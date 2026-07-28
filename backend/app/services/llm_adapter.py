import os
import time
from typing import List, Dict, Any, AsyncGenerator
from cryptography.fernet import Fernet, InvalidToken
from dotenv import dotenv_values
from openai import OpenAI, AsyncOpenAI
from app.core.logger import logger

def get_openaiKey():
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    # 在实际运行中，如果是通过项目根目录运行，.env 应该在根目录
    PROJECT_ROOT = os.path.dirname(BASE_DIR)
    
    ENV_PATH = os.path.join(PROJECT_ROOT, ".env")
    SECRET_KEY_PATH = os.path.join(PROJECT_ROOT, ".secrets.key")
    
    if not os.path.exists(ENV_PATH) or not os.path.exists(SECRET_KEY_PATH): 
        return None
        
    try:
        with open(SECRET_KEY_PATH, "rb") as f: 
            fernet = Fernet(f.read())
        config = dotenv_values(ENV_PATH)
        encrypted_value = config.get("DASHSCOPE_API_KEY_ENC")
        if not encrypted_value: 
            return None
        return fernet.decrypt(encrypted_value.encode()).decode()
    except Exception as e:
        logger.error(f"解密 API Key 失败: {e}")
        return None

class LLMAdapter:
    def __init__(self):
        self.api_key = get_openaiKey()
        if self.api_key:
            self.client = OpenAI(
                api_key=self.api_key,
                base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                max_retries=0  # 禁用自动重试，避免超时后等待3分钟
            )
            self.async_client = AsyncOpenAI(
                api_key=self.api_key,
                base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                max_retries=0  # 禁用自动重试
            )
        else:
            self.client = None
            self.async_client = None
            logger.warning("未找到有效的 API Key 配置。")
            
        self.default_model = "deepseek-r1"
        self.timeout = 60  # 默认超时时间（秒）
        
        self.MODELS = {
            "reasoning": "deepseek-r1-distill-qwen-7b",
            "chat": "deepseek-v3.2",
            "fast": "deepseek-v4-flash-flash",
            "r1": "deepseek-r1"
        }

    def chat_completion(self, messages: List[Dict[str, str]], trace_id: str = "N/A", timeout: int = None, model: str = None) -> str:
        """
        统一的同步生成文本接口
        model: 可选，指定模型名或模型类型（"reasoning"|"chat"|"fast"|"r1"）
        """
        if not self.client:
            raise Exception("LLM 客户端未初始化(缺少 API Key)")
            
        target_model = self.MODELS.get(model, model) or self.default_model
        start_time = time.time()
        try:
            response = self.client.chat.completions.create(
                model=target_model,
                messages=messages,
                timeout=timeout or self.timeout
            )
            content = response.choices[0].message.content
            latency = time.time() - start_time
            
            logger.bind(llm=True, trace_id=trace_id).info(
                f"Model: {target_model} | Latency: {latency:.2f}s | "
                f"PromptTokens: {response.usage.prompt_tokens} | "
                f"CompletionTokens: {response.usage.completion_tokens}"
            )
            return content
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"LLM 调用失败: {e}")
            raise e

    async def async_chat_completion(self, messages: List[Dict[str, str]], trace_id: str = "N/A", timeout: int = None, model: str = None, temperature: float = None) -> str:
        """
        异步版本的生成文本接口
        model: 可选，指定模型名或模型类型（"reasoning"|"chat"|"fast"|"r1"）
        temperature: 可选，不传则用模型默认值；判卷/评分这类需要稳定输出的场景建议传低值（如 0.2）
        """
        if not self.async_client:
            raise Exception("LLM 客户端未初始化(缺少 API Key)")

        target_model = self.MODELS.get(model, model) or self.default_model
        start_time = time.time()
        try:
            extra_kwargs = {"temperature": temperature} if temperature is not None else {}
            response = await self.async_client.chat.completions.create(
                model=target_model,
                messages=messages,
                timeout=timeout or self.timeout,
                **extra_kwargs
            )
            content = response.choices[0].message.content
            latency = time.time() - start_time
            
            logger.bind(llm=True, trace_id=trace_id).info(
                f"Async Model: {target_model} | Latency: {latency:.2f}s | "
                f"PromptTokens: {response.usage.prompt_tokens} | "
                f"CompletionTokens: {response.usage.completion_tokens}"
            )
            return content
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"LLM 异步调用失败: {e}")
            raise e

    async def chat_completion_stream(self, messages: List[Dict[str, str]], trace_id: str = "N/A", model: str = None) -> AsyncGenerator[str, None]:
        """
        统一的异步流式生成文本接口，实现打字机效果
        model: 可选，指定模型名或模型类型（"reasoning"|"chat"|"fast"|"r1"）
        """
        if not self.async_client:
            yield "LLM 客户端未初始化(缺少 API Key)"
            return
            
        target_model = self.MODELS.get(model, model) or self.default_model
        start_time = time.time()
        try:
            logger.bind(llm=True, trace_id=trace_id).info(
                f"Stream Model: {target_model} | Starting..."
            )
            response = await self.async_client.chat.completions.create(
                model=target_model,
                messages=messages,
                stream=True
            )
            async for chunk in response:
                # DeepSeek-R1 可能会有 reasoning_content (think 标签)
                # 为了保持统一，这里简单处理，如果 delta.content 有内容就抛出
                if chunk.choices and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta
                    if hasattr(delta, 'reasoning_content') and delta.reasoning_content:
                        # 如果需要展示思考过程，可以把 reasoning_content 包在 <think></think> 里
                        # 这里为了打字机效果更纯粹，我们选择抛出 reasoning_content 作为灰色的文字或直接拼接
                        # 但为避免前端解析复杂，暂时屏蔽或按普通文本输出
                        # 我们选择只输出最终的 content，或者如果前端支持，可以把 reasoning 也发出去
                        # 我们这里简化，只输出 content，忽略 reasoning_content
                        pass
                    if delta.content:
                        yield delta.content
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"LLM 流式调用失败: {e}")
            yield f"\n[调用失败: {str(e)}]"

llm_client = LLMAdapter()
