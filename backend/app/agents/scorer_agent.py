import json
from typing import List, Dict
from app.services.llm_adapter import llm_client
from app.core.logger import logger

class ScorerAgent:
    """
    负责对整段模拟对话进行多维度评分的 Agent (评)
    """
    async def score_conversation(self, chat_history: List[Dict[str, str]], trace_id: str = "N/A") -> dict:
        """
        对整段对话进行总结性评分
        """
        logger.bind(trace_id=trace_id).info("ScorerAgent 正在对整段对话进行评分")
        
        # 将对话历史转换为易读文本
        history_text = ""
        for msg in chat_history:
            role_name = "【考生】" if msg["role"] == "trainee" else "【客户】"
            history_text += f"{role_name}: {msg['content']}\n"
            
        prompt = f"""
请作为专业的质检员，对以下一段银行客服（考生）与客户的模拟对话进行多维度评分。

对话记录：
{history_text}

请严格按照以下 JSON 格式输出，不要包含多余文本：
{{
    "overall_score": 0-100的整数,
    "score_details": {{
        "accuracy": 0-100的整数 (业务准确性：解答是否正确无误),
        "service_tone": 0-100的整数 (服务态度：用词是否礼貌规范),
        "compliance": 0-100的整数 (制度合规性：有无违规操作或违规承诺),
        "empathy": 0-100的整数 (情绪安抚能力：是否接住并安抚了客户的负面情绪),
        "dialogue_control": 0-100的整数 (沟通控场能力：偏题时能否高效引导回主线并解决问题)
    }},
    "feedback": "整体综合评价与改进建议"
}}
"""
        messages = [{"role": "user", "content": prompt}]
        response = await llm_client.async_chat_completion(messages, trace_id=trace_id)
        
        try:
            import re
            # 过滤掉可能的 <think> 标签内容，并提取 JSON 块
            content = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL)
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                clean_str = match.group(0)
            else:
                clean_str = content.strip().strip("```json").strip("```")
            return json.loads(clean_str)
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"ScorerAgent 解析评分结果失败: {e}\n原文: {response}")
            raise Exception("对话评分解析失败")

    def generate_capability_portrait(self, exam_history: list, practice_history: list, feynman_progress: dict, pomodoro_stats: dict, weakness_stats: dict, trace_id: str = "N/A") -> dict:
        """
        生成多维能力画像：知识掌握度、学习节奏感、实战能力、错误修正力
        """
        logger.bind(trace_id=trace_id).info("ScorerAgent 正在生成能力画像")

        # 基于数据计算各维度分数
        # 1. 知识掌握度：费曼完成度 + 练习平均分
        feynman_completion = feynman_progress.get("completion_rate", 0)
        practice_avg = 0
        if practice_history:
            practice_avg = sum(p.get("score", 0) for p in practice_history) / len(practice_history)
        knowledge_mastery = int(feynman_completion * 0.4 + practice_avg * 0.6)

        # 2. 学习节奏感：番茄钟数据
        total_pomodoros = pomodoro_stats.get("total_pomodoros", 0)
        streak_days = pomodoro_stats.get("streak_days", 0)
        avg_daily = pomodoro_stats.get("avg_daily_pomodoros", 0)
        learning_rhythm = min(100, int(streak_days * 5 + avg_daily * 10 + total_pomodoros * 0.5))

        # 3. 实战能力：考试平均分 + 考试次数
        exam_avg = 0
        exam_count = len(exam_history)
        if exam_history:
            exam_avg = sum(e.get("overall_score", 0) for e in exam_history) / len(exam_history)
        practical_ability = int(exam_avg * 0.7 + min(exam_count * 5, 30))

        # 4. 错误修正力：弱点解决率
        total_weaknesses = weakness_stats.get("total", 0)
        resolved_weaknesses = weakness_stats.get("resolved", 0)
        if total_weaknesses > 0:
            resolution_rate = resolved_weaknesses / total_weaknesses
        else:
            resolution_rate = 1.0
        error_correction = int(resolution_rate * 100)

        return {
            "knowledge_mastery": {
                "score": knowledge_mastery,
                "feynman_completion": round(feynman_completion, 2),
                "practice_avg_score": round(practice_avg, 1),
                "blind_spots": weakness_stats.get("unresolved_points", [])
            },
            "learning_rhythm": {
                "score": learning_rhythm,
                "total_pomodoros": total_pomodoros,
                "streak_days": streak_days,
                "avg_daily_pomodoros": round(avg_daily, 1)
            },
            "practical_ability": {
                "score": practical_ability,
                "exam_count": exam_count,
                "exam_avg_score": round(exam_avg, 1)
            },
            "error_correction": {
                "score": error_correction,
                "total_weaknesses": total_weaknesses,
                "resolved_weaknesses": resolved_weaknesses,
                "resolution_rate": round(resolution_rate, 2)
            },
            "overall_portrait": {
                "knowledge_mastery": knowledge_mastery,
                "learning_rhythm": learning_rhythm,
                "practical_ability": practical_ability,
                "error_correction": error_correction
            }
        }

scorer_agent = ScorerAgent()
