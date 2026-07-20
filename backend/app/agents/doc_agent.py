from app.services.llm_adapter import llm_client
from app.services.external_kb import external_kb
from app.services.retrieval_pipeline import retrieval_pipeline
from app.core.logger import logger

class DocAgent:
    """
    负责基于外部知识库进行问答的 Agent (学)
    V3.0: 集成高级检索管线
    """
    async def answer_query(self, query: str, trace_id: str = "N/A", user_profile: dict = None) -> str:
        logger.bind(trace_id=trace_id).info(f"DocAgent 收到查询: {query}")
        
        # 1. 使用高级检索管线检索（V3.0升级）
        kb_results = await retrieval_pipeline.search(query, top_k=5, user_profile=user_profile, trace_id=trace_id)
        
        # 将检索结果存储到上下文中，以便前端可以展示
        retrieved_docs = [{"content": item.get('content', ''), "node_id": item.get('node_id', ''), "similarity": item.get('similarity', item.get('score', '未知'))} for item in kb_results]
        
        # 2. 拼接上下文
        context_str = "\n".join([f"- {item['content']}" for item in kb_results])
        
        # 3. 构造 Prompt
        prompt = f"""
你是一个专业的银行客服培训导师。请基于以下提供的参考资料回答考生的提问。
如果参考资料中没有相关信息，请直接回答"根据当前知识库无法解答此问题"，不要自行编造。

【参考资料】:
{context_str}

【考生提问】:
{query}
"""
        messages = [
            {"role": "system", "content": "你是一个严格遵循给定资料的导师。"},
            {"role": "user", "content": prompt}
        ]
        
        # 4. 调用 LLM（使用对话模型 deepseek-v3.2）
        response = await llm_client.async_chat_completion(messages, trace_id=trace_id, model="chat")
        return response

    async def answer_query_stream(self, query: str, trace_id: str = "N/A", mode: str = "normal", history: list = None, user_profile: dict = None):
        logger.bind(trace_id=trace_id).info(f"DocAgent 收到查询 (Stream, mode={mode}): {query}")
        
        if history is None:
            history = [{"role": "trainee", "content": query}]

        if mode == "feynman":
            # 费曼模式：扮演实习生提问，让学员解释
            system_prompt = """你现在处于“费曼挑战”模式，扮演一名刚入职的银行实习生（Intern_Mode）。
你的师傅（考生）刚刚学习了银行业务知识。
你需要向师傅虚心请教，提出关于某个银行业务（如密码重置、账户冻结、信用卡挂失等）的问题，让他用自己的话给你讲一遍。
例如：“师傅，我刚才没看懂《大额转账规定》，如果不核实身份会有什么后果呀？”
如果师傅解释得通俗易懂且逻辑正确，你要表示恍然大悟，并判定他“通关”；如果师傅解释得不清楚或有错误，你要继续追问或指出疑惑的地方。
请保持实习生的人设，态度谦虚但对知识点要求严格。"""
            
            messages = [{"role": "system", "content": system_prompt}]
            for msg in history:
                role = "assistant" if msg["role"] == "ai" else "user"
                messages.append({"role": role, "content": msg["content"]})
            retrieved_docs = []
                
        else:
            # 正常学习模式：基于 RAG 回答（V3.0 使用高级检索管线）
            kb_results = await retrieval_pipeline.search(query, top_k=5, user_profile=user_profile, trace_id=trace_id)
            
            retrieved_docs = [{"content": item.get('content', ''), "node_id": item.get('node_id', ''), "similarity": item.get('similarity', item.get('score', '未知'))} for item in kb_results]
            
            # 2. 拼接上下文
            context_str = "\n".join([f"- {item['content']}" for item in kb_results])
            
            # 3. 构造 Prompt
            prompt = f"""
你是一个专业的银行客服培训导师。请基于以下提供的参考资料回答考生的提问。
如果参考资料中没有相关信息，请直接回答"根据当前知识库无法解答此问题"，不要自行编造。

【参考资料】:
{context_str}

【考生提问】:
{query}
"""
            messages = [
                {"role": "system", "content": "你是一个严格遵循给定资料的导师。"},
                {"role": "user", "content": prompt}
            ]
        
        # 4. 流式调用 LLM
        # 先发送包含检索来源的特殊标记
        import json
        if mode != "feynman":
            yield f"__KNOWLEDGE_SOURCES__:{json.dumps(retrieved_docs)}\n"
            
        async for chunk in llm_client.chat_completion_stream(messages, trace_id=trace_id, model="chat"):
            yield chunk

doc_agent = DocAgent()
