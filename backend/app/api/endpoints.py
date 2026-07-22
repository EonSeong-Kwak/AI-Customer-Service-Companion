from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import uuid
import json
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case

from app.core.database import get_db
from app.models import (ExamRecord, ChatHistory, User, Persona, PracticeRecord,
                        UserWeakness, Question, ExamPaper, ExamAssignment,
                        FeynmanRecord, PomodoroSession, ReverseLoopRecord)
from app.agents.doc_agent import doc_agent
from app.agents.quiz_agent import quiz_agent
from app.agents.persona_agent import persona_agent
from app.agents.scorer_agent import scorer_agent
from app.services.external_kb import external_kb

router = APIRouter()

@router.get("/practice/categories")
async def get_practice_categories(db: AsyncSession = Depends(get_db)):
    """获取所有题目分类及其题目（知识库驱动：优先从 source_node_id 获取业务线）"""
    try:
        stmt = select(Question).order_by(Question.created_at.desc())
        result = await db.execute(stmt)
        questions = result.scalars().all()

        # 按分类分组：优先用知识库节点的 business_line，降级用 category 字段
        grouped = {}
        for q in questions:
            cat = None
            if q.source_node_id:
                try:
                    business_line = await external_kb.get_node_business_line(q.source_node_id)
                    if business_line:
                        cat = business_line
                except Exception:
                    pass
            if cat is None:
                cat = q.category or "通用业务"
            if cat not in grouped:
                grouped[cat] = []
            grouped[cat].append({
                "id": q.id,
                "scenario": q.scenario,
                "difficulty": q.difficulty
            })

        return [{"category": k, "questions": v} for k, v in grouped.items()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def health_check():
    return {"status": "ok", "message": "System is running v1.0"}

class ChatRequest(BaseModel):
    message: str
    agent_type: str = "doc" # "doc", "quiz", "persona"
    mode: str = "normal" # "normal", "feynman"
    history: list = [] # 用于 persona/doc feynman 的历史记录
    question_id: str | None = None # 用于 quiz agent 关联题目

class ScoreRequest(BaseModel):
    history: List[Dict[str, str]] # [{'role': 'trainee', 'content': '...'}, ...]

@router.post("/chat")
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    try:
        if request.agent_type == "doc":
            async def doc_generator():
                history = request.history + [{"role": "trainee", "content": request.message}]
                async for chunk in doc_agent.answer_query_stream(request.message, mode=request.mode, history=history):
                    yield chunk
            return StreamingResponse(doc_generator(), media_type="text/plain")
        
        elif request.agent_type == "quiz":
            # Quiz Agent：根据传来的 question_id 进行打分
            if not request.question_id:
                async def error_gen():
                    yield "缺少题目信息，无法判分。"
                return StreamingResponse(error_gen(), media_type="text/plain")

            db_question = await db.get(Question, request.question_id)

            last_msg = request.message

            if db_question:
                evaluation_prompt = f"""你是一个专业的银行客服培训考官。请对考生的回答进行点评。
【题目场景】：{db_question.scenario}
【参考答案】：{db_question.reference_answer}
【核心踩分点】：{', '.join(db_question.key_points)}

【考生的实际回答】：{last_msg}

请指出其优点和不足，判断是否覆盖了核心踩分点，并给出具体的改进建议。
同时在末尾另起一行，用 JSON 格式标记弱点信息，格式如下：
__WEAKNESS__{{"score": 75, "missed_points": ["未提及的踩分点1", "踩分点2"]}}
请直接输出点评内容，不要受外部知识库限制。"""
            else:
                evaluation_prompt = f"你是一个银行客服培训考官。请对考生的回答进行点评。指出其优点和不足，给出改进建议。\n考生的回答：{last_msg}"

            from app.services.llm_adapter import llm_client
            messages = [{"role": "user", "content": evaluation_prompt}]

            async def quiz_generator():
                yield "【练习判分结果】\n"
                full_reply = "【练习判分结果】\n"
                async for chunk in llm_client.chat_completion_stream(messages):
                    full_reply += chunk
                    yield chunk

                # 判分完成后，提取弱点标签并持久化
                try:
                    mock_user = await db.get(User, "mock_user")
                    if not mock_user:
                        db.add(User(id="mock_user", username="测试用户", hashed_password="xxx"))
                        await db.flush()

                    practice_record = PracticeRecord(
                        id=str(uuid.uuid4()),
                        trainee_id="mock_user",
                        question_id=request.question_id,
                        trainee_answer=last_msg,
                        ai_evaluation=full_reply
                    )
                    db.add(practice_record)
                    await db.flush()

                    # 提取弱点标签
                    import re
                    weakness_match = re.search(r'__WEAKNESS__(\{.*?\})', full_reply)
                    if weakness_match:
                        try:
                            weakness_data = json.loads(weakness_match.group(1))
                            missed = weakness_data.get("missed_points", [])
                            score = weakness_data.get("score", 0)

                            # 只在得分低于80且有遗漏点时记录弱点
                            if missed and score < 80:
                                weakness = UserWeakness(
                                    id=str(uuid.uuid4()),
                                    trainee_id="mock_user",
                                    category=db_question.category if db_question else "通用业务",
                                    weak_points=missed,
                                    score=score,
                                    source_type="practice",
                                    source_id=practice_record.id,
                                    resolved=False
                                )
                                db.add(weakness)
                        except Exception as e:
                            import logging
                            logging.error(f"Failed to parse weakness: {e}")

                    await db.commit()
                except Exception as e:
                    import logging
                    logging.error(f"Failed to save practice record: {e}")

            return StreamingResponse(quiz_generator(), media_type="text/plain")
            
        elif request.agent_type == "persona":
            # 升级版：加入场景压迫感与情绪驱动的话题跳转机制
            system_prompt = """你正在超市收银台排队结账，后面排着长队，但你的手机银行转账一直失败。
你正在和银行客服（现在的考生）沟通转账问题。你的初始状态是“急切”。
请注意以下行为逻辑：
1. 每次回复前，请先评估客服的回答：如果客服打官腔（如“请您理解”、“这是规定”），或者让你做复杂的操作（如去网点、提供繁杂证明），你的“耐心值”就会耗尽。
2. 如果客服在两轮对话内没有给你一个立刻能操作的解决方案，或者你的耐心值耗尽，你会因为后面顾客的催促感到极其尴尬和暴躁。
3. 这时，你必须自然地转移话题！放弃追究转账失败的原因，转而提出一个更简单直接的诉求，例如：“后面人都等着呢！行了行了我不转了，你赶紧帮我看看我这张卡还能不能直接绑微信刷码？”或者“那你帮我查查余额，我看看够不够取现金！”
4. 转移话题后，顺着新话题聊，绝不再回到转账失败的问题上。
请完全沉浸在这个场景中，表现得像一个真实、缺乏耐心的真人。你确信对方是真实客服，不要怀疑其身份。"""
            # 把当前用户的话加入历史
            history = request.history + [{"role": "trainee", "content": request.message}]
            
            async def persona_generator():
                async for chunk in persona_agent.generate_reply_stream(system_prompt, history):
                    yield chunk
                    
            return StreamingResponse(persona_generator(), media_type="text/plain")
            
        else:
            raise HTTPException(status_code=400, detail="未知的 Agent 类型")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/score")
async def score_conversation(request: ScoreRequest, db: AsyncSession = Depends(get_db)):
    try:
        if not request.history:
            raise HTTPException(status_code=400, detail="历史记录为空")
            
        # 1. 调用 scorer_agent 获取评分报告
        score_result = await scorer_agent.score_conversation(request.history)
        
        # 2. 存入数据库 - 考试记录
        exam_id = str(uuid.uuid4())
        
        # 为了避免 MySQL 的外键约束报错，我们先确保引用的 mock_user 和 default_persona 存在
        # 在真实应用中这些应该是通过注册和配置功能创建好的
        mock_user = await db.get(User, "mock_user")
        if not mock_user:
            db.add(User(id="mock_user", username="测试用户", hashed_password="xxx"))
            
        mock_persona = await db.get(Persona, "default_persona")
        if not mock_persona:
            db.add(Persona(id="default_persona", name="默认急躁客户", system_prompt="..."))
            
        await db.flush() # 提前刷入数据库，使得下面的外键能引用到
        
        record = ExamRecord(
            id=exam_id,
            trainee_id="mock_user", # v1.0 简化，暂时固定用户
            persona_id="default_persona",
            overall_score=score_result.get("overall_score", 0),
            score_details=score_result.get("score_details", {}),
            feedback=score_result.get("feedback", "")
        )
        db.add(record)
        await db.flush() # 确保 exam_record 存在，使得 chat_history 的 exam_id 能引用到

        # 提取考试低分维度，存入弱点表
        score_details = score_result.get("score_details", {})
        dimension_labels = {
            "accuracy": "业务准确性",
            "service_tone": "服务态度",
            "compliance": "制度合规性",
            "empathy": "情绪安抚",
            "dialogue_control": "沟通控场"
        }
        for dim_key, dim_label in dimension_labels.items():
            dim_score = score_details.get(dim_key, 100)
            if dim_score < 75:
                weakness = UserWeakness(
                    id=str(uuid.uuid4()),
                    trainee_id="mock_user",
                    category="模拟考试",
                    weak_points=[f"{dim_label}（{dim_score}分）"],
                    score=dim_score,
                    source_type="exam",
                    source_id=exam_id,
                    resolved=False
                )
                db.add(weakness)
        
        # 3. 存入数据库 - 聊天历史
        for msg in request.history:
            chat_record = ChatHistory(
                exam_id=exam_id,
                role=msg.get("role", "unknown"),
                content=msg.get("content", "")
            )
            db.add(chat_record)
            
        await db.commit()
        return score_result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/practice/history")
async def get_practice_history(db: AsyncSession = Depends(get_db)):
    """获取专项练习记录"""
    try:
        # 联合查询题目以获取场景描述
        stmt = select(PracticeRecord, Question).join(Question, PracticeRecord.question_id == Question.id, isouter=True).where(PracticeRecord.trainee_id == "mock_user").order_by(PracticeRecord.created_at.desc())
        result = await db.execute(stmt)
        records = result.all()
        
        return [
            {
                "id": r.PracticeRecord.id,
                "question_scenario": r.Question.scenario if r.Question else "未知题目",
                "trainee_answer": r.PracticeRecord.trainee_answer,
                "ai_evaluation": r.PracticeRecord.ai_evaluation,
                "created_at": r.PracticeRecord.created_at.isoformat() if r.PracticeRecord.created_at else None
            }
            for r in records
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/history")
async def get_history(db: AsyncSession = Depends(get_db)):
    """获取考生的历史考试记录（v1.0 简化版，返回所有 mock_user 的记录）"""
    try:
        stmt = select(ExamRecord).where(ExamRecord.trainee_id == "mock_user").order_by(ExamRecord.created_at.desc())
        result = await db.execute(stmt)
        records = result.scalars().all()
        
        return [
            {
                "id": r.id,
                "overall_score": r.overall_score,
                "score_details": r.score_details,
                "feedback": r.feedback,
                "created_at": r.created_at.isoformat() if r.created_at else None
            }
            for r in records
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/history/{exam_id}")
async def get_chat_details(exam_id: str, db: AsyncSession = Depends(get_db)):
    """获取某次考试的详细聊天记录"""
    try:
        stmt = select(ChatHistory).where(ChatHistory.exam_id == exam_id).order_by(ChatHistory.timestamp.asc())
        result = await db.execute(stmt)
        chats = result.scalars().all()
        
        return [
            {
                "role": c.role,
                "content": c.content,
                "timestamp": c.timestamp.isoformat() if c.timestamp else None
            }
            for c in chats
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 错题画像 & 反向循环 ====================

@router.get("/practice/weaknesses")
async def get_user_weaknesses(db: AsyncSession = Depends(get_db)):
    """获取学员的错题画像（弱点标签）"""
    try:
        stmt = select(UserWeakness).where(
            UserWeakness.trainee_id == "mock_user",
            UserWeakness.resolved == False
        ).order_by(UserWeakness.created_at.desc())
        result = await db.execute(stmt)
        weaknesses = result.scalars().all()

        # 按分类聚合
        grouped = {}
        for w in weaknesses:
            cat = w.category or "通用业务"
            if cat not in grouped:
                grouped[cat] = []
            grouped[cat].append({
                "id": w.id,
                "weak_points": w.weak_points,
                "score": w.score,
                "source_type": w.source_type,
                "created_at": w.created_at.isoformat() if w.created_at else None
            })

        return [{"category": k, "weaknesses": v} for k, v in grouped.items()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ReverseTrainingRequest(BaseModel):
    category: str
    weak_points: List[str]

@router.post("/practice/reverse-training")
async def generate_reverse_training(request: ReverseTrainingRequest, db: AsyncSession = Depends(get_db)):
    """根据弱点标签生成反向训练题（错题变种）"""
    try:
        result = await quiz_agent.generate_reverse_training(
            weak_points=request.weak_points,
            category=request.category
        )

        # 将生成的反向训练题存入题库
        new_question = Question(
            id=str(uuid.uuid4()),
            category=request.category,
            scenario=result.get("scenario", ""),
            reference_answer=result.get("reference_answer", ""),
            key_points=result.get("key_points", []),
            difficulty=result.get("difficulty", "medium")
        )
        db.add(new_question)
        await db.commit()

        return {
            "status": "success",
            "question_id": new_question.id,
            "question": result,
            "message": f"已根据弱点[{', '.join(request.weak_points)}]生成反向训练题"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/practice/recommended")
async def get_recommended_practice(db: AsyncSession = Depends(get_db)):
    """
    获取推荐练习：如果有未解决的弱点标签，强制推送反向训练题；
    如果没有弱点，返回空列表（正常进入题库选择）
    """
    try:
        stmt = select(UserWeakness).where(
            UserWeakness.trainee_id == "mock_user",
            UserWeakness.resolved == False
        ).order_by(UserWeakness.created_at.desc())
        result = await db.execute(stmt)
        weaknesses = result.scalars().all()

        if not weaknesses:
            return {"has_recommendation": False, "recommendations": []}

        # 聚合弱点
        recommendations = []
        seen_categories = set()
        for w in weaknesses:
            cat = w.category or "通用业务"
            if cat not in seen_categories:
                seen_categories.add(cat)
                recommendations.append({
                    "category": cat,
                    "weak_points": w.weak_points,
                    "last_score": w.score,
                    "weakness_id": w.id
                })

        return {"has_recommendation": True, "recommendations": recommendations}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 试卷 & 发卷 ====================

@router.get("/exam-papers")
async def get_my_exam_papers(db: AsyncSession = Depends(get_db)):
    """获取下发给当前学员的试卷"""
    try:
        stmt = select(ExamAssignment, ExamPaper).join(
            ExamPaper, ExamAssignment.exam_paper_id == ExamPaper.id
        ).where(
            ExamAssignment.trainee_id == "mock_user",
            ExamAssignment.status != "completed"
        ).order_by(ExamAssignment.created_at.desc())
        result = await db.execute(stmt)
        assignments = result.all()

        return [
            {
                "assignment_id": r.ExamAssignment.id,
                "paper_id": r.ExamPaper.id,
                "title": r.ExamPaper.title,
                "question_ids": r.ExamPaper.question_ids,
                "status": r.ExamAssignment.status,
                "created_at": r.ExamAssignment.created_at.isoformat() if r.ExamAssignment.created_at else None
            }
            for r in assignments
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/exam-papers/{paper_id}/detail")
async def get_exam_paper_detail(paper_id: str, db: AsyncSession = Depends(get_db)):
    """获取试卷详情（包含题目内容）"""
    try:
        paper = await db.get(ExamPaper, paper_id)
        if not paper:
            raise HTTPException(status_code=404, detail="试卷不存在")

        questions = []
        for q_id in paper.question_ids:
            question = await db.get(Question, q_id)
            if question:
                questions.append({
                    "id": question.id,
                    "category": question.category,
                    "scenario": question.scenario,
                    "reference_answer": question.reference_answer,
                    "key_points": question.key_points,
                    "difficulty": question.difficulty
                })

        return {
            "id": paper.id,
            "title": paper.title,
            "questions": questions,
            "total_questions": len(questions),
            "created_at": paper.created_at.isoformat() if paper.created_at else None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SubmitExamAnswerRequest(BaseModel):
    assignment_id: str
    answers: list  # [{"question_id": str, "answer": str}]


@router.post("/exam-papers/submit")
async def submit_exam_answer(request: SubmitExamAnswerRequest, db: AsyncSession = Depends(get_db)):
    """提交试卷答案"""
    try:
        assignment = await db.get(ExamAssignment, request.assignment_id)
        if not assignment:
            raise HTTPException(status_code=404, detail="发卷记录不存在")

        paper = await db.get(ExamPaper, assignment.exam_paper_id)
        if not paper:
            raise HTTPException(status_code=404, detail="试卷不存在")

        # 确保 mock_user 存在
        mock_user = await db.get(User, "mock_user")
        if not mock_user:
            db.add(User(id="mock_user", username="测试用户", hashed_password="xxx"))
            await db.flush()

        from app.services.llm_adapter import llm_client
        import re

        total_score = 0
        results = []

        for ans in request.answers:
            question = await db.get(Question, ans["question_id"])
            if question:
                # 使用 LLM 评分（和练习判分相同的逻辑）
                evaluation_prompt = f"""你是一个专业的银行客服培训考官。请对考生的回答进行评分。

【题目场景】：{question.scenario}
【参考答案】：{question.reference_answer}
【核心踩分点】：{', '.join(question.key_points or [])}

【考生的实际回答】：{ans['answer']}

请按以下 JSON 格式输出评分结果，不要包含多余文本：
{{
    "score": 0-100,
    "feedback": "点评内容，指出优点和不足",
    "missed_points": ["未提及的踩分点1", "踩分点2"]
}}
"""
                messages = [{"role": "user", "content": evaluation_prompt}]
                response = await llm_client.async_chat_completion(messages)

                try:
                    clean_str = response.strip().strip("```json").strip("```")
                    score_data = json.loads(clean_str)
                except:
                    # 如果 JSON 解析失败，尝试从文本中提取
                    score_match = re.search(r'"score"\s*:\s*(\d+)', response)
                    score = int(score_match.group(1)) if score_match else 60
                    score_data = {
                        "score": score,
                        "feedback": response[:200],
                        "missed_points": []
                    }

                score = score_data.get("score", 60)
                total_score += score
                results.append({
                    "question_id": ans["question_id"],
                    "trainee_answer": ans["answer"],
                    "score": score,
                    "feedback": score_data.get("feedback", ""),
                    "missed_points": score_data.get("missed_points", [])
                })

                # 记录弱点
                if score < 80 and score_data.get("missed_points"):
                    weakness = UserWeakness(
                        id=str(uuid.uuid4()),
                        trainee_id="mock_user",
                        category=question.category,
                        weak_points=score_data.get("missed_points", []),
                        score=score,
                        source_type="exam",
                        source_id=assignment.id,
                        resolved=False
                    )
                    db.add(weakness)

        avg_score = total_score / len(request.answers) if request.answers else 0

        exam_record = ExamRecord(
            id=str(uuid.uuid4()),
            trainee_id="mock_user",
            persona_id=None,
            overall_score=int(avg_score),
            score_details={"question_count": len(results), "paper_id": paper.id, "results": results},
            feedback=f"试卷《{paper.title}》得分：{int(avg_score)}分"
        )
        db.add(exam_record)

        assignment.status = "completed"
        await db.commit()

        return {
            "status": "success",
            "total_score": int(avg_score),
            "question_results": results,
            "message": f"试卷提交成功！总得分：{int(avg_score)}分"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/exam-papers/{assignment_id}/complete")
async def complete_exam_paper(assignment_id: str, db: AsyncSession = Depends(get_db)):
    """标记试卷为已完成"""
    try:
        assignment = await db.get(ExamAssignment, assignment_id)
        if not assignment:
            raise HTTPException(status_code=404, detail="发卷记录不存在")
        assignment.status = "completed"
        await db.commit()
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 反循环完整闭环 ====================

class VerifyCorrectionRequest(BaseModel):
    question_id: str
    trainee_answer: str
    weakness_id: Optional[str] = None

@router.post("/practice/verify-correction")
async def verify_correction(request: VerifyCorrectionRequest, db: AsyncSession = Depends(get_db)):
    """反循环闭环：验证学员是否真正掌握了薄弱知识点"""
    try:
        # 获取反向训练题
        question = await db.get(Question, request.question_id)
        if not question:
            raise HTTPException(status_code=404, detail="题目不存在")

        # 获取关联的弱点
        weak_points = []
        weakness = None
        if request.weakness_id:
            weakness = await db.get(UserWeakness, request.weakness_id)
            if weakness:
                weak_points = weakness.weak_points or []

        # 调用 verify_correction 验证
        result = await quiz_agent.verify_correction(
            reverse_scenario=question.scenario,
            reverse_reference=question.reference_answer,
            trainee_answer=request.trainee_answer,
            weak_points=weak_points
        )

        # 记录反循环追踪
        loop_record = ReverseLoopRecord(
            id=str(uuid.uuid4()),
            trainee_id="mock_user",
            weakness_id=request.weakness_id,
            original_question_id=None,
            error_analysis={},
            reverse_question_id=request.question_id,
            reverse_answer=request.trainee_answer,
            verification_result=result.get("status", "pending"),
            reinforcement_needed=result.get("status") == "need_reinforcement"
        )
        db.add(loop_record)

        # 如果验证通过，标记弱点为已解决
        if result.get("status") == "corrected" and weakness:
            weakness.resolved = True

        await db.commit()

        return {
            "status": result.get("status"),
            "score": result.get("score", 0),
            "feedback": result.get("feedback", ""),
            "covered_points": result.get("covered_points", []),
            "still_missing": result.get("still_missing", []),
            "recommendation": result.get("recommendation", ""),
            "weakness_resolved": result.get("status") == "corrected"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 纵向趋势分析 ====================

@router.get("/trend")
async def get_trend_analysis(db: AsyncSession = Depends(get_db)):
    """获取学员的纵向成绩趋势"""
    try:
        # 考试成绩趋势
        exam_stmt = select(ExamRecord).where(
            ExamRecord.trainee_id == "mock_user"
        ).order_by(ExamRecord.created_at.asc())
        exam_result = await db.execute(exam_stmt)
        exam_records = exam_result.scalars().all()

        exam_trend = []
        for r in exam_records:
            exam_trend.append({
                "date": r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else "",
                "score": r.overall_score,
                "details": r.score_details or {}
            })

        # 练习成绩趋势 - 从 ai_evaluation 中提取分数
        practice_stmt = select(PracticeRecord).where(
            PracticeRecord.trainee_id == "mock_user"
        ).order_by(PracticeRecord.created_at.asc())
        practice_result = await db.execute(practice_stmt)
        practice_records = practice_result.scalars().all()

        practice_trend = []
        for r in practice_records:
            import re
            score_match = re.search(r'__WEAKNESS__\{.*?"score":\s*(\d+)', r.ai_evaluation or "")
            score = int(score_match.group(1)) if score_match else 0
            practice_trend.append({
                "date": r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else "",
                "score": score
            })

        return {
            "exam_trend": exam_trend,
            "practice_trend": practice_trend,
            "exam_count": len(exam_trend),
            "practice_count": len(practice_trend),
            "exam_avg": sum(e["score"] for e in exam_trend) / len(exam_trend) if exam_trend else 0,
            "practice_avg": sum(p["score"] for p in practice_trend) / len(practice_trend) if practice_trend else 0
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 费曼完成度追踪 ====================

class FeynmanSubmitRequest(BaseModel):
    topic: str
    paraphrase: str

@router.post("/feynman/submit")
async def submit_feynman_paraphrase(request: FeynmanSubmitRequest, db: AsyncSession = Depends(get_db)):
    """提交费曼复述，系统分析理解度"""
    try:
        # 调用 Doc Agent 分析复述质量
        from app.services.llm_adapter import llm_client
        prompt = f"""
你是银行客服培训系统的费曼学习法评估专家。

知识点主题：{request.topic}
学员复述内容：{request.paraphrase}

请判断：
1. 核心概念是否准确？（是/否）
2. 是否遗漏关键细节？
3. 理解度评分：0-100
4. 推荐复习内容

请严格按照以下 JSON 格式输出：
{{
    "is_accurate": true/false,
    "understanding_score": 0-100,
    "missing_points": ["遗漏的关键点1", "遗漏的关键点2"],
    "review_suggestion": "复习建议"
}}
"""
        messages = [{"role": "user", "content": prompt}]
        response = await llm_client.async_chat_completion(messages)

        try:
            clean_str = response.strip().strip("```json").strip("```")
            result = json.loads(clean_str)
        except:
            result = {"is_accurate": False, "understanding_score": 0, "missing_points": [], "review_suggestion": "解析失败"}

        # 存入数据库
        record = FeynmanRecord(
            id=str(uuid.uuid4()),
            trainee_id="mock_user",
            topic=request.topic,
            paraphrase=request.paraphrase,
            understanding_score=result.get("understanding_score", 0),
            missing_points=result.get("missing_points", []),
            is_accurate=result.get("is_accurate", False),
            review_suggestion=result.get("review_suggestion", "")
        )
        db.add(record)
        await db.commit()

        return {
            "status": "success",
            "understanding_score": result.get("understanding_score", 0),
            "is_accurate": result.get("is_accurate", False),
            "missing_points": result.get("missing_points", []),
            "review_suggestion": result.get("review_suggestion", ""),
            "record_id": record.id
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/feynman/progress")
async def get_feynman_progress(db: AsyncSession = Depends(get_db)):
    """获取费曼学习完成度"""
    try:
        stmt = select(FeynmanRecord).where(
            FeynmanRecord.trainee_id == "mock_user"
        ).order_by(FeynmanRecord.created_at.desc())
        result = await db.execute(stmt)
        records = result.scalars().all()

        # 按主题分组，取每个主题的最高分
        topic_best = {}
        for r in records:
            if r.topic not in topic_best or r.understanding_score > topic_best[r.topic]["score"]:
                topic_best[r.topic] = {
                    "score": r.understanding_score,
                    "is_accurate": r.is_accurate,
                    "missing_points": r.missing_points or [],
                    "last_attempt": r.created_at.isoformat() if r.created_at else None
                }

        total_topics = len(topic_best)
        completed = sum(1 for t in topic_best.values() if t["score"] >= 70)
        completion_rate = completed / total_topics if total_topics > 0 else 0

        return {
            "total_topics": total_topics,
            "completed": completed,
            "in_progress": total_topics - completed,
            "completion_rate": round(completion_rate, 2),
            "topics": [
                {"topic": k, **v} for k, v in topic_best.items()
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 教学题型 ====================

class TeachingQuestionRequest(BaseModel):
    category: str

@router.post("/practice/teaching-question")
async def generate_teaching_question(request: TeachingQuestionRequest, db: AsyncSession = Depends(get_db)):
    """生成费曼学习法-教学题型"""
    try:
        result = await quiz_agent.generate_teaching_question(category=request.category)

        # 存入题库
        new_question = Question(
            id=str(uuid.uuid4()),
            category=request.category,
            scenario=result.get("scenario", ""),
            reference_answer=result.get("reference_answer", ""),
            key_points=result.get("key_points", []),
            difficulty=result.get("difficulty", "medium")
        )
        db.add(new_question)
        await db.commit()

        return {
            "status": "success",
            "question_id": new_question.id,
            "question": result,
            "message": f"已生成「{request.category}」教学题型"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 能力画像 ====================

@router.get("/capability-portrait")
async def get_capability_portrait(db: AsyncSession = Depends(get_db)):
    """获取多维能力画像"""
    try:
        # 收集各维度数据
        # 1. 考试历史
        exam_stmt = select(ExamRecord).where(ExamRecord.trainee_id == "mock_user").order_by(ExamRecord.created_at.desc())
        exam_result = await db.execute(exam_stmt)
        exam_history = [{"overall_score": r.overall_score, "score_details": r.score_details} for r in exam_result.scalars().all()]

        # 2. 练习历史
        practice_stmt = select(PracticeRecord, Question).join(
            Question, PracticeRecord.question_id == Question.id, isouter=True
        ).where(PracticeRecord.trainee_id == "mock_user").order_by(PracticeRecord.created_at.desc())
        practice_result = await db.execute(practice_stmt)
        practice_history = []
        for r in practice_result.all():
            import re
            score_match = re.search(r'__WEAKNESS__\{.*?"score":\s*(\d+)', r.PracticeRecord.ai_evaluation or "")
            score = int(score_match.group(1)) if score_match else 0
            practice_history.append({"score": score})

        # 3. 费曼进度
        feynman_stmt = select(FeynmanRecord).where(FeynmanRecord.trainee_id == "mock_user")
        feynman_result = await db.execute(feynman_stmt)
        feynman_records = feynman_result.scalars().all()
        topic_best = {}
        for r in feynman_records:
            if r.topic not in topic_best or r.understanding_score > topic_best[r.topic]:
                topic_best[r.topic] = r.understanding_score
        feynman_progress = {
            "completion_rate": sum(1 for s in topic_best.values() if s >= 70) / len(topic_best) if topic_best else 0
        }

        # 4. 番茄钟统计
        pomo_stmt = select(PomodoroSession).where(PomodoroSession.trainee_id == "mock_user")
        pomo_result = await db.execute(pomo_stmt)
        pomo_records = pomo_result.scalars().all()
        pomodoro_stats = {
            "total_pomodoros": len(pomo_records),
            "streak_days": 0,  # 简化计算
            "avg_daily_pomodoros": len(pomo_records) / 7 if pomo_records else 0
        }

        # 5. 弱点统计
        weakness_stmt = select(UserWeakness).where(UserWeakness.trainee_id == "mock_user")
        weakness_result = await db.execute(weakness_stmt)
        all_weaknesses = weakness_result.scalars().all()
        resolved = sum(1 for w in all_weaknesses if w.resolved)
        unresolved_points = []
        for w in all_weaknesses:
            if not w.resolved:
                unresolved_points.extend(w.weak_points or [])
        weakness_stats = {
            "total": len(all_weaknesses),
            "resolved": resolved,
            "unresolved_points": list(set(unresolved_points))
        }

        # 生成能力画像
        portrait = scorer_agent.generate_capability_portrait(
            exam_history=exam_history,
            practice_history=practice_history,
            feynman_progress=feynman_progress,
            pomodoro_stats=pomodoro_stats,
            weakness_stats=weakness_stats
        )

        return portrait
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 番茄钟数据统计 ====================

class PomodoroCompleteRequest(BaseModel):
    module: str = "study"  # study / practice
    duration: int = 1500  # 秒

@router.post("/pomodoro/complete")
async def complete_pomodoro(request: PomodoroCompleteRequest, db: AsyncSession = Depends(get_db)):
    """完成一次番茄钟，记录到数据库"""
    try:
        session = PomodoroSession(
            id=str(uuid.uuid4()),
            trainee_id="mock_user",
            module=request.module,
            duration=request.duration,
            status="completed"
        )
        db.add(session)
        await db.commit()

        # 统计今日番茄数
        from datetime import datetime, date
        today = date.today()
        stmt = select(func.count(PomodoroSession.id)).where(
            PomodoroSession.trainee_id == "mock_user",
            func.date(PomodoroSession.created_at) == today
        )
        result = await db.execute(stmt)
        today_count = result.scalar() or 0

        # 总番茄数
        total_stmt = select(func.count(PomodoroSession.id)).where(PomodoroSession.trainee_id == "mock_user")
        total_result = await db.execute(total_stmt)
        total_count = total_result.scalar() or 0

        return {
            "status": "success",
            "today_pomodoros": today_count,
            "total_pomodoros": total_count,
            "message": f"完成第{total_count}个番茄钟！今日已完成{today_count}个。"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pomodoro/stats")
async def get_pomodoro_stats(db: AsyncSession = Depends(get_db)):
    """获取番茄钟统计数据"""
    try:
        from datetime import datetime, date, timedelta

        # 总番茄数
        total_stmt = select(func.count(PomodoroSession.id)).where(PomodoroSession.trainee_id == "mock_user")
        total_result = await db.execute(total_stmt)
        total_pomodoros = total_result.scalar() or 0

        # 总学习时长（分钟）
        duration_stmt = select(func.sum(PomodoroSession.duration)).where(PomodoroSession.trainee_id == "mock_user")
        duration_result = await db.execute(duration_stmt)
        total_duration = duration_result.scalar() or 0
        total_study_hours = round(total_duration / 3600, 1)

        # 今日番茄数
        today = date.today()
        today_stmt = select(func.count(PomodoroSession.id)).where(
            PomodoroSession.trainee_id == "mock_user",
            func.date(PomodoroSession.created_at) == today
        )
        today_result = await db.execute(today_stmt)
        today_pomodoros = today_result.scalar() or 0

        # 计算连续学习天数
        date_stmt = select(func.date(PomodoroSession.created_at)).where(
            PomodoroSession.trainee_id == "mock_user"
        ).distinct().order_by(func.date(PomodoroSession.created_at).desc())
        date_result = await db.execute(date_stmt)
        dates = [row[0] for row in date_result.fetchall()]

        streak_days = 0
        if dates:
            check_date = today
            for d in dates:
                if d == check_date:
                    streak_days += 1
                    check_date = check_date - timedelta(days=1)
                elif d == check_date - timedelta(days=1):
                    continue
                else:
                    break

        # 近7天日均
        week_ago = today - timedelta(days=7)
        week_stmt = select(func.count(PomodoroSession.id)).where(
            PomodoroSession.trainee_id == "mock_user",
            func.date(PomodoroSession.created_at) > week_ago
        )
        week_result = await db.execute(week_stmt)
        week_count = week_result.scalar() or 0
        avg_daily = round(week_count / 7, 1)

        return {
            "total_pomodoros": total_pomodoros,
            "total_study_hours": total_study_hours,
            "today_pomodoros": today_pomodoros,
            "streak_days": streak_days,
            "avg_daily_pomodoros": avg_daily
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ===== V3.0 动态模拟考试系统 =====

from app.models import DynamicExam, BusinessLineProgress
from app.services.exam_engine import dynamic_exam_engine, AnxietyMechanism, EmergencyMechanism, business_line_manager

# 内存中缓存考试状态（生产环境应使用 Redis）
_exam_state_cache = {}

# 缓存自动回收：客户端可能在考试自然结束（达到最大轮数/烦躁值爆表）后
# 未调用 /dynamic-exam/end（网络中断、直接关闭浏览器等），导致缓存条目永远无法清理。
# 已结束的考试给一段宽限期（供前端补call /end 取最终评分），超时后台清理；
# 进行中但长时间无活动的考试也做兜底清理，避免无限增长。
_EXAM_CACHE_ENDED_GRACE = timedelta(minutes=15)
_EXAM_CACHE_ABANDONED_TIMEOUT = timedelta(hours=3)


def _touch_exam_activity(exam_state: dict):
    """记录考试状态的最近一次活跃时间，供缓存回收判断使用"""
    exam_state["_last_activity"] = datetime.now()


def _reap_stale_exam_cache():
    """清理长时间未活动的考试缓存条目，防止内存无限增长"""
    now = datetime.now()
    stale_ids = []
    for exam_id, exam_state in _exam_state_cache.items():
        last_activity = exam_state.get("_last_activity", now)
        idle = now - last_activity
        if exam_state.get("status") != "in_progress":
            if idle > _EXAM_CACHE_ENDED_GRACE:
                stale_ids.append(exam_id)
        elif idle > _EXAM_CACHE_ABANDONED_TIMEOUT:
            stale_ids.append(exam_id)
    for exam_id in stale_ids:
        del _exam_state_cache[exam_id]
    return len(stale_ids)


class StartDynamicExamRequest(BaseModel):
    pass


@router.post("/dynamic-exam/start")
async def start_dynamic_exam(db: AsyncSession = Depends(get_db)):
    """开始动态模拟考试"""
    try:
        trace_id = str(uuid.uuid4())
        exam_state = await dynamic_exam_engine.initialize_exam(trace_id=trace_id)
        
        # 确保 mock_user 存在
        mock_user = await db.get(User, "mock_user")
        if not mock_user:
            db.add(User(id="mock_user", username="测试用户", hashed_password="xxx"))
            await db.flush()
        
        # 创建考试记录
        exam_id = str(uuid.uuid4())
        exam_record = DynamicExam(
            id=exam_id,
            trainee_id="mock_user",
            persona_type=exam_state["persona_type"],
            initial_anxiety=exam_state["initial_anxiety"],
            final_anxiety=exam_state["initial_anxiety"],
            max_anxiety=exam_state["initial_anxiety"],
            anxiety_threshold=exam_state["anxiety_threshold"],
            max_rounds=exam_state["max_rounds"],
            expected_rounds=exam_state["expected_rounds"],
            business_lines_covered=exam_state["business_lines_covered"],
            status="in_progress"
        )
        db.add(exam_record)
        await db.commit()
        
        exam_state["exam_id"] = exam_id
        _touch_exam_activity(exam_state)
        _exam_state_cache[exam_id] = exam_state

        # 生成客户开场白
        business_context = await persona_agent.get_business_context(
            exam_state["current_business_line"], trace_id=trace_id
        )
        opening_prompt = f"""你是{exam_state['persona_type']}的银行客户。
你现在需要咨询「{exam_state['current_business_line']}」相关的问题。
请用1-2句话开场，描述你的问题。语气要符合{exam_state['persona_type']}的特点。"""
        
        opening_history = [{"role": "trainee", "content": "您好，请问有什么可以帮您？"}]
        opening_reply = await persona_agent.generate_reply(
            opening_prompt, opening_history, trace_id=trace_id, business_context=business_context
        )
        
        exam_state["chat_history"].append({"round": 0, "role": "customer", "content": opening_reply})
        
        return {
            "exam_id": exam_id,
            "persona_type": exam_state["persona_type"],
            "initial_anxiety": exam_state["initial_anxiety"],
            "anxiety_threshold": exam_state["anxiety_threshold"],
            "current_business_line": exam_state["current_business_line"],
            "goals": exam_state["goals"],
            "max_rounds": exam_state["max_rounds"],
            "expected_rounds": exam_state["expected_rounds"],
            "opening_message": opening_reply,
            "emotion_state": AnxietyMechanism.get_emotion_state(exam_state["initial_anxiety"]),
            # V3.4: 意图状态机 + PBL 项目制
            "exam_mode": exam_state.get("exam_mode", "single"),
            "intent_state": exam_state["intent_machine"].get_state_snapshot() if exam_state.get("intent_machine") else None,
            "task_state": exam_state["project_manager"].get_state_snapshot() if exam_state.get("project_manager") else None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class DynamicExamChatRequest(BaseModel):
    exam_id: str
    message: str


@router.post("/dynamic-exam/chat")
async def dynamic_exam_chat(request: DynamicExamChatRequest, db: AsyncSession = Depends(get_db)):
    """动态考试对话"""
    try:
        exam_state = _exam_state_cache.get(request.exam_id)
        if not exam_state:
            raise HTTPException(status_code=404, detail="考试不存在或已过期")
        
        if exam_state["status"] != "in_progress":
            raise HTTPException(status_code=400, detail=f"考试已结束：{exam_state['status']}")

        _touch_exam_activity(exam_state)

        trace_id = str(uuid.uuid4())
        trainee_answer = request.message
        
        # 获取业务上下文
        business_context = await persona_agent.get_business_context(
            exam_state["current_business_line"], trace_id=trace_id
        )
        
        # 根据烦躁值调整人格语气
        anxiety = exam_state["current_anxiety"]
        emotion = AnxietyMechanism.get_emotion_state(anxiety)
        anxiety_prompt = f"\n当前烦躁值：{anxiety}/100，情绪状态：{emotion}。"
        if anxiety > 70:
            anxiety_prompt += "你现在非常烦躁，语气要急切、不满。"
        elif anxiety > 50:
            anxiety_prompt += "你有些不耐烦，语气要带情绪。"
        elif anxiety < 30:
            anxiety_prompt += "你现在心情不错，语气要平和。"

        # 业务目标引导：提醒客户当前的业务诉求，避免话题跑偏
        goals_pending = [g["name"] for g in exam_state["goals"] if not g["completed"]]
        goals_prompt = ""
        if goals_pending:
            goals_prompt = f"\n\n【当前你的业务诉求】（请在回复中自然推进这些诉求，不要跑偏到其他话题）：\n- 「{exam_state['current_business_line']}」业务的目标：{', '.join(goals_pending)}\n请注意：如果客服已经回答清楚，请自然接受并推进到下一个诉求，不要在同一个问题上反复纠缠。"

        # V3.4: 意图状态机 + PBL 项目制 —— 将当前意图/任务注入客户 prompt
        intent_task_prompt = ""
        if exam_state.get("exam_mode") == "project" and exam_state.get("project_manager"):
            pm = exam_state["project_manager"]
            intent_task_prompt = pm.get_task_prompt()
        elif exam_state.get("intent_machine"):
            intent_task_prompt = exam_state["intent_machine"].get_intent_prompt()

        # V3.2: 突发情况融入聊天 —— 在生成客户回复前检测，若触发则注入客户 prompt
        # 让客户在该轮回复中自然说出突发台词，而非用弹窗脱节展示
        next_round = exam_state["current_round"] + 1
        emergency_prompt = ""
        triggered_emergency = None
        if next_round > 2 and next_round < exam_state["max_rounds"] - 1:
            triggered_emergency = EmergencyMechanism.check_emergency()
            if triggered_emergency:
                # 突发情况小幅推高烦躁值（客户被打断/遇到状况）
                exam_state["current_anxiety"] = min(100, exam_state["current_anxiety"] + AnxietyMechanism.INCREASE_RULES["突发状况影响"])
                emergency_prompt = (
                    '\n\n【突发状况来袭——请在本轮回复中自然演绎】\n'
                    f"状况类型：{triggered_emergency['type']}\n"
                    f"状况描述：{triggered_emergency['description']}\n"
                    f'请你在本轮回复中，以客户的口吻自然地说出类似这样的话："{triggered_emergency["customer_line"]}"\n'
                    '要求：把这句突发台词融入你的正常业务诉求中，不要生硬跳出，保持1-2句话。'
                    '不要解释这是突发状况，就像真实通话中突然发生一样自然表达。'
                )
                # 存入 pending_emergency，下一轮 process_round 时评估考生应对
                exam_state["pending_emergency"] = triggered_emergency

        full_system_prompt = exam_state["system_prompt"] + anxiety_prompt + goals_prompt + intent_task_prompt + emergency_prompt
        
        # 生成客户回复
        history = [{"role": "trainee", "content": trainee_answer}]
        persona_reply = await persona_agent.generate_reply(
            full_system_prompt, history, trace_id=trace_id, business_context=business_context
        )
        
        # 处理这轮对话
        round_result = await dynamic_exam_engine.process_round(
            exam_state, trainee_answer, persona_reply, trace_id=trace_id
        )
        
        # 更新数据库记录
        exam_record = await db.get(DynamicExam, request.exam_id)
        if exam_record:
            exam_record.final_anxiety = exam_state["current_anxiety"]
            exam_record.max_anxiety = exam_state["max_anxiety"]
            exam_record.total_rounds = exam_state["current_round"]
            exam_record.chat_history = exam_state["chat_history"]
            exam_record.anxiety_history = exam_state["anxiety_history"]
            exam_record.business_lines_covered = exam_state["business_lines_covered"]
            if exam_state["status"] != "in_progress":
                exam_record.status = exam_state["status"]
                exam_record.completed_at = datetime.now()
            await db.commit()
        
        return {
            "round": round_result["round"],
            "customer_reply": persona_reply,
            "anxiety": round_result["anxiety"],
            "anxiety_change": round_result["anxiety_change"],
            "emotion_state": round_result["emotion_state"],
            "triggered_rules": round_result["triggered_rules"],
            "key_points_hit": round_result["key_points_hit"],
            "goals_completed": round_result["goals_completed"],
            "all_goals_done": round_result["all_goals_done"],
            "emergency": round_result["emergency"],
            "emergency_result": round_result["emergency_result"],
            "emergency_triggered": triggered_emergency,  # V3.2: 本轮是否触发突发（已融入客户回复）
            "anxiety_warning": round_result["anxiety_warning"],
            "end_reason": round_result["end_reason"],
            "status": round_result["status"],
            "current_business_line": exam_state["current_business_line"],
            "goals": exam_state["goals"],
            "max_rounds": exam_state["max_rounds"],
            "business_lines_covered": exam_state["business_lines_covered"],
            # V3.4: 意图状态机 + PBL 项目制
            "exam_mode": round_result.get("exam_mode", "single"),
            "intent_state": round_result.get("intent_state"),
            "task_state": round_result.get("task_state"),
            "intent_switched": round_result.get("intent_switched", False),
            "task_switched": round_result.get("task_switched", False),
            "intent_history": round_result.get("intent_history", []),
            "task_history": round_result.get("task_history", [])
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class EndDynamicExamRequest(BaseModel):
    exam_id: str


@router.post("/dynamic-exam/end")
async def end_dynamic_exam(request: EndDynamicExamRequest, db: AsyncSession = Depends(get_db)):
    """结束动态考试并生成报告"""
    try:
        exam_state = _exam_state_cache.get(request.exam_id)
        if not exam_state:
            raise HTTPException(status_code=404, detail="考试不存在或已过期")
        
        trace_id = str(uuid.uuid4())
        
        # 计算最终评分
        final_score = dynamic_exam_engine.calculate_final_score(exam_state)
        
        # 更新考试状态
        if exam_state["status"] == "in_progress":
            exam_state["status"] = "completed"
        
        # 更新数据库
        exam_record = await db.get(DynamicExam, request.exam_id)
        if exam_record:
            exam_record.final_anxiety = exam_state["current_anxiety"]
            exam_record.max_anxiety = exam_state["max_anxiety"]
            exam_record.total_rounds = exam_state["current_round"]
            exam_record.business_lines_covered = exam_state["business_lines_covered"]
            exam_record.business_score = final_score["business_score"]
            exam_record.emotion_score = final_score["emotion_score"]
            exam_record.efficiency_score = final_score["efficiency_score"]
            exam_record.bonus_score = final_score["bonus_score"]
            exam_record.overall_score = final_score["overall_score"]
            exam_record.weakness_tags = final_score["weakness_tags"]
            exam_record.status = exam_state["status"]
            exam_record.chat_history = exam_state["chat_history"]
            exam_record.anxiety_history = exam_state["anxiety_history"]
            exam_record.completed_at = datetime.now()
            await db.commit()
            
            # 保存业务线进度
            for progress in exam_state["business_line_progress"]:
                progress_record = BusinessLineProgress(
                    id=str(uuid.uuid4()),
                    exam_id=request.exam_id,
                    business_line=progress["business_line"],
                    category=progress.get("category", progress["business_line"]),
                    key_points=progress.get("key_points", []),
                    goals=progress["goals"],
                    goals_completed=progress["goals_completed"],
                    rounds_used=progress["rounds_used"],
                    rounds_expected=progress["rounds_expected"],
                    score=int(len(progress["goals_completed"]) / max(len(progress["goals"]), 1) * 100),
                    completed=progress["completed"]
                )
                db.add(progress_record)
            
            # 生成弱点标签并存入 user_weaknesses 表
            for tag in final_score["weakness_tags"]:
                weakness = UserWeakness(
                    id=str(uuid.uuid4()),
                    trainee_id="mock_user",
                    category="动态考试",
                    weak_points=[tag["tag"]],
                    score=final_score["overall_score"],
                    source_type="exam",
                    source_id=request.exam_id,
                    resolved=False
                )
                db.add(weakness)
            
            await db.commit()
        
        # 清理缓存
        if request.exam_id in _exam_state_cache:
            del _exam_state_cache[request.exam_id]
        
        return {
            "exam_id": request.exam_id,
            "status": exam_state["status"],
            "final_score": final_score,
            "anxiety_history": exam_state["anxiety_history"],
            "business_line_progress": exam_state["business_line_progress"],
            "chat_history": exam_state["chat_history"]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dynamic-exam/{exam_id}/detail")
async def get_dynamic_exam_detail(exam_id: str, db: AsyncSession = Depends(get_db)):
    """获取动态考试详情"""
    try:
        exam_record = await db.get(DynamicExam, exam_id)
        if not exam_record:
            raise HTTPException(status_code=404, detail="考试记录不存在")

        # 获取业务线进度
        stmt = select(BusinessLineProgress).where(BusinessLineProgress.exam_id == exam_id)
        result = await db.execute(stmt)
        progress_records = result.scalars().all()

        return {
            "exam_id": exam_record.id,
            "persona_type": exam_record.persona_type,
            "initial_anxiety": exam_record.initial_anxiety,
            "final_anxiety": exam_record.final_anxiety,
            "max_anxiety": exam_record.max_anxiety,
            "anxiety_threshold": exam_record.anxiety_threshold,
            "total_rounds": exam_record.total_rounds,
            "expected_rounds": exam_record.expected_rounds,
            "max_rounds": exam_record.max_rounds,
            "business_score": exam_record.business_score,
            "emotion_score": exam_record.emotion_score,
            "efficiency_score": exam_record.efficiency_score,
            "bonus_score": exam_record.bonus_score,
            "overall_score": exam_record.overall_score,
            "status": exam_record.status,
            "chat_history": exam_record.chat_history,
            "anxiety_history": exam_record.anxiety_history,
            "business_lines_covered": exam_record.business_lines_covered,
            "weakness_tags": exam_record.weakness_tags,
            "business_line_progress": [
                {
                    "business_line": p.business_line,
                    "goals": p.goals,
                    "goals_completed": p.goals_completed,
                    "rounds_used": p.rounds_used,
                    "rounds_expected": p.rounds_expected,
                    "score": p.score,
                    "completed": p.completed
                }
                for p in progress_records
            ],
            "created_at": exam_record.created_at.isoformat() if exam_record.created_at else None,
            "completed_at": exam_record.completed_at.isoformat() if exam_record.completed_at else None
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/dynamic-exam/{exam_id}/resume")
async def resume_dynamic_exam(exam_id: str, db: AsyncSession = Depends(get_db)):
    """恢复进行中的考试：从数据库重建考试状态到内存缓存"""
    try:
        # 如果缓存中已有，直接返回
        if exam_id in _exam_state_cache:
            exam_state = _exam_state_cache[exam_id]
            _touch_exam_activity(exam_state)
            return {
                "exam_id": exam_id,
                "persona_type": exam_state["persona_type"],
                "initial_anxiety": exam_state["initial_anxiety"],
                "anxiety_threshold": exam_state["anxiety_threshold"],
                "current_anxiety": exam_state["current_anxiety"],
                "current_business_line": exam_state["current_business_line"],
                "goals": exam_state["goals"],
                "max_rounds": exam_state["max_rounds"],
                "expected_rounds": exam_state["expected_rounds"],
                "current_round": exam_state["current_round"],
                "business_lines_covered": exam_state["business_lines_covered"],
                "emotion_state": AnxietyMechanism.get_emotion_state(exam_state["current_anxiety"]),
                "chat_history": exam_state["chat_history"],
                "status": exam_state["status"],
                "resumed_from_cache": True
            }

        # 从数据库恢复
        exam_record = await db.get(DynamicExam, exam_id)
        if not exam_record:
            raise HTTPException(status_code=404, detail="考试记录不存在")

        if exam_record.status != "in_progress":
            raise HTTPException(status_code=400, detail=f"考试已结束（{exam_record.status}），无法恢复")

        # 获取业务线进度
        stmt = select(BusinessLineProgress).where(BusinessLineProgress.exam_id == exam_id)
        result = await db.execute(stmt)
        progress_records = result.scalars().all()

        # 重建业务线进度
        business_line_progress = []
        for p in progress_records:
            goals = p.goals or []
            goals_completed = p.goals_completed or []
            # 重建 goals 的 completed 状态
            rebuilt_goals = []
            for g in goals:
                if isinstance(g, dict):
                    g_copy = dict(g)
                    g_copy["completed"] = g.get("id") in goals_completed or g.get("completed", False)
                    rebuilt_goals.append(g_copy)
            business_line_progress.append({
                "business_line": p.business_line,
                "goals": rebuilt_goals,
                "goals_completed": goals_completed,
                "rounds_used": p.rounds_used,
                "rounds_expected": p.rounds_expected,
                "key_points": p.key_points or [],
                "completed": p.completed
            })

        # 如果没有进度记录，从考试记录的基础信息重建
        if not business_line_progress and exam_record.business_lines_covered:
            current_line = exam_record.business_lines_covered[-1]
            # 获取该业务线的知识节点
            business_config = await business_line_manager.get_business_config()
            current_node_ids = business_config["node_map"].get(current_line, [])
            key_points = await dynamic_exam_engine._generate_key_points(current_line, node_ids=current_node_ids)
            goals = dynamic_exam_engine._generate_goals(current_line, key_points)
            business_line_progress = [{
                "business_line": current_line,
                "goals": goals,
                "goals_completed": [],
                "rounds_used": exam_record.total_rounds,
                "rounds_expected": 5,
                "key_points": key_points,
                "completed": False
            }]
        else:
            current_line = business_line_progress[-1]["business_line"] if business_line_progress else exam_record.business_lines_covered[-1]

        # 获取当前业务线的 goals 和 key_points
        current_progress = business_line_progress[-1] if business_line_progress else {}
        current_goals = current_progress.get("goals", [])
        current_key_points = current_progress.get("key_points", [])

        # 获取人格配置（从数据库加载）
        persona_configs = await dynamic_exam_engine.persona_configs
        persona_config = persona_configs.get(exam_record.persona_type, persona_configs.get("普通型"))

        # 重建考试状态
        exam_state = {
            "persona_type": exam_record.persona_type,
            "system_prompt": persona_config["system_prompt"],
            "initial_anxiety": exam_record.initial_anxiety,
            "anxiety_threshold": exam_record.anxiety_threshold,
            "current_anxiety": exam_record.final_anxiety,  # 恢复到上次最后的烦躁值
            "max_anxiety": exam_record.max_anxiety,
            "current_business_line": current_line,
            "business_lines_covered": exam_record.business_lines_covered or [current_line],
            "key_points": current_key_points,
            "goals": current_goals,
            "goals_completed": current_progress.get("goals_completed", []),
            "current_round": exam_record.total_rounds,
            "max_rounds": exam_record.max_rounds,
            "expected_rounds": exam_record.expected_rounds,
            "emergency_count": 0,
            "emergency_success_count": 0,
            "no_progress_count": 0,
            "pending_emergency": None,
            "status": "in_progress",
            "chat_history": exam_record.chat_history or [],
            "anxiety_history": exam_record.anxiety_history or [],
            "business_line_progress": business_line_progress,
            # V3.4 意图状态机 / PBL 项目制状态不持久化到数据库，恢复的考试统一按单业务线模式处理
            "exam_mode": "single",
            "intent_machine": None,
            "project_manager": None,
            "intent_history": [],
            "task_history": [],
            # V5.0: 逐轮明细不持久化到数据库，恢复后的评分只能统计恢复之后发生的轮次
            "round_records": []
        }

        _touch_exam_activity(exam_state)
        _exam_state_cache[exam_id] = exam_state

        return {
            "exam_id": exam_id,
            "persona_type": exam_state["persona_type"],
            "initial_anxiety": exam_state["initial_anxiety"],
            "anxiety_threshold": exam_state["anxiety_threshold"],
            "current_anxiety": exam_state["current_anxiety"],
            "current_business_line": exam_state["current_business_line"],
            "goals": exam_state["goals"],
            "max_rounds": exam_state["max_rounds"],
            "expected_rounds": exam_state["expected_rounds"],
            "current_round": exam_state["current_round"],
            "business_lines_covered": exam_state["business_lines_covered"],
            "emotion_state": AnxietyMechanism.get_emotion_state(exam_state["current_anxiety"]),
            "chat_history": exam_state["chat_history"],
            "status": exam_state["status"],
            "resumed_from_cache": False
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dynamic-exam/history")
async def get_dynamic_exam_history(db: AsyncSession = Depends(get_db)):
    """获取动态考试历史记录"""
    try:
        stmt = select(DynamicExam).where(
            DynamicExam.trainee_id == "mock_user"
        ).order_by(DynamicExam.created_at.desc())
        result = await db.execute(stmt)
        records = result.scalars().all()

        return [
            {
                "exam_id": r.id,
                "persona_type": r.persona_type,
                "overall_score": r.overall_score,
                "business_score": r.business_score,
                "emotion_score": r.emotion_score,
                "efficiency_score": r.efficiency_score,
                "bonus_score": r.bonus_score,
                "total_rounds": r.total_rounds,
                "status": r.status,
                "business_lines_covered": r.business_lines_covered,
                "created_at": r.created_at.isoformat() if r.created_at else None
            }
            for r in records
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/dynamic-exam/{exam_id}")
async def delete_dynamic_exam(exam_id: str, db: AsyncSession = Depends(get_db)):
    """删除动态考试记录（含业务线进度）"""
    try:
        exam_record = await db.get(DynamicExam, exam_id)
        if not exam_record:
            raise HTTPException(status_code=404, detail="考试记录不存在")

        # 删除关联的业务线进度
        stmt = select(BusinessLineProgress).where(BusinessLineProgress.exam_id == exam_id)
        result = await db.execute(stmt)
        progress_records = result.scalars().all()
        for p in progress_records:
            await db.delete(p)

        # 删除考试记录
        await db.delete(exam_record)

        # 清除内存缓存
        if exam_id in _exam_state_cache:
            del _exam_state_cache[exam_id]

        await db.commit()
        return {"message": "考试记录已删除", "exam_id": exam_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


