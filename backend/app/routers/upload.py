import logging
from io import BytesIO

import numpy as np
from fastapi import APIRouter, HTTPException, UploadFile
from PIL import Image

from app.config import SUPPORTED_IMAGE_TYPES, settings
from app.schemas.upload import UploadResponse
from app.services.image_service import image_service
from app.services.sam_service import sam_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/upload", response_model=UploadResponse)
async def upload_image(file: UploadFile):
    """上传图片并预计算 image embedding"""
    if not sam_service.is_loaded:
        raise HTTPException(status_code=503, detail={"code": "MODEL_NOT_READY", "message": "模型尚未加载完成"})

    # 校验文件类型
    if file.content_type not in SUPPORTED_IMAGE_TYPES:
        raise HTTPException(
            status_code=415,
            detail={"code": "UNSUPPORTED_FORMAT", "message": f"不支持的格式: {file.content_type}"},
        )

    # 读取文件内容
    content = await file.read()

    # 校验文件大小
    if len(content) > settings.max_image_size:
        max_mb = settings.max_image_size // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail={"code": "FILE_TOO_LARGE", "message": f"文件超过 {max_mb}MB 限制"},
        )

    # PIL 读取并转为 RGB numpy 数组
    pil_image = Image.open(BytesIO(content)).convert("RGB")
    image_np = np.array(pil_image)

    # 存入缓存
    image_id, width, height = image_service.store(image_np)

    # 预计算 image embedding（耗时操作）
    sam_service.set_image(image_np, image_id)

    logger.info("Image uploaded: id=%s, size=%dx%d", image_id, width, height)
    return UploadResponse(image_id=image_id, width=width, height=height)
