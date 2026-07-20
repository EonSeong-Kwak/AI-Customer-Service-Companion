from fastapi import APIRouter, HTTPException, Depends, Body, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Any
import uuid
import io
import docx
import pdfplumber

from app.core.database import get_db
from app.models import Question
from app.agents.builder_agent import builder_agent
from app.services.external_kb import external_kb
from pydantic import BaseModel

router = APIRouter()

class ExtractRequest(BaseModel):
    document_text: str

class SaveRequest(BaseModel):
    knowledge_nodes: List[Dict[str, Any]]

@router.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    try:
        content = ""
        file_bytes = await file.read()
        
        if file.filename.lower().endswith(".pdf"):
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                for page in pdf.pages:
                    text = page.extract_text()
                    if text:
                        content += text + "\n"
        elif file.filename.lower().endswith(".docx"):
            doc = docx.Document(io.BytesIO(file_bytes))
            for para in doc.paragraphs:
                content += para.text + "\n"
        elif file.filename.lower().endswith(".txt") or file.filename.lower().endswith(".md"):
            content = file_bytes.decode("utf-8")
        else:
            raise HTTPException(status_code=400, detail="不支持的文件格式。请上传 PDF, Word(.docx) 或 TXT/MD 文件。")
            
        return {"status": "success", "text": content.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件解析失败: {str(e)}")

@router.post("/extract")
async def extract_knowledge(request: ExtractRequest):
    try:
        result = await builder_agent.extract_knowledge_nodes(request.document_text)
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/save")
async def save_knowledge(request: SaveRequest, db: AsyncSession = Depends(get_db)):
    try:
        saved_count = 0
        nodes_to_add = []
        for node in request.knowledge_nodes:
            category = node.get("category", "通用业务")
            # Collect the node to be added to ChromaDB
            nodes_to_add.append(node)
            
            # Save the derived questions to the Question table
            derived_questions = node.get("derived_questions", [])
            for dq in derived_questions:
                q = Question(
                    id=str(uuid.uuid4()),
                    category=category,
                    scenario=dq.get("scenario", ""),
                    reference_answer=dq.get("reference_answer", ""),
                    key_points=dq.get("key_points", []),
                    difficulty="medium"
                )
                db.add(q)
                saved_count += 1
        
        await db.commit()

        # Add to ChromaDB RAG Vector Store
        await external_kb.add_knowledge(nodes_to_add)

        # 自动归类新节点（向量检索，相似度>75%继承业务线）
        for node in nodes_to_add:
            node_id = node.get("node_id")
            content = node.get("rule_content", "") or node.get("content", "")
            if content:
                # 检索最相似的已有节点
                results = await external_kb.search_knowledge(content, top_k=1)
                if results and len(results) > 0:
                    sim_str = results[0].get("similarity", "0%")
                    try:
                        sim_val = float(sim_str.replace("%", ""))
                    except Exception:
                        sim_val = 0
                    if sim_val >= 75:
                        # 继承相似节点的业务线
                        similar_node_id = results[0].get("node_id")
                        bl = await external_kb.get_node_business_line(similar_node_id)
                        if bl:
                            # 注意：刚add的节点可能检索到自己，需要排除
                            # 如果检索到的就是自己，跳过
                            if similar_node_id != node_id:
                                await external_kb.set_node_business_line(node_id, bl)

        return {"status": "success", "message": f"成功保存 {saved_count} 道衍生题目，并向向量知识库入库 {len(nodes_to_add)} 个知识原子！"}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
