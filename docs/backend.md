# 后端技术文档

后端基于 FastAPI，使用 uv 管理依赖，集成 SAM 2.1 进行图像分割。

## 技术栈

| 组件 | 版本 | 用途 |
|------|------|------|
| FastAPI | 0.115+ | Web 框架 |
| Uvicorn | 0.30+ | ASGI 服务器 |
| SAM 2 | latest | 图像分割模型 |
| PyTorch | 2.5.1+ | 深度学习框架 |
| Pillow | 10.3+ | 图像 I/O |
| NumPy | 1.26+ | 数值计算 |
| uv | latest | 包管理器 |

## uv 项目管理

### pyproject.toml

```toml
[project]
name = "fastsam-demo-backend"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn>=0.30.0",
    "python-multipart>=0.0.9",
    "pillow>=10.3.0",
    "numpy>=1.26,<2",
    "pydantic-settings>=2.0.0",
    "torch>=2.5.1",
    "torchvision>=0.20.1",
    "sam-2 @ git+https://github.com/facebookresearch/sam2.git",
]

[tool.uv]
dev-dependencies = [
    "pytest>=8.0.0",
    "httpx>=0.27.0",
]
```

### 常用命令

```bash
uv sync              # 安装所有依赖
uv run uvicorn ...   # 启动服务
uv run pytest        # 运行测试
uv add <pkg>         # 添加依赖
```

## 项目结构

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 入口
│   ├── config.py            # 配置管理
│   ├── routers/
│   │   ├── segment.py       # 分割接口
│   │   └── upload.py        # 上传接口
│   ├── services/
│   │   ├── sam_service.py   # SAM 2.1 模型封装
│   │   └── image_service.py # 图片缓存
│   ├── schemas/
│   │   └── segment.py       # Pydantic 模型
│   └── utils/
│       └── mask_encoder.py  # RLE 编码
├── checkpoints/             # 模型权重
├── pyproject.toml
└── uv.lock
```

## 核心模块

### config.py

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000
    model_cfg: str = "configs/sam2.1/sam2.1_hiera_t.yaml"
    checkpoint_path: str = "checkpoints/sam2.1_hiera_tiny.pt"
    cors_origins: str = "*"
    max_image_size: int = 10 * 1024 * 1024
    image_cache_ttl: int = 3600

    model_config = {"env_file": ".env"}


settings = Settings()
```

### main.py

```python
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import segment, upload
from app.services.sam_service import sam_service

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Loading SAM 2.1 model...")
    sam_service.load(settings.model_cfg, settings.checkpoint_path)
    logger.info(f"Model loaded on {sam_service.device}")
    yield
    sam_service.unload()


app = FastAPI(title="FastSAM Demo API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api")
app.include_router(segment.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "model": settings.checkpoint_path.split("/")[-1],
        "device": str(sam_service.device),
    }
```

### sam_service.py - SAM 2.1 封装

```python
import torch
import numpy as np
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor


class SAMService:
    """SAM 2.1 模型推理服务"""

    def __init__(self):
        self.predictor: SAM2ImagePredictor | None = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def load(self, model_cfg: str, checkpoint: str):
        model = build_sam2(model_cfg, checkpoint, device=self.device)
        self.predictor = SAM2ImagePredictor(model)

    def set_image(self, image: np.ndarray):
        """预计算 image embedding"""
        with torch.inference_mode():
            self.predictor.set_image(image)

    def predict(
        self,
        points: np.ndarray,
        labels: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Point prompt 推理

        Args:
            points: shape (N, 2), [[x, y], ...]
            labels: shape (N,), 1=前景 0=背景

        Returns:
            masks: shape (K, H, W), bool
            scores: shape (K,), float
        """
        with torch.inference_mode():
            masks, scores, _ = self.predictor.predict(
                point_coords=points,
                point_labels=labels,
                multimask_output=True,
            )
        return masks, scores

    def unload(self):
        self.predictor = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


sam_service = SAMService()
```

