import logging

import numpy as np
from fastapi import APIRouter, HTTPException

from app.schemas.segment import MaskResult, RLEMask, SegmentRequest, SegmentResponse
from app.services.image_service import image_service
from app.services.sam_service import sam_service
from app.utils.mask_encoder import encode_mask_rle, mask_to_bbox

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/segment", response_model=SegmentResponse)
async def segment_image(request: SegmentRequest):
    """根据点击坐标进行图像分割"""
    if not sam_service.is_loaded:
        raise HTTPException(status_code=503, detail={"code": "MODEL_NOT_READY", "message": "模型尚未加载完成"})

    # 查找缓存的图片
    cached = image_service.get(request.image_id)
    if cached is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "IMAGE_NOT_FOUND", "message": f"Image '{request.image_id}' not found or expired"},
        )

    # 设置图片（相同 image_id 会跳过重复的 embedding 计算）
    sam_service.set_image(cached.image, request.image_id)

    # 构建 point prompt
    points = np.array([[p.x, p.y] for p in request.points])
    labels = np.array([p.label for p in request.points])

    # 模型推理
    masks, scores = sam_service.predict(points, labels)

    # 按 score 降序构建响应
    results = _build_results(masks, scores)
    logger.info("Segment: image_id=%s, points=%d, masks=%d", request.image_id, len(request.points), len(results))
    return SegmentResponse(masks=results, image_id=request.image_id)


def _build_results(masks: np.ndarray, scores: np.ndarray) -> list[MaskResult]:
    """将模型输出转换为 API 响应格式，按 score 降序排列"""
    paired = sorted(zip(masks, scores), key=lambda x: x[1], reverse=True)
    results: list[MaskResult] = []
    for mask, score in paired:
        rle = encode_mask_rle(mask)
        bbox = mask_to_bbox(mask)
        results.append(
            MaskResult(
                rle=RLEMask(**rle),
                bbox=bbox,
                score=float(score),
                area=int(mask.sum()),
            )
        )
    return results
