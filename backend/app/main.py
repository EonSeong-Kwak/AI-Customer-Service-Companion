from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import api_router
from app.api import admin
from app.api import builder
from app.core.config import settings
from app.core.logger import logger
import uuid
import asyncio
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# 跨域设置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局 Trace ID 中间件
class TraceIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        trace_id = request.headers.get("X-Trace-ID", str(uuid.uuid4()))
        request.state.trace_id = trace_id
        
        # 将 trace_id 绑定到日志上下文
        with logger.contextualize(trace_id=trace_id):
            logger.bind(access=True).info(f"Received request: {request.method} {request.url.path}")
            try:
                response = await call_next(request)
                response.headers["X-Trace-ID"] = trace_id
                logger.bind(access=True).info(f"Returned response: {response.status_code}")
                return response
            except Exception as e:
                logger.bind(access=True).error(f"Request failed: {request.method} {request.url.path} - {str(e)}")
                raise e

app.add_middleware(TraceIDMiddleware)

# 包含主路由和管理路由
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(admin.router, prefix="/api/v1/admin")
app.include_router(builder.router, prefix="/api/v1/admin/builder", tags=["builder"])


@app.on_event("startup")
async def _startup_background_prewarm():
    """启动时后台预热：业务线分类（不阻塞服务启动，在后台异步执行）"""
    async def _prewarm():
        # 先等2秒让服务完全启动
        await asyncio.sleep(2)
        try:
            from app.services.exam_engine import business_line_manager
            await business_line_manager.get_business_config(trace_id="prewarm")
            logger.info("[预热] 业务线分类已完成")
        except Exception as e:
            logger.warning(f"[预热] 业务线分类失败（将在首次启动考试时重试）: {e}")

    asyncio.create_task(_prewarm())
