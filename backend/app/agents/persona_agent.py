from typing import List, Dict
from app.services.llm_adapter import llm_client
from app.services.retrieval_pipeline import retrieval_pipeline
from app.core.logger import logger

# V3.2: 角色红线 —— 所有 persona 共用，强约束角色边界
ROLE_REDLINE = """【角色红线（必须严格遵守，违反将导致考试异常终止）】
1. 你只能是银行客户，绝不能说出客服/银行工作人员的话术，包括但不限于："请提供卡号"、"请验证身份"、"我帮您查询"、"建议您..."、"请提供统一信用代码"等核身或服务话术。这类话只能由客服（考生）来说。
2. 不要在回复中用括号写"烦躁值上升至XX"之类的数值，情绪由系统统一管理。
3. 你的回复必须聚焦自己的业务诉求，不要替客服思考业务流程或合规要求。
4. 如果客服已经清楚回答了你的问题，请自然接受并推进到下一个诉求，不要在同一个细节上反复纠缠。
5. 【强制禁止】绝不允许主动追问信息安全、身份核验、合规流程、隐私保护等细节问题。你默认信任银行客服的身份核查流程，不会质疑"为什么要查我身份"、"你们怎么核实身份"等问题。你的疑问只能聚焦在业务方案本身（如费用、时效、操作步骤、安全性）。"""


class PersonaAgent:
    """
    负责扮演客户与考生进行模拟对话的 Agent (考)
    V3.0: 集成高级检索管线，为对话注入真实业务上下文
    """
    async def generate_reply(self, system_prompt: str, chat_history: List[Dict[str, str]], trace_id: str = "N/A", business_context: str = "") -> str:
        """
        chat_history 格式: [{"role": "user", "content": "你好"}, {"role": "ai", "content": "我不高兴"}]
        这里的 "user" 实际上是系统里的"考生"，"ai" 是系统里的"客户"。
        由于 OpenAI SDK 的定义，我们要转换一下角色映射，以防 LLM 混淆。
        V3.0: 注入业务上下文，让客户回复业务细节更准确
        """
        logger.bind(trace_id=trace_id).info("PersonaAgent 正在生成客户回复")
        
        context_injection = ""
        if business_context:
            context_injection = f"\n\n【业务知识参考】（请基于以下真实业务知识回复，确保业务细节准确）：\n{business_context}"
        
        messages = [
            {"role": "system", "content": f"你现在扮演一个银行客户。\n{ROLE_REDLINE}\n\n人格规则与背景设定：\n{system_prompt}{context_injection}\n\n请始终保持在此人格下，使用客户的口吻回复。控制在1-2句话。"}
        ]
        
        for msg in chat_history:
            if msg["role"] == "trainee": # 考生的话对于 LLM 来说是 user 输入
                messages.append({"role": "user", "content": msg["content"]})
            else: # 之前客户说的话，对于 LLM 来说是 assistant 的历史
                messages.append({"role": "assistant", "content": msg["content"]})
                
        response = await llm_client.async_chat_completion(messages, trace_id=trace_id, model="chat")
        return response

    async def generate_reply_stream(self, system_prompt: str, chat_history: List[Dict[str, str]], trace_id: str = "N/A", business_context: str = ""):
        """
        流式生成回复
        V3.0: 注入业务上下文
        """
        logger.bind(trace_id=trace_id).info("PersonaAgent 正在流式生成客户回复")
        
        context_injection = ""
        if business_context:
            context_injection = f"\n\n【业务知识参考】（请基于以下真实业务知识回复，确保业务细节准确）：\n{business_context}"
        
        messages = [
            {"role": "system", "content": f"你现在扮演一个银行客户。\n{ROLE_REDLINE}\n\n人格规则与背景设定：\n{system_prompt}{context_injection}\n\n请始终保持在此人格下，使用客户的口吻回复。控制在1-2句话。"}
        ]
        
        for msg in chat_history:
            if msg["role"] == "trainee":
                messages.append({"role": "user", "content": msg["content"]})
            else:
                messages.append({"role": "assistant", "content": msg["content"]})
                
        async for chunk in llm_client.chat_completion_stream(messages, trace_id=trace_id, model="chat"):
            yield chunk

    async def get_business_context(self, query: str, trace_id: str = "N/A") -> str:
        """V3.0: 通过高级检索管线获取业务上下文"""
        results = await retrieval_pipeline.search(query, top_k=3, trace_id=trace_id)
        return "\n".join([f"- {item.get('content', '')}" for item in results])

persona_agent = PersonaAgent()
