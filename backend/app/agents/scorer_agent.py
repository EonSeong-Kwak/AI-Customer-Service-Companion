from typing import List, Dict
from app.core.logger import logger

class ScorerAgent:
    """
    负责生成学员多维能力画像的 Agent (评)
    """
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
