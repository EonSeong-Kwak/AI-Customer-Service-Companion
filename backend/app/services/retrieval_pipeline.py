"""
高级检索管线 V3.0
包含：查询改写 → 多路召回 → 重排序 → 画像感知过滤 → 降级策略
"""
import os
import json
import asyncio
from typing import List, Dict, Optional
from whoosh.index import create_in, exists_in, open_dir
from whoosh.fields import Schema, TEXT, ID, STORED
from whoosh.qparser import MultifieldParser, OrGroup
from whoosh import analysis
from app.services.llm_adapter import llm_client
from app.services.external_kb import external_kb
from app.core.logger import logger


class QueryRewriter:
    """查询改写器：将口语化提问改写为结构化检索词"""
    
    QUERY_REWRITE_PROMPT = """你是一个银行客服培训系统的查询改写助手。
请将用户的口语化提问改写为多个结构化检索词，提升检索准确率。

用户查询：{user_query}

请输出 JSON（不要包含多余文本和```标记）：
{{
    "main_query": "核心检索词",
    "sub_queries": [
        "子检索词1",
        "子检索词2",
        "子检索词3"
    ],
    "intent_tags": ["业务流程", "风控规则"],
    "expected_content_type": "sop|rule|case|faq"
}}
"""
    
    async def rewrite(self, user_query: str, trace_id: str = "N/A") -> dict:
        """改写查询，返回结构化检索词"""
        logger.bind(trace_id=trace_id).info(f"查询改写开始: {user_query}")
        try:
            prompt = self.QUERY_REWRITE_PROMPT.format(user_query=user_query)
            messages = [{"role": "user", "content": prompt}]
            response = await llm_client.async_chat_completion(messages, trace_id=trace_id)
            
            # 清理响应文本
            import re
            content = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL)
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                result = json.loads(match.group(0))
                logger.bind(trace_id=trace_id).info(f"查询改写结果: {result}")
                return result
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"查询改写失败: {e}")
        
        # 降级：返回原始查询
        return {
            "main_query": user_query,
            "sub_queries": [user_query],
            "intent_tags": [],
            "expected_content_type": "sop"
        }


class BM25Retriever:
    """BM25 关键词检索器（基于 Whoosh）"""
    
    def __init__(self):
        self.index_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            "data", "whoosh_index"
        )
        os.makedirs(self.index_dir, exist_ok=True)
        self.schema = Schema(
            node_id=ID(stored=True, unique=True),
            content=TEXT(stored=True, analyzer=analysis.StemmingAnalyzer()),
            keywords=TEXT(stored=True, analyzer=analysis.StemmingAnalyzer())
        )
        self._ensure_index()
    
    def _ensure_index(self):
        """确保索引存在，如果不存在则创建"""
        if not exists_in(self.index_dir):
            create_in(self.index_dir, self.schema)
            logger.info("Whoosh 索引已创建")
    
    def rebuild_index(self, documents: List[Dict]):
        """重建索引（用于知识库更新时）"""
        ix = open_dir(self.index_dir)
        writer = ix.writer()
        # 清空旧索引
        writer.commit_optimize()
        
        for doc in documents:
            writer.add_document(
                node_id=doc.get("node_id", ""),
                content=doc.get("content", ""),
                keywords=doc.get("keywords", "")
            )
        writer.commit()
        logger.info(f"Whoosh 索引重建完成，共 {len(documents)} 条文档")
    
    async def search(self, query: str, top_k: int = 10, trace_id: str = "N/A") -> List[Dict]:
        """BM25 关键词检索"""
        logger.bind(trace_id=trace_id).info(f"BM25 检索: query='{query}', top_k={top_k}")
        try:
            ix = open_dir(self.index_dir)
            with ix.searcher() as searcher:
                parser = MultifieldParser(["content", "keywords"], schema=self.schema, group=OrGroup)
                q = parser.parse(query)
                results = searcher.search(q, limit=top_k)
                
                top_results = []
                for hit in results:
                    top_results.append({
                        "node_id": hit["node_id"],
                        "content": hit["content"],
                        "score": float(hit.score),
                        "source": "bm25"
                    })
                return top_results
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"BM25 检索失败: {e}")
            return []


