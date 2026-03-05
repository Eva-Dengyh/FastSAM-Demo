import time
import uuid
from dataclasses import dataclass, field

import numpy as np

from app.config import settings


@dataclass
class CachedImage:
    """缓存的图片数据，包含原始 numpy 数组和尺寸信息"""

    image: np.ndarray
    width: int
    height: int
    created_at: float = field(default_factory=time.time)


class ImageService:
    """图片内存缓存管理，支持 TTL 过期清理"""

    def __init__(self) -> None:
        self._cache: dict[str, CachedImage] = {}

    def store(self, image: np.ndarray) -> tuple[str, int, int]:
        """
        存储图片到缓存。

        Returns:
            (image_id, width, height)
        """
        image_id = uuid.uuid4().hex[:8]
        h, w = image.shape[:2]
        self._cache[image_id] = CachedImage(image=image, width=w, height=h)
        self._cleanup_expired()
        return image_id, w, h

    def get(self, image_id: str) -> CachedImage | None:
        """获取缓存的图片，过期则返回 None"""
        cached = self._cache.get(image_id)
        if cached is None:
            return None
        if time.time() - cached.created_at > settings.image_cache_ttl:
            del self._cache[image_id]
            return None
        return cached

    def _cleanup_expired(self) -> None:
        """清理所有过期缓存"""
        now = time.time()
        expired_keys = [
            key
            for key, item in self._cache.items()
            if now - item.created_at > settings.image_cache_ttl
        ]
        for key in expired_keys:
            del self._cache[key]


image_service = ImageService()
