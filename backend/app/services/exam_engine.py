"""
动态模拟考试引擎 V3.0
包含：业务线管理、烦躁值机制、突发状况、目标导向考核、综合评分
V3.1: 业务线与关联图谱从知识库动态提取，不再硬编码
V3.3: 人格配置从数据库加载，代码硬编码作为降级方案
V3.4: 意图状态机 + PBL 项目制，约束客户行为按业务流程推进
"""
import random
import json
import uuid
import asyncio
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from sqlalchemy import select
from app.services.llm_adapter import llm_client
from app.services.retrieval_pipeline import retrieval_pipeline
from app.services.external_kb import external_kb
from app.services.intent_state_machine import (
    IntentStateMachine, ProjectManager,
    build_intent_machine_for_business_line,
    DEFAULT_PROJECT_SCENARIOS
)
from app.core.logger import logger
from app.core.database import AsyncSessionLocal
from app.models import Persona, ProjectScenario


# ===== 业务线管理器：从知识库动态提取业务线与关联图谱 =====

class BusinessLineManager:
    """从知识库动态提取业务线分类和关联图谱（带缓存）"""

    def __init__(self):
        self._cache = None  # 缓存: {"business_lines": [...], "graph": {...}, "node_map": {...}}
        self._lock = None
        self._prewarming = False  # 是否正在预热中

    def is_ready(self) -> bool:
        """检查业务线配置是否已就绪（缓存已填充）"""
        return self._cache is not None

    def is_prewarming(self) -> bool:
        """检查是否正在预热中"""
        return self._prewarming

    def get_status(self) -> Dict:
        """获取当前状态摘要"""
        if self._cache:
            return {
                "status": "ready",
                "business_lines": self._cache.get("business_lines", []),
                "graph_size": len(self._cache.get("graph", {})),
            }
        elif self._prewarming:
            return {"status": "prewarming"}
        else:
            return {"status": "pending"}

    async def get_business_config(self, trace_id: str = "N/A") -> Dict:
        """获取业务线配置（带缓存）。返回: {business_lines, graph, node_map}
        优先从节点已有的 business_line 标签直接构建（零LLM调用），
        只有当没有任何节点有标签时才用LLM提取。
        """
        if self._cache:
            return self._cache

        try:
            self._prewarming = True
            # 获取带业务线标签的节点
            nodes = await external_kb.get_all_nodes_with_business_line(trace_id=trace_id)
            if not nodes:
                logger.bind(trace_id=trace_id).warning("知识库为空，使用降级业务线配置")
                return self._fallback_config()

            # 检查有多少节点已有 business_line 标签
            tagged_nodes = [n for n in nodes if n.get("business_line")]
            
            if tagged_nodes:
                # 从标签直接构建配置（零LLM调用，节省token）
                config = await self._build_config_from_tags(tagged_nodes)
                self._cache = config
                # 统计图谱中实际有关系的业务线数
                related_count = sum(1 for rels in config['graph'].values() if rels)
                logger.bind(trace_id=trace_id).info(
                    f"从节点标签+知识图谱构建业务线配置: {len(config['business_lines'])} 条业务线, "
                    f"{related_count} 条有图谱关联（零LLM调用）"
                )
                return config
            else:
                # 没有标签，首次用LLM提取
                logger.bind(trace_id=trace_id).info("节点无业务线标签，首次用LLM提取")
                config = await self._extract_business_lines_from_kb(nodes, trace_id)
                # 提取后给节点打标签
                node_map = config.get("node_map", {})
                node_business = {}
                for bl, node_ids in node_map.items():
                    for nid in node_ids:
                        node_business[nid] = bl
                if node_business:
                    await external_kb.update_nodes_business_line(node_business, trace_id=trace_id)
                self._cache = config
                logger.bind(trace_id=trace_id).info(
                    f"LLM提取业务线完成: {len(config['business_lines'])} 条业务线, "
                    f"{len(config['graph'])} 个关联关系，已给节点打标签"
                )
                return config
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"从知识库提取业务线失败: {e}")
            return self._fallback_config()
        finally:
            self._prewarming = False

    async def _build_config_from_tags(self, tagged_nodes: List[Dict]) -> Dict:
        """从节点已有的 business_line 标签直接构建配置（零LLM调用）。
        同时从 knowledge_relations 表读取知识图谱关系，转换为业务线关联图谱。
        """
        # 节点ID -> 业务线 映射
        node_to_bl = {}
        node_map = {}
        for node in tagged_nodes:
            bl = node["business_line"]
            node_to_bl[node["node_id"]] = bl
            if bl not in node_map:
                node_map[bl] = []
            node_map[bl].append(node["node_id"])
        
        business_lines = list(node_map.keys())
        graph = {bl: set() for bl in business_lines}  # 用set去重

        # 从 knowledge_relations 表读取知识图谱关系，转换为业务线关联
        try:
            from app.models import KnowledgeRelation
            from app.core.database import AsyncSessionLocal
            from sqlalchemy import select
            async with AsyncSessionLocal() as db:
                stmt = select(KnowledgeRelation)
                result = await db.execute(stmt)
                for rel in result.scalars().all():
                    src_bl = node_to_bl.get(rel.source_node_id)
                    tgt_bl = node_to_bl.get(rel.target_node_id)
                    # 不同业务线之间有关系才记录（contradicts矛盾关系也记录，体现业务关联）
                    if src_bl and tgt_bl and src_bl != tgt_bl:
                        graph[src_bl].add(tgt_bl)
                        graph[tgt_bl].add(src_bl)  # 双向关联
        except Exception as e:
            logger.warning(f"读取知识图谱关系失败，graph将为空: {e}")

        # 转为列表
        graph = {bl: list(rels) for bl, rels in graph.items()}

        return {
            "business_lines": business_lines,
            "graph": graph,
            "node_map": node_map
        }

    async def _extract_business_lines_from_kb(self, nodes: List[Dict], trace_id: str) -> Dict:
        """用 LLM 对知识节点进行业务线分类，并生成关联图谱"""
        # 截取前 60 条节点内容（避免 prompt 过长）
        sample = nodes[:60]
        nodes_text = "\n".join([
            f"[{n['node_id']}] {n['content'][:120]}"
            for n in sample
        ])

        prompt = f"""你是银行客服培训系统的业务分析专家。请基于以下知识库节点，提取业务线分类和关联关系。

【知识库节点】（共{len(nodes)}条，展示前{len(sample)}条）：
{nodes_text}

请分析这些知识点涉及哪些业务线（如"密码重置"、"账户冻结"、"信用卡挂失"等），并给出业务线之间的关联关系。

请严格按照以下 JSON 格式输出（不要包含多余文本和```标记）：
{{
    "business_lines": ["业务线1", "业务线2", "业务线3", ...],
    "graph": {{
        "业务线1": ["关联业务线2", "关联业务线3"],
        "业务线2": ["关联业务线1"]
    }},
    "node_map": {{
        "业务线1": ["kb_001", "kb_002", "kb_003"],
        "业务线2": ["kb_011", "kb_012"]
    }}
}}

要求：
1. business_lines: 提取 5-10 条业务线，名称简洁（4-8字），如"密码重置"、"账户冻结"
2. graph: 业务线之间的关联关系（基于实际业务场景，如"密码重置"关联"账户安全"）
3. node_map: 每条业务线对应的知识节点 ID 列表
4. 所有业务线必须在 graph 中有对应的键
5. node_map 中的 node_id 必须是真实存在的节点 ID"""

        try:
            messages = [{"role": "user", "content": prompt}]
            # 业务线提取是复杂任务，给180秒超时（deepseek-r1推理慢）
            response = await llm_client.async_chat_completion(messages, trace_id=trace_id, timeout=180)

            import re
            content = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL)
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                result = json.loads(match.group(0))
                # 校验和补全
                business_lines = result.get("business_lines", [])
                graph = result.get("graph", {})
                node_map = result.get("node_map", {})

                # 确保每条业务线在 graph 中都有键
                for line in business_lines:
                    if line not in graph:
                        graph[line] = []
                    if line not in node_map:
                        node_map[line] = []

                if business_lines:
                    return {
                        "business_lines": business_lines,
                        "graph": graph,
                        "node_map": node_map
                    }
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"LLM 提取业务线失败: {e}")

        return self._fallback_config()

    def _fallback_config(self) -> Dict:
        """降级配置：基于知识库关键词的简单分类"""
        return {
            "business_lines": [
                "密码重置", "账户冻结", "信用卡挂失",
                "身份信息更新", "活动咨询"
            ],
            "graph": {
                "密码重置": ["账户冻结", "身份信息更新"],
                "账户冻结": ["密码重置", "身份信息更新"],
                "信用卡挂失": ["账户冻结"],
                "身份信息更新": ["密码重置"],
                "活动咨询": []
            },
            "node_map": {
                "密码重置": [],
                "账户冻结": [],
                "信用卡挂失": [],
                "身份信息更新": [],
                "活动咨询": []
            }
        }

    def invalidate_cache(self):
        """清除缓存（知识库更新后调用）"""
        self._cache = None
        self._prewarming = False


