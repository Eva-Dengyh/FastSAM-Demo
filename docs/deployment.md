# 部署方案

## 方案对比

| 方案 | 费用 | GPU | 准备时间 | 适合场景 |
|------|------|-----|---------|---------|
| 本地运行 | 免费 | 可选 | 5 分钟 | 面试现场/视频共享 |
| Google Colab + ngrok | 免费 | 免费 T4 | 15 分钟 | 远程面试 |
| Docker | 免费 | 可选 | 10 分钟 | 标准化部署 |

> 三种方案默认都是「Go Gateway + 多 backend」形态：流量从 8080 进 Gateway，再分发到 worker。Colab 单进程方案见下文备注。

---

## 方案一：本地运行（推荐）

### 一键启动

```bash
./start.sh
```

自动完成：检查 uv / go → 安装依赖 → 下载模型 → 起 backend-0 (:8000) + backend-1 (:8002) + Gateway (:8080) + 前端 (:3000) → 打开浏览器。

### 手动启动

```bash
# backend ×2
cd backend
uv sync
mkdir -p checkpoints
wget -O checkpoints/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
WORKER_ID=worker-0 MAX_INFLIGHT=2 uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
WORKER_ID=worker-1 MAX_INFLIGHT=2 uv run uvicorn app.main:app --host 0.0.0.0 --port 8002 &

# Gateway
cd ../gateway
go mod download
go run ./cmd/gateway -config configs/gateway.dev.yaml &

# 前端（新终端）
cd ../frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev
# 访问 http://localhost:3000
```

前端通过 `NEXT_PUBLIC_API_URL` 指向 Gateway，Gateway 再转发到 worker，整条链路无需任何 CORS 配置。

---

## 方案二：Google Colab + ngrok

利用免费 T4 GPU (16GB)，通过 ngrok 穿透到公网。

> Colab 是单 backend 进程演示，不起 Gateway——前端直接打到 ngrok 暴露的 FastAPI。验证多 worker / 网关能力请用本地或 Docker 方案。

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
ngrok.set_auth_token("YOUR_NGROK_TOKEN")  # https://ngrok 免费注册
public_url = ngrok.connect(8000)
print(f"公网地址: {public_url}")

uvicorn.run("app.main:app", host="0.0.0.0", port=8000)
```

> Colab 方案需要单独在本地启动前端并把 `NEXT_PUBLIC_API_URL` 改为 ngrok 地址。

---

## 方案三：Docker（推荐）

### 前置要求

- Docker
- docker-compose
- 模型权重文件

### 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/Eva-Dengyh/FastSAM-Demo.git
cd FastSAM-Demo

# 2. 下载模型（只需一次）
mkdir -p models
wget -O models/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt

# 3. 启动
docker-compose up --build
```

`docker-compose.yml` 编排：

| 容器 | 角色 | 端口 |
|------|------|------|
| `fastsam-backend-0` | worker-0（FastAPI） | 仅 expose 8000 |
| `fastsam-backend-1` | worker-1（FastAPI） | 仅 expose 8000 |
| `fastsam-gateway` | Go 推理网关 | **8080:8080** |
| `fastsam-frontend` | Next.js | **3001:3000** |

### 访问

- 前端：http://localhost:3001
- Gateway：http://localhost:8080/api/health
- Gateway 指标：http://localhost:8080/metrics

> backend 容器**不再对外映射端口**，所有 API 都从 Gateway 进。这是有意为之——避免绕过 Gateway 直连 backend，让 Gateway 真正成为唯一入口。

### 常用命令

```bash
# 停止
docker-compose down

# 重启某个 worker（验证故障摘除）
docker-compose stop backend-1
docker-compose start backend-1

# 查看日志
docker-compose logs -f gateway
docker-compose logs -f backend-0
```

### 端口说明

| 服务 | 内部端口 | 外部端口 |
|------|---------|---------|
| 前端 | 3000 | 3001 |
| Gateway | 8080 | 8080 |
| backend-0 / backend-1 | 8000 | 不暴露（仅 Gateway 可达） |

使用 3001 是为了避免与本地开发端口 3000 冲突。

### 自定义端口

如需修改端口，编辑 `docker-compose.yml`：

```yaml
services:
  gateway:
    ports:
      - "8090:8080"  # 改为 8090
  frontend:
    ports:
      - "3002:3000"  # 改为 3002
    environment:
      - NEXT_PUBLIC_API_URL=http://gateway:8080  # 容器内端口仍是 8080
```

---

## 环境变量

`.env.example`:

```env
HOST=0.0.0.0
PORT=8000

# 节点标识（多 worker 部署时每个进程一个唯一值，Gateway 用来粘性路由）
WORKER_ID=worker-0

# 单进程同时跑的推理上限（兜底，应与 Gateway 的 max_inflight 同值）
MAX_INFLIGHT=2

MODEL_CFG=configs/sam2.1/sam2.1_hiera_t.yaml
CHECKPOINT_PATH=checkpoints/sam2.1_hiera_tiny.pt
CORS_ORIGINS=*

# 图片缓存过期时间（秒，应与 Gateway session_ttl_seconds 对齐）
IMAGE_CACHE_TTL=3600

MAX_IMAGE_SIZE=10485760
```

Gateway 配置见 `gateway/configs/gateway.yaml`（容器）和 `gateway/configs/gateway.dev.yaml`（本地），关键字段含义参考 [`gateway/README.md`](../gateway/README.md#配置说明)。