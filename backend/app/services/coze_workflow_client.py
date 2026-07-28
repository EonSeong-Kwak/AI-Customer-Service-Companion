"""
Coze 工作流客户端（V6.0：用于"练习/通关"模块，按业务线调用固定内容的 Coze Workflow）

和 coze_client.py（Chat API，/v3/chat）是两套完全不同的资源与事件语法，
不合并到一个文件里，保持职责分离。

协议参考 Coze 官方文档：
- 启动（流式）：POST /v1/workflow/stream_run
- 续跑（流式）：POST /v1/workflow/stream_resume
SSE 事件：
- event: Message   —— data.content 按 node 增量拼接，data.node_is_finish 为真时该节点问句已完整
- event: Interrupt —— data.interrupt_data.{event_id, type, required_parameters}，工作流暂停等待本轮输入。
  实测确认：续跑时 resume_data 不能传纯文本，必须是形如 '{"<参数名>": "<回答内容>"}' 的 JSON 字符串，
  参数名从 required_parameters 的 key 里动态读取（不同工作流/节点可能不一样，这里不假设固定叫 QUESTION_DATA）
- event: Error     —— data.{error_code, error_message}
- event: Done      —— 工作流已跑完全程
"""
import json
from dataclasses import dataclass
from typing import Optional

import httpx

from app.core.config import settings
from app.core.logger import logger


@dataclass
class WorkflowStepResult:
    status: str  # "awaiting_input" | "completed" | "error"
    message_text: str = ""
    event_id: Optional[str] = None
    interrupt_type: Optional[int] = None
    required_params: Optional[list] = None  # Interrupt 事件里 required_parameters 的 key 列表，续跑时要用来拼 resume_data
    node_title: Optional[str] = None
    error_message: Optional[str] = None


class CozeWorkflowClient:
    def __init__(self):
        self.base_url = settings.COZE_BASE_URL.rstrip("/")
        self.token = settings.COZE_API_TOKEN

    @property
    def enabled(self) -> bool:
        return bool(self.token)

    async def start_run(
        self,
        workflow_id: str,
        parameters: Optional[dict] = None,
        bot_id: Optional[str] = None,
        app_id: Optional[str] = None,
        trace_id: str = "N/A",
        timeout: int = 60,
    ) -> WorkflowStepResult:
        if not self.enabled:
            return WorkflowStepResult(status="error", error_message="Coze 未配置（COZE_API_TOKEN 缺失）")

        payload = {"workflow_id": workflow_id, "parameters": parameters or {}}
        if bot_id:
            payload["bot_id"] = bot_id
        if app_id:
            payload["app_id"] = app_id

        return await self._post_stream("/v1/workflow/stream_run", payload, trace_id, timeout)

    async def resume_run(
        self,
        workflow_id: str,
        event_id: str,
        interrupt_type: Optional[int],
        resume_data: str,
        trace_id: str = "N/A",
        timeout: int = 60,
    ) -> WorkflowStepResult:
        """resume_data 必须是调用方按上一次 Interrupt 的 required_params 拼好的 JSON 字符串
        （如 '{"QUESTION_DATA": "考生这轮的回答"}'），不能传纯文本——直接传纯文本 Coze 会续跑失败。"""
        if not self.enabled:
            return WorkflowStepResult(status="error", error_message="Coze 未配置（COZE_API_TOKEN 缺失）")

        payload = {
            "workflow_id": workflow_id,
            "event_id": event_id,
            "resume_data": resume_data,
        }
        if interrupt_type is not None:
            payload["interrupt_type"] = interrupt_type

        return await self._post_stream("/v1/workflow/stream_resume", payload, trace_id, timeout)

    async def _post_stream(self, path: str, payload: dict, trace_id: str, timeout: int) -> WorkflowStepResult:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", f"{self.base_url}{path}", json=payload, headers=headers) as resp:
                    if resp.status_code != 200:
                        error_body = await resp.aread()
                        return WorkflowStepResult(
                            status="error",
                            error_message=f"Coze HTTP {resp.status_code}: {error_body.decode('utf-8', 'ignore')[:500]}",
                        )
                    return await self._consume_stream(resp, trace_id)
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"Coze 工作流调用失败 ({path}): {e}")
            return WorkflowStepResult(status="error", error_message=str(e))

    async def _consume_stream(self, resp, trace_id: str) -> WorkflowStepResult:
        """逐行解析 SSE，按 node 累积 Message 内容，遇到 Interrupt/Done/Error 即返回（这就是一"轮"的边界）"""
        current_event = None
        message_text = ""
        node_title = None

        async for line in resp.aiter_lines():
            if not line:
                continue
            if line.startswith("event:"):
                current_event = line[len("event:"):].strip()
                continue
            if not line.startswith("data:"):
                continue
            data_str = line[len("data:"):].strip()
            if not data_str or data_str == "[DONE]":
                continue
            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                continue

            if current_event == "Message":
                content = data.get("content") or ""
                message_text += content
                node_title = data.get("node_title") or node_title
            elif current_event == "Interrupt":
                interrupt_data = data.get("interrupt_data") or {}
                required_params = list((interrupt_data.get("required_parameters") or {}).keys()) or None
                return WorkflowStepResult(
                    status="awaiting_input",
                    message_text=message_text,
                    event_id=interrupt_data.get("event_id"),
                    interrupt_type=interrupt_data.get("type"),
                    required_params=required_params,
                    node_title=data.get("node_title") or node_title,
                )
            elif current_event == "Error":
                error_message = data.get("error_message") or str(data)
                logger.bind(trace_id=trace_id).error(f"Coze 工作流返回错误事件: {error_message}")
                return WorkflowStepResult(status="error", error_message=error_message)
            elif current_event == "Done":
                return WorkflowStepResult(status="completed", message_text=message_text, node_title=node_title)

        # 流提前结束但未收到 Interrupt/Error/Done（网络异常等），按错误处理，绝不静默当成功
        return WorkflowStepResult(status="error", error_message="Coze 工作流响应流异常结束（未收到 Interrupt/Done/Error）")


coze_workflow_client = CozeWorkflowClient()
