from typing import List, Dict
import httpx
import json
import os
import uuid
import chromadb
from chromadb.config import Settings
from chromadb.utils import embedding_functions
from app.core.logger import logger

class ExternalKBClient:
    """
    基于 ChromaDB 的向量知识库客户端
    """
    def __init__(self):
        # 1. 初始化 ChromaDB 本地持久化客户端
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        db_path = os.path.join(base_dir, "data", "chroma_db")
        os.makedirs(db_path, exist_ok=True)
        
        self.chroma_client = chromadb.PersistentClient(path=db_path)
        
        # 2. 初始化开源轻量级 Embedding 模型 (这里使用 HuggingFace 默认的轻量中文模型)
        # 注意: 初次运行会下载模型文件，大概需要几十 MB
        self.embedding_func = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="paraphrase-multilingual-MiniLM-L12-v2")
        
        # 3. 获取或创建 Collection
        self.collection = self.chroma_client.get_or_create_collection(
            name="bank_knowledge_base",
            embedding_function=self.embedding_func
        )
        
        # 4. 加载并向量化本地模拟知识库
        self._init_knowledge_base(base_dir)

    def _init_knowledge_base(self, base_dir: str):
        """
        读取本地 JSON 文件，并将其嵌入（Embedding）到 ChromaDB 向量库中。
        为了避免重复嵌入，如果集合中已经有数据，则跳过。
        """
        if self.collection.count() > 0:
            logger.info(f"向量知识库已存在，共 {self.collection.count()} 条记录，跳过初始化。")
            return

        json_path = os.path.join(base_dir, "data", "mock_kb.json")
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                mock_data = json.load(f)
            
            logger.info("开始向 ChromaDB 向量化导入业务知识库...")
            
            documents = []
            metadatas = []
            ids = []
            
            for item in mock_data:
                # 组合成需要被检索的核心语义文本
                doc_text = f"关键词: {', '.join(item['keywords'])}\n内容: {item['content']}"
                
                documents.append(doc_text)
                # 将结构化信息存入 metadata 以便后续调用
                metadatas.append({"node_id": item["node_id"], "content": item["content"]})
                ids.append(item["node_id"])
            
            # 批量写入向量数据库 (会自动调用 embedding_func 生成向量)
            self.collection.add(
                documents=documents,
                metadatas=metadatas,
                ids=ids
            )
            logger.info(f"成功向量化导入 {len(ids)} 条业务知识节点。")
            
        except Exception as e:
            logger.error(f"初始化向量知识库失败: {e}")

    async def add_knowledge(self, nodes: List[Dict], trace_id: str = "N/A"):
        """
        动态添加新的知识节点到向量库
        """
        if not nodes:
            return
            
        logger.bind(trace_id=trace_id).info(f"开始向 ChromaDB 动态添加 {len(nodes)} 条新知识...")
        
        documents = []
        metadatas = []
        ids = []
        
        for item in nodes:
            # 兼容 builder 传过来的格式
            keywords = item.get('keywords', [])
            rule_content = item.get('rule_content', '')
            title = item.get('title', '')
            node_id = item.get('node_id') or f"kb_dynamic_{uuid.uuid4().hex[:8]}"
            
            doc_text = f"标题: {title}\n关键词: {', '.join(keywords)}\n内容: {rule_content}"
            
            documents.append(doc_text)
            metadatas.append({"node_id": node_id, "content": doc_text})
            ids.append(node_id)
            
        try:
            self.collection.add(
                documents=documents,
                metadatas=metadatas,
                ids=ids
            )
            logger.bind(trace_id=trace_id).info(f"成功向 ChromaDB 添加了 {len(ids)} 条新知识。")
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"动态添加知识失败: {e}")

    async def search_knowledge(self, query: str, top_k: int = 5, trace_id: str = "N/A") -> List[Dict[str, str]]:
        """
        向 ChromaDB 发起语义向量检索
        """
        logger.bind(trace_id=trace_id).info(f"正在执行向量检索: query='{query}', top_k={top_k}")
        
        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=top_k
            )
            
            # ChromaDB 的 query 结果格式: {'ids': [['id1', 'id2']], 'metadatas': [[{...}, {...}]], 'distances': [[...]]}
            if results['metadatas'] and len(results['metadatas']) > 0:
                top_results = []
                for i in range(len(results['metadatas'][0])):
                    meta = results['metadatas'][0][i]
                    dist = results['distances'][0][i] if 'distances' in results and results['distances'] else 0
                    # 对于归一化的向量，L2 距离与余弦相似度的转换：similarity ≈ 1 - (dist / 2)
                    similarity = max(0.0, 1.0 - (dist / 2.0))
                    # 转成百分比形式，保留一位小数
                    meta['similarity'] = f"{similarity * 100:.1f}%"
                    top_results.append(meta)
                return top_results
            return []
            
        except Exception as e:
            logger.error(f"向量检索失败: {e}")
            return []

    async def get_node_by_id(self, node_id: str, trace_id: str = "N/A") -> Dict[str, str]:
        """
        根据知识点 ID 从向量库获取具体的文档内容
        """
        logger.bind(trace_id=trace_id).info(f"获取特定知识点内容: node_id='{node_id}'")

        try:
            results = self.collection.get(ids=[node_id])
            if results['metadatas'] and len(results['metadatas']) > 0:
                return results['metadatas'][0]
        except Exception as e:
            logger.error(f"获取知识点内容失败: {e}")

        return {
            "node_id": node_id,
            "content": f"未找到 node_id 为 {node_id} 的知识点"
        }

    async def get_all_nodes(self, trace_id: str = "N/A") -> List[Dict]:
        """获取知识库中所有节点（用于业务线提取等全局分析）"""
        logger.bind(trace_id=trace_id).info("获取知识库全部节点")
        try:
            results = self.collection.get()
            nodes = []
            if results and results.get('metadatas'):
                for i, meta in enumerate(results['metadatas']):
                    node_id = results['ids'][i] if results.get('ids') else f"node_{i}"
                    nodes.append({
                        "node_id": node_id,
                        "content": meta.get("content", "")
                    })
            logger.bind(trace_id=trace_id).info(f"知识库共 {len(nodes)} 条节点")
            return nodes
        except Exception as e:
            logger.error(f"获取全部节点失败: {e}")
            return []

    async def update_nodes_business_line(self, node_business_map: Dict[str, str], trace_id: str = "N/A"):
        """
        批量更新知识库节点的业务线标签（写入 ChromaDB metadata）
        node_business_map: {node_id: business_line}
        """
        logger.bind(trace_id=trace_id).info(f"开始更新 {len(node_business_map)} 个节点的业务线标签")
        try:
            for node_id, business_line in node_business_map.items():
                results = self.collection.get(ids=[node_id])
                if results['metadatas'] and len(results['metadatas']) > 0:
                    meta = results['metadatas'][0]
                    meta['business_line'] = business_line
                    self.collection.update(ids=[node_id], metadatas=[meta])
            logger.bind(trace_id=trace_id).info("节点业务线标签更新完成")
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"更新节点业务线标签失败: {e}")

    async def get_node_business_line(self, node_id: str) -> str:
        """获取某个知识库节点的业务线标签，没有则返回 None"""
        try:
            results = self.collection.get(ids=[node_id])
            if results['metadatas'] and len(results['metadatas']) > 0:
                return results['metadatas'][0].get('business_line')
        except Exception:
            pass
        return None

    async def delete_node(self, node_id: str, trace_id: str = "N/A"):
        """删除知识库节点"""
        logger.bind(trace_id=trace_id).info(f"删除知识库节点: {node_id}")
        try:
            self.collection.delete(ids=[node_id])
            logger.bind(trace_id=trace_id).info(f"节点 {node_id} 删除成功")
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"删除节点失败: {e}")

    async def set_node_business_line(self, node_id: str, business_line: str, trace_id: str = "N/A"):
        """设置单个节点的业务线标签"""
        try:
            results = self.collection.get(ids=[node_id])
            if results['metadatas'] and len(results['metadatas']) > 0:
                meta = results['metadatas'][0]
                meta['business_line'] = business_line
                self.collection.update(ids=[node_id], metadatas=[meta])
                logger.bind(trace_id=trace_id).info(f"节点 {node_id} 业务线设置为: {business_line}")
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"设置节点业务线失败: {e}")

    async def get_all_nodes_with_business_line(self, trace_id: str = "N/A") -> List[Dict]:
        """获取所有节点，包含业务线标签"""
        logger.bind(trace_id=trace_id).info("获取知识库全部节点（含业务线）")
        try:
            results = self.collection.get()
            nodes = []
            if results and results.get('metadatas'):
                for i, meta in enumerate(results['metadatas']):
                    node_id = results['ids'][i] if results.get('ids') else f"node_{i}"
                    nodes.append({
                        "node_id": node_id,
                        "content": meta.get("content", ""),
                        "business_line": meta.get("business_line", None)
                    })
            logger.bind(trace_id=trace_id).info(f"知识库共 {len(nodes)} 条节点")
            return nodes
        except Exception as e:
            logger.error(f"获取全部节点失败: {e}")
            return []

external_kb = ExternalKBClient()
