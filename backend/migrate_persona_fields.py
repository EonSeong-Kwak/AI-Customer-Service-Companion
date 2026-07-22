"""
迁移脚本：为 personas 表添加 initial_anxiety 和 threshold 列
修复错误: Unknown column 'personas.initial_anxiety' in 'field list'
"""
import asyncio
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import engine
from sqlalchemy import text


async def migrate():
    print("正在检查 personas 表结构...")

    async with engine.begin() as conn:
        # 检查现有列
        result = await conn.execute(text("SHOW COLUMNS FROM personas"))
        columns = {row[0] for row in result}

        if "initial_anxiety" not in columns:
            print("  添加列: initial_anxiety (INT DEFAULT 20)")
            await conn.execute(text("ALTER TABLE personas ADD COLUMN initial_anxiety INT DEFAULT 20"))
        else:
            print("  初始烦躁值列已存在，跳过")

        if "threshold" not in columns:
            print("  添加列: threshold (INT DEFAULT 80)")
            await conn.execute(text("ALTER TABLE personas ADD COLUMN threshold INT DEFAULT 80"))
        else:
            print("  阈值列已存在，跳过")

        # 为现有人格配置更新默认值
        print("  更新现有人格配置的烦躁值...")
        await conn.execute(text("UPDATE personas SET initial_anxiety=60, threshold=80 WHERE name='急躁型' AND initial_anxiety=20"))
        await conn.execute(text("UPDATE personas SET initial_anxiety=40, threshold=70 WHERE name='疑虑型' AND initial_anxiety=20"))
        await conn.execute(text("UPDATE personas SET initial_anxiety=20, threshold=85 WHERE name='普通型' AND initial_anxiety=20"))
        await conn.execute(text("UPDATE personas SET initial_anxiety=70, threshold=75 WHERE name='愤怒型' AND initial_anxiety=20"))

    print("迁移完成！")


if __name__ == "__main__":
    asyncio.run(migrate())
