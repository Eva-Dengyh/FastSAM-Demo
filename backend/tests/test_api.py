from io import BytesIO
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def mock_sam_service():
    """所有测试默认 mock SAM 服务，避免加载真实模型"""
    with patch("app.routers.upload.sam_service") as mock_upload, \
         patch("app.routers.segment.sam_service") as mock_segment, \
         patch("app.routers.health.sam_service") as mock_health:
        for mock in (mock_upload, mock_segment, mock_health):
            mock.is_loaded = True
            mock.device = "cpu"
        mock_upload.set_image = MagicMock()
        mock_segment.set_image = MagicMock()
        # predict 返回 1 个 mask + score
        mock_segment.predict = MagicMock(
            return_value=(
                np.array([np.ones((10, 10), dtype=bool)]),
                np.array([0.95]),
            )
        )
        yield {
            "upload": mock_upload,
            "segment": mock_segment,
            "health": mock_health,
        }


def _create_test_image(fmt="JPEG", content_type="image/jpeg") -> tuple[BytesIO, str]:
    """生成测试图片"""
    buf = BytesIO()
    img = Image.new("RGB", (100, 100), color="red")
    img.save(buf, format=fmt)
    buf.seek(0)
    return buf, content_type


class TestHealth:
    def test_health_check(self):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"


class TestUpload:
    def test_upload_success(self):
        buf, ct = _create_test_image()
        resp = client.post("/api/upload", files={"file": ("test.jpg", buf, ct)})
        assert resp.status_code == 200
        data = resp.json()
        assert "image_id" in data
        assert data["width"] == 100
        assert data["height"] == 100

    def test_upload_unsupported_format(self):
        buf = BytesIO(b"not an image")
        resp = client.post("/api/upload", files={"file": ("test.txt", buf, "text/plain")})
        assert resp.status_code == 415

    def test_upload_file_too_large(self):
        buf, ct = _create_test_image()
        with patch("app.routers.upload.settings") as mock_settings:
            mock_settings.max_image_size = 1  # 1 byte
            mock_settings.cors_origins = "*"
            resp = client.post("/api/upload", files={"file": ("test.jpg", buf, ct)})
            assert resp.status_code == 413

    def test_upload_model_not_ready(self, mock_sam_service):
        mock_sam_service["upload"].is_loaded = False
        buf, ct = _create_test_image()
        resp = client.post("/api/upload", files={"file": ("test.jpg", buf, ct)})
        assert resp.status_code == 503


class TestSegment:
    def test_segment_image_not_found(self):
        resp = client.post("/api/segment", json={"image_id": "notexist", "points": [{"x": 50, "y": 50}]})
        assert resp.status_code == 404

    def test_segment_success(self, mock_sam_service):
        # 先上传图片
        buf, ct = _create_test_image()
        upload_resp = client.post("/api/upload", files={"file": ("test.jpg", buf, ct)})
        image_id = upload_resp.json()["image_id"]

        # 分割
        resp = client.post("/api/segment", json={"image_id": image_id, "points": [{"x": 50, "y": 50}]})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["masks"]) > 0
        assert data["masks"][0]["score"] == pytest.approx(0.95)

    def test_segment_model_not_ready(self, mock_sam_service):
        mock_sam_service["segment"].is_loaded = False
        resp = client.post("/api/segment", json={"image_id": "any", "points": [{"x": 50, "y": 50}]})
        assert resp.status_code == 503
