from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
import uuid

from app.core.database import get_db
from app.models import (
    Persona, Question, ExamRecord, PracticeRecord, UserWeakness,
    ExamPaper, ExamAssignment, User, ProjectScenario, IntentDefinition
)
from app.services.external_kb import external_kb
from pydantic import BaseModel

router = APIRouter()

# --- Persona Schemas ---
class PersonaCreate(BaseModel):
    name: str
    system_prompt: str
    description: str | None = None
    initial_anxiety: int | None = None
    threshold: int | None = None

class PersonaUpdate(BaseModel):
    name: str | None = None
    system_prompt: str | None = None
    description: str | None = None
    initial_anxiety: int | None = None
    threshold: int | None = None

# --- Question Schemas ---
class QuestionCreate(BaseModel):
    category: str = "通用业务"
    scenario: str
    reference_answer: str
    key_points: list[str] = []
    difficulty: str = "medium"
    source_node_id: Optional[str] = None

class QuestionUpdate(BaseModel):
    category: str | None = None
    scenario: str | None = None
    reference_answer: str | None = None
    key_points: list[str] | None = None
    difficulty: str | None = None
    source_node_id: Optional[str] = None

# ==========================================
# Persona Endpoints
# ==========================================

@router.get("/personas")
async def get_personas(db: AsyncSession = Depends(get_db)):
    stmt = select(Persona).order_by(Persona.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()

@router.post("/personas")
async def create_persona(persona: PersonaCreate, db: AsyncSession = Depends(get_db)):
    new_persona = Persona(
        id=str(uuid.uuid4()),
        name=persona.name,
        system_prompt=persona.system_prompt,
        description=persona.description,
        initial_anxiety=persona.initial_anxiety,
        threshold=persona.threshold
    )
    db.add(new_persona)
    await db.commit()
    return new_persona

@router.put("/personas/{persona_id}")
async def update_persona(persona_id: str, persona: PersonaUpdate, db: AsyncSession = Depends(get_db)):
    db_persona = await db.get(Persona, persona_id)
    if not db_persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    
    if persona.name is not None: db_persona.name = persona.name
    if persona.system_prompt is not None: db_persona.system_prompt = persona.system_prompt
    if persona.description is not None: db_persona.description = persona.description
    if persona.initial_anxiety is not None: db_persona.initial_anxiety = persona.initial_anxiety
    if persona.threshold is not None: db_persona.threshold = persona.threshold
    
    await db.commit()
    return db_persona

@router.delete("/personas/{persona_id}")
async def delete_persona(persona_id: str, db: AsyncSession = Depends(get_db)):
    db_persona = await db.get(Persona, persona_id)
    if not db_persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    
    await db.delete(db_persona)
    await db.commit()
    return {"status": "ok"}


class GeneratePersonaRequest(BaseModel):
    description: str


@router.post("/personas/generate")
async def generate_persona(req: GeneratePersonaRequest):
    """用小模型生成客户人格配置"""
    from app.services.llm_adapter import llm_client
    import json

    prompt = f"""你是一个银行客服培训系统的客户人格设计专家。请根据用户描述，生成一个完整的客户人格配置。

## 用户描述
{req.description}

## 生成要求
请严格按照以下JSON格式输出（不要输出其他内容，不要用markdown代码块包裹）：
{{
    "name": "人格名称（简洁，如'急躁型客户'、'迷糊老年客户'）",
    "description": "一句话描述这个客户的特点",
    "system_prompt": "完整的系统提示词，至少200字。要包含：1.客户身份设定（年龄/职业/性格）2.来电目的 3.情绪基线和触发点 4.语言风格 5.行为约束（不能自己说办好了、不能主动报出答案等红线）",
    "initial_anxiety": 20,
    "threshold": 80
}}

## 人格维度说明
- initial_anxiety（初始烦躁值0-100）：急躁型50-70，普通型20-30，平和型10-20
- threshold（烦躁阈值60-100）：越低越容易爆发挂断，急躁型70-80，普通型80-90，平和型90-100

## system_prompt 编写要点
1. 用第二人称"你是一个..."开头
2. 明确客户的具体诉求（如"你要办理信用卡挂失"）
3. 描述情绪触发点（如"如果客服让你重复说身份证号你会很不耐烦"）
4. 约束行为红线（如"你不能自己说出解决方案"、"不能主动说谢谢"）
5. 语言风格要具体（如"说话简短急促"、"经常打断客服"）

请直接输出JSON，不要有任何额外文字。"""

    messages = [{"role": "user", "content": prompt}]
    try:
        response = await llm_client.async_chat_completion(messages, model="chat", timeout=60)
        import re
        # 清理模型对数字的奇怪标记（>>20<<、_Domain_80 等）
        clean_str = response.strip().strip("```json").strip("```").strip()
        clean_str = re.sub(r'>>(\d+)<<', r'\1', clean_str)
        clean_str = re.sub(r'_Domain_(\d+)', r'\1', clean_str)
        try:
            result = json.loads(clean_str)
        except json.JSONDecodeError:
            # JSON解析失败，用正则提取各字段
            def extract(field, text, dtype=str):
                m = re.search(rf'"{field}"\s*:\s*"?(.*?)"?\s*[,\n}}]', text)
                if m:
                    val = m.group(1).strip().strip('"')
                    if dtype == int:
                        # 只取0-100范围内的数字
                        nums = re.findall(r'\d+', val)
                        for n in nums:
                            num = int(n)
                            if 0 <= num <= 100:
                                return num
                        return 20
                    return val
                return "" if dtype == str else 20
            result = {
                "name": extract("name", clean_str),
                "description": extract("description", clean_str),
                "system_prompt": extract("system_prompt", clean_str),
                "initial_anxiety": extract("initial_anxiety", clean_str, int),
                "threshold": extract("threshold", clean_str, int)
            }
        return {"status": "success", "persona": result}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ==========================================
# Question Endpoints
# ==========================================

@router.get("/questions")
async def get_questions(db: AsyncSession = Depends(get_db)):
    stmt = select(Question).order_by(Question.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()

@router.post("/questions")
async def create_question(question: QuestionCreate, db: AsyncSession = Depends(get_db)):
    # 知识库驱动分类：如果传了 source_node_id，从知识库节点获取业务线覆盖 category
    category = question.category
    source_node_id = question.source_node_id
    if source_node_id:
        try:
            business_line = await external_kb.get_node_business_line(source_node_id)
            if business_line:
                category = business_line
        except Exception:
            pass

    new_question = Question(
        id=str(uuid.uuid4()),
        category=category,
        scenario=question.scenario,
        reference_answer=question.reference_answer,
        key_points=question.key_points,
        difficulty=question.difficulty,
        source_node_id=source_node_id
    )
    db.add(new_question)
    await db.commit()
    return new_question

@router.put("/questions/{question_id}")
async def update_question(question_id: str, question: QuestionUpdate, db: AsyncSession = Depends(get_db)):
    db_question = await db.get(Question, question_id)
    if not db_question:
        raise HTTPException(status_code=404, detail="Question not found")

    # 知识库驱动分类：如果传了 source_node_id，从知识库节点获取业务线覆盖 category
    if question.source_node_id is not None:
        db_question.source_node_id = question.source_node_id
        try:
            business_line = await external_kb.get_node_business_line(question.source_node_id)
            if business_line:
                db_question.category = business_line
        except Exception:
            pass

    if question.category is not None: db_question.category = question.category
    if question.scenario is not None: db_question.scenario = question.scenario
    if question.reference_answer is not None: db_question.reference_answer = question.reference_answer
    if question.key_points is not None: db_question.key_points = question.key_points
    if question.difficulty is not None: db_question.difficulty = question.difficulty

    await db.commit()
    return db_question

@router.delete("/questions/{question_id}")
async def delete_question(question_id: str, db: AsyncSession = Depends(get_db)):
    db_question = await db.get(Question, question_id)
    if not db_question:
        raise HTTPException(status_code=404, detail="Question not found")
    
    await db.delete(db_question)
    await db.commit()
    return {"status": "ok"}


@router.get("/kb-nodes/search")
async def search_kb_nodes(q: str = ""):
    """检索知识库节点，用于题目关联选择"""
    if not q.strip():
        # 无关键词时返回全部节点（限制50条）
        nodes = await external_kb.get_all_nodes()
        return [{"node_id": n["node_id"], "content": n["content"][:100], "business_line": await external_kb.get_node_business_line(n["node_id"])} for n in nodes[:50]]
    results = await external_kb.search_knowledge(q, top_k=10)
    return [{"node_id": r.get("node_id"), "content": r.get("content", "")[:100], "similarity": r.get("similarity"), "business_line": await external_kb.get_node_business_line(r.get("node_id"))} for r in results]


# ==========================================
# 知识库节点管理
# ==========================================

class UpdateBusinessLineRequest(BaseModel):
    business_line: str

class CreateBusinessLineRequest(BaseModel):
    name: str
    node_ids: List[str] = []


@router.get("/kb-nodes")
async def get_kb_nodes():
    """获取所有知识库节点，按业务线分组"""
    nodes = await external_kb.get_all_nodes_with_business_line()
    # 按业务线分组
    grouped = {}
    for node in nodes:
        bl = node["business_line"] or "未分类"
        if bl not in grouped:
            grouped[bl] = []
        grouped[bl].append(node)
    # 统计
    stats = [{"business_line": k, "count": len(v)} for k, v in grouped.items()]
    return {"nodes": nodes, "grouped": grouped, "stats": stats, "total": len(nodes)}


@router.put("/kb-nodes/{node_id}/business-line")
async def update_node_business_line(node_id: str, req: UpdateBusinessLineRequest, db: AsyncSession = Depends(get_db)):
    """修改知识库节点的业务线归属"""
    await external_kb.set_node_business_line(node_id, req.business_line)
    # 同步更新关联该节点的题目category
    stmt = select(Question).where(Question.source_node_id == node_id)
    result = await db.execute(stmt)
    questions = result.scalars().all()
    for q in questions:
        q.category = req.business_line
    await db.commit()
    return {"status": "ok", "business_line": req.business_line, "updated_questions": len(questions)}


@router.post("/business-lines")
async def create_business_line(req: CreateBusinessLineRequest, db: AsyncSession = Depends(get_db)):
    """新建业务线，并将指定节点归入该业务线"""
    for node_id in req.node_ids:
        await external_kb.set_node_business_line(node_id, req.name)
        # 同步题目category
        stmt = select(Question).where(Question.source_node_id == node_id)
        result = await db.execute(stmt)
        questions = result.scalars().all()
        for q in questions:
            q.category = req.name
    await db.commit()
    return {"status": "ok", "business_line": req.name, "node_count": len(req.node_ids)}


@router.post("/kb-nodes/auto-classify")
async def auto_classify_kb_nodes():
    """LLM智能归类未分类节点"""
    from app.services.exam_engine import BusinessLineManager
    from app.services.llm_adapter import llm_client
    import asyncio

    # 1. 获取所有节点
    all_nodes = await external_kb.get_all_nodes_with_business_line()
    unclassified = [n for n in all_nodes if not n["business_line"]]
    if not unclassified:
        return {"status": "ok", "message": "没有未分类节点", "classified": 0}

    # 2. 用BusinessLineManager提取业务线（它会调用LLM分析所有节点）
    blm = BusinessLineManager()
    config = await blm.get_business_config()
    node_map = config.get("node_map", {})  # {业务线: [节点ID列表]}

    # 3. 反转为 {node_id: 业务线}
    node_business = {}
    for bl, node_ids in node_map.items():
        for nid in node_ids:
            node_business[nid] = bl

    # 4. 更新未分类节点
    classified_count = 0
    update_map = {}
    for node in unclassified:
        bl = node_business.get(node["node_id"])
        if bl:
            update_map[node["node_id"]] = bl
            classified_count += 1

    if update_map:
        await external_kb.update_nodes_business_line(update_map)
        # 同步题目category
        from app.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            for node_id, bl in update_map.items():
                stmt = select(Question).where(Question.source_node_id == node_id)
                result = await db.execute(stmt)
                questions = result.scalars().all()
                for q in questions:
                    q.category = bl
            await db.commit()

    return {"status": "ok", "classified": classified_count, "total_unclassified": len(unclassified)}


@router.delete("/kb-nodes/{node_id}")
async def delete_kb_node(node_id: str):
    """删除知识库节点"""
    await external_kb.delete_node(node_id)
    return {"status": "ok"}


# ==========================================
# 知识图谱关系管理（MySQL版）
# ==========================================

@router.get("/knowledge-relations")
async def get_knowledge_relations(db: AsyncSession = Depends(get_db)):
    """获取所有知识点关系"""
    from app.models import KnowledgeRelation
    stmt = select(KnowledgeRelation).order_by(KnowledgeRelation.created_at.desc())
    result = await db.execute(stmt)
    relations = result.scalars().all()
    return [{"id": r.id, "source_node_id": r.source_node_id, "target_node_id": r.target_node_id, "relation_type": r.relation_type, "weight": r.weight} for r in relations]


class CreateRelationRequest(BaseModel):
    source_node_id: str
    target_node_id: str
    relation_type: str = "related"
    weight: float = 1.0


@router.post("/knowledge-relations")
async def create_knowledge_relation(req: CreateRelationRequest, db: AsyncSession = Depends(get_db)):
    """创建知识点关系"""
    from app.models import KnowledgeRelation
    relation = KnowledgeRelation(
        source_node_id=req.source_node_id,
        target_node_id=req.target_node_id,
        relation_type=req.relation_type,
        weight=req.weight
    )
    db.add(relation)
    await db.commit()
    return {"status": "ok", "id": relation.id}


@router.delete("/knowledge-relations/{relation_id}")
async def delete_knowledge_relation(relation_id: int, db: AsyncSession = Depends(get_db)):
    """删除知识点关系"""
    from app.models import KnowledgeRelation
    relation = await db.get(KnowledgeRelation, relation_id)
    if not relation:
        raise HTTPException(status_code=404, detail="Relation not found")
    await db.delete(relation)
    await db.commit()
    return {"status": "ok"}


@router.get("/knowledge-graph")
async def get_knowledge_graph(db: AsyncSession = Depends(get_db)):
    """获取知识图谱（节点+边），用于可视化"""
    from app.models import KnowledgeRelation
    # 获取所有节点
    nodes = await external_kb.get_all_nodes_with_business_line()
    # 获取所有关系
    stmt = select(KnowledgeRelation)
    result = await db.execute(stmt)
    relations = result.scalars().all()

    # 转换为图格式
    graph_nodes = [{"id": n["node_id"], "label": n["content"][:30] + "...", "business_line": n["business_line"]} for n in nodes]
    graph_edges = [{"source": r.source_node_id, "target": r.target_node_id, "relation_type": r.relation_type, "weight": r.weight} for r in relations]

    return {"nodes": graph_nodes, "edges": graph_edges}


@router.post("/knowledge-graph/auto-build")
async def auto_build_knowledge_graph(db: AsyncSession = Depends(get_db)):
    """LLM智能构建知识图谱：按业务线分组分析节点关系，写入 knowledge_relations 表"""
    from app.models import KnowledgeRelation
    from app.services.llm_adapter import llm_client
    import re, json
    from sqlalchemy import delete as sql_delete

    # 1. 获取所有节点（带业务线标签）
    nodes = await external_kb.get_all_nodes_with_business_line()
    tagged = [n for n in nodes if n.get("business_line")]
    if not tagged:
        raise HTTPException(status_code=400, detail="没有已分类节点，请先给节点分配业务线")

    # 2. 按业务线分组
    groups = {}
    for n in tagged:
        bl = n["business_line"]
        if bl not in groups:
            groups[bl] = []
        groups[bl].append(n)

    # 3. 清空旧关系
    await db.execute(sql_delete(KnowledgeRelation))
    await db.commit()

    total_relations = 0

    # 4. 每组用LLM分析节点间关系
    for bl, group_nodes in groups.items():
        # 节点太多则截取前20个
        sample = group_nodes[:20]
        nodes_text = "\n".join([
            f"[{n['node_id']}] {n['content'][:100]}"
            for n in sample
        ])

        prompt = f"""你是银行客服培训系统的知识图谱分析专家。请分析以下同属「{bl}」业务线的知识节点之间的关系。

【知识节点】（共{len(group_nodes)}个，展示前{len(sample)}个）：
{nodes_text}

请分析这些知识点之间的关系，包括：
- prerequisite: A是B的前置条件（必须先完成A才能做B）
- extends: A是B的扩展延伸（B在A基础上深入）
- related: A和B相关联（业务上有联系但无先后）
- contradicts: A和B互斥矛盾（两者不能同时成立）

请严格按照以下JSON数组格式输出（不要输出其他内容，不要用markdown代码块）：
[
    {{"source": "kb_001", "target": "kb_002", "relation_type": "prerequisite", "weight": 0.9}},
    {{"source": "kb_002", "target": "kb_005", "relation_type": "extends", "weight": 0.8}}
]

要求：
1. 只输出确实存在的关系，不要牵强附会
2. weight取值0.5-1.0，关系越强权重越高
3. source和target必须是上面真实出现的节点ID
4. 每组输出3-10条关系即可
5. 如果节点之间没有明显关系，返回空数组 []"""

        try:
            messages = [{"role": "user", "content": prompt}]
            response = await llm_client.async_chat_completion(messages, model="chat", timeout=120)
            # 逐条正则提取关系，避免整体JSON解析失败
            valid_node_ids = {n["node_id"] for n in sample}
            # 匹配 {"source": "kb_xxx", "target": "kb_xxx", "relation_type": "xxx", "weight": xxx}
            rel_pattern = re.compile(
                r'\{\s*"source"\s*:\s*"(kb_\d+)"\s*,\s*'
                r'"target"\s*:\s*"(kb_\d+)"\s*,\s*'
                r'"relation_type"\s*:\s*"(prerequisite|extends|related|contradicts)"\s*,?\s*'
                r'"weight"\s*:\s*"?([^",}\s]+)"?\s*\}',
                re.IGNORECASE
            )
            for m in rel_pattern.finditer(response):
                src, tgt, rtype, w_raw = m.groups()
                if src in valid_node_ids and tgt in valid_node_ids and src != tgt:
                    # weight 安全转换
                    w_map = {"0.5": 0.5, "0.6": 0.6, "0.7": 0.7, "0.8": 0.8, "0.9": 0.9, "1": 1.0, "1.0": 1.0}
                    w = w_map.get(w_raw.strip("."), None)
                    if w is None:
                        try:
                            w = max(0.1, min(1.0, abs(float(w_raw))))
                        except (ValueError, TypeError):
                            w = 0.8
                    new_rel = KnowledgeRelation(
                        source_node_id=src,
                        target_node_id=tgt,
                        relation_type=rtype,
                        weight=w
                    )
                    db.add(new_rel)
                    total_relations += 1
        except Exception as e:
            from loguru import logger as loguru_logger
            loguru_logger.error(f"业务线[{bl}]知识图谱构建失败: {e}")

    # 5. 跨业务线关系分析：每个业务线取代表节点，分析与其他业务线的关系
    try:
        bl_list = list(groups.keys())
        cross_prompt_nodes = []
        for bl in bl_list:
            # 每个业务线取前2个节点作为代表
            for n in groups[bl][:2]:
                cross_prompt_nodes.append(f"[{n['node_id']}][业务线:{bl}] {n['content'][:80]}")
        
        cross_prompt = f"""你是银行客服业务分析专家。请分析以下来自不同业务线的知识节点之间的跨业务线关系。

【知识节点】：
{chr(10).join(cross_prompt_nodes)}

请找出不同业务线之间的关联关系。例如：
- "信用卡挂失"与"密码管理"可能相关（挂失后需重置密码）
- "账户冻结"与"信息更新"可能相关（信息变更触发风控冻结）

请严格按照以下JSON数组格式输出（只输出跨业务线关系，同业务线不输出）：
[
    {{"source": "kb_021", "target": "kb_002", "relation_type": "related", "weight": 0.7}}
]

要求：
1. source和target必须来自不同业务线
2. 只输出确实有业务关联的关系
3. 输出3-8条跨业务线关系
4. 直接输出JSON，不要其他文字"""

        cross_messages = [{"role": "user", "content": cross_prompt}]
        cross_response = await llm_client.async_chat_completion(cross_messages, model="chat", timeout=120)
        from loguru import logger as loguru_logger
        loguru_logger.info(f"跨业务线LLM返回前200字: {cross_response[:200]}")
        # 提取所有 {...} JSON对象（DOTALL支持跨行），逐个解析
        all_node_ids = {n["node_id"] for n in tagged}
        node_bl_map = {n["node_id"]: n["business_line"] for n in tagged}
        cross_count = 0
        # 允许的relation_type映射（LLM可能输出多种值）
        REL_TYPE_MAP = {
            "prerequisite": "prerequisite",
            "extends": "extends",
            "related": "related",
            "contradicts": "contradicts",
            "possible_sequence": "related",
            "sequence": "related",
            "association": "related",
            "dependency": "prerequisite",
            "similar": "related",
            "correlation": "related",
        }
        for obj_str in re.findall(r'\{[^{}]+\}', cross_response, re.DOTALL):
            src_m = re.search(r'"source"\s*:\s*"(kb_\d+)"', obj_str)
            tgt_m = re.search(r'"target"\s*:\s*"(kb_\d+)"', obj_str)
            rtype_m = re.search(r'"relation_type"\s*:\s*"([^"]+)"', obj_str)
            w_m = re.search(r'"weight"\s*:\s*"?([0-9.]+)"?', obj_str)
            if not (src_m and tgt_m and rtype_m):
                continue
            src, tgt = src_m.group(1), tgt_m.group(1)
            rtype_raw = rtype_m.group(1).strip().lower()
            rtype = REL_TYPE_MAP.get(rtype_raw, "related")  # 未知类型默认归为related
            if src in all_node_ids and tgt in all_node_ids and src != tgt:
                src_bl = node_bl_map.get(src)
                tgt_bl = node_bl_map.get(tgt)
                if src_bl and tgt_bl and src_bl != tgt_bl:
                    try:
                        w = float(w_m.group(1)) if w_m else 0.7
                        w = max(0.1, min(1.0, abs(w)))
                    except (ValueError, TypeError):
                        w = 0.7
                    db.add(KnowledgeRelation(
                        source_node_id=src, target_node_id=tgt,
                        relation_type=rtype, weight=w
                    ))
                    total_relations += 1
                    cross_count += 1
        loguru_logger.info(f"跨业务线关系提取: 匹配到{cross_count}条")
    except Exception as e:
        from loguru import logger as loguru_logger
        loguru_logger.error(f"跨业务线关系构建失败: {e}")

    await db.commit()
    return {"status": "ok", "business_lines": len(groups), "total_relations": total_relations}


# ==========================================
# 数据大屏 (Dashboard)
# ==========================================

@router.get("/dashboard/stats")
async def get_dashboard_stats(db: AsyncSession = Depends(get_db)):
    """全局数据大屏：学员平均分、易错点统计、考试次数等"""
    try:
        # 1. 考试统计
        exam_count_result = await db.execute(select(func.count(ExamRecord.id)))
        total_exams = exam_count_result.scalar() or 0

        avg_score_result = await db.execute(select(func.avg(ExamRecord.overall_score)))
        avg_exam_score = round(avg_score_result.scalar() or 0, 1)

        # 2. 练习统计
        practice_count_result = await db.execute(select(func.count(PracticeRecord.id)))
        total_practices = practice_count_result.scalar() or 0

        # 3. 各维度平均得分
        all_exams_result = await db.execute(select(ExamRecord.score_details))
        all_exams = all_exams_result.scalars().all()

        dim_scores = {"accuracy": [], "service_tone": [], "compliance": [], "empathy": [], "dialogue_control": []}
        for details in all_exams:
            if details:
                for k in dim_scores:
                    if k in details:
                        dim_scores[k].append(details[k])

        avg_dims = {}
        for k, v in dim_scores.items():
            avg_dims[k] = round(sum(v) / len(v), 1) if v else 0

        # 4. 易错点统计（弱点标签频率）
        weakness_result = await db.execute(select(UserWeakness))
        all_weaknesses = weakness_result.scalars().all()

        weakness_freq = {}
        for w in all_weaknesses:
            for point in (w.weak_points or []):
                weakness_freq[point] = weakness_freq.get(point, 0) + 1

        # 排序取Top10
        top_weaknesses = sorted(weakness_freq.items(), key=lambda x: x[1], reverse=True)[:10]

        # 5. 分类统计
        category_result = await db.execute(select(Question.category, func.count(Question.id)).group_by(Question.category))
        category_stats = [{"category": cat, "count": cnt} for cat, cnt in category_result.all()]

        return {
            "total_exams": total_exams,
            "avg_exam_score": avg_exam_score,
            "total_practices": total_practices,
            "avg_dimensions": avg_dims,
            "top_weaknesses": [{"point": p, "count": c} for p, c in top_weaknesses],
            "category_stats": category_stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 组卷 & 发卷
# ==========================================

class ExamPaperCreate(BaseModel):
    title: str
    question_ids: List[str]

@router.get("/exam-papers")
async def get_exam_papers(db: AsyncSession = Depends(get_db)):
    """获取所有试卷"""
    stmt = select(ExamPaper).order_by(ExamPaper.created_at.desc())
    result = await db.execute(stmt)
    papers = result.scalars().all()
    return [
        {
            "id": p.id,
            "title": p.title,
            "question_ids": p.question_ids,
            "question_count": len(p.question_ids or []),
            "created_at": p.created_at.isoformat() if p.created_at else None
        }
        for p in papers
    ]

@router.post("/exam-papers")
async def create_exam_paper(paper: ExamPaperCreate, db: AsyncSession = Depends(get_db)):
    """创建试卷（组卷）"""
    new_paper = ExamPaper(
        id=str(uuid.uuid4()),
        title=paper.title,
        question_ids=paper.question_ids,
        created_by=None
    )
    db.add(new_paper)
    await db.commit()
    return {"status": "success", "id": new_paper.id, "message": f"试卷《{paper.title}》创建成功，包含{len(paper.question_ids)}道题"}

@router.delete("/exam-papers/{paper_id}")
async def delete_exam_paper(paper_id: str, db: AsyncSession = Depends(get_db)):
    """删除试卷"""
    paper = await db.get(ExamPaper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在")
    await db.delete(paper)
    await db.commit()
    return {"status": "ok"}

class DistributeRequest(BaseModel):
    trainee_ids: List[str]

@router.post("/exam-papers/{paper_id}/distribute")
async def distribute_exam_paper(paper_id: str, req: DistributeRequest, db: AsyncSession = Depends(get_db)):
    """给学员下发试卷"""
    paper = await db.get(ExamPaper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在")

    created = []
    for tid in req.trainee_ids:
        assignment = ExamAssignment(
            id=str(uuid.uuid4()),
            exam_paper_id=paper_id,
            trainee_id=tid,
            status="pending"
        )
        db.add(assignment)
        created.append(tid)

    await db.commit()
    return {"status": "success", "message": f"已向{len(created)}名学员下发试卷《{paper.title}》"}

@router.get("/exam-papers/{paper_id}/assignments")
async def get_paper_assignments(paper_id: str, db: AsyncSession = Depends(get_db)):
    """查看某试卷的下发情况"""
    stmt = select(ExamAssignment, User).join(
        User, ExamAssignment.trainee_id == User.id, isouter=True
    ).where(ExamAssignment.exam_paper_id == paper_id)
    result = await db.execute(stmt)
    rows = result.all()
    return [
        {
            "assignment_id": r.ExamAssignment.id,
            "trainee_id": r.ExamAssignment.trainee_id,
            "trainee_name": r.User.username if r.User else "未知",
            "status": r.ExamAssignment.status,
            "created_at": r.ExamAssignment.created_at.isoformat() if r.ExamAssignment.created_at else None
        }
        for r in rows
    ]


@router.get("/exam-papers/{paper_id}/records")
async def get_paper_records(paper_id: str, db: AsyncSession = Depends(get_db)):
    """获取某试卷下所有学员的做题记录详情（分数、每题答题情况）。

    数据关联说明：
    - ExamRecord 本身没有 paper_id 字段，但提交试卷时会把 paper_id 写入 score_details JSON。
    - ExamAssignment 记录每个学员的发卷状态（pending/in_progress/completed）。
    - UserWeakness 通过 source_id=assignment.id 关联，保存每题的弱点/丢分点。
    """
    # 1. 获取该试卷的所有发卷记录（含学员信息），按下发动机倒序
    assign_stmt = select(ExamAssignment, User).join(
        User, ExamAssignment.trainee_id == User.id, isouter=True
    ).where(ExamAssignment.exam_paper_id == paper_id).order_by(ExamAssignment.created_at.desc())
    assign_result = await db.execute(assign_stmt)
    assign_rows = assign_result.all()

    if not assign_rows:
        return []

    # 2. 获取该试卷相关的所有考试记录（通过 score_details.paper_id 关联）
    all_records_stmt = select(ExamRecord).order_by(ExamRecord.created_at.desc())
    all_records_result = await db.execute(all_records_stmt)
    all_records = all_records_result.scalars().all()
    paper_records = [r for r in all_records if (r.score_details or {}).get("paper_id") == paper_id]

    # 3. 获取相关弱点记录（每题答题情况），按 source_id(assignment_id) 分组
    assignment_ids = [r.ExamAssignment.id for r in assign_rows]
    weakness_stmt = select(UserWeakness).where(UserWeakness.source_id.in_(assignment_ids))
    weakness_result = await db.execute(weakness_stmt)
    weaknesses_by_assignment = {}
    for w in weakness_result.scalars().all():
        weaknesses_by_assignment.setdefault(w.source_id, []).append({
            "category": w.category,
            "weak_points": w.weak_points,
            "score": w.score,
            "resolved": w.resolved,
            "source_type": w.source_type
        })

    # 4. 将考试记录匹配到已完成的发卷记录
    # 由于历史数据 ExamRecord.trainee_id 固定为 "mock_user"，无法按 trainee_id 精确匹配，
    # 这里采用按完成顺序最佳匹配：已完成的发卷按时间顺序消费考试记录。
    completed_assignments = [r for r in assign_rows if r.ExamAssignment.status == "completed"]
    matched_records = {}  # assignment_id -> ExamRecord
    used_record_ids = set()
    for assign_row in completed_assignments:
        for record in paper_records:
            if record.id not in used_record_ids:
                matched_records[assign_row.ExamAssignment.id] = record
                used_record_ids.add(record.id)
                break

    # 4.5 收集所有题目ID，批量查询题目内容
    question_ids = set()
    for rec in matched_records.values():
        for item in (rec.score_details or {}).get("results", []):
            qid = item.get("question_id")
            if qid:
                question_ids.add(qid)
    questions_map = {}
    if question_ids:
        q_stmt = select(Question).where(Question.id.in_(question_ids))
        q_result = await db.execute(q_stmt)
        for q in q_result.scalars().all():
            questions_map[q.id] = {"scenario": q.scenario, "category": q.category, "reference_answer": q.reference_answer}

    # 5. 组装返回数据
    result_list = []
    for r in assign_rows:
        rec = matched_records.get(r.ExamAssignment.id)
        # 从 score_details.results 提取答题详情，关联题目内容
        answer_details = []
        if rec and rec.score_details:
            for item in rec.score_details.get("results", []):
                qid = item.get("question_id")
                q_info = questions_map.get(qid, {})
                answer_details.append({
                    "question_id": qid,
                    "scenario": q_info.get("scenario", ""),
                    "category": q_info.get("category", ""),
                    "reference_answer": q_info.get("reference_answer", ""),
                    "trainee_answer": item.get("trainee_answer", ""),
                    "score": item.get("score", 0),
                    "feedback": item.get("feedback", ""),
                    "missed_points": item.get("missed_points", [])
                })
        result_list.append({
            "assignment_id": r.ExamAssignment.id,
            "trainee_id": r.ExamAssignment.trainee_id,
            "trainee_name": r.User.username if r.User else "未知",
            "status": r.ExamAssignment.status,
            "overall_score": rec.overall_score if rec else None,
            "score_details": rec.score_details if rec else None,
            "feedback": rec.feedback if rec else None,
            "answers": answer_details,  # 每题答题详情（题目+分数+点评+丢分点）
            "exam_created_at": rec.created_at.isoformat()
                if rec and rec.created_at else None,
            "assigned_at": r.ExamAssignment.created_at.isoformat() if r.ExamAssignment.created_at else None
        })
    return result_list


# ==========================================
# 学员弱点概览
# ==========================================

@router.get("/weaknesses/overview")
async def get_all_weaknesses(db: AsyncSession = Depends(get_db)):
    """管理员查看所有学员的弱点概览"""
    stmt = select(UserWeakness, User).join(
        User, UserWeakness.trainee_id == User.id, isouter=True
    ).order_by(UserWeakness.created_at.desc())
    result = await db.execute(stmt)
    rows = result.all()
    return [
        {
            "id": r.UserWeakness.id,
            "trainee_id": r.UserWeakness.trainee_id,
            "trainee_name": r.User.username if r.User else "未知",
            "category": r.UserWeakness.category,
            "weak_points": r.UserWeakness.weak_points,
            "score": r.UserWeakness.score,
            "source_type": r.UserWeakness.source_type,
            "resolved": r.UserWeakness.resolved,
            "created_at": r.UserWeakness.created_at.isoformat() if r.UserWeakness.created_at else None
        }
        for r in rows
    ]


# ==========================================
# 学员画像（分标签查询）
# ==========================================

# 标签定义：基于考试分数、考试次数、练习次数、弱点数量动态生成
TRAINEE_PROFILE_TAGS = [
    {"tag": "高分学员", "description": "平均考试分数≥85", "dimension": "score"},
    {"tag": "中等水平", "description": "平均考试分数60-84", "dimension": "score"},
    {"tag": "待提升", "description": "有考试记录且平均分数<60", "dimension": "score"},
    {"tag": "高频考试", "description": "考试次数≥5", "dimension": "activity"},
    {"tag": "活跃学员", "description": "练习次数≥10", "dimension": "activity"},
    {"tag": "新用户", "description": "无考试和练习记录", "dimension": "activity"},
    {"tag": "弱项集中", "description": "未解决弱点记录≥3", "dimension": "weakness"},
    {"tag": "无显著弱点", "description": "无未解决弱点记录", "dimension": "weakness"},
]


@router.get("/trainee-profiles/tags")
async def get_trainee_profile_tags():
    """获取所有可用的学员画像标签列表"""
    return TRAINEE_PROFILE_TAGS


@router.get("/trainee-profiles")
async def get_trainee_profiles(tag: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """获取学员画像列表，可按标签筛选。

    Args:
        tag: 可选标签名，如"高分学员"、"待提升"、"高频考试"、"新用户"等。
    """
    # 1. 获取所有学员（role=trainee）
    stmt = select(User).where(User.role == "trainee").order_by(User.created_at.desc())
    result = await db.execute(stmt)
    trainees = result.scalars().all()

    if not trainees:
        return []

    trainee_ids = [t.id for t in trainees]

    # 2. 批量统计每个学员的考试情况
    exam_stmt = select(
        ExamRecord.trainee_id,
        func.count(ExamRecord.id).label("exam_count"),
        func.avg(ExamRecord.overall_score).label("avg_score"),
        func.max(ExamRecord.overall_score).label("max_score"),
    ).where(ExamRecord.trainee_id.in_(trainee_ids)).group_by(ExamRecord.trainee_id)
    exam_result = await db.execute(exam_stmt)
    exam_stats = {row.trainee_id: row for row in exam_result.all()}

    # 3. 批量统计每个学员的练习次数
    practice_stmt = select(
        PracticeRecord.trainee_id,
        func.count(PracticeRecord.id).label("practice_count"),
    ).where(PracticeRecord.trainee_id.in_(trainee_ids)).group_by(PracticeRecord.trainee_id)
    practice_result = await db.execute(practice_stmt)
    practice_stats = {row.trainee_id: row.practice_count for row in practice_result.all()}

    # 4. 批量统计每个学员的未解决弱点数量
    weakness_stmt = select(
        UserWeakness.trainee_id,
        func.count(UserWeakness.id).label("weakness_count"),
    ).where(
        UserWeakness.trainee_id.in_(trainee_ids),
        UserWeakness.resolved == False,
    ).group_by(UserWeakness.trainee_id)
    weakness_result = await db.execute(weakness_stmt)
    weakness_stats = {row.trainee_id: row.weakness_count for row in weakness_result.all()}

    # 5. 组装画像并生成标签
    profiles = []
    for t in trainees:
        exam_stat = exam_stats.get(t.id)
        exam_count = exam_stat.exam_count if exam_stat else 0
        avg_score = round(float(exam_stat.avg_score), 1) if exam_stat and exam_stat.avg_score is not None else 0
        max_score = exam_stat.max_score if exam_stat and exam_stat.max_score is not None else 0
        practice_count = practice_stats.get(t.id, 0)
        weakness_count = weakness_stats.get(t.id, 0)

        # 生成标签
        tags = []
        if exam_count > 0:
            if avg_score >= 85:
                tags.append("高分学员")
            elif avg_score < 60:
                tags.append("待提升")
            else:
                tags.append("中等水平")

        if exam_count >= 5:
            tags.append("高频考试")

        if practice_count >= 10:
            tags.append("活跃学员")

        if exam_count == 0 and practice_count == 0:
            tags.append("新用户")

        if weakness_count >= 3:
            tags.append("弱项集中")
        elif weakness_count == 0:
            tags.append("无显著弱点")

        profiles.append({
            "trainee_id": t.id,
            "trainee_name": t.username,
            "exam_count": exam_count,
            "avg_score": avg_score,
            "max_score": max_score,
            "practice_count": practice_count,
            "weakness_count": weakness_count,
            "tags": tags,
            "created_at": t.created_at.isoformat() if t.created_at else None
        })

    # 6. 按标签筛选
    if tag:
        profiles = [p for p in profiles if tag in p["tags"]]

    return profiles


# ==========================================
# 动态考试预热 (V3.0)
# ==========================================

@router.get("/prewarm/status")
async def get_prewarm_status():
    """查询业务线分类预热状态"""
    from app.services.exam_engine import business_line_manager
    return business_line_manager.get_status()


@router.post("/prewarm")
async def trigger_prewarm():
    """手动触发业务线分类预热（异步执行，立即返回）"""
    import asyncio
    import uuid as _uuid
    from app.services.exam_engine import business_line_manager
    from app.core.logger import logger

    status = business_line_manager.get_status()
    if status["status"] == "ready":
        return {"message": "业务线分类已就绪，无需重复预热", "status": status}
    if status["status"] == "prewarming":
        return {"message": "预热正在进行中，请稍后", "status": status}

    async def _do_prewarm():
        trace_id = str(_uuid.uuid4())
        try:
            await business_line_manager.get_business_config(trace_id=trace_id)
            logger.info("[管理员触发预热] 业务线分类已完成")
        except Exception as e:
            logger.error(f"[管理员触发预热] 失败: {e}")

    asyncio.create_task(_do_prewarm())
    return {"message": "预热已启动，预计需要 1-3 分钟", "status": {"status": "prewarming"}}


# ==========================================
# V3.4 项目场景（PBL）管理接口
# ==========================================

# --- 项目场景 Schemas ---
class ProjectScenarioCreate(BaseModel):
    name: str
    description: str | None = None
    business_line: str | None = None
    tasks: list = []
    difficulty: str = "medium"
    enabled: bool = True

class ProjectScenarioUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    business_line: str | None = None
    tasks: list | None = None
    difficulty: str | None = None
    enabled: bool | None = None


@router.get("/project-scenarios")
async def get_project_scenarios(db: AsyncSession = Depends(get_db)):
    """获取所有项目场景"""
    stmt = select(ProjectScenario).order_by(ProjectScenario.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/project-scenarios")
async def create_project_scenario(scenario: ProjectScenarioCreate, db: AsyncSession = Depends(get_db)):
    """创建项目场景"""
    new_scenario = ProjectScenario(
        id=str(uuid.uuid4()),
        name=scenario.name,
        description=scenario.description,
        business_line=scenario.business_line,
        tasks=scenario.tasks,
        difficulty=scenario.difficulty,
        enabled=scenario.enabled
    )
    db.add(new_scenario)
    await db.commit()
    return new_scenario


@router.put("/project-scenarios/{scenario_id}")
async def update_project_scenario(scenario_id: str, scenario: ProjectScenarioUpdate, db: AsyncSession = Depends(get_db)):
    """更新项目场景"""
    existing = await db.get(ProjectScenario, scenario_id)
    if not existing:
        raise HTTPException(status_code=404, detail="项目场景不存在")

    if scenario.name is not None:
        existing.name = scenario.name
    if scenario.description is not None:
        existing.description = scenario.description
    if scenario.business_line is not None:
        existing.business_line = scenario.business_line
    if scenario.tasks is not None:
        existing.tasks = scenario.tasks
    if scenario.difficulty is not None:
        existing.difficulty = scenario.difficulty
    if scenario.enabled is not None:
        existing.enabled = scenario.enabled

    await db.commit()
    return existing


@router.delete("/project-scenarios/{scenario_id}")
async def delete_project_scenario(scenario_id: str, db: AsyncSession = Depends(get_db)):
    """删除项目场景"""
    existing = await db.get(ProjectScenario, scenario_id)
    if not existing:
        raise HTTPException(status_code=404, detail="项目场景不存在")
    await db.delete(existing)
    await db.commit()
    return {"message": "已删除"}


# --- 意图定义 Schemas ---
class IntentDefinitionCreate(BaseModel):
    name: str
    business_line: str | None = None
    success_criteria: list = []
    description: str | None = None

class IntentDefinitionUpdate(BaseModel):
    name: str | None = None
    business_line: str | None = None
    success_criteria: list | None = None
    description: str | None = None


@router.get("/intent-definitions")
async def get_intent_definitions(db: AsyncSession = Depends(get_db)):
    """获取所有意图定义"""
    stmt = select(IntentDefinition).order_by(IntentDefinition.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/intent-definitions")
async def create_intent_definition(intent: IntentDefinitionCreate, db: AsyncSession = Depends(get_db)):
    """创建意图定义"""
    new_intent = IntentDefinition(
        id=str(uuid.uuid4()),
        name=intent.name,
        business_line=intent.business_line,
        success_criteria=intent.success_criteria,
        description=intent.description
    )
    db.add(new_intent)
    await db.commit()
    return new_intent


@router.delete("/intent-definitions/{intent_id}")
async def delete_intent_definition(intent_id: str, db: AsyncSession = Depends(get_db)):
    """删除意图定义"""
    existing = await db.get(IntentDefinition, intent_id)
    if not existing:
        raise HTTPException(status_code=404, detail="意图定义不存在")
    await db.delete(existing)
    await db.commit()
    return {"message": "已删除"}
