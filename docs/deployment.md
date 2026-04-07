# 部署方案

## 方案对比

| 方案 | 费用 | GPU | 准备时间 | 适合场景 |
|------|------|-----|---------|---------|
| 本地运行 | 免费 | 可选 | 5 分钟 | 面试现场/视频共享 |
| Google Colab + ngrok | 免费 | 免费 T4 | 15 分钟 | 远程面试 |
| Docker | 免费 | 可选 | 10 分钟 | 标准化部署 |

---

## 方案一：本地运行（推荐）

### 一键启动

```bash
./start.sh
```

自动完成：安装依赖 → 下载模型 → 启动后端(:8000) → 启动前端(:3000) → 打开浏览器。

### 手动启动

```bash
# 后端
cd backend
uv sync
mkdir -p checkpoints
wget -O checkpoints/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# 前端（新终端）
cd frontend
npm install
npm run dev
# 访问 http://localhost:3000
```

前端通过 Next.js rewrites 将 `/api/*` 代理到后端，无需额外 CORS 配置。

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
ngrok.set_auth_token("YOUR_NGROK_TOKEN")  # https://ngrok 免费注册
public_url = ngrok.connect(8000)
print(f"公网地址: {public_url}")

uvicorn.run("app.main:app", host="0.0.0.0", port=8000)
```

> Colab 方案需要单独在本地启动前端并修改 `next.config.ts` 中的代理目标为 ngrok 地址。

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

### 访问

- 前端：http://localhost:3001
- 后端 API：http://localhost:8001/docs

### 常用命令

```bash
# 停止
docker-compose down

# 重启
docker-compose restart

# 查看日志
docker-compose logs -f
```

### 端口说明

| 服务 | 内部端口 | 外部端口 |
|------|---------|---------|
| 前端 | 3000 | 3001 |
| 后端 | 8000 | 8001 |

使用 3001/8001 是为了避免与本地开发端口冲突。

### 自定义端口

如需修改端口，编辑 `docker-compose.yml`：

```yaml
services:
  backend:
    ports:
      - "8002:8000"  # 改为 8002
  frontend:
    ports:
      - "3002:3000"  # 改为 3002
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