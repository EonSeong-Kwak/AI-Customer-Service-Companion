import asyncio
import os
import sys

# 将根目录加入路径，以便能够导入 app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import engine, Base
from app.models import *  # 导入所有模型以便 SQLAlchemy 识别

async def init_db():
    print("正在初始化数据库...")
    async with engine.begin() as conn:
        # 注意：为了防止每次重启清空数据，注释掉 drop_all
        # await conn.run_sync(Base.metadata.drop_all)
        
        # 创建新表（如果表已存在则忽略）
        await conn.run_sync(Base.metadata.create_all)
    print("数据库初始化完成！")

if __name__ == "__main__":
    asyncio.run(init_db())
