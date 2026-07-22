import asyncio
from sqlalchemy import text
from app.core.database import engine

async def main():
    async with engine.begin() as conn:
        try:
            await conn.execute(text("ALTER TABLE questions ADD COLUMN category VARCHAR(100) DEFAULT '通用业务'"))
            print("Successfully added 'category' column.")
        except Exception as e:
            print(f"Error or column already exists: {e}")

if __name__ == "__main__":
    asyncio.run(main())
