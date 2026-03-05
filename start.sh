#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
CKPT="$BACKEND_DIR/checkpoints/sam2.1_hiera_tiny.pt"
CKPT_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt"

# 检查 uv
if ! command -v uv &> /dev/null; then
    echo "安装 uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # shellcheck source=/dev/null
    source "$HOME/.bashrc" 2>/dev/null || source "$HOME/.zshrc" 2>/dev/null || true
fi

# 安装依赖
echo "安装后端依赖..."
cd "$BACKEND_DIR"
uv sync

# 下载模型权重
if [ ! -f "$CKPT" ]; then
    echo "下载 SAM 2.1 模型权重 (39MB)..."
    mkdir -p "$BACKEND_DIR/checkpoints"
    curl -L -o "$CKPT" "$CKPT_URL"
fi

# 复制 .env
if [ ! -f "$BACKEND_DIR/.env" ]; then
    cp "$PROJECT_DIR/.env.example" "$BACKEND_DIR/.env"
fi

# 启动后端
echo "启动后端服务..."
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
sleep 3

# 打开前端
echo "打开前端页面..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "$PROJECT_DIR/frontend/index.html"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "$PROJECT_DIR/frontend/index.html" 2>/dev/null || true
fi

echo ""
echo "=================================="
echo "  FastSAM Demo 已启动"
echo "  后端: http://localhost:8000"
echo "  API 文档: http://localhost:8000/docs"
echo "  按 Ctrl+C 停止"
echo "=================================="

wait $BACKEND_PID
