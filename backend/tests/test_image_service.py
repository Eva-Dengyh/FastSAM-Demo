import time
from unittest.mock import patch

import numpy as np

from app.services.image_service import ImageService


class TestImageService:
    def setup_method(self):
        self.service = ImageService()
        self.test_image = np.zeros((100, 200, 3), dtype=np.uint8)

    def test_store_and_get(self):
        image_id, width, height = self.service.store(self.test_image)
        assert len(image_id) == 8
        assert width == 200
        assert height == 100

        cached = self.service.get(image_id)
        assert cached is not None
        assert cached.width == 200
        assert cached.height == 100
        assert cached.image.shape == (100, 200, 3)

    def test_get_nonexistent(self):
        assert self.service.get("notexist") is None

    def test_ttl_expiry(self):
        image_id, _, _ = self.service.store(self.test_image)

        # 模拟过期
        with patch("app.services.image_service.settings") as mock_settings:
            mock_settings.image_cache_ttl = 0
            assert self.service.get(image_id) is None

    def test_store_generates_unique_ids(self):
        id1, _, _ = self.service.store(self.test_image)
        id2, _, _ = self.service.store(self.test_image)
        assert id1 != id2
