import asyncio
from app.core.database import AsyncSessionLocal
from app.models import Question
from sqlalchemy import select

async def fix_scenarios():
    async with AsyncSessionLocal() as db:
        stmt = select(Question)
        result = await db.execute(stmt)
        questions = result.scalars().all()
        
        count = 0
        for q in questions:
            if "【RAG知识点】" in q.scenario or "【标准话术】" in q.scenario:
                content = q.scenario
                if "【RAG知识点】" in content:
                    parts = content.split("【RAG知识点】")
                    scenario = parts[0].replace("【客户问题】", "").strip()
                    if len(parts) > 1:
                        sub_parts = parts[1].split("【标准话术】")
                        answer = sub_parts[1].strip() if len(sub_parts) > 1 else sub_parts[0].strip()
                        q.scenario = scenario
                        q.reference_answer = answer
                        count += 1
                elif "【RAG知识点/解答】" in content:
                    parts = content.split("【RAG知识点/解答】")
                    scenario = parts[0].replace("【客户问题】", "").strip()
                    answer = parts[1].strip() if len(parts) > 1 else ""
                    q.scenario = scenario
                    q.reference_answer = answer
                    count += 1
        await db.commit()
        print(f"Fixed {count} scenarios and answers.")

if __name__ == "__main__":
    asyncio.run(fix_scenarios())
