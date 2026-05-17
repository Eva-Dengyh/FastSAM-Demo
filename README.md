# FastSAM-Demo

基于 SAM 2.1（Segment Anything Model 2）的交互式图像分割 Web 应用。用户上传图片后，点击任意物体即可实时分割并高亮显示。

![overview](/public/Snipaste_2026-04-07_15-27-13.png)

## 技术栈

- **推理网关**: Go 1.22 + chi + zerolog + Prometheus（并发控流、粘性路由、健康摘除）
- **后端**: FastAPI + SAM 2.1（Meta 分割模型，Apache 2.0 开源）
- **前端**: Next.js 15 + TypeScript + Tailwind CSS v4 + Framer Motion
- **模型**: SAM 2.1 Hiera — 支持图片/视频分割，无需申请，直接下载
- **包管理**: go mod（网关）+ uv（后端）+ npm（前端）

## 核心特性

- **点击即分割**: click-to-segment 交互，毫秒级响应
- **Go 推理网关**: 有界队列 + N 并发上限保护 GPU，故障 worker 自动摘除
- **粘性路由**: `image_id → worker_id` 会话表，保证 embedding 缓存命中
- **横向扩展**: 多 worker 形态，最低负载优先调度
- **跨服务 trace**: `X-Request-Id` 贯穿 Gateway → backend，一行 ID 串起全链路日志
- **多模型选择**: tiny(39M) / small(46M) / base+(81M) / large(224M)
- **CPU/GPU 双模式**: tiny 模型 CPU 也能跑
- **多物体选择**: 不同颜色标注多个分割区域
- **RLE 压缩传输**: mask 数据压缩率 > 98%
- **导出功能**: 支持导出原图、叠加效果、仅掩码
- **无需申请**: 模型权重直接下载，Apache 2.0 许可

## 效果展示

| 叠加效果 | 掩码输出 |
|:---:|:---:|
| ![overlay](public/Snipaste_2026-04-07_14-18-56_original_overlay.png) | ![masks](public/Snipaste_2026-04-07_14-18-56_original_masks.png) |

## 快速开始

### Docker 部署（推荐）

```bash
# 克隆项目
git clone https://github.com/Eva-Dengyh/FastSAM-Demo.git
cd FastSAM-Demo

# 下载模型权重（只需一次）
mkdir -p models
wget -O models/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt

# 一键启动（拉起 2 个 backend + Gateway + 前端）
docker-compose up --build
```

访问：
- 前端：http://localhost:3001
- Gateway：http://localhost:8080/api/health
- Gateway 指标：http://localhost:8080/metrics

> backend-0 / backend-1 容器仅 expose、不对外映射端口，所有 API 都从 Gateway 进。

### 本地开发

```bash
# 克隆项目
git clone https://github.com/Eva-Dengyh/FastSAM-Demo.git
cd FastSAM-Demo

# 一键启动（自动安装依赖 + 下载模型 + 起 2 backend + Gateway + 前端）
./start.sh
```

`start.sh` 会要求本机已安装 **Go 1.22+** 和 **uv**，并在以下端口分别启动：

| 进程 | 端口 | 说明 |
|------|------|------|
| backend-0 (uvicorn) | 8000 | `WORKER_ID=worker-0` |
| backend-1 (uvicorn) | 8002 | `WORKER_ID=worker-1` |
| Gateway (go run) | 8080 | 用 `gateway/configs/gateway.dev.yaml` |
| 前端 (Next.js) | 3000 | API 经 `NEXT_PUBLIC_API_URL` 指向 Gateway |

或手动启动：

```bash
# 1. 安装后端依赖
cd backend && uv sync

# 2. 下载模型权重（tiny 39MB，无需认证）
mkdir -p checkpoints
wget -O checkpoints/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt

# 3. 起两个 backend 进程（不同 WORKER_ID + 端口）
WORKER_ID=worker-0 MAX_INFLIGHT=2 uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
WORKER_ID=worker-1 MAX_INFLIGHT=2 uv run uvicorn app.main:app --host 0.0.0.0 --port 8002 &

# 4. 起 Gateway
cd ../gateway && go mod download
go run ./cmd/gateway -config configs/gateway.dev.yaml &

# 5. 起前端（指向 Gateway）
cd ../frontend && npm install
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev
```

前端 http://localhost:3000 · Gateway http://localhost:8080/api/health · backend Swagger http://localhost:8000/docs

详细步骤见 [docs/quickstart.md](docs/quickstart.md)。

### 多 worker 验证

启动后跑：

```bash
./scripts/verify-multiworker.sh
```

会自动校验负载均衡 + 粘性路由，预期看到 8 次 upload 在两个 worker 间均衡分布，同一 `image_id` 的所有 segment 始终命中同一个 worker。

## 项目结构

```
FastSAM-Demo/
├── gateway/              # Go 推理网关（chi + zerolog + Prometheus）
│   ├── cmd/gateway/      # main 入口
│   ├── internal/         # config/pool/session/health/middleware/handler/metrics
│   ├── configs/          # gateway.yaml（容器）/ gateway.dev.yaml（本地）
│   ├── Dockerfile        # 多阶段构建，alpine 运行时
│   └── go.mod
├── backend/              # FastAPI 后端（多实例横向扩展）
│   ├── app/              # 应用代码 (routers/services/schemas/utils)
│   │   └── main.py       # 含 trace_id middleware + X-Worker-Id 响应头
│   ├── tests/            # 单元测试
│   ├── Dockerfile        # 后端容器镜像
│   └── pyproject.toml    # uv 依赖管理
├── frontend/             # Next.js + TypeScript
│   ├── src/
│   │   ├── app/          # App Router 页面
│   │   ├── components/   # UI 组件
│   │   ├── hooks/        # 业务逻辑 Hooks（含 410/429 自动恢复）
│   │   ├── lib/          # API 封装（含错误子类 + 退避重试）
│   │   └── types/        # TypeScript 类型定义
│   ├── next.config.ts    # API 代理配置（指向 Gateway）
│   └── Dockerfile        # 前端容器镜像
├── models/               # 模型权重（需手动下载）
├── scripts/              # 验证脚本（verify-multiworker.sh 等）
├── docker-compose.yml    # Docker 服务编排（2 backend + gateway + frontend）
├── .dockerignore         # Docker 构建忽略文件
├── docs/                 # 完整技术文档
├── start.sh              # 一键启动脚本（本地多 worker 形态）
└── .env.example
```

## 文档

| 文档 | 说明 |
|------|------|
| [架构设计](docs/architecture.md) | 系统架构、技术选型、数据流 |
| [Go 网关](gateway/README.md) | Gateway 配置、路由、错误语义、运行入口 |
| [网关 Phase 1/2 纪要](docs/go/) | 分阶段实施过程、关键决策、验证清单 |
| [快速启动](docs/quickstart.md) | 5 分钟跑通指南 |
| [API 文档](docs/api.md) | RESTful 接口详细说明（含 Gateway 错误码） |
| [前端文档](docs/frontend.md) | Next.js + TypeScript 前端实现 |
| [后端文档](docs/backend.md) | FastAPI + SAM 2.1 推理服务 |
| [模型文档](docs/model.md) | SAM 2.1 架构、模型对比、性能基准 |
| [部署方案](docs/deployment.md) | 本地 / Colab / Docker |
| [面试指南](docs/interview-guide.md) | Demo 脚本、技术话术 |
| [问题排查](docs/troubleshooting.md) | 常见问题与解决方案 |

## License

MIT