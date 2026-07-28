"""
V6.0 迁移脚本：创建 Coze 工作流驱动的"练习/通关"模块相关表。
独立新增表，不改动任何已有表结构：
  coze_workflow_registry / practice_node_questions / practice_question_drafts / practice_workflow_sessions
"""
import asyncio
from app.core.database import engine, Base
from app.models import (
    CozeWorkflowRegistry, PracticeNodeQuestion, PracticeQuestionDraft, PracticeWorkflowSession,
)


async def migrate():
    print("=" * 60)
    print("V6.0 迁移：Coze 工作流练习/通关模块")
    print("=" * 60)
    print("\n创建新表...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✓ 表创建完成（coze_workflow_registry、practice_node_questions、"
          "practice_question_drafts、practice_workflow_sessions）")
    print("\n✅ V6.0 迁移完成！")
    print("现在管理员可以在「Coze 工作流练习」管理页登记业务线工作流、维护题目、审核 AI 草稿。")


if __name__ == "__main__":
    asyncio.run(migrate())
