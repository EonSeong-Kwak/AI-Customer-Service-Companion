import asyncio
from app.core.database import AsyncSessionLocal
from app.models import Question
from sqlalchemy import select

async def check():
    async with AsyncSessionLocal() as db:
        stmt = select(Question).limit(3)
        result = await db.execute(stmt)
        for q in result.scalars().all():
            print(f"ID: {q.id}")
            print(f"SCENARIO: {q.scenario}")
            print(f"ANSWER: {q.reference_answer}")
            print("-" * 20)

asyncio.run(check())
