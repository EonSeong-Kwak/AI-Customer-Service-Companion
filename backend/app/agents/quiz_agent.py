import json
import re
from app.services.llm_adapter import llm_client
from app.services.external_kb import external_kb
from app.services.retrieval_pipeline import retrieval_pipeline
from app.core.logger import logger


def _parse_llm_json_robust(text: str, str_fields: list = None, list_fields: list = None, num_fields: list = None) -> dict:
    """稳健解析 LLM 返回的 JSON。
    先尝试 json.loads；失败则用正则逐字段提取（兼容字符串值内含未转义双引号、换行）。
    """
    clean = text.strip().strip("```json").strip("```").strip()
    # 去除可能的思考块
    clean = re.sub(r'<think>.*?</think>', '', clean, flags=re.DOTALL)
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        pass

    result = {}
    str_fields = str_fields or []
    list_fields = list_fields or []
    num_fields = num_fields or []

    # 提取字符串字段：匹配 "field": " 后的内容，直到 "\n + 下一字段 或 "\n}
    for field in str_fields:
        m = re.search(
            rf'"{re.escape(field)}"\s*:\s*"(.*?)"\s*,?\s*\n\s*(?:"|\}})',
            clean, re.DOTALL
        )
        if m:
            result[field] = m.group(1).strip()

    # 提取列表字段（元素为字符串）
    for field in list_fields:
        m = re.search(rf'"{re.escape(field)}"\s*:\s*\[(.*?)\]', clean, re.DOTALL)
        if m:
            items = re.findall(r'"([^"]+)"', m.group(1))
            if items:
                result[field] = items

    # 提取数字字段
    for field in num_fields:
        m = re.search(rf'"{re.escape(field)}"\s*:\s*"?([0-9.]+)"?', clean)
        if m:
            try:
                val = float(m.group(1))
                result[field] = int(val) if val == int(val) else val
            except ValueError:
                pass

    if not result:
        raise ValueError(f"无法从 LLM 输出中提取任何字段: {text[:200]}")
    return result


