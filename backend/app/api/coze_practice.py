"""
考生端接口：Coze 工作流驱动的"练习/通关"模块（V6.0，独立新增路由，不改动 endpoints.py）
挂载前缀：/api/v1/coze-practice
"""
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import User, CozeWorkflowRegistry, PracticeWorkflowSession
from app.services.practice_workflow_engine import practice_workflow_engine
from app.services.exam_engine import business_line_manager
from app.core.logger import logger

router = APIRouter()

MOCK_TRAINEE_ID = "mock_user"


async def _ensure_mock_user(db: AsyncSession):
    user = await db.get(User, MOCK_TRAINEE_ID)
    if not user:
        db.add(User(id=MOCK_TRAINEE_ID, username="测试用户", hashed_password="xxx"))
        await db.flush()


@router.get("/business-lines")
async def get_practice_business_lines(db: AsyncSession = Depends(get_db)):
    """全量业务线 + 已注册且启用了 Coze 工作流的业务线子集（前端用后者决定是否展示新入口）"""
    status = business_line_manager.get_status()
    all_lines = status.get("business_lines", []) or []

    result = await db.execute(select(CozeWorkflowRegistry.business_line).where(CozeWorkflowRegistry.enabled == True))
    workflow_enabled_lines = [row[0] for row in result.all()]

    return {
        "status": status.get("status"),
        "business_lines": all_lines,
        "workflow_enabled_lines": workflow_enabled_lines,
    }


class StartWorkflowSessionRequest(BaseModel):
    business_line: str
    mode: str  # "practice" | "tongguan"


@router.post("/workflow/start")
async def start_practice_workflow(payload: StartWorkflowSessionRequest, db: AsyncSession = Depends(get_db)):
    if payload.mode not in ("practice", "tongguan"):
        raise HTTPException(status_code=400, detail="mode 必须是 practice 或 tongguan")

    trace_id = str(uuid.uuid4())
    await _ensure_mock_user(db)
    try:
        result = await practice_workflow_engine.start_session(
            db, trainee_id=MOCK_TRAINEE_ID, business_line=payload.business_line, mode=payload.mode, trace_id=trace_id
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.bind(trace_id=trace_id).error(f"开始练习工作流会话失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _get_session_or_404(db: AsyncSession, session_id: str) -> PracticeWorkflowSession:
    session = await db.get(PracticeWorkflowSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    return session


class AnswerWorkflowSessionRequest(BaseModel):
    session_id: str
    answer: str


@router.post("/workflow/answer")
async def answer_practice_workflow(payload: AnswerWorkflowSessionRequest, db: AsyncSession = Depends(get_db)):
    trace_id = str(uuid.uuid4())
    session = await _get_session_or_404(db, payload.session_id)
    try:
        result = await practice_workflow_engine.submit_answer(db, session, payload.answer, trace_id=trace_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.bind(trace_id=trace_id).error(f"提交练习工作流回答失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class EndWorkflowSessionRequest(BaseModel):
    session_id: str


@router.post("/workflow/end")
async def end_practice_workflow(payload: EndWorkflowSessionRequest, db: AsyncSession = Depends(get_db)):
    trace_id = str(uuid.uuid4())
    session = await _get_session_or_404(db, payload.session_id)
    session = await practice_workflow_engine.end_session(db, session, trace_id=trace_id)
    return {
        "session_id": session.id,
        "status": session.status,
        "mode": session.mode,
        "business_line": session.business_line,
        "overall_score": session.overall_score,
        "coverage_rate": session.coverage_rate,
        "key_points_total": session.key_points_total,
        "key_points_hit": session.key_points_hit,
        "passed": session.passed,
        "weakness_tags": session.weakness_tags or [],
        "used_fallback": session.used_fallback,
        "transcript": session.transcript or [],
        "coze_raw_output": session.coze_raw_output,
    }


@router.get("/workflow/history")
async def get_practice_workflow_history(db: AsyncSession = Depends(get_db)):
    stmt = (
        select(PracticeWorkflowSession)
        .where(PracticeWorkflowSession.trainee_id == MOCK_TRAINEE_ID)
        .order_by(PracticeWorkflowSession.created_at.desc())
        .limit(50)
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()
    return [
        {
            "session_id": s.id,
            "business_line": s.business_line,
            "mode": s.mode,
            "status": s.status,
            "overall_score": s.overall_score,
            "coverage_rate": s.coverage_rate,
            "passed": s.passed,
            "used_fallback": s.used_fallback,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "completed_at": s.completed_at.isoformat() if s.completed_at else None,
        }
        for s in sessions
    ]


@router.get("/workflow/{session_id}")
async def get_practice_workflow_detail(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await _get_session_or_404(db, session_id)
    return {
        "session_id": session.id,
        "business_line": session.business_line,
        "mode": session.mode,
        "status": session.status,
        "overall_score": session.overall_score,
        "coverage_rate": session.coverage_rate,
        "key_points_total": session.key_points_total,
        "key_points_hit": session.key_points_hit,
        "passed": session.passed,
        "weakness_tags": session.weakness_tags or [],
        "used_fallback": session.used_fallback,
        "transcript": session.transcript or [],
        "coze_raw_output": session.coze_raw_output,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "completed_at": session.completed_at.isoformat() if session.completed_at else None,
    }