class Reranker:
    """重排序器：对多路召回结果统一打分排序"""

    def __init__(self):
        self._reranker_model = None
        self._load_attempted = False

    def _load_reranker(self):
        """延迟加载 reranker 模型（只在首次调用时尝试加载）
        需要设置环境变量 ENABLE_RERANKER=1 才启用，避免首次下载 185MB 模型阻塞请求
        """
        if self._load_attempted:
            return
        self._load_attempted = True
        import os
        if os.environ.get("ENABLE_RERANKER", "0") != "1":
            logger.info("BGE Reranker 未启用（设置环境变量 ENABLE_RERANKER=1 以启用），使用降级关键词覆盖率评分")
            self._reranker_model = None
            return
        try:
            from FlagEmbedding import FlagReranker
            self._reranker_model = FlagReranker('BAAI/bge-reranker-base', use_fp16=True)
            logger.info("BGE Reranker 模型加载成功")
        except Exception as e:
            logger.warning(f"BGE Reranker 模型加载失败（将使用降级评分）: {e}")
            self._reranker_model = None
    
    def _keyword_coverage(self, query: str, candidate_content: str) -> float:
        """计算关键词覆盖率（降级评分）"""
        query_words = set(query.lower().split())
        content_words = set(candidate_content.lower().split())
        if not query_words:
            return 0.0
        coverage = len(query_words & content_words) / len(query_words)
        return coverage
    
    def _business_weight(self, content: str) -> float:
        """业务权重：风控 > 话术 > 流程"""
        if any(kw in content for kw in ["风控", "风险", "限额", "冻结"]):
            return 1.0
        elif any(kw in content for kw in ["话术", "安抚", "道歉", "同理心"]):
            return 0.9
        elif any(kw in content for kw in ["流程", "步骤", "操作", "SOP"]):
            return 0.8
        return 0.5
    
    def rerank(self, query: str, candidates: List[Dict], top_k: int = 5, trace_id: str = "N/A") -> List[Dict]:
        """对候选结果重排序"""
        if not candidates:
            return []

        # 延迟加载 Reranker 模型
        self._load_reranker()

        logger.bind(trace_id=trace_id).info(f"重排序开始，候选数: {len(candidates)}")
        scored = []

        for candidate in candidates:
            content = candidate.get("content", "")

            if self._reranker_model:
                # 使用 BGE Reranker
                try:
                    score = self._reranker_model.compute_score([[query, content]], normalize=True)
                    if isinstance(score, list):
                        score = score[0]
                except Exception:
                    score = self._keyword_coverage(query, content)
            else:
                # 降级：关键词覆盖率
                score = self._keyword_coverage(query, content)
            
            # 综合得分 = 语义相关性 * 0.5 + 关键词覆盖率 * 0.3 + 业务权重 * 0.2
            final_score = (
                float(score) * 0.5 +
                self._keyword_coverage(query, content) * 0.3 +
                self._business_weight(content) * 0.2
            )
            scored.append((candidate, final_score))
        
        scored.sort(key=lambda x: x[1], reverse=True)
        result = [item[0] for item in scored[:top_k]]
        logger.bind(trace_id=trace_id).info(f"重排序完成，返回 Top-{len(result)}")
        return result


class ProfileAwareFilter:
    """画像感知过滤器：根据用户画像调整最终结果"""
    
    def filter(self, candidates: List[Dict], user_profile: Optional[dict] = None, trace_id: str = "N/A") -> List[Dict]:
        """根据用户画像过滤和重排结果"""
        if not user_profile:
            return candidates[:5]
        
        feynman_progress = user_profile.get("feynman_progress", 0.5)
        weaknesses = user_profile.get("weaknesses", [])
        
        filtered = []
        priority_items = []
        
        for candidate in candidates:
            content = candidate.get("content", "")
            
            # 有弱点 → 强制包含相关文档
            is_weakness_related = False
            for w in weaknesses:
                if w and w in content:
                    is_weakness_related = True
                    break
            
            if is_weakness_related:
                priority_items.append(candidate)
            else:
                filtered.append(candidate)
        
        # 弱点相关文档排前面
        result = priority_items + filtered
        logger.bind(trace_id=trace_id).info(
            f"画像过滤完成，优先项: {len(priority_items)}, 总计: {len(result[:5])}"
        )
        return result[:5]


