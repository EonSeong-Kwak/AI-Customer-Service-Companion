"""
管理端接口：Coze 工作流练习/通关模块（V6.0，独立新增路由，不改动 admin.py）
挂载前缀：/api/v1/coze-practice-admin

三块能力：
1. coze-workflows —— 业务线 ↔ Coze 工作流ID 注册表 CRUD
2. practice-nodes —— 练习节点题目镜像表 CRUD（本地兜底 + 打分依据 + 手动同步进 Coze 的定稿文本来源）
3. practice-question-drafts —— AI 起草 → 人工审核 → 定稿，形状比照 admin.py 里 knowledge-drafts 那一套
"""
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import CozeWorkflowRegistry, PracticeNodeQuestion, PracticeQuestionDraft
from app.agents.quiz_agent import quiz_agent

router = APIRouter()


# ==========================================
# 1. 业务线 ↔ Coze 工作流 注册表
# ==========================================

class CozeWorkflowCreate(BaseModel):
    business_line: str
    workflow_id: str
    bot_id: Optional[str] = None
    app_id: Optional[str] = None
    mode_param_key: str = "mode"
    practice_mode_value: str = "practice"
    tongguan_mode_value: str = "tongguan"
    enabled: bool = True
    notes: Optional[str] = None


class CozeWorkflowUpdate(BaseModel):
    workflow_id: Optional[str] = None
    bot_id: Optional[str] = None
    app_id: Optional[str] = None
    mode_param_key: Optional[str] = None
    practice_mode_value: Optional[str] = None
    tongguan_mode_value: Optional[str] = None
    enabled: Optional[bool] = None
    notes: Optional[str] = None


@router.get("/coze-workflows")
async def list_coze_workflows(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CozeWorkflowRegistry).order_by(CozeWorkflowRegistry.created_at.desc()))
    return result.scalars().all()


@router.post("/coze-workflows")
async def create_coze_workflow(payload: CozeWorkflowCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(CozeWorkflowRegistry).where(CozeWorkflowRegistry.business_line == payload.business_line)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"业务线「{payload.business_line}」已经注册过工作流")

    record = CozeWorkflowRegistry(id=str(uuid.uuid4()), **payload.model_dump())
    db.add(record)
    await db.commit()
    return record


@router.put("/coze-workflows/{registry_id}")
async def update_coze_workflow(registry_id: str, payload: CozeWorkflowUpdate, db: AsyncSession = Depends(get_db)):
    record = await db.get(CozeWorkflowRegistry, registry_id)
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(record, field, value)
    await db.commit()
    return record


@router.delete("/coze-workflows/{registry_id}")
async def delete_coze_workflow(registry_id: str, db: AsyncSession = Depends(get_db)):
    record = await db.get(CozeWorkflowRegistry, registry_id)
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    await db.delete(record)
    await db.commit()
    return {"status": "ok"}


# ==========================================
# 2. 练习节点题目镜像表
# ==========================================

class PracticeNodeCreate(BaseModel):
    business_line: str
    node_key: Optional[str] = None
    order_index: int = 0
    question_text: str
    reference_answer: str
    key_points: List[str] = []
    difficulty: str = "medium"
    source_node_id: Optional[str] = None


class PracticeNodeUpdate(BaseModel):
    node_key: Optional[str] = None
    order_index: Optional[int] = None
    question_text: Optional[str] = None
    reference_answer: Optional[str] = None
    key_points: Optional[List[str]] = None
    difficulty: Optional[str] = None
    source_node_id: Optional[str] = None