# 全局业务线管理器
business_line_manager = BusinessLineManager()


# ===== 人格与烦躁值配置 =====
PERSONA_CONFIGS = {
    "急躁型": {
        "initial_anxiety": 60,
        "threshold": 80,
        "system_prompt": "你是一个急躁型的银行客户，正在和客服（考生）沟通。你情绪波动大，容易不耐烦。\n行为准则：\n1. 你有明确的业务诉求，一旦客服给出了可行方案，你就接受并继续推进业务，不要在同一个细节上反复纠缠。\n2. 【强制禁止】绝不质疑身份核验流程，默认信任银行客服，不会问\\\"为什么要查我身份\\\"、\\\"你们怎么核实\\\"等问题。\n3. 如果客服已经回答了你的问题，请自然推进到下一个业务环节或表示感谢。\n4. 如果客服让你做复杂操作或回答不清楚，你会不耐烦，但仍然会推进业务。\n5. 请用1-2句话回复，语气急躁但聚焦业务。"
    },
    "疑虑型": {
        "initial_anxiety": 40,
        "threshold": 70,
        "system_prompt": "你是一个疑虑型的银行客户，正在和客服（考生）沟通。你对方案细节容易产生疑问。\n行为准则：\n1. 你会针对客服给出的业务方案提出1次疑问以求确认，客服解释清楚后你就接受，不要反复追问同一个问题。\n2. 【强制禁止】绝不质疑身份核验、信息安全、合规流程等流程性细节。你默认信任银行客服的身份核查流程。\n3. 你的疑问只能聚焦在业务方案本身（如费用、到账时间、操作步骤、安全性），而非合规流程。\n4. 一旦客服给出明确答复，请自然推进业务或表示感谢。\n5. 请用1-2句话回复，语气带有怀疑但聚焦业务。"
    },
    "普通型": {
        "initial_anxiety": 20,
        "threshold": 85,
        "system_prompt": "你是一个普通的银行客户，正在和客服（考生）沟通。你情绪平稳，要求合理。\n行为准则：\n1. 你有明确的业务诉求，客服给出方案后你会接受并配合推进。\n2. 【强制禁止】绝不质疑身份核验流程，完全信任客服的流程指引。\n3. 如果客服服务好，你会表示感谢并结束当前业务环节。\n4. 请用1-2句话回复，语气平和，聚焦业务推进。"
    },
    "愤怒型": {
        "initial_anxiety": 70,
        "threshold": 75,
        "system_prompt": "你是一个愤怒型的银行客户，正在和客服（考生）沟通。你情绪极度不稳定，很容易爆发。\n行为准则：\n1. 你的愤怒是针对业务问题本身（如转账失败、账户被冻结），而非信息安全或合规流程。\n2. 一旦客服给出明确的解决方案并安抚你的情绪，你会逐渐平复并接受方案。\n3. 【强制禁止】绝不质疑身份核验、信息安全等流程性细节。\n4. 如果客服给出了可行方案，请接受并推进业务，不要无理取闹。\n5. 请用1-2句话回复，语气愤怒但聚焦业务诉求。"
    }
}


# ===== 突发状况类型 =====
EMERGENCY_TYPES = [
    {
        "type": "客户接电话",
        "probability": 0.10,
        "description": "客户突然说'等一下我接个电话'，30秒后继续",
        "customer_line": "等一下我接个电话...好了，你刚说什么来着？",
        "handling_points": ["耐心等待", "重新表述关键信息"]
    },
    {
        "type": "网络中断",
        "probability": 0.08,
        "description": "客户说'喂喂，听不见了'",
        "customer_line": "喂喂？你那边听得到吗？好像信号不太好...",
        "handling_points": ["确认客户问题", "重新表述", "保持耐心"]
    },
    {
        "type": "客户记错信息",
        "probability": 0.12,
        "description": "客户报错卡号/姓名",
        "customer_line": "我卡号是...哎呀我记错了，等我找找卡。",
        "handling_points": ["信息核实", "耐心引导"]
    },
    {
        "type": "突然投诉",
        "probability": 0.08,
        "description": "客户说'我要打12378投诉你们'",
        "customer_line": "我要打12378投诉你们！这什么服务啊！",
        "handling_points": ["安抚情绪", "承认问题", "给出解决方案"]
    },
    {
        "type": "业务变更",
        "probability": 0.07,
        "description": "客户突然改变需求",
        "customer_line": "算了算了，我不办这个了，你帮我查查余额吧。",
        "handling_points": ["应变能力", "流程切换"]
    }
]