class QuizAgent:
    """
    负责出题与自动判卷的 Agent (练)
    包含：出题、判分、弱点提取、反向训练题生成
    V3.0: 集成高级检索管线提升出题素材质量
    """

    async def generate_question(self, node_id: str, difficulty: str = "medium", trace_id: str = "N/A") -> dict:
        """根据特定的知识点出题（V3.0：使用高级检索管线获取更完整的业务上下文）"""
        logger.bind(trace_id=trace_id).info(f"QuizAgent 正在为知识点 {node_id} 生成题目")

        node_info = await external_kb.get_node_by_id(node_id, trace_id=trace_id)
        
        # V3.0: 使用高级检索管线检索相关业务上下文，作为出题素材
        related_context = await retrieval_pipeline.search(
            node_info.get('content', '')[:50], top_k=3, trace_id=trace_id
        )
        context_str = "\n".join([f"- {item.get('content', '')}" for item in related_context])

        prompt = f"""
请基于以下银行业务知识点，生成一道情景模拟题供客服人员练习。
难度：{difficulty}
知识点：{node_info['content']}

相关业务上下文（来自高级检索管线）：
{context_str}

请严格按照以下 JSON 格式输出，不要包含多余文本：
{{
    "scenario": "客户投诉转账失败，情绪激动...",
    "reference_answer": "您好，非常抱歉给您带来不便...",
    "key_points": ["安抚情绪", "核实原因", "合规用语"]
}}
"""
        messages = [{"role": "user", "content": prompt}]
        response = await llm_client.async_chat_completion(messages, trace_id=trace_id, model="chat")

        try:
            return _parse_llm_json_robust(
                response,
                str_fields=["scenario", "reference_answer"],
                list_fields=["key_points"],
            )
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"QuizAgent 解析生成的题目失败: {e}, 返回原文: {response}")
            raise Exception("生成题目解析失败")

    async def evaluate_answer(self, scenario: str, reference: str, key_points: list, trainee_answer: str, trace_id: str = "N/A") -> dict:
        """评估考生对单道题目的回答"""
        prompt = f"""
你正在对银行客服人员的回答进行打分。
【客户情景】: {scenario}
【标准答案参考】: {reference}
【关键得分点】: {', '.join(key_points)}

【考生的实际回答】: {trainee_answer}

【判分原则】
- 只要考生回答的内容在语义上覆盖了某个得分点，就算命中，不要求逐字逐句和"标准答案参考"一致，也不要因为表达更简洁、说法不同就判定未覆盖
- 例如得分点是"告知时间"，考生只要给出了具体的时间/时长信息（无论用什么措辞），就算命中这一条
- 只有在回答中确实完全没有涉及某个得分点对应的信息时，才把它放进 missed_points

请严格按照以下 JSON 格式输出评估结果，不要输出 JSON 之外的任何文字：
{{
    "score": <整数，必须在 0 到 100 之间，不允许超出此范围>,
    "feedback": "具体的改进建议或表扬",
    "missed_points": [考生回答中没有覆盖到的关键得分点原文，从上面【关键得分点】列表里逐字挑选；如果全部覆盖到了，这里必须是空数组 []，不要写解释性文字]
}}
"""
        messages = [{"role": "user", "content": prompt}]
        response = await llm_client.async_chat_completion(messages, trace_id=trace_id, model="chat", temperature=0.2)

        try:
            return _parse_llm_json_robust(
                response,
                str_fields=["feedback"],
                list_fields=["missed_points"],
                num_fields=["score"],
            )
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"QuizAgent 解析评分结果失败: {e}")
            raise Exception("评估解析失败")

    async def generate_reverse_training(self, weak_points: list, category: str, trace_id: str = "N/A") -> dict:
        """
        反循环机制：根据学员的弱点标签，生成针对性的"错题变种"
        V3.0: 使用高级检索管线检索相关业务文档作为出题素材
        """
        logger.bind(trace_id=trace_id).info(f"QuizAgent 正在为弱点 {weak_points} 生成反向训练题")

        # V3.0: 检索相关业务文档作为出题素材
        search_query = f"{category} {' '.join(weak_points)}"
        related_docs = await retrieval_pipeline.search(search_query, top_k=3, trace_id=trace_id)
        context_str = "\n".join([f"- {item.get('content', '')}" for item in related_docs])

        prompt = f"""
你是一个银行客服培训系统的出题专家。
学员在「{category}」分类的练习中，以下知识点存在明显薄弱：
{', '.join(weak_points)}

相关业务文档（来自高级检索管线）：
{context_str}

请针对这些薄弱点，生成一道"错题变种"——即考察相同知识点但变换了场景和提问方式的题目。
要求：题目难度适中，重点考察学员之前遗漏的薄弱点。

请严格按照以下 JSON 格式输出，不要包含多余文本：
{{
    "scenario": "新的客户情景描述...",
    "reference_answer": "标准答案话术...",
    "key_points": ["重点考察的薄弱知识点1", "薄弱知识点2"],
    "difficulty": "medium",
    "category": "{category}",
    "reverse_note": "这道题专门针对学员的哪些薄弱点设计的说明"
}}
"""
        messages = [{"role": "user", "content": prompt}]
        response = await llm_client.async_chat_completion(messages, trace_id=trace_id, model="chat", timeout=120)

        try:
            result = _parse_llm_json_robust(
                response,
                str_fields=["scenario", "reference_answer", "difficulty", "category", "reverse_note"],
                list_fields=["key_points"],
            )
            result["is_reverse_training"] = True
            return result
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"QuizAgent 反向训练题生成失败: {e}, 原文: {response}")
            raise Exception("反向训练题生成失败")

    async def generate_teaching_question(self, category: str, trace_id: str = "N/A") -> dict:
        """
        费曼学习法-教学题型：生成一道教学场景题，要求考生用通俗语言向新手解释业务流程
        """
        logger.bind(trace_id=trace_id).info(f"QuizAgent 正在为分类 {category} 生成教学题型")

        prompt = f"""
你是银行客服培训系统的出题专家。请围绕「{category}」生成一道"教学场景题"。

教学题型的核心是费曼学习法——通过"教会别人"来检验理解：
- 场景：一个刚入职的新手客服向你（考生）请教【{category}】相关问题
- 考生需要用通俗易懂的语言解释清楚，避免专业术语堆砌
- 题目应包含虚拟学员的追问（2-3轮）

请严格按照以下 JSON 格式输出，不要包含多余文本：
{{
    "scenario": "新手客服小王刚入职，他问你：'师傅，{category}的具体流程是什么？我有点搞不清楚...'",
    "follow_up_questions": ["新手客服的追问1", "追问2"],
    "reference_answer": "标准教学话术，用通俗语言解释...",
    "key_points": ["解释清晰度", "逻辑顺序", "避免术语堆砌", "覆盖关键步骤"],
    "difficulty": "medium",
    "category": "{category}",
    "question_type": "teaching"
}}
"""
        messages = [{"role": "user", "content": prompt}]
        response = await llm_client.async_chat_completion(messages, trace_id=trace_id)

        try:
            result = _parse_llm_json_robust(
                response,
                str_fields=["scenario", "reference_answer", "difficulty", "category", "question_type"],
                list_fields=["key_points", "follow_up_questions"],
            )
            result["question_type"] = "teaching"
            return result
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"QuizAgent 教学题型生成失败: {e}, 原文: {response}")
            raise Exception("教学题型生成失败")

    async def analyze_wrong_answer(self, scenario: str, reference_answer: str, wrong_answer: str, trace_id: str = "N/A") -> dict:
        """
        反循环机制-错误深度分析：分析学员为什么答错
        """
        prompt = f"""
你是银行客服培训系统的错误分析专家。请分析学员的错误回答。

题目场景：{scenario}
正确答案：{reference_answer}
学员错误答案：{wrong_answer}

请分析：
1. 错在哪一步？（概念模糊/逻辑错误/遗漏要点/话术不当）
2. 为什么会产生这个错误？
3. 学员缺失了哪些知识点？

请严格按照以下 JSON 格式输出：
{{
    "error_type": "概念模糊|逻辑错误|遗漏要点|话术不当",
    "root_cause": "根本原因分析",
    "missing_knowledge": ["缺失知识点1", "缺失知识点2"],
    "error_severity": "high|medium|low"
}}
"""
        messages = [{"role": "user", "content": prompt}]
        response = await llm_client.async_chat_completion(messages, trace_id=trace_id)

        try:
            return _parse_llm_json_robust(
                response,
                str_fields=["error_type", "root_cause", "error_severity"],
                list_fields=["missing_knowledge"],
            )
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"QuizAgent 错误分析失败: {e}, 原文: {response}")
            raise Exception("错误分析失败")

    async def verify_correction(self, reverse_scenario: str, reverse_reference: str, trainee_answer: str, weak_points: list, trace_id: str = "N/A") -> dict:
        """
        反循环机制-验证修正结果：验证学员是否真正掌握了薄弱知识点
        """
        prompt = f"""
你是银行客服培训系统的评分专家。学员之前在以下知识点存在薄弱：{', '.join(weak_points)}
现在学员完成了反向训练题，请验证是否真正掌握。

反向训练题场景：{reverse_scenario}
标准答案：{reverse_reference}
学员回答：{trainee_answer}

请判断：
1. 学员是否纠正了之前的错误思路？
2. 是否覆盖了之前遗漏的薄弱知识点？
3. 如果仍然答错，需要建议返回Doc Agent重新学习

请严格按照以下 JSON 格式输出：
{{
    "score": 0-100,
    "status": "corrected|need_reinforcement",
    "covered_points": ["已掌握的薄弱点"],
    "still_missing": ["仍未掌握的点"],
    "feedback": "具体评价",
    "recommendation": "如果need_reinforcement，建议复习的知识点"
}}
"""
        messages = [{"role": "user", "content": prompt}]
        response = await llm_client.async_chat_completion(messages, trace_id=trace_id)

        try:
            return _parse_llm_json_robust(
                response,
                str_fields=["status", "feedback", "recommendation"],
                list_fields=["covered_points", "still_missing"],
                num_fields=["score"],
            )
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"QuizAgent 验证修正失败: {e}, 原文: {response}")
            raise Exception("验证修正失败")

quiz_agent = QuizAgent()
