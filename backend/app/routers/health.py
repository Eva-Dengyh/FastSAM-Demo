from fastapi import APIRouter

from app.config import settings
from app.services.sam_service import sam_service

router = APIRouter()


@router.get("/health")
async def health_check():
    """健康检查：返回服务状态和模型信息"""
    return {
        "status": "ok",
        "model": settings.checkpoint_path.split("/")[-1],
        "device": str(sam_service.device),
    }
