# 快速启动指南

5 分钟内跑通完整的图像分割 Demo。

## 环境要求

- Python 3.10+
- Node.js 18+
- Go 1.22+（推理网关）
- uv（Python 包管理器）
- 现代浏览器（Chrome / Firefox / Safari）
- GPU 可选（推荐，但 tiny 模型 CPU 也能跑）

## 第一步：安装工具链

```bash
# 安装 uv (Python 包管理)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 验证
uv --version
node --version   # 需要 18+
npm --version
go version       # 需要 1.22+（推理网关用）
```

> Go 未安装时去 https://go.dev/dl/ 选对应平台的安装包；macOS 也可以 `brew install go`。

## 第二步：克隆项目

```bash
git clone https://github.com/Eva-Dengyh/FastSAM-Demo.git
cd FastSAM-Demo
```

## 第三步：安装后端依赖

```bash
cd backend
uv sync
```

## 第四步：下载模型权重

SAM 2.1 权重完全开放，无需注册或申请：

```bash
mkdir -p checkpoints

# tiny 模型（39MB，CPU 友好，推荐 Demo 使用）
wget -O checkpoints/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt

# 或使用 curl
curl -L -o checkpoints/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
```

其他模型尺寸（可选）：

```bash
# small (46MB)
wget -O checkpoints/sam2.1_hiera_small.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt

# base+ (81MB)
wget -O checkpoints/sam2.1_hiera_base_plus.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt

# large (224MB，精度最高)
wget -O checkpoints/sam2.1_hiera_large.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt
```

## 第五步：配置环境变量

```bash
cd ..
cp .env.example .env
```

`.env` 默认配置：

```env
HOST=0.0.0.0
PORT=8000
MODEL_CFG=configs/sam2.1/sam2.1_hiera_t.yaml
CHECKPOINT_PATH=checkpoints/sam2.1_hiera_tiny.pt
CORS_ORIGINS=*
```

## 第六步：安装前端依赖

```bash
cd frontend
npm install
```

## 第七步：启动服务

### 方式一：一键启动（推荐）

```bash
cd FastSAM-Demo
./start.sh
```

自动安装依赖、下载模型、起 2 个 backend（worker-0 / worker-1）+ Gateway + 前端，并打开浏览器。

### 方式二：分别启动

```bash
# 终端 1：起两个 backend 进程（多 worker 形态）
cd backend
WORKER_ID=worker-0 MAX_INFLIGHT=2 uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
WORKER_ID=worker-1 MAX_INFLIGHT=2 uv run uvicorn app.main:app --host 0.0.0.0 --port 8002 &

# 终端 2：启动 Gateway
cd ../gateway
go mod download
go run ./cmd/gateway -config configs/gateway.dev.yaml

# 终端 3：启动前端，API 指向 Gateway
cd ../frontend
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev
```

看到以下输出说明成功：

```
# backend-0 / backend-1
INFO:     Uvicorn running on http://0.0.0.0:8000  /  http://0.0.0.0:8002
INFO:     Loading SAM 2.1 model (hiera_tiny)...
INFO:     Model loaded on cuda  # 或 cpu

# Gateway
INF gateway started workers=2
INF worker recovered passes=2 worker_id=worker-0
INF worker recovered passes=2 worker_id=worker-1

# 前端
▲ Next.js (turbopack)
- Local: http://localhost:3000
```

验证：
- 前端：http://localhost:3000
- Gateway 健康检查：http://localhost:8080/api/health （应 `healthy_workers: 2`）
- Gateway 指标：http://localhost:8080/metrics
- 直连 backend Swagger：http://localhost:8000/docs 或 http://localhost:8002/docs

> 等 ~10-15s 健康探活完成（每个 worker 需要连续 2 次成功），`healthy_workers` 才会变 2。

## 开始使用

1. 打开 http://localhost:3000
2. 拖拽或点击上传一张图片
3. 点击图片上的目标物体
4. 等待 ~100ms，分割结果以半透明高亮显示
5. 右侧面板显示 mask 置信度和面积
6. 继续点击其他物体叠加更多 mask
7. 点击「清除选择」或「重新上传」重置

## 常见启动问题

| 问题 | 解决方案 |
|------|----------|
| `uv: command not found` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| `node: command not found` | 安装 Node.js 18+ |
| `go: command not found` | 安装 Go 1.22+（https://go.dev/dl/，macOS 可 `brew install go`） |
| 模型下载失败 | 检查网络，或使用代理下载 |
| 前端 3000 端口被占用 | `npm run dev -- --port 3001` |
| 8000/8002/8080 端口被占用 | `lsof -i :8080` 找到占用进程并关闭 |
| Gateway `healthy_workers: 0` | 等 ~15s 健康探活；仍是 0 检查 backend 日志和 `gateway/configs/gateway.dev.yaml` 的 URL |
| 首次请求慢 | 模型在 lifespan 中预加载，首次 `set_image` 需 ~1-3s |
| `Failed to build SAM 2 CUDA extension` | 可忽略，不影响主要功能 |

## 多 worker 验证

启动后用脚本快速验证负载均衡 + 粘性路由：

```bash
./scripts/verify-multiworker.sh
```

会输出 8 次 upload 的 `X-Worker-Id` 分布，以及同一 `image_id` 的 5 次 segment 是否全部命中同一个 worker。详细解读见 [go/phase2.md](./go/phase2.md#4-验证脚本)。

## Docker 部署（推荐生产环境）

如果只需要快速部署而非本地开发，推荐使用 Docker：

```bash
# 1. 克隆项目
git clone https://github.com/Eva-Dengyh/FastSAM-Demo.git
cd FastSAM-Demo

# 2. 下载模型
mkdir -p models
wget -O models/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt

# 3. 启动
docker-compose up --build
```

访问：
- 前端：http://localhost:3001
- Gateway：http://localhost:8080/api/health
- Gateway 指标：http://localhost:8080/metrics

> Docker 形态下，backend-0 / backend-1 容器仅 expose 不映射端口，所有 API 都从 Gateway 进。

更多问题见 [troubleshooting.md](./troubleshooting.md)。