### image_service.py

```python
import uuid
import time
from dataclasses import dataclass, field

import numpy as np

from app.config import settings


@dataclass
class CachedImage:
    image: np.ndarray
    width: int
    height: int
    created_at: float = field(default_factory=time.time)


class ImageService:
    def __init__(self):
        self._cache: dict[str, CachedImage] = {}

    def store(self, image: np.ndarray) -> str:
        image_id = uuid.uuid4().hex[:8]
        h, w = image.shape[:2]
        self._cache[image_id] = CachedImage(image=image, width=w, height=h)
        self._cleanup()
        return image_id

    def get(self, image_id: str) -> CachedImage | None:
        cached = self._cache.get(image_id)
        if cached and time.time() - cached.created_at > settings.image_cache_ttl:
            del self._cache[image_id]
            return None
        return cached

    def _cleanup(self):
        now = time.time()
        expired = [k for k, v in self._cache.items()
                   if now - v.created_at > settings.image_cache_ttl]
        for k in expired:
            del self._cache[k]


image_service = ImageService()
```

### schemas/segment.py

```python
from pydantic import BaseModel, Field


class PointInput(BaseModel):
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    label: int = Field(default=1, ge=0, le=1)


class SegmentRequest(BaseModel):
    image_id: str
    points: list[PointInput] = Field(..., min_length=1)


class RLEMask(BaseModel):
    counts: list[int]
    size: list[int]


class MaskResult(BaseModel):
    rle: RLEMask
    bbox: list[int]
    score: float
    area: int


class SegmentResponse(BaseModel):
    masks: list[MaskResult]
    image_id: str
```

### routers/segment.py

```python
import numpy as np
from fastapi import APIRouter, HTTPException

from app.schemas.segment import SegmentRequest, SegmentResponse, MaskResult, RLEMask
from app.services.sam_service import sam_service
from app.services.image_service import image_service
from app.utils.mask_encoder import encode_mask_rle

router = APIRouter()


@router.post("/segment", response_model=SegmentResponse)
async def segment(request: SegmentRequest):
    cached = image_service.get(request.image_id)
    if not cached:
        raise HTTPException(status_code=404, detail={
            "code": "IMAGE_NOT_FOUND",
            "message": f"Image '{request.image_id}' not found",
        })

    # 设置图片（复用缓存的 embedding）
    sam_service.set_image(cached.image)

    # 推理
    points = np.array([[p.x, p.y] for p in request.points])
    labels = np.array([p.label for p in request.points])
    masks, scores = sam_service.predict(points, labels)

    # 构建响应
    results = []
    for mask, score in sorted(zip(masks, scores), key=lambda x: x[1], reverse=True):
        rle = encode_mask_rle(mask)
        ys, xs = np.where(mask)
        bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
        results.append(MaskResult(
            rle=RLEMask(**rle), bbox=bbox,
            score=float(score), area=int(mask.sum()),
        ))

    return SegmentResponse(masks=results, image_id=request.image_id)
```

### mask_encoder.py

```python
import numpy as np


def encode_mask_rle(mask: np.ndarray) -> dict:
    """Binary mask → RLE 编码"""
    pixels = mask.flatten().astype(np.uint8)
    counts = []
    current_val = 0
    current_count = 0

    for pixel in pixels:
        if pixel == current_val:
            current_count += 1
        else:
            counts.append(current_count)
            current_val = 1 - current_val
            current_count = 1
    counts.append(current_count)

    return {"counts": counts, "size": [int(mask.shape[0]), int(mask.shape[1])]}
```

## 性能优化

### 1. Image Embedding 缓存

`set_image()` 预计算 embedding（慢），`predict()` 复用（快）。

### 2. 模型预加载

FastAPI lifespan 启动时加载模型，避免首次请求冷启动。

### 3. 推理模式

使用 `torch.inference_mode()` 关闭梯度计算，减少内存和提升速度。
