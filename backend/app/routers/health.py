from fastapi import APIRouter

from app.config import settings
from app.services.sam_service import sam_service

router = APIRouter()


@router.get("/health")
async def health_check():
    """健康检查：返回 worker 标识、模型状态、GPU 信息。供 Gateway 探活使用。"""
    payload = {
        "status": "ok" if sam_service.is_loaded else "starting",
        "worker_id": settings.worker_id,
        "model_loaded": sam_service.is_loaded,
        "model": settings.checkpoint_path.split("/")[-1],
        "device": str(sam_service.device),
        "max_inflight": settings.max_inflight,
    }
    # GPU 显存占用（仅 CUDA 设备）
    import torch
    if torch.cuda.is_available():
        payload["gpu_memory_allocated_mb"] = round(torch.cuda.memory_allocated() / 1024 / 1024, 1)
        payload["gpu_memory_reserved_mb"] = round(torch.cuda.memory_reserved() / 1024 / 1024, 1)
    return payload
