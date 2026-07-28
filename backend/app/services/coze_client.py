"""
Coze 智能体客户端（V5.0：用于替换动态模拟考试里"客户"角色扮演的默认大模型）
文档：https://www.coze.cn/open/docs/developer_guides/chat_v3
"""
import json
import httpx
from app.core.config import settings
from app.core.logger import logger


class CozeClient:
    """封装 Coze v3 Chat API（流式），对外只暴露"发一条消息、拿完整回复文本"的简单接口"""

    def __init__(self):
        self.base_url = settings.COZE_BASE_URL.rstrip("/")
        self.token = settings.COZE_API_TOKEN
        self.bot_id = settings.COZE_BOT_ID

    @property
    def enabled(self) -> bool:
        return bool(self.token and self.bot_id)

    async def chat(self, message: str, user_id: str = "studycoach-exam", trace_id: str = "N/A", timeout: int = 60) -> str:
        """
        向 Coze 智能体发一条消息，返回其完整回复文本。
        每次调用都是无状态的新会话（不传 conversation_id），与现有 DashScope 流程
        "每轮都靠 system_prompt 重新描述完整上下文"的设计保持一致。
        """
        if not self.enabled:
            raise RuntimeError("Coze 未配置（COZE_API_TOKEN / COZE_BOT_ID 缺失）")

        payload = {
            "bot_id": self.bot_id,
            "user_id": user_id,
            "stream": True,
            "auto_save_history": False,
            "additional_messages": [
                {"role": "user", "content": message, "content_type": "text"}
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

        full_text = ""
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", f"{self.base_url}/v3/chat", json=payload, headers=headers) as resp:
                    if resp.status_code != 200:
                        error_body = await resp.aread()
                        raise RuntimeError(f"Coze HTTP {resp.status_code}: {error_body.decode('utf-8', 'ignore')[:500]}")

                    current_event = None
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("event:"):
                            current_event = line[len("event:"):].strip()
                        elif line.startswith("data:"):
                            data_str = line[len("data:"):].strip()
                            if data_str == "[DONE]":
                                break
                            if current_event == "conversation.message.completed":
                                try:
                                    data = json.loads(data_str)
                                except json.JSONDecodeError:
                                    continue
                                if data.get("type") == "answer" and data.get("role") == "assistant":
                                    full_text = data.get("content", "") or full_text
                            elif current_event == "error":
                                logger.bind(trace_id=trace_id).error(f"Coze 返回错误事件: {data_str}")

            if not full_text:
                logger.bind(trace_id=trace_id).warning("Coze 回复为空（可能是 bot_id 不对，或智能体本身没有回应内容）")
            return full_text
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"Coze 调用失败: {e}")
            raise


coze_client = CozeClient()
