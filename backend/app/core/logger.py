import sys
from loguru import logger
from .config import settings

# 移除默认的 handler
logger.remove()

# 配置全局默认的 extra 字段，防止格式化时抛出 KeyError
logger.configure(extra={"trace_id": "system"})


# 控制台输出
logger.add(
    sys.stdout, 
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
)

# 文件输出 - 统一日志 (app.log)
logger.add(
    "logs/app.log",
    rotation="10 MB",
    retention="10 days",
    level="INFO",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} | trace_id={extra[trace_id]} - {message}",
    filter=lambda record: "llm" not in record["extra"] and "access" not in record["extra"]
)

# 文件输出 - 专门为 Access (HTTP请求) 准备的日志
logger.add(
    "logs/access.log",
    rotation="10 MB",
    retention="10 days",
    level="INFO",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | trace_id={extra[trace_id]} - {message}",
    filter=lambda record: record["extra"].get("access", False)
)

# 文件输出 - 专门为 LLM 调用准备的日志
logger.add(
    "logs/llm.log",
    rotation="10 MB",
    retention="10 days",
    level="INFO",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | trace_id={extra[trace_id]} - {message}",
    filter=lambda record: record["extra"].get("llm", False)
)

# 文件输出 - 错误日志 (error.log)
logger.add(
    "logs/error.log",
    rotation="10 MB",
    retention="30 days",
    level="ERROR",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} | trace_id={extra[trace_id]} - {message}"
)
