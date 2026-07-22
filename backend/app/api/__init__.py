from fastapi import APIRouter
from app.api.endpoints import router as main_router

api_router = APIRouter()
api_router.include_router(main_router, prefix="", tags=["Main"])