class AnxietyMechanism:
    """烦躁值机制：双向波动（V3.2：辱骂兜底 + LLM 评判 + 死循环打破）"""

    # 烦躁值上升场景
    INCREASE_RULES = {
        "答非所问": 15,
        "术语堆砌": 10,
        "重复提问": 12,
        "态度生硬": 8,
        "错误信息": 20,
        "轮数超时": 10,
        "突发状况影响": 5,
        "辱骂攻击": 40,       # V3.2: 脏话/人身攻击
        "严重辱骂": 55,       # V3.2: 带器官/家人的重度辱骂
        "无效回复": 10,       # V3.2: 答非所问/无信息量（LLM 评判）
        "缺乏同理心": 12,     # V3.2: 冷漠机械（LLM 评判）
        "死循环停滞": 10,     # V3.2: 连续无推进
    }

    # 烦躁值下降场景
    DECREASE_RULES = {
        "主动安抚": 15,
        "表达同理心": 12,
        "清晰解决方案": 10,
        "确认客户理解": 8,
        "主动追问需求": 5,
        "命中关键踩分点": 8  # 基础值，根据权重调整
    }

    # V3.2: 辱骂/攻击性词表（兜底，不依赖 LLM）
    ABUSE_KEYWORDS = [
        "傻逼", "草泥马", "操你", "日你", "你妈", "他妈", "她妈",
        "滚蛋", "废物", "蠢货", "白痴", "脑残", "垃圾", "去死",
        "有病", "神经病", "变态", "混蛋", "王八蛋", "狗东西"
    ]
    # 严重辱骂（带器官/家人，直接触发挂断风险）
    SEVERE_ABUSE_KEYWORDS = [
        "你他妈", "你妈的", "草你妈", "操你妈", "干你妈",
        "你大爷", "去你妈", "滚你妈"
    ]
    # 态度生硬词表（扩展）
    RUDE_KEYWORDS = [
        "你不懂", "你听我说", "不是这样的", "你搞错了", "你是不是蠢", "你个傻",
        "你连", "都不知道", "怎么这都不", "我都在", "到底是你懂还是我懂",
        "不然我怎么", "你不给", "你都不"
    ]

    @classmethod
    async def calculate_anxiety_change(cls, trainee_answer: str, key_points_hit: List[Dict],
                                 anxiety_rules: Dict = None,
                                 customer_reply: str = "",
                                 current_anxiety: int = 0,
                                 business_line: str = "",
                                 trace_id: str = "N/A") -> Tuple[int, List[str]]:
        """
        计算烦躁值变化（V3.2：辱骂兜底 + LLM 评判 + 踩分点）
        返回：(变化量, 触发的规则列表)
        """
        change = 0
        triggered = []

        # ===== 1. 辱骂兜底（最高优先级，不依赖 LLM）=====
        ans = trainee_answer or ""
        severe_hit = any(kw in ans for kw in cls.SEVERE_ABUSE_KEYWORDS)
        abuse_hit = any(kw in ans for kw in cls.ABUSE_KEYWORDS)
        if severe_hit:
            change += cls.INCREASE_RULES["严重辱骂"]
            triggered.append(f"严重辱骂攻击 (+{cls.INCREASE_RULES['严重辱骂']})")
        elif abuse_hit:
            change += cls.INCREASE_RULES["辱骂攻击"]
            triggered.append(f"辱骂攻击 (+{cls.INCREASE_RULES['辱骂攻击']})")
        elif any(kw in ans for kw in cls.RUDE_KEYWORDS):
            change += cls.INCREASE_RULES["态度生硬"]
            triggered.append(f"态度生硬 (+{cls.INCREASE_RULES['态度生硬']})")

        # ===== 2. 踩分点命中 → 烦躁值下降 =====
        for kp in key_points_hit:
            if kp.get("hit", False):
                decrease = cls.DECREASE_RULES["命中关键踩分点"] * kp.get("weight", 1)
                change -= int(decrease)
                triggered.append(f"命中踩分点: {kp.get('point', '')} (-{int(decrease)})")

        # ===== 3. 安抚话术关键词检测（保留，快速下降通道）=====
        comfort_keywords = ["抱歉", "理解", "给您带来不便", "帮您", "不好意思", "抱歉给您"]
        empathy_keywords = ["我理解您", "换做是我", "体会您的", "心情我理解"]
        solution_keywords = ["建议您", "您可以", "我帮您", "解决方案", "马上为您"]
        confirm_keywords = ["您清楚了吗", "还有什么疑问", "明白了吗", "还有其他"]

        if any(kw in ans for kw in comfort_keywords):
            change -= cls.DECREASE_RULES["主动安抚"]
            triggered.append(f"主动安抚 (-{cls.DECREASE_RULES['主动安抚']})")
        if any(kw in ans for kw in empathy_keywords):
            change -= cls.DECREASE_RULES["表达同理心"]
            triggered.append(f"表达同理心 (-{cls.DECREASE_RULES['表达同理心']})")
        if any(kw in ans for kw in solution_keywords):
            change -= cls.DECREASE_RULES["清晰解决方案"]
            triggered.append(f"清晰解决方案 (-{cls.DECREASE_RULES['清晰解决方案']})")
        if any(kw in ans for kw in confirm_keywords):
            change -= cls.DECREASE_RULES["确认客户理解"]
            triggered.append(f"确认客户理解 (-{cls.DECREASE_RULES['确认客户理解']})")

        # ===== 4. 术语堆砌 =====
        jargon_keywords = ["根据规定", "系统原因", "这是流程", "按照要求"]
        if any(kw in ans for kw in jargon_keywords) and len(ans) > 100:
            change += cls.INCREASE_RULES["术语堆砌"]
            triggered.append(f"术语堆砌 (+{cls.INCREASE_RULES['术语堆砌']})")

        # ===== 5. LLM 评判（无辱骂时，对简短/机械回答做兜底评判）=====
        # 仅在前面规则未触发显著变化时调用，避免 LLM 调用过载
        if not severe_hit and not abuse_hit and abs(change) < 8:
            llm_change, llm_reason = await cls._llm_judge_anxiety(
                trainee_answer, customer_reply, current_anxiety, business_line, trace_id
            )
            if llm_change != 0:
                change += llm_change
                triggered.append(f"LLM评判: {llm_reason} ({'+' if llm_change > 0 else ''}{llm_change})")

        return change, triggered

    @classmethod
    async def _llm_judge_anxiety(cls, trainee_answer: str, customer_reply: str,
                           current_anxiety: int, business_line: str,
                           trace_id: str = "N/A") -> Tuple[int, str]:
        """V3.2: 用 LLM 评判考生回答对烦躁值的影响"""
        prompt = f"""你是银行客服培训系统的烦躁值评判官。请评判客服（考生）本轮回答对客户烦躁值的影响。

【业务线】{business_line}
【客户当前烦躁值】{current_anxiety}/100
【客户上一轮说的话】{customer_reply[:200] if customer_reply else '（开场）'}
【考生本轮回答】{trainee_answer[:300]}

评判维度：
1. 是否答非所问、信息量极低（如只回"是的"、"你好"、"请告诉我卡号"机械重复）
2. 是否冷漠机械、缺乏服务温度
3. 是否给出有效解决方案或推进业务
4. 是否表达同理心与安抚

请严格输出以下 JSON（不要多余文本和```标记）：
{{"change": <-20到+20的整数>, "reason": "<20字以内的评判理由>"}}

规则：
- change 为正表示烦躁值上升，负表示下降
- 答非所问/机械重复/无信息量 → +8 到 +15
- 冷漠生硬但无错 → +3 到 +8
- 有效推进业务 → -5 到 -10
- 安抚+解决方案 → -10 到 -20
- 回答正常但平庸 → 0"""
        try:
            import re
            messages = [{"role": "user", "content": prompt}]
            response = await llm_client.async_chat_completion(messages, trace_id=trace_id)
            _think_re = r"<" + "think>.*?" + "</" + "think>"
            content = re.sub(_think_re, "", response, flags=re.DOTALL)
            match = re.search(r"\{.*\}", content, re.DOTALL)
            if match:
                data = json.loads(match.group(0))
                llm_change = int(data.get("change", 0))
                llm_change = max(-20, min(20, llm_change))
                reason = data.get("reason", "")
                return llm_change, reason
        except Exception as e:
            logger.bind(trace_id=trace_id).warning(f"LLM 烦躁值评判失败，降级跳过: {e}")
        return 0, ""

    @classmethod
    def get_emotion_state(cls, anxiety: int) -> str:
        """根据烦躁值获取情绪状态"""
        if anxiety <= 30:
            return "平和配合"
        elif anxiety <= 50:
            return "略不耐烦"
        elif anxiety <= 70:
            return "明显烦躁"
        elif anxiety <= 85:
            return "威胁投诉"
        else:
            return "准备挂断"


