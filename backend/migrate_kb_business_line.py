"""
知识库驱动分类 - 一次性迁移脚本

做两件事：
1. 给知识库节点打业务线标签（从 BusinessLineManager 获取 node_map，反转为 {node_id: business_line}，
   调用 external_kb.update_nodes_business_line）
2. 给题库所有题目自动关联 source_node_id（用题目 scenario 做检索，匹配最相似的知识库节点）

运行方式：
    cd backend
    python migrate_kb_business_line.py
"""
import asyncio
import os
import re
import sys

# 设置正确的 sys.path（项目根目录）
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models import Question
from app.services.external_kb import external_kb
from app.services.exam_engine import business_line_manager


def parse_similarity(sim_str: str) -> float:
    """从 "85.5%" 字符串解析出 0.855"""
    if not sim_str:
        return 0.0
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", sim_str)
    if not m:
        return 0.0
    return float(m.group(1)) / 100.0


async def migrate_node_business_lines(trace_id: str = "migrate") -> dict:
    """
    步骤一：从 BusinessLineManager 获取 node_map（{业务线: [节点ID列表]}），
    反转为 {node_id: 业务线}，写入 ChromaDB metadata。
    """
    print("\n[步骤1] 开始给知识库节点打业务线标签...")
    business_config = await business_line_manager.get_business_config(trace_id=trace_id)
    node_map = business_config.get("node_map", {})  # {业务线: [节点ID列表]}

    # 反转为 {node_id: 业务线}
    node_business_map = {}
    for business_line, node_ids in node_map.items():
        for node_id in node_ids:
            # 后写覆盖先写，理论上一个节点只属于一条业务线
            node_business_map[node_id] = business_line

    print(f"   共发现 {len(node_map)} 条业务线，{len(node_business_map)} 个节点-业务线映射")

    if not node_business_map:
        print("   ⚠️ 没有可更新的节点，跳过此步骤")
        return {"total_business_lines": len(node_map), "updated_nodes": 0}

    await external_kb.update_nodes_business_line(node_business_map, trace_id=trace_id)
    print(f"   ✅ 已更新 {len(node_business_map)} 个节点的业务线标签")

    # 同时打印出每条业务线对应的节点数
    for line, node_ids in node_map.items():
        print(f"      - {line}: {len(node_ids)} 个节点")

    return {"total_business_lines": len(node_map), "updated_nodes": len(node_business_map)}


async def migrate_questions_source_node(trace_id: str = "migrate") -> dict:
    """
    步骤二：遍历题库所有题目，用 external_kb.search_knowledge(q.scenario, top_k=1) 匹配节点，
    如果相似度 > 60%，设置 q.source_node_id 和 q.category（从节点的 business_line 继承）。
    """
    print("\n[步骤2] 开始给题库题目自动关联 source_node_id...")
    SIMILARITY_THRESHOLD = 0.60

    linked_count = 0
    skipped_low_similarity = 0
    skipped_no_result = 0
    skipped_already_linked = 0
    total_questions = 0

    async with AsyncSessionLocal() as db:
        stmt = select(Question).order_by(Question.created_at.asc())
        result = await db.execute(stmt)
        questions = result.scalars().all()
        total_questions = len(questions)
        print(f"   题库共 {total_questions} 道题目")

        for q in questions:
            # 已有关联的跳过（避免重复迁移覆盖）
            # 注意：用户可能希望重新关联，这里默认跳过以保持幂等
            if q.source_node_id:
                skipped_already_linked += 1
                continue

            scenario = q.scenario or ""
            if not scenario.strip():
                skipped_no_result += 1
                continue

            try:
                results = await external_kb.search_knowledge(scenario, top_k=1, trace_id=trace_id)
            except Exception as e:
                print(f"   ⚠️ 题目 {q.id} 检索失败: {e}")
                skipped_no_result += 1
                continue

            if not results:
                skipped_no_result += 1
                continue

            top = results[0]
            sim_str = top.get("similarity", "0%")
            similarity = parse_similarity(sim_str)
            node_id = top.get("node_id")

            if similarity < SIMILARITY_THRESHOLD or not node_id:
                print(f"   - 跳过题目 {q.id}（相似度 {sim_str} < 60% 或无 node_id）")
                skipped_low_similarity += 1
                continue

            # 设置 source_node_id
            q.source_node_id = node_id

            # 继承节点的 business_line 作为 category
            business_line = await external_kb.get_node_business_line(node_id)
            if business_line:
                old_category = q.category
                q.category = business_line
                print(f"   ✅ 题目 {q.id} 关联节点 {node_id}（相似度 {sim_str}，category: {old_category} -> {business_line}）")
            else:
                print(f"   ✅ 题目 {q.id} 关联节点 {node_id}（相似度 {sim_str}，节点无 business_line，保留原 category）")

            linked_count += 1

        await db.commit()

    report = {
        "total_questions": total_questions,
        "linked": linked_count,
        "skipped_already_linked": skipped_already_linked,
        "skipped_low_similarity": skipped_low_similarity,
        "skipped_no_result": skipped_no_result,
    }
    print("\n   ===== 迁移报告 =====")
    for k, v in report.items():
        print(f"   - {k}: {v}")
    return report


async def main():
    trace_id = "migrate_kb_business_line"
    print("=" * 60)
    print("知识库驱动分类 - 迁移脚本")
    print("=" * 60)

    # 步骤1
    node_report = await migrate_node_business_lines(trace_id=trace_id)

    # 步骤2
    question_report = await migrate_questions_source_node(trace_id=trace_id)

    print("\n" + "=" * 60)
    print("迁移完成 ✅")
    print("=" * 60)
    print(f"知识库节点：更新 {node_report['updated_nodes']} 个，覆盖 {node_report['total_business_lines']} 条业务线")
    print(f"题库题目：成功关联 {question_report['linked']} 道，"
          f"跳过 {question_report['total_questions'] - question_report['linked']} 道")


if __name__ == "__main__":
    asyncio.run(main())