class RetrievalPipeline:
    """高级检索管线主入口"""
    
    def __init__(self):
        self.query_rewriter = QueryRewriter()
        self.bm25_retriever = BM25Retriever()
        self.reranker = Reranker()
        self.profile_filter = ProfileAwareFilter()
    
    async def search(
        self,
        query: str,
        top_k: int = 5,
        user_profile: Optional[dict] = None,
        trace_id: str = "N/A"
    ) -> List[Dict]:
        """
        完整检索流程：查询改写 → 多路召回 → 重排序 → 画像过滤
        任何步骤失败都会降级
        """
        logger.bind(trace_id=trace_id).info(f"高级检索管线启动: query='{query}'")
        
        try:
            # Step 1: 查询改写
            rewrite_result = await self.query_rewriter.rewrite(query, trace_id=trace_id)
            main_query = rewrite_result.get("main_query", query)
            sub_queries = rewrite_result.get("sub_queries", [query])
            all_queries = [main_query] + sub_queries
            
            # Step 2: 多路召回（并行）
            vector_tasks = [external_kb.search_knowledge(q, top_k=10, trace_id=trace_id) for q in all_queries[:2]]
            bm25_tasks = [self.bm25_retriever.search(q, top_k=10, trace_id=trace_id) for q in all_queries[:2]]
            
            vector_results_flat = []
            bm25_results_flat = []
            
            try:
                vector_results = await asyncio.gather(*vector_tasks, return_exceptions=True)
                for r in vector_results:
                    if isinstance(r, list):
                        vector_results_flat.extend(r)
            except Exception as e:
                logger.bind(trace_id=trace_id).error(f"向量检索失败: {e}")
            
            try:
                bm25_results = await asyncio.gather(*bm25_tasks, return_exceptions=True)
                for r in bm25_results:
                    if isinstance(r, list):
                        bm25_results_flat.extend(r)
            except Exception as e:
                logger.bind(trace_id=trace_id).error(f"BM25检索失败: {e}")
            
            # 合并去重
            all_results = vector_results_flat + bm25_results_flat
            unique_results = self._deduplicate(all_results)
            
            if not unique_results:
                # 降级：直接用原始查询做向量检索
                logger.bind(trace_id=trace_id).warning("多路召回无结果，降级到原始查询向量检索")
                unique_results = await external_kb.search_knowledge(query, top_k=10, trace_id=trace_id)
            
            # Step 3: 重排序
            reranked = self.reranker.rerank(main_query, unique_results, top_k=10, trace_id=trace_id)
            
            # Step 4: 画像感知过滤
            final = self.profile_filter.filter(reranked, user_profile, trace_id=trace_id)
            
            logger.bind(trace_id=trace_id).info(
                f"检索管线完成: 向量{len(vector_results_flat)} + BM25{len(bm25_results_flat)} "
                f"→ 去重{len(unique_results)} → 重排{len(reranked)} → 最终{len(final)}"
            )
            return final
            
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"检索管线异常，完全降级: {e}")
            # 完全降级：直接向量检索
            try:
                return await external_kb.search_knowledge(query, top_k=top_k, trace_id=trace_id)
            except Exception:
                return []
    
    def _deduplicate(self, results: List[Dict]) -> List[Dict]:
        """去重：按 node_id 去重，保留得分高的"""
        seen = {}
        for r in results:
            node_id = r.get("node_id", "")
            if node_id not in seen:
                seen[node_id] = r
            else:
                # 保留信息更全的
                if "score" not in seen[node_id] and "score" in r:
                    seen[node_id] = r
        return list(seen.values())


# 全局实例
retrieval_pipeline = RetrievalPipeline()
