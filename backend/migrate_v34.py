"""
V3.4 迁移脚本：创建项目场景表和意图定义表，并插入默认项目场景
"""
import asyncio
import uuid
from app.core.database import engine, AsyncSessionLocal, Base
from app.models import ProjectScenario, IntentDefinition
from app.services.intent_state_machine import DEFAULT_PROJECT_SCENARIOS, DEFAULT_INTENT_TEMPLATES


async def migrate():
    """执行迁移"""
    print("=" * 60)
    print("V3.4 迁移：项目场景表 + 意图定义表")
    print("=" * 60)

    # 1. 创建新表
    print("\n[1/3] 创建新表...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✓ 表创建完成（包括 project_scenarios、intent_definitions）")

    # 2. 插入默认项目场景
    print("\n[2/3] 插入默认项目场景...")
    async with AsyncSessionLocal() as session:
        # 检查是否已有项目场景
        from sqlalchemy import select
        result = await session.execute(select(ProjectScenario))
        existing = result.scalars().all()

        if existing:
            print(f"  数据库已有 {len(existing)} 个项目场景，跳过默认场景插入")
        else:
            for scenario_data in DEFAULT_PROJECT_SCENARIOS:
                scenario = ProjectScenario(
                    id=str(uuid.uuid4()),
                    name=scenario_data["name"],
                    description=scenario_data.get("description"),
                    business_line=scenario_data.get("business_line"),
                    tasks=scenario_data.get("tasks", []),
                    difficulty=scenario_data.get("difficulty", "medium"),
                    enabled=True
                )
                session.add(scenario)
                print(f"  ✓ 插入项目场景: {scenario.name}")
            await session.commit()
            print(f"✓ 共插入 {len(DEFAULT_PROJECT_SCENARIOS)} 个默认项目场景")

    # 3. 插入默认意图定义
    print("\n[3/3] 插入默认意图定义...")
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(IntentDefinition))
        existing_intents = result.scalars().all()

        if existing_intents:
            print(f"  数据库已有 {len(existing_intents)} 个意图定义，跳过默认意图插入")
        else:
            count = 0
            for business_line, intents in DEFAULT_INTENT_TEMPLATES.items():
                for intent_data in intents:
                    intent = IntentDefinition(
                        id=str(uuid.uuid4()),
                        name=intent_data["name"],
                        business_line=business_line,
                        success_criteria=intent_data.get("success_criteria", []),
                        description=intent_data.get("description")
                    )
                    session.add(intent)
                    count += 1
            await session.commit()
            print(f"✓ 共插入 {count} 个默认意图定义")

    print("\n" + "=" * 60)
    print("✅ V3.4 迁移完成！")
    print("=" * 60)
    print("\n现在管理员可以在后台管理项目场景和意图定义。")
    print("考试系统会自动从数据库加载启用的项目场景。")


if __name__ == "__main__":
    asyncio.run(migrate())
