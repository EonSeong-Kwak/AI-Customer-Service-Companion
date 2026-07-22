import asyncio
from app.core.database import AsyncSessionLocal
from app.models import Question
from sqlalchemy import select

async def fix_categories():
    async with AsyncSessionLocal() as db:
        stmt = select(Question)
        result = await db.execute(stmt)
        questions = result.scalars().all()
        
        count = 0
        for q in questions:
            keywords = q.key_points or []
            # Check substrings in keywords or content
            category = "通用业务"
            kw_str = " ".join(keywords) + " " + q.scenario
            
            if "密码" in kw_str: category = "密码重置与找回"
            elif "冻结" in kw_str or "受控" in kw_str or "限制" in kw_str: category = "账户受控排查"
            elif "信用卡" in kw_str or "挂失" in kw_str or "盗刷" in kw_str: category = "信用卡挂失与补办"
            elif "更新" in kw_str or "身份证" in kw_str or "职业" in kw_str or "信息" in kw_str: category = "客户预留信息更新"
            elif "活动" in kw_str or "抽奖" in kw_str or "首登" in kw_str: category = "远程银行首登有礼"
            
            if q.category != category:
                q.category = category
                count += 1
                
        await db.commit()
        print(f"Updated {count} questions categories.")

if __name__ == "__main__":
    asyncio.run(fix_categories())
