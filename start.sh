#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
GATEWAY_DIR="$PROJECT_DIR/gateway"
CKPT="$BACKEND_DIR/checkpoints/sam2.1_hiera_tiny.pt"
CKPT_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt"

cleanup() {
    echo "正在停止服务..."
    kill $BACKEND0_PID $BACKEND1_PID $GATEWAY_PID $FRONTEND_PID 2>/dev/null || true
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

# 检查 go（Gateway 需要）
if ! command -v go &> /dev/null; then
    echo "未检测到 Go，请先安装 Go 1.22+：https://go.dev/dl/"
    exit 1
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

# 同步 Gateway Go 依赖
echo "同步 Gateway 依赖..."
cd "$GATEWAY_DIR"
go mod download

# 安装前端依赖
echo "安装前端依赖..."
cd "$FRONTEND_DIR"
npm install --silent

# 启动两个 backend（同一台机，但不同进程，验证 Gateway 多 worker 调度）
# 注意：本地两进程共享同一块 CPU/GPU，吞吐不会真正翻倍——本阶段验证的是【调度正确性】
echo "启动 backend-0（:8000, WORKER_ID=worker-0）..."
cd "$BACKEND_DIR"
WORKER_ID=worker-0 MAX_INFLIGHT=2 uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND0_PID=$!

echo "启动 backend-1（:8002, WORKER_ID=worker-1）..."
WORKER_ID=worker-1 MAX_INFLIGHT=2 uv run uvicorn app.main:app --host 0.0.0.0 --port 8002 &
BACKEND1_PID=$!

# 启动 Gateway（:8080），用 dev 配置（两 worker 指向 localhost:8000 / 8002）
echo "启动 Gateway 服务（:8080）..."
cd "$GATEWAY_DIR"
go run ./cmd/gateway -config "$GATEWAY_DIR/configs/gateway.dev.yaml" &
GATEWAY_PID=$!

# 启动前端，rewrites 指向 Gateway
echo "启动前端服务（:3000，API → Gateway）..."
cd "$FRONTEND_DIR"
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev -- --port 3000 &
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
echo "  FastSAM Demo 已启动（Phase 2 多 worker）"
echo "  前端:        http://localhost:3000"
echo "  Gateway:     http://localhost:8080/api/health"
echo "  Gateway 指标: http://localhost:8080/metrics"
echo "  backend-0:   http://localhost:8000/docs"
echo "  backend-1:   http://localhost:8002/docs"
echo "  按 Ctrl+C 停止"
echo "=================================="

wait $BACKEND0_PID $BACKEND1_PID $GATEWAY_PID $FRONTEND_PID
