import json
import re
import uuid
from typing import Dict, Any
from app.services.llm_adapter import llm_client
from app.core.logger import logger

class BuilderAgent:
    def __init__(self):
        self.system_prompt = """你是一个专业的银行教研专家。你的任务是从提供的业务文档中提取“知识原子(Knowledge Node)”。
你需要输出一个标准的 JSON 格式，严格遵循以下 Schema，不要输出任何其他解释性文本：

```json
{
  "knowledge_nodes": [
    {
      "category": "提取出的业务分类(如: 密码重置与找回)",
      "title": "知识点标题(如: 手机银行登录密码重置)",
      "keywords": ["关键词1", "关键词2"],
      "rule_content": "底层的业务规则或操作条件(精简)",
      "derived_questions": [
        {
          "scenario": "模拟客户的真实口语化提问(如: 哎呀，我手机银行密码忘了，登录不进去了，这可怎么办呀？)",
          "reference_answer": "安抚情绪 + 解决方案的标准话术",
          "key_points": ["得分点1", "得分点2"]
        }
      ]
    }
  ]
}
```

要求：
1. 请根据用户提供的文本，提取尽可能多的 knowledge_nodes。
2. 每个 node 可以衍生 1-2 个 derived_questions，模拟不同的客户情绪或提问角度。
3. 必须返回合法的 JSON 字符串，包裹在 ```json 和 ``` 之间。"""

    async def extract_knowledge_nodes(self, document_text: str, trace_id: str = "N/A") -> Dict[str, Any]:
        """
        核心方法：传入业务文档文本，返回结构化的 Knowledge Nodes 字典
        """
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": f"请解析以下业务文档并提取知识原子：\n\n{document_text}"}
        ]
        
        try:
            logger.bind(trace_id=trace_id).info("BuilderAgent 开始请求大模型提取知识原子...")
            # 为了更稳定的 JSON 抽取，如果你的模型支持 response_format，可以在 llm_adapter 里增加支持。
            # 这里我们通过 Prompt 强控，并使用正则提取。
            response_text = await llm_client.async_chat_completion(messages, trace_id=trace_id)
            
            # Extract JSON from markdown code block
            json_str = self._extract_json_from_text(response_text)
            
            data = json.loads(json_str)
            
            # Inject node_id if not generated
            if "knowledge_nodes" in data:
                for node in data["knowledge_nodes"]:
                    if "node_id" not in node:
                        node["node_id"] = f"kb_{uuid.uuid4().hex[:8]}"
                    
            return data
        except json.JSONDecodeError as je:
            logger.bind(trace_id=trace_id).error(f"Builder Agent JSON 解析失败: {je}\n原始文本: {response_text}")
            raise Exception("大模型返回的数据格式不合法，无法解析为 JSON。")
        except Exception as e:
            logger.bind(trace_id=trace_id).error(f"Builder Agent 解析失败: {e}")
            raise e
            
    def _extract_json_from_text(self, text: str) -> str:
        # Match ```json ... ``` or just find the first { and last }
        match = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
        if match:
            return match.group(1)
            
        # Fallback
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end != -1:
            return text[start:end+1]
            
        return text

builder_agent = BuilderAgent()
