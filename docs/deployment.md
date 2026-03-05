# 部署方案

## 方案对比

| 方案 | 费用 | GPU | 准备时间 | 适合场景 |
|------|------|-----|---------|---------|
| 本地运行 | 免费 | 可选 | 5 分钟 | 面试现场/视频共享 |
| Google Colab + ngrok | 免费 | 免费 T4 | 15 分钟 | 远程面试 |
| Docker | 免费 | 可选 | 10 分钟 | 标准化部署 |

---

## 方案一：本地运行（推荐）

```bash
cd backend
uv sync

# 下载 tiny 模型（39MB，无需认证）
mkdir -p checkpoints
wget -O checkpoints/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt

# 启动
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# 打开前端
open ../frontend/index.html
```

### 一键启动脚本

`start.sh`:

```bash
#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
CKPT="$BACKEND_DIR/checkpoints/sam2.1_hiera_tiny.pt"
CKPT_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt"

# 检查 uv
command -v uv >/dev/null 2>&1 || {
    echo "安装 uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    source ~/.bashrc 2>/dev/null || source ~/.zshrc 2>/dev/null
}

cd "$BACKEND_DIR"
uv sync

# 下载模型
if [ ! -f "$CKPT" ]; then
    echo "下载 SAM 2.1 模型权重 (39MB)..."
    mkdir -p checkpoints
    curl -L -o "$CKPT" "$CKPT_URL"
fi

# 启动后端
echo "启动后端..."
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
sleep 3

# 打开前端
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "$PROJECT_DIR/frontend/index.html"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "$PROJECT_DIR/frontend/index.html"
fi

echo "服务已启动！"
echo "后端: http://localhost:8000"
echo "API 文档: http://localhost:8000/docs"
wait $BACKEND_PID
```

---

## 方案二：Google Colab + ngrok

利用免费 T4 GPU (16GB)，通过 ngrok 穿透到公网。

```python
# Cell 1: 安装
!git clone https://github.com/facebookresearch/sam2.git && cd sam2 && pip install -e .
!pip install fastapi uvicorn pyngrok python-multipart pillow

# Cell 2: 下载模型
!mkdir -p checkpoints
!wget -O checkpoints/sam2.1_hiera_small.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt

# Cell 3: 启动
import nest_asyncio
from pyngrok import ngrok
import uvicorn

nest_asyncio.apply()
ngrok.set_auth_token("YOUR_NGROK_TOKEN")  # https://ngrok.com 免费注册
public_url = ngrok.connect(8000)
print(f"公网地址: {public_url}")

uvicorn.run("app.main:app", host="0.0.0.0", port=8000)
```

---

## 方案三：Docker

### Dockerfile

```dockerfile
FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends git wget && \
    rm -rf /var/lib/apt/lists/*

# 安装 uv
RUN pip install uv

WORKDIR /app

# 安装 SAM 2
RUN git clone https://github.com/facebookresearch/sam2.git /tmp/sam2 && \
    cd /tmp/sam2 && pip install -e .

# 下载模型
RUN mkdir -p checkpoints && \
    wget -O checkpoints/sam2.1_hiera_tiny.pt \
    https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt

# 复制代码
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync
COPY backend/ .
COPY frontend/ /app/static/

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### GPU 版本

```dockerfile
FROM nvidia/cuda:12.4.0-runtime-ubuntu22.04
# ... 其余同上，加上 CUDA 依赖
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - CORS_ORIGINS=*
      - MODEL_CFG=configs/sam2.1/sam2.1_hiera_t.yaml
      - CHECKPOINT_PATH=checkpoints/sam2.1_hiera_tiny.pt
    restart: unless-stopped
```

```bash
docker compose up -d
```

---

## 环境变量

`.env.example`:

```env
HOST=0.0.0.0
PORT=8000
MODEL_CFG=configs/sam2.1/sam2.1_hiera_t.yaml
CHECKPOINT_PATH=checkpoints/sam2.1_hiera_tiny.pt
CORS_ORIGINS=*
IMAGE_CACHE_TTL=3600
```
