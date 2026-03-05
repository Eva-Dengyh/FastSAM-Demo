import logging

import numpy as np
import torch
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

logger = logging.getLogger(__name__)


class SAMService:
    """SAM 2.1 模型推理服务（单例）"""

    def __init__(self) -> None:
        self.predictor: SAM2ImagePredictor | None = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._current_image_id: str | None = None

    @property
    def is_loaded(self) -> bool:
        return self.predictor is not None

    def load(self, model_cfg: str, checkpoint: str) -> None:
        """加载 SAM 2.1 模型权重"""
        logger.info("Building SAM 2.1 model: cfg=%s, ckpt=%s", model_cfg, checkpoint)
        model = build_sam2(model_cfg, checkpoint, device=self.device)
        self.predictor = SAM2ImagePredictor(model)
        logger.info("SAM 2.1 model loaded on %s", self.device)

    def set_image(self, image: np.ndarray, image_id: str) -> None:
        """设置图片并预计算 image embedding（最耗时步骤），相同 image_id 跳过重复计算"""
        if self._current_image_id == image_id:
            return
        with torch.inference_mode():
            self.predictor.set_image(image)
        self._current_image_id = image_id

    def predict(
        self,
        points: np.ndarray,
        labels: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        基于 point prompt 进行分割推理。

        Args:
            points: 点坐标，shape (N, 2)，每行 [x, y]
            labels: 点标签，shape (N,)，1=前景 0=背景

        Returns:
            masks: shape (K, H, W)，bool 数组，K 个候选 mask
            scores: shape (K,)，每个 mask 的置信度
        """
        with torch.inference_mode():
            masks, scores, _ = self.predictor.predict(
                point_coords=points,
                point_labels=labels,
                multimask_output=True,
            )
        return masks, scores

    def unload(self) -> None:
        """释放模型资源"""
        self.predictor = None
        self._current_image_id = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        logger.info("SAM 2.1 model unloaded")


sam_service = SAMService()
