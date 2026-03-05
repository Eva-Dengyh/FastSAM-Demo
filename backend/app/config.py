from pydantic_settings import BaseSettings

SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


class Settings(BaseSettings):
    """应用配置，从环境变量或 .env 文件读取"""

    host: str = "0.0.0.0"
    port: int = 8000

    # SAM 2.1 模型配置
    model_cfg: str = "configs/sam2.1/sam2.1_hiera_t.yaml"
    checkpoint_path: str = "checkpoints/sam2.1_hiera_tiny.pt"

    # CORS 配置（逗号分隔多个域名）
    cors_origins: str = "*"

    # 图片上传限制（字节）
    max_image_size: int = 10 * 1024 * 1024

    # 图片缓存过期时间（秒）
    image_cache_ttl: int = 3600

    model_config = {"env_file": ".env"}


settings = Settings()
