#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
CKPT="$BACKEND_DIR/checkpoints/sam2.1_hiera_tiny.pt"
CKPT_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt"

cleanup() {
    echo "正在停止服务..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# 检查 uv
if ! command -v uv &> /dev/null; then
    echo "安装 uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # shellcheck source=/dev/null
    source "$HOME/.bashrc" 2>/dev/null || source "$HOME/.zshrc" 2>/dev/null || true
fi

# 安装后端依赖
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

# 安装前端依赖
echo "安装前端依赖..."
cd "$FRONTEND_DIR"
npm install --silent

# 启动后端
echo "启动后端服务..."
cd "$BACKEND_DIR"
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# 启动前端开发服务器
echo "启动前端服务..."
cd "$FRONTEND_DIR"
npm run dev -- --port 3000 &
FRONTEND_PID=$!

sleep 3

# 打开浏览器
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "http://localhost:3000"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "http://localhost:3000" 2>/dev/null || true
fi

echo ""
echo "=================================="
echo "  FastSAM Demo 已启动"
echo "  前端: http://localhost:3000"
echo "  后端: http://localhost:8000"
echo "  API 文档: http://localhost:8000/docs"
echo "  按 Ctrl+C 停止"
echo "=================================="

wait $BACKEND_PID $FRONTEND_PID