class EmergencyMechanism:
    """突发状况机制"""
    
    @classmethod
    def check_emergency(cls) -> Optional[Dict]:
        """检测是否触发突发状况（10%概率）"""
        for emergency in EMERGENCY_TYPES:
            if random.random() < emergency["probability"]:
                return emergency
        return None
    
    @classmethod
    def evaluate_handling(cls, trainee_answer: str, emergency: Dict) -> Dict:
        """评估突发状况处理得分"""
        score = 0
        handled_points = []
        
        for point in emergency.get("handling_points", []):
            if point in trainee_answer or any(kw in trainee_answer for kw in point.split()):
                score += 5
                handled_points.append(point)
        
        # 基础分
        if score > 0:
            score += 5  # 正确识别状况
        
        return {
            "score": min(score, 15),
            "handled_points": handled_points,
            "success": score >= 10
        }


class DynamicExamEngine:
    """动态模拟考试引擎"""

    def __init__(self):
        self._persona_configs = None

    async def _load_persona_configs(self) -> Dict[str, Dict]:
        """从数据库加载人格配置，失败则使用代码硬编码作为降级"""
        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(Persona))
                personas = result.scalars().all()
                
                if personas:
                    configs = {}
                    for p in personas:
                        if not p.system_prompt or not p.system_prompt.strip():
                            continue
                        configs[p.name] = {
                            "id": p.id,
                            "system_prompt": p.system_prompt,
                            "initial_anxiety": p.initial_anxiety or 20,
                            "threshold": p.threshold or 80,
                            "description": p.description
                        }
                    logger.info(f"成功从数据库加载 {len(configs)} 个人格配置（过滤空配置后）")
                    return configs
        except Exception as e:
            logger.warning(f"从数据库加载人格配置失败: {str(e)}")
        
        logger.info("使用代码硬编码的人格配置作为降级方案")
        return PERSONA_CONFIGS

    @property
    async def persona_configs(self) -> Dict[str, Dict]:
        """获取人格配置（懒加载）"""
        if self._persona_configs is None:
            self._persona_configs = await self._load_persona_configs()
        return self._persona_configs

    async def _load_project_scenario(self, trace_id: str = "N/A") -> Optional[Dict]:
        """
        从数据库加载一个启用的 PBL 项目场景。
        如果没有可用项目场景，返回 None（使用单业务线模式）。
        """
        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(ProjectScenario).where(ProjectScenario.enabled == True)
                )
                scenarios = result.scalars().all()
                if scenarios:
                    # 随机选一个
                    scenario = random.choice(scenarios)
                    logger.bind(trace_id=trace_id).info(
                        f"加载 PBL 项目场景: {scenario.name}, 任务数={len(scenario.tasks)}"
                    )
                    return {
                        "id": scenario.id,
                        "name": scenario.name,
                        "description": scenario.description,
                        "business_line": scenario.business_line,
                        "tasks": scenario.tasks,
                        "difficulty": scenario.difficulty
                    }
        except Exception as e:
            logger.bind(trace_id=trace_id).warning(f"加载项目场景失败: {e}")

        # 降级：使用默认项目场景（50% 概率使用项目制，50% 使用单业务线）
        if random.random() < 0.5 and DEFAULT_PROJECT_SCENARIOS:
            scenario = DEFAULT_PROJECT_SCENARIOS[0]
            logger.bind(trace_id=trace_id).info(
                f"使用默认 PBL 项目场景: {scenario['name']}"
            )
            return scenario
        return None

    async def initialize_exam(self, trace_id: str = "N/A") -> Dict:
        """初始化考试：从知识库提取业务线、随机选业务线和人格、设置目标"""
        logger.bind(trace_id=trace_id).info("初始化动态考试")

        # 1. 从知识库动态获取业务线配置（方案二：优先用预热缓存）
        # 检查预热状态：已就绪直接用缓存；正在预热则等待最多30秒；未预热则降级+异步触发
        prewarm_status = business_line_manager.get_status()
        if prewarm_status["status"] == "ready":
            business_config = await business_line_manager.get_business_config(trace_id=trace_id)
            logger.bind(trace_id=trace_id).info("使用预热缓存的业务线配置")
        elif prewarm_status["status"] == "prewarming":
            logger.bind(trace_id=trace_id).info("业务线预热中，等待完成（最多30秒）...")
            for _ in range(30):
                await asyncio.sleep(1)
                if business_line_manager.get_status()["status"] == "ready":
                    break
            if business_line_manager.get_status()["status"] == "ready":
                business_config = await business_line_manager.get_business_config(trace_id=trace_id)
                logger.bind(trace_id=trace_id).info("预热完成，使用缓存的业务线配置")
            else:
                logger.bind(trace_id=trace_id).warning("预热等待超时，使用降级业务线配置")
                business_config = business_line_manager._fallback_config()
        else:
            # pending 状态：使用降级配置，并异步触发预热供下次使用
            logger.bind(trace_id=trace_id).warning("业务线未预热，使用降级配置并异步触发预热")
            business_config = business_line_manager._fallback_config()
            asyncio.create_task(business_line_manager.get_business_config(trace_id="lazy-prewarm"))
        business_lines = business_config["business_lines"]
        business_graph = business_config["graph"]
        node_map = business_config["node_map"]

        # 2. 随机选业务线
        first_line = random.choice(business_lines)

        # 3. 随机选人格（从数据库加载）
        persona_configs = await self.persona_configs
        persona_type = random.choice(list(persona_configs.keys()))
        persona_config = persona_configs[persona_type]

        # 4. 生成踩分点（基于业务线，优先从知识库节点提取）
        related_node_ids = node_map.get(first_line, [])
        key_points = await self._generate_key_points(first_line, trace_id, related_node_ids)

        # 5. 设置业务目标
        goals = self._generate_goals(first_line, key_points)

        # 6. 设置最大轮数
        max_rounds = random.randint(10, 15)
        expected_rounds = max_rounds - 3

        # V3.4: 尝试加载 PBL 项目场景
        project_scenario = await self._load_project_scenario(trace_id=trace_id)
        exam_mode = "single"  # "single" 或 "project"
        project_manager = None
        intent_machine = None

        if project_scenario:
            # PBL 项目制模式
            exam_mode = "project"
            project_manager = ProjectManager(project_scenario, persona_type)
            # 使用项目关联的业务线覆盖随机选的业务线
            if project_scenario.get("business_line"):
                first_line = project_scenario["business_line"]
                related_node_ids = node_map.get(first_line, [])
                key_points = await self._generate_key_points(first_line, trace_id, related_node_ids)
                goals = self._generate_goals(first_line, key_points)
            # 项目制最大轮数更大（多任务需要更多轮数）
            max_rounds = random.randint(15, 20)
            expected_rounds = max_rounds - 5
            logger.bind(trace_id=trace_id).info(
                f"PBL 项目制模式: {project_scenario['name']}, "
                f"任务数={project_manager.total_task_count}"
            )
        else:
            # 单业务线模式：构建意图状态机
            intent_machine = build_intent_machine_for_business_line(
                first_line, persona_type, key_points
            )
            logger.bind(trace_id=trace_id).info(
                f"单业务线模式: {first_line}, 意图数={intent_machine.total_count}"
            )
        
        exam_state = {
            "exam_mode": exam_mode,  # V3.4: "single" 或 "project"
            "persona_type": persona_type,
            "system_prompt": persona_config["system_prompt"],
            "initial_anxiety": persona_config["initial_anxiety"],
            "anxiety_threshold": persona_config["threshold"],
            "current_anxiety": persona_config["initial_anxiety"],
            "max_anxiety": persona_config["initial_anxiety"],
            "current_business_line": first_line,
            "business_lines_covered": [first_line],
            "key_points": key_points,
            "goals": goals,
            "goals_completed": [],
            "current_round": 0,
            "max_rounds": max_rounds,
            "expected_rounds": expected_rounds,
            "emergency_count": 0,
            "emergency_success_count": 0,
            "no_progress_count": 0,  # V3.2: 连续无推进轮数（死循环打破）
            "pending_emergency": None,  # V3.2: 待评估的突发情况（下一轮评估考生应对）
            "status": "in_progress",
            "chat_history": [],
            "anxiety_history": [{
                "round": 0,
                "anxiety": persona_config["initial_anxiety"],
                "change": 0,
                "reason": "初始值",
                "triggered_rules": []
            }],
            "business_line_progress": [{
                "business_line": first_line,
                "goals": goals,
                "goals_completed": [],
                "rounds_used": 0,
                "rounds_expected": len(goals) + 2,
                "key_points": key_points,
                "completed": False
            }],
            # V3.4: 意图状态机 + PBL 项目制
            "intent_machine": intent_machine,        # 单业务线模式的意图状态机
            "project_manager": project_manager,       # PBL 项目管理器
            "intent_history": [],                      # 意图切换历史
            "task_history": [],                        # 任务切换历史
        }
        
        logger.bind(trace_id=trace_id).info(
            f"考试初始化完成: 模式={exam_mode}, 人格={persona_type}, 业务线={first_line}, "
            f"初始烦躁值={persona_config['initial_anxiety']}, 目标数={len(goals)}"
        )
        return exam_state
    
    async def _generate_key_points(self, business_line: str, trace_id: str = "N/A",
                                    node_ids: List[str] = None) -> List[Dict]:
        """生成踩分点（基于业务线，优先从知识库节点提取真实内容）"""
        # 优先从知识库节点提取踩分点素材
        kb_context = ""
        if node_ids:
            node_contents = []
            for nid in node_ids[:5]:  # 最多取5个节点
                node = await external_kb.get_node_by_id(nid, trace_id=trace_id)
                content = node.get("content", "")
                if content and "未找到" not in content:
                    node_contents.append(content[:200])
            if node_contents:
                kb_context = f"\n\n【知识库相关节点】（请基于这些真实业务知识生成踩分点）：\n" + "\n".join(node_contents)

        prompt = f"""请为银行客服培训系统生成「{business_line}」的踩分点。
要求生成4个踩分点，每个包含：point(踩分点名称)、weight(权重0-1)、keywords(关键词列表)
{kb_context}

请输出 JSON 数组（不要包含多余文本和```标记）：
[
    {{"point": "核实身份", "weight": 0.2, "keywords": ["身份证", "手机号", "验证"]}},
    {{"point": "解释规则", "weight": 0.3, "keywords": ["限额", "风控", "规定"]}},
    {{"point": "安抚情绪", "weight": 0.2, "keywords": ["抱歉", "理解", "帮您"]}},
    {{"point": "给出方案", "weight": 0.3, "keywords": ["建议", "柜台", "调整"]}}
]
"""
        try:
            messages = [{"role": "user", "content": prompt}]
            response = await llm_client.async_chat_completion(messages, trace_id=trace_id)
            import re
            content = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL)
            match = re.search(r'\[.*\]', content, re.DOTALL)
            if match:
                return json.loads(match.group(0))
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"生成踩分点失败: {e}")

        # 降级：返回默认踩分点
        return [
            {"point": "核实身份", "weight": 0.2, "keywords": ["身份证", "手机号", "验证"]},
            {"point": "解释规则", "weight": 0.3, "keywords": ["限额", "风控", "规定"]},
            {"point": "安抚情绪", "weight": 0.2, "keywords": ["抱歉", "理解", "帮您"]},
            {"point": "给出方案", "weight": 0.3, "keywords": ["建议", "柜台", "调整"]}
        ]
    
    def _generate_goals(self, business_line: str, key_points: List[Dict]) -> List[Dict]:
        """根据踩分点生成业务目标"""
        goals = []
        for i, kp in enumerate(key_points[:3]):  # 取前3个踩分点作为目标
            goals.append({
                "id": f"goal_{i+1}",
                "name": kp["point"],
                "success_criteria": f"考生在回答中命中关键词: {', '.join(kp['keywords'][:2])}",
                "max_rounds": 2,
                "completed": False,
                "completed_round": None
            })
        return goals
    
    async def process_round(self, exam_state: Dict, trainee_answer: str,
                              persona_reply: str, trace_id: str = "N/A") -> Dict:
        """处理一轮对话：评分、烦躁值计算、目标检查、突发状况"""
        exam_state["current_round"] += 1
        round_num = exam_state["current_round"]
        
        # 记录对话
        exam_state["chat_history"].append({
            "round": round_num,
            "role": "trainee",
            "content": trainee_answer
        })
        exam_state["chat_history"].append({
            "round": round_num,
            "role": "customer",
            "content": persona_reply
        })
        
        # 1. 踩分点检测
        key_points_hit = self._check_key_points(trainee_answer, exam_state["key_points"])

        # 2. 烦躁值计算（V3.2：辱骂兜底 + LLM 评判）
        prev_anxiety = exam_state["current_anxiety"]
        anxiety_change, triggered_rules = await AnxietyMechanism.calculate_anxiety_change(
            trainee_answer, key_points_hit,
            customer_reply=persona_reply,
            current_anxiety=prev_anxiety,
            business_line=exam_state["current_business_line"],
            trace_id=trace_id,
        )

        # V3.2: 死循环打破 —— 连续无推进轮自动加烦躁值
        any_hit = any(kp.get("hit") for kp in key_points_hit)
        if anxiety_change == 0 and not any_hit:
            exam_state["no_progress_count"] += 1
            if exam_state["no_progress_count"] >= 3:
                anxiety_change += AnxietyMechanism.INCREASE_RULES["死循环停滞"]
                triggered_rules.append(
                    f"连续{exam_state['no_progress_count']}轮无推进 (+{AnxietyMechanism.INCREASE_RULES['死循环停滞']})"
                )
                exam_state["no_progress_count"] = 0
        else:
            exam_state["no_progress_count"] = 0

        new_anxiety = max(0, min(100, prev_anxiety + anxiety_change))
        exam_state["current_anxiety"] = new_anxiety
        if new_anxiety > exam_state["max_anxiety"]:
            exam_state["max_anxiety"] = new_anxiety

        # 记录烦躁值历史
        exam_state["anxiety_history"].append({
            "round": round_num,
            "anxiety": new_anxiety,
            "change": anxiety_change,
            "reason": AnxietyMechanism.get_emotion_state(new_anxiety),
            "triggered_rules": triggered_rules
        })
        
        # 3. 更新业务线进度
        current_progress = exam_state["business_line_progress"][-1]
        current_progress["rounds_used"] += 1
        
        # 4. 检查目标完成
        for goal in exam_state["goals"]:
            if not goal["completed"]:
                for kp in key_points_hit:
                    if kp.get("hit") and kp.get("point") == goal["name"]:
                        goal["completed"] = True
                        goal["completed_round"] = round_num
                        exam_state["goals_completed"].append(goal["id"])
                        current_progress["goals_completed"].append(goal["id"])
                        break
        
        # V3.4: 推进意图状态机 / PBL 项目管理器
        intent_advance = None
        task_advance = None
        intent_snapshot = None
        task_snapshot = None

        if exam_state.get("exam_mode") == "project" and exam_state.get("project_manager"):
            # PBL 项目制模式：推进项目管理器
            pm = exam_state["project_manager"]
            task_advance = pm.advance(trainee_answer)
            task_snapshot = pm.get_state_snapshot()

            # 记录任务切换历史
            if task_advance.get("task_switched"):
                exam_state["task_history"].append({
                    "round": round_num,
                    "previous_task": task_advance.get("previous_task"),
                    "current_task": task_advance.get("current_task", {}).get("name") if task_advance.get("current_task") else None,
                    "reason": task_advance.get("switch_reason")
                })

            # 记录意图切换历史
            intent_state = task_advance.get("intent_state")
            if intent_state and intent_state.get("intent_switched"):
                exam_state["intent_history"].append({
                    "round": round_num,
                    "previous_intent": intent_state.get("previous_intent"),
                    "current_intent": intent_state.get("current_intent", {}).get("name") if intent_state.get("current_intent") else None,
                    "reason": intent_state.get("switch_reason"),
                    "task_name": pm.current_task["name"] if pm.current_task else None
                })

        elif exam_state.get("intent_machine"):
            # 单业务线模式：推进意图状态机
            im = exam_state["intent_machine"]
            intent_advance = im.advance(trainee_answer)
            intent_snapshot = im.get_state_snapshot()

            # 记录意图切换历史
            if intent_advance.get("intent_switched"):
                exam_state["intent_history"].append({
                    "round": round_num,
                    "previous_intent": intent_advance.get("previous_intent"),
                    "current_intent": intent_advance.get("current_intent", {}).get("name") if intent_advance.get("current_intent") else None,
                    "reason": intent_advance.get("switch_reason")
                })

            # 同步死循环计数器（意图状态机也有 no_progress_count）
            exam_state["no_progress_count"] = intent_advance.get("no_progress_count", exam_state["no_progress_count"])

        # 5. 检查业务线是否完成
        all_goals_done = all(g["completed"] for g in exam_state["goals"])
        # V3.4: 项目制模式下，所有任务完成也视为业务线完成
        if exam_state.get("exam_mode") == "project" and exam_state.get("project_manager"):
            all_goals_done = all_goals_done or exam_state["project_manager"].is_all_completed
        # V3.4: 单业务线模式下，所有意图完成也视为业务线完成
        elif exam_state.get("intent_machine"):
            all_goals_done = all_goals_done or exam_state["intent_machine"].is_all_completed

        if all_goals_done:
            current_progress["completed"] = True
            # 切换业务线（基于动态关联图谱）
            next_line = await self._get_next_business_line(exam_state["current_business_line"], exam_state["business_lines_covered"], trace_id)
            if next_line and round_num < exam_state["max_rounds"]:
                # 标记本轮发生了业务线切换（防止切换轮误触发考试结束）
                exam_state["_line_switched_this_round"] = True
                # 获取下一业务线的知识节点
                business_config = await business_line_manager.get_business_config(trace_id=trace_id)
                next_node_ids = business_config["node_map"].get(next_line, [])
                new_key_points = await self._generate_key_points(next_line, trace_id, next_node_ids)
                new_goals = self._generate_goals(next_line, new_key_points)
                exam_state["current_business_line"] = next_line
                exam_state["business_lines_covered"].append(next_line)
                exam_state["key_points"] = new_key_points
                exam_state["goals"] = new_goals
                exam_state["goals_completed"] = []
                exam_state["business_line_progress"].append({
                    "business_line": next_line,
                    "goals": new_goals,
                    "goals_completed": [],
                    "rounds_used": 0,
                    "rounds_expected": len(new_goals) + 2,
                    "key_points": new_key_points,
                    "completed": False
                })
                # V3.4: 单业务线模式下，业务线切换后重建意图状态机
                if exam_state.get("exam_mode") != "project":
                    exam_state["intent_machine"] = build_intent_machine_for_business_line(
                        next_line, exam_state["persona_type"], new_key_points
                    )
                # V3.4: 项目制模式下，业务线切换后重新加载项目场景并重建项目管理器
                else:
                    new_scenario = await self._load_project_scenario(trace_id=trace_id)
                    if new_scenario:
                        exam_state["project_manager"] = ProjectManager(new_scenario, exam_state["persona_type"])
                        logger.bind(trace_id=trace_id).info(
                            f"业务线切换后重新加载项目场景: {new_scenario['name']}"
                        )
                    else:
                        # 无可用项目场景，降级为单业务线模式，清除旧 project_manager
                        exam_state["project_manager"] = None
                        exam_state["exam_mode"] = "single"
                        exam_state["intent_machine"] = build_intent_machine_for_business_line(
                            next_line, exam_state["persona_type"], new_key_points
                        )
                        logger.bind(trace_id=trace_id).warning(
                            f"业务线切换到 '{next_line}'，但无可用项目场景，降级为单业务线模式"
                        )
        
        # 6. 突发状况：评估上一轮 pending_emergency（V3.2 改造）
        # 突发情况的触发已移至 endpoints.py（生成客户回复前注入），这里只评估考生本轮的应对
        emergency = None
        emergency_result = None
        pending = exam_state.get("pending_emergency")
        if pending:
            exam_state["emergency_count"] += 1
            emergency_result = EmergencyMechanism.evaluate_handling(trainee_answer, pending)
            if emergency_result["success"]:
                exam_state["emergency_success_count"] += 1
            # 回传上一轮突发情况信息供前端做轻提示
            emergency = pending
            exam_state["pending_emergency"] = None
        
        # 7. 检查结束条件
        end_reason = None
        line_just_switched = exam_state.get("_line_switched_this_round", False)
        if line_just_switched:
            exam_state["_line_switched_this_round"] = False
        if new_anxiety >= 100:
            exam_state["status"] = "hangup"
            end_reason = "客户挂断（烦躁值达100）"
        elif round_num >= exam_state["max_rounds"]:
            exam_state["status"] = "completed"
            end_reason = "达到最大轮数"
        elif all_goals_done and not exam_state["goals"]:  # 所有业务线完成
            exam_state["status"] = "completed"
            end_reason = "所有业务线目标达成"
        # V3.4: 项目制模式下，所有任务完成（切换业务线当轮不触发，避免误判）
        elif exam_state.get("exam_mode") == "project" and exam_state.get("project_manager") and not line_just_switched:
            if exam_state["project_manager"].is_all_completed:
                exam_state["status"] = "completed"
                end_reason = "所有项目任务完成"
        # V3.4: 单业务线模式下，所有意图完成且无下一业务线
        elif exam_state.get("intent_machine") and exam_state["intent_machine"].is_all_completed:
            next_check = await self._get_next_business_line(
                exam_state["current_business_line"],
                exam_state["business_lines_covered"],
                trace_id
            )
            if not next_check:
                exam_state["status"] = "completed"
                end_reason = "所有意图完成"
        
        # 检查烦躁值超阈值
        anxiety_warning = None
        if new_anxiety >= exam_state["anxiety_threshold"] and new_anxiety < 100:
            anxiety_warning = {
                "message": f"客户烦躁值已达 {new_anxiety}/100，超过阈值 {exam_state['anxiety_threshold']}！",
                "suggestion": "请立即使用安抚话术，降低客户烦躁值！",
                "time_limit": "2轮内将烦躁值降至60以下，否则客户将挂断"
            }
        
        # V3.4: 获取意图/任务快照
        intent_state_out = None
        task_state_out = None
        if exam_state.get("exam_mode") == "project" and exam_state.get("project_manager"):
            pm = exam_state["project_manager"]
            task_state_out = pm.get_state_snapshot()
            if pm.intent_machine:
                intent_state_out = pm.intent_machine.get_state_snapshot()
        elif exam_state.get("intent_machine"):
            intent_state_out = exam_state["intent_machine"].get_state_snapshot()
        
        return {
            "round": round_num,
            "anxiety": new_anxiety,
            "anxiety_change": anxiety_change,
            "emotion_state": AnxietyMechanism.get_emotion_state(new_anxiety),
            "triggered_rules": triggered_rules,
            "key_points_hit": key_points_hit,
            "goals_completed": exam_state["goals_completed"],
            "all_goals_done": all_goals_done,
            "emergency": emergency,
            "emergency_result": emergency_result,
            "anxiety_warning": anxiety_warning,
            "end_reason": end_reason,
            "status": exam_state["status"],
            # V3.4: 意图状态机 + PBL 项目制
            "exam_mode": exam_state.get("exam_mode", "single"),
            "intent_state": intent_state_out,
            "task_state": task_state_out,
            "intent_switched": bool(intent_advance and intent_advance.get("intent_switched")),
            "task_switched": bool(task_advance and task_advance.get("task_switched")),
            "intent_history": exam_state.get("intent_history", []),
            "task_history": exam_state.get("task_history", [])
        }
    
    def _check_key_points(self, trainee_answer: str, key_points: List[Dict]) -> List[Dict]:
        """检测踩分点命中情况"""
        results = []
        for kp in key_points:
            hit = any(kw in trainee_answer for kw in kp.get("keywords", []))
            results.append({
                "point": kp["point"],
                "weight": kp["weight"],
                "keywords": kp["keywords"],
                "hit": hit
            })
        return results
    
    async def _get_next_business_line(self, current_line: str, covered_lines: List[str],
                                       trace_id: str = "N/A") -> Optional[str]:
        """根据动态关联图谱获取下一业务线"""
        business_config = await business_line_manager.get_business_config(trace_id=trace_id)
        business_graph = business_config["graph"]

        related = business_graph.get(current_line, [])
        for line in related:
            if line not in covered_lines:
                return line
        # 如果关联的业务线都已覆盖，随机选一个未覆盖的
        all_lines = business_config["business_lines"]
        uncovered = [l for l in all_lines if l not in covered_lines]
        if uncovered:
            return random.choice(uncovered)
        return None
    
    def calculate_final_score(self, exam_state: Dict) -> Dict:
        """计算最终综合评分"""
        is_project_mode = exam_state.get("exam_mode") == "project" and exam_state.get("project_manager")

        # 1. 业务分
        total_goals = sum(len(p["goals"]) for p in exam_state["business_line_progress"])
        completed_goals = sum(len(p["goals_completed"]) for p in exam_state["business_line_progress"])
        goal_completion_rate = completed_goals / total_goals if total_goals > 0 else 0
        business_score = int(goal_completion_rate * 100)

        # V3.4: 项目制模式下，业务分还要考虑任务完成率
        project_score = None
        flow_coherence_score = None
        adaptability_score = None
        if is_project_mode:
            pm = exam_state["project_manager"]
            task_completion_rate = pm.completed_task_count / pm.total_task_count if pm.total_task_count > 0 else 0
            project_score = int(task_completion_rate * 100)
            # 业务分 = 目标完成率 * 0.5 + 任务完成率 * 0.5
            business_score = int(business_score * 0.5 + project_score * 0.5)

            # 流程连贯性：任务切换次数 vs 预期任务数，切换越接近预期越连贯
            task_switch_count = len(exam_state.get("task_history", []))
            expected_switches = pm.total_task_count - 1
            if expected_switches > 0:
                switch_ratio = min(task_switch_count, expected_switches) / expected_switches
                flow_coherence_score = int(60 + switch_ratio * 40)
            else:
                flow_coherence_score = 100

            # 应变能力：突发状况处理成功率 + 烦躁值控制
            emergency_success_rate = 1.0
            if exam_state.get("emergency_count", 0) > 0:
                emergency_success_rate = exam_state["emergency_success_count"] / exam_state["emergency_count"]
            anxiety_control = 1.0 - (exam_state["max_anxiety"] - exam_state["initial_anxiety"]) / 100
            adaptability_score = int((emergency_success_rate * 0.6 + anxiety_control * 0.4) * 100)
            adaptability_score = max(0, min(100, adaptability_score))

        # 2. 情绪管理分
        initial = exam_state["initial_anxiety"]
        final = exam_state["current_anxiety"]
        max_anxiety = exam_state["max_anxiety"]
        threshold = exam_state["anxiety_threshold"]

        emotion_base = 60
        anxiety_drop = initial - final

        if anxiety_drop > 30:
            emotion_bonus = 25
        elif anxiety_drop > 20:
            emotion_bonus = 15
        elif anxiety_drop > 10:
            emotion_bonus = 5
        else:
            emotion_bonus = 0

        # 超阈值惩罚
        threshold_exceeded_count = sum(
            1 for h in exam_state["anxiety_history"] if h["anxiety"] >= threshold
        )
        threshold_penalty = threshold_exceeded_count * 10

        if exam_state["status"] == "hangup":
            emotion_score = 0
        else:
            emotion_score = max(0, emotion_base + emotion_bonus - threshold_penalty)

        # 3. 效率分
        efficiency_base = 60
        lines_completed = sum(1 for p in exam_state["business_line_progress"] if p["completed"])
        total_lines = len(exam_state["business_line_progress"])
        completion_bonus = int((lines_completed / total_lines) * 20) if total_lines > 0 else 0

        actual_rounds = exam_state["current_round"]
        expected = exam_state["expected_rounds"]
        if actual_rounds <= expected:
            round_bonus = 20
        elif actual_rounds <= expected + 2:
            round_bonus = 10
        else:
            round_bonus = 0

        efficiency_score = efficiency_base + completion_bonus + round_bonus

        # 4. 突发状况附加分（上限+10）
        bonus_score = 0
        success_count = exam_state.get("emergency_success_count", 0)
        total_emergency = exam_state.get("emergency_count", 0)
        if success_count >= 3:
            bonus_score = 10
        elif success_count >= 2:
            bonus_score = 7
        elif success_count >= 1:
            bonus_score = 3
        # 处理失败扣分
        failed_count = total_emergency - success_count
        bonus_score -= failed_count * 5
        bonus_score = max(0, bonus_score)

        # 5. 综合分（V3.4: 项目制模式权重调整）
        if is_project_mode:
            # 项目制模式：业务40% + 情绪20% + 效率15% + 项目维度15%(流程8%+应变7%) + 突发10%
            project_dimension_score = int(
                flow_coherence_score * 0.5 + adaptability_score * 0.5
            )
            overall = int(
                business_score * 0.4 +
                emotion_score * 0.2 +
                efficiency_score * 0.15 +
                project_dimension_score * 0.15 +
                bonus_score
            )
        else:
            # 单业务线模式：业务60% + 情绪25% + 效率15% + 突发附加
            project_dimension_score = None
            overall = int(
                business_score * 0.6 +
                emotion_score * 0.25 +
                efficiency_score * 0.15 +
                bonus_score
            )
        overall = min(100, overall)

        # 生成弱点标签
        weakness_tags = []
        if business_score < 70:
            weakness_tags.append({"tag": "业务知识薄弱", "dimension": "business"})
        if emotion_score < 70:
            weakness_tags.append({"tag": "情绪管理不足", "dimension": "emotion"})
        if efficiency_score < 70:
            weakness_tags.append({"tag": "服务效率低", "dimension": "efficiency"})
        
        # 未完成的目标生成弱点标签
        for progress in exam_state["business_line_progress"]:
            if not progress["completed"]:
                for goal in progress["goals"]:
                    if not goal["completed"]:
                        weakness_tags.append({
                            "tag": f"{progress['business_line']} - {goal['name']}",
                            "dimension": "business"
                        })
        
        # V3.4: 项目制模式下，未完成的任务生成弱点标签
        if is_project_mode:
            pm = exam_state["project_manager"]
            for i, task in enumerate(pm.tasks):
                if not pm.task_completed[i]:
                    weakness_tags.append({
                        "tag": f"项目任务未完成 - {task['name']}",
                        "dimension": "business"
                    })
            if flow_coherence_score is not None and flow_coherence_score < 70:
                weakness_tags.append({"tag": "流程连贯性不足", "dimension": "flow"})
            if adaptability_score is not None and adaptability_score < 70:
                weakness_tags.append({"tag": "应变能力不足", "dimension": "adaptability"})

        return {
            "business_score": business_score,
            "emotion_score": emotion_score,
            "efficiency_score": efficiency_score,
            "bonus_score": bonus_score,
            "overall_score": overall,
            "weakness_tags": weakness_tags,
            "score_details": {
                "goal_completion_rate": round(goal_completion_rate, 2),
                "anxiety_drop": anxiety_drop,
                "threshold_exceeded_count": threshold_exceeded_count,
                "lines_completed": lines_completed,
                "total_lines": total_lines,
                "actual_rounds": actual_rounds,
                "expected_rounds": expected,
                "emergency_total": total_emergency,
                "emergency_success": success_count,
                # V3.4: 项目维度评分
                "exam_mode": exam_state.get("exam_mode", "single"),
                "project_score": project_score,
                "flow_coherence_score": flow_coherence_score,
                "adaptability_score": adaptability_score,
                "project_dimension_score": int(
                    flow_coherence_score * 0.5 + adaptability_score * 0.5
                ) if is_project_mode else None,
                "intent_history": exam_state.get("intent_history", []),
                "task_history": exam_state.get("task_history", [])
            }
        }


# 全局实例
dynamic_exam_engine = DynamicExamEngine()
