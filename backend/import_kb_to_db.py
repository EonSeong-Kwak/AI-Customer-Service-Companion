import asyncio
import json
import os
from app.core.database import AsyncSessionLocal
from app.models import Question
import uuid

async def import_kb():
    # 1. Read mock_kb.json
    kb_path = os.path.join(os.path.dirname(__file__), "data", "mock_kb.json")
    with open(kb_path, "r", encoding="utf-8") as f:
        kb_data = json.load(f)
        
    print(f"Loaded {len(kb_data)} nodes from mock_kb.json")
    
    async with AsyncSessionLocal() as db:
        # 2. Convert and insert
        count = 0
        for node in kb_data:
            content = node["content"]
            
            # Simple heuristic to determine category based on keywords
            category = "通用业务"
            kw_str = " ".join(node["keywords"]) + " " + content
            
            if "密码" in kw_str: category = "密码重置与找回"
            elif "冻结" in kw_str or "受控" in kw_str or "限制" in kw_str: category = "账户受控排查"
            elif "信用卡" in kw_str or "挂失" in kw_str or "盗刷" in kw_str: category = "信用卡挂失与补办"
            elif "更新" in kw_str or "身份证" in kw_str or "职业" in kw_str or "信息" in kw_str: category = "客户预留信息更新"
            elif "活动" in kw_str or "抽奖" in kw_str or "首登" in kw_str: category = "远程银行首登有礼"
            
            # Extract scenario and answer
            scenario = ""
            answer = ""
            
            if "【RAG知识点】" in content:
                parts = content.split("【RAG知识点】")
                scenario = parts[0].replace("【客户问题】", "").strip()
                if len(parts) > 1:
                    sub_parts = parts[1].split("【标准话术】")
                    answer = sub_parts[1].strip() if len(sub_parts) > 1 else sub_parts[0].strip()
            elif "【RAG知识点/解答】" in content:
                parts = content.split("【RAG知识点/解答】")
                scenario = parts[0].replace("【客户问题】", "").strip()
                answer = parts[1].strip() if len(parts) > 1 else ""
            
            # Skip if parsing failed
            if not scenario:
                continue
                
            q = Question(
                id=str(uuid.uuid4()),
                category=category,
                scenario=scenario,
                reference_answer=answer,
                key_points=node["keywords"],
                source_node_id=node["node_id"],
                difficulty="medium"
            )
            db.add(q)
            count += 1
            
        await db.commit()
        print(f"Successfully imported {count} questions into the database!")

if __name__ == "__main__":
    asyncio.run(import_kb())