@router.get("/practice-nodes")
async def list_practice_nodes(business_line: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    stmt = select(PracticeNodeQuestion).order_by(
        PracticeNodeQuestion.business_line.asc(), PracticeNodeQuestion.order_index.asc()
    )
    if business_line:
        stmt = stmt.where(PracticeNodeQuestion.business_line == business_line)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/practice-nodes")
async def create_practice_node(payload: PracticeNodeCreate, db: AsyncSession = Depends(get_db)):
    record = PracticeNodeQuestion(id=str(uuid.uuid4()), **payload.model_dump())
    db.add(record)
    await db.commit()
    return record


@router.put("/practice-nodes/{node_id}")
async def update_practice_node(node_id: str, payload: PracticeNodeUpdate, db: AsyncSession = Depends(get_db)):
    record = await db.get(PracticeNodeQuestion, node_id)
    if not record:
        raise HTTPException(status_code=404, detail="节点题目不存在")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(record, field, value)
    record.sync_status = "unsynced"  # 内容一改，之前"已同步"的状态就不再可信了
    await db.commit()
    return record


@router.delete("/practice-nodes/{node_id}")
async def delete_practice_node(node_id: str, db: AsyncSession = Depends(get_db)):
    record = await db.get(PracticeNodeQuestion, node_id)
    if not record:
        raise HTTPException(status_code=404, detail="节点题目不存在")
    await db.delete(record)
    await db.commit()
    return {"status": "ok"}


@router.post("/practice-nodes/{node_id}/mark-synced")
async def mark_practice_node_synced(node_id: str, db: AsyncSession = Depends(get_db)):
    """管理员手动把内容粘贴进 Coze 工作流编辑器后，回来点一下标记——纯人工确认，系统无法程序校验"""
    record = await db.get(PracticeNodeQuestion, node_id)
    if not record:
        raise HTTPException(status_code=404, detail="节点题目不存在")
    record.sync_status = "synced"
    record.last_synced_at = datetime.now()
    await db.commit()
    return record


# ==========================================
# 3. AI 起草练习题草稿 → 人工审核 → 定稿
# ==========================================

class PracticeDraftGenerate(BaseModel):
    node_id: str
    business_line: str
    difficulty: str = "medium"


@router.post("/practice-question-drafts/generate")
async def generate_practice_question_draft(payload: PracticeDraftGenerate, db: AsyncSession = Depends(get_db)):
    """管理员手动选一个知识库节点，调用现成的 quiz_agent.generate_question 起草一版练习题"""
    trace_id = f"practice-draft-{uuid.uuid4().hex[:8]}"
    try:
        generated = await quiz_agent.generate_question(payload.node_id, payload.difficulty, trace_id=trace_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 起草失败: {e}")

    draft = PracticeQuestionDraft(
        id=str(uuid.uuid4()),
        business_line=payload.business_line,
        source_node_id=payload.node_id,
        scenario=generated["scenario"],
        reference_answer=generated["reference_answer"],
        key_points=generated.get("key_points", []),
        difficulty=payload.difficulty,
        status="pending",
    )
    db.add(draft)
    await db.commit()
    return draft


@router.get("/practice-question-drafts")
async def list_practice_question_drafts(
    status: Optional[str] = None, business_line: Optional[str] = None, db: AsyncSession = Depends(get_db)
):
    stmt = select(PracticeQuestionDraft).order_by(PracticeQuestionDraft.created_at.desc())
    if status:
        stmt = stmt.where(PracticeQuestionDraft.status == status)
    if business_line:
        stmt = stmt.where(PracticeQuestionDraft.business_line == business_line)
    result = await db.execute(stmt)
    return result.scalars().all()


class PracticeDraftUpdate(BaseModel):
    scenario: Optional[str] = None
    reference_answer: Optional[str] = None
    key_points: Optional[List[str]] = None
    difficulty: Optional[str] = None


@router.put("/practice-question-drafts/{draft_id}")
async def update_practice_question_draft(draft_id: str, payload: PracticeDraftUpdate, db: AsyncSession = Depends(get_db)):
    draft = await db.get(PracticeQuestionDraft, draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="草稿不存在")
    if draft.status != "pending":
        raise HTTPException(status_code=400, detail=f"草稿已处于「{draft.status}」状态，不能再编辑")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(draft, field, value)
    await db.commit()
    return draft


class PracticeDraftApprove(BaseModel):
    node_key: Optional[str] = None
    order_index: int = 0


@router.post("/practice-question-drafts/{draft_id}/approve")
async def approve_practice_question_draft(draft_id: str, payload: PracticeDraftApprove, db: AsyncSession = Depends(get_db)):
    """审核通过：写入 PracticeNodeQuestion（sync_status=unsynced，等管理员手动粘贴进 Coze）"""
    draft = await db.get(PracticeQuestionDraft, draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="草稿不存在")
    if draft.status != "pending":
        raise HTTPException(status_code=400, detail=f"草稿已处于「{draft.status}」状态，不能重复处理")

    node = PracticeNodeQuestion(
        id=str(uuid.uuid4()),
        business_line=draft.business_line,
        node_key=payload.node_key,
        order_index=payload.order_index,
        question_text=draft.scenario,
        reference_answer=draft.reference_answer,
        key_points=draft.key_points or [],
        difficulty=draft.difficulty,
        source_node_id=draft.source_node_id,
        sync_status="unsynced",
    )
    db.add(node)
    draft.status = "approved"
    draft.reviewed_at = datetime.now()
    await db.commit()
    return {"status": "ok", "practice_node_id": node.id}


@router.post("/practice-question-drafts/{draft_id}/reject")
async def reject_practice_question_draft(draft_id: str, db: AsyncSession = Depends(get_db)):
    draft = await db.get(PracticeQuestionDraft, draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="草稿不存在")
    if draft.status != "pending":
        raise HTTPException(status_code=400, detail=f"草稿已处于「{draft.status}」状态，不能重复处理")
    draft.status = "rejected"
    draft.reviewed_at = datetime.now()
    await db.commit()
    return {"status": "ok"}
