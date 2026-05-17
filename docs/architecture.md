# 系统架构设计

## 项目概述

FastSAM-Demo 是一个交互式图像分割 Web 应用。用户上传图片后，通过点击目标物体，后端调用 SAM 2.1 模型进行实时分割，前端使用 Canvas 将 mask 以半透明高亮叠加在原图上。

## 系统架构图

```
┌───────────────────────────────────────────────────────┐
│           Browser (Next.js + TypeScript)                │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ ImageUploader │  │ Segment      │  │ ControlPanel │  │
│  │ (拖拽上传)    │  │ Canvas       │  │ (mask 管理)  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  │
│         │                 │                              │
│  ┌──────┴─────────────────┴───────────────────────┐     │
│  │     useSegmentation Hook                        │     │
│  │     + lib/api.ts（含 410/429 自动恢复）         │     │
│  └──────────────────┬─────────────────────────────┘     │
│                     │ /api/* → NEXT_PUBLIC_API_URL       │
└─────────────────────┼───────────────────────────────────┘
                      ▼
┌───────────────────────────────────────────────────────┐
│            Go Gateway (chi + zerolog + Prometheus)      │
│                                                         │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────────┐    │
│  │ handler     │ │ pool         │ │ session table  │    │
│  │ /api/upload │ │ 有界队列 +    │ │ image_id →     │    │
│  │ /api/segment│ │ N goroutine  │ │ worker_id      │    │
│  │ /api/health │ └──────────────┘ └────────────────┘    │
│  │ /metrics    │ ┌──────────────┐ ┌────────────────┐    │
│  └─────────────┘ │ health probe │ │ middleware     │    │
│                  │ (周期摘除)    │ │ trace_id +     │    │
│                  └──────────────┘ │ metrics + log  │    │
│                                   └────────────────┘    │
└─────────────────┬────────────────────┬──────────────────┘
                  │                    │
                  ▼                    ▼
   ┌───────────────────────┐  ┌───────────────────────┐
   │ FastAPI worker-0       │  │ FastAPI worker-1       │
   │ (uvicorn :8000)        │  │ (uvicorn :8002)        │
   │ ┌──────┐ ┌──────────┐ │  │ ┌──────┐ ┌──────────┐ │
   │ │Upload│ │Segment   │ │  │ │Upload│ │Segment   │ │
   │ │Hdlr  │ │Hdlr      │─┼─▶│ │Hdlr  │ │Hdlr      │ │
   │ └──────┘ └─────┬────┘ │  │ └──────┘ └─────┬────┘ │
   │ Semaphore N(兜底)     │  │ Semaphore N(兜底)     │
   │   ▼                  │  │   ▼                  │
   │ SAM 2.1 Predictor    │  │ SAM 2.1 Predictor    │
   │ Image Cache (embed)   │  │ Image Cache (embed)   │
   └───────────────────────┘  └───────────────────────┘
```

## 技术选型

### 推理网关：Go 1.22 + chi

| 能力 | 实现 |
|------|------|
| 并发控流 | 每个 worker 一个有界 channel + N 个消费 goroutine（≈ N 并发 in-flight），队列满立即 429 |
| 粘性会话 | 进程内 `SessionTable`：`image_id → worker_id`，带 TTL 和后台 sweeper |
| 健康摘除 | 周期探活 `/api/health`，连续失败超阈值摘除，并清空该 worker 的会话 |
| 负载均衡 | `PickLeastLoaded`：遍历健康 worker 选当前队列最浅者 |
| 跨服务 trace | 入口 middleware 生成 / 透传 `X-Request-Id`，写入响应头、日志、上游请求头 |
| 可观测 | Prometheus `/metrics`（7 个指标）+ zerolog 结构化访问日志 |

**为什么用 Go 网关**：Python 进程做反向代理 + 并发控流，要么自己写 asyncio 调度（复杂且和业务耦合），要么靠 nginx/envoy（缺粘性路由所需的 image_id 业务感知）。Go 的 channel + goroutine 把"有界队列 + 并发上限"用十几行代码表达干净，且能保留 ReverseProxy 的流式转发能力（upload 不进 Gateway 内存）。

### 模型：SAM 2.1

| 对比项 | SAM 2.1 | SAM 1 (ViT-H) | MobileSAM |
|--------|---------|----------------|-----------|
| 发布时间 | 2024.9 | 2023.4 | 2023.6 |
| 架构 | Hiera + Memory Attention | ViT | TinyViT |
| 模型尺寸 | 4 种(39M~224M) | 3 种(86M~641M) | 9.66M |
| 视频分割 | **支持** | 不支持 | 不支持 |
| GPU 要求 | 推荐但可选 | 推荐但可选 | CPU 可用 |
| 许可证 | Apache 2.0 | Apache 2.0 | Apache 2.0 |
| 需要申请 | **不需要** | 不需要 | 不需要 |

**选择理由**：
- SAM 2.1 是 SAM 系列最新正式版（SAM 3 需要申请且必须 GPU）
- 4 种模型尺寸可选，tiny(39M) CPU 也能跑
- 支持图片和视频分割（面试加分）
- Apache 2.0 完全开源，权重直接下载

### 后端：FastAPI

- 原生 async 支持
- 自带 Swagger UI（`/docs`），面试直接展示
- Pydantic 类型校验
- 配合 uv 管理依赖

### 前端：Next.js + TypeScript + Tailwind CSS v4

- **Next.js 15 (App Router)**：React 主流全栈框架，SSR/SSG 能力，环境变量驱动 API 入口
- **TypeScript**：全量类型覆盖，与后端 Pydantic Schema 对齐
- **Tailwind CSS v4**：最新版原子化样式，CSS 变量驱动主题
- **Framer Motion**：专业级动效（页面过渡、mask 列表动画）
- **自定义 Hooks**：`useSegmentation` 封装分割业务逻辑，组件专注 UI

**选择理由**：
- 工程化方案展示全栈能力（面试加分）
- 清晰分层：types → lib → hooks → components → app
- TypeScript + API 层封装体现代码规范

### 包管理：go mod (网关) + uv (后端) + npm (前端)

- 网关 `go mod download` 拉取 chi / zerolog / prometheus client
- 后端 `uv sync` 一键安装，比 pip 快 10-100 倍
- 前端标准 npm 管理，Next.js 生态兼容

## 项目目录结构

```
FastSAM-Demo/
├── gateway/                     # Go 推理网关
│   ├── cmd/gateway/main.go      # 入口、装配、优雅退出
│   ├── internal/
│   │   ├── config/              # YAML 加载 + 字段校验
│   │   ├── handler/             # /api/upload /api/segment /api/health
│   │   ├── pool/                # WorkerPool: 有界队列 + N goroutine + ReverseProxy
│   │   ├── session/             # SessionTable: image_id → worker_id + TTL
│   │   ├── health/              # 周期探活 + 阈值切换
│   │   ├── middleware/          # trace_id + metrics + 访问日志 + recover
│   │   └── metrics/             # 7 个 Prometheus 指标
│   ├── configs/
│   │   ├── gateway.yaml         # docker-compose 形态（按容器名）
│   │   └── gateway.dev.yaml     # 本地形态（按 localhost 端口）
│   ├── Dockerfile               # 多阶段构建，alpine 运行时
│   └── go.mod
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI 入口（trace_id middleware + X-Worker-Id 响应头）
│   │   ├── config.py            # 配置管理（含 worker_id / max_inflight）
│   │   ├── routers/
│   │   │   ├── segment.py       # 分割接口
│   │   │   ├── upload.py        # 上传接口
│   │   │   └── health.py        # 健康检查（返回 worker_id / model_loaded）
│   │   ├── services/
│   │   │   ├── sam_service.py   # SAM 2.1 封装（含 asyncio.Semaphore 兜底）
│   │   │   └── image_service.py # 图片缓存
│   │   ├── schemas/
│   │   │   ├── segment.py       # 分割 Schema
│   │   │   ├── upload.py        # 上传 Schema
│   │   │   └── common.py        # 通用 Schema
│   │   └── utils/
│   │       └── mask_encoder.py  # RLE 编码
│   ├── tests/                   # 单元测试
│   ├── checkpoints/             # 模型权重
│   ├── pyproject.toml           # uv 依赖
│   └── uv.lock
├── frontend/
│   ├── src/
│   │   ├── app/                 # Next.js App Router
│   │   ├── components/          # UI 组件
│   │   ├── hooks/               # 业务逻辑 Hooks（含 410/429 自动恢复）
│   │   ├── lib/                 # API 封装（含错误子类 + 退避重试）+ mask 渲染
│   │   └── types/               # TypeScript 类型
│   ├── package.json
│   └── next.config.ts           # 经 NEXT_PUBLIC_API_URL 指向 Gateway
├── scripts/
│   └── verify-multiworker.sh    # 多 worker 负载均衡 + 粘性路由验证
├── docs/                        # 技术文档
├── docker-compose.yml           # 2 backend + gateway + frontend
├── .env.example
├── start.sh                     # 本地一键启动（含多 worker 形态）
└── README.md
```

## 核心数据流

```
用户操作                前端处理                 Gateway                  worker (FastAPI)
────────              ────────                ──────                  ─────────────
1. 选择图片      ──▶  FormData 上传
                      POST /api/upload     ──▶  选最低负载 worker
                                                流式 ReverseProxy ──▶  SAM 2.1 set_image()
                                                                       预计算 embedding
                                                ModifyResponse 截 ◀──  返回 { image_id, size }
                                                获 image_id 写入
                                                SessionTable
                      接收 UploadResponse   ◀──  透传 body + X-Worker-Id
                      Canvas 绘制图片

2. 点击 (x,y)    ──▶  坐标映射
                      POST /api/segment    ──▶  ReadBody → 查
                      {image_id, points}        SessionTable → 没命中
                                                返 410；命中则路由到
                                                目标 worker        ──▶  复用 embedding
                                                                       SAM 2.1 predict()
                                                                       RLE 编码
                      接收 SegmentResponse  ◀──  透传                ◀──  返回 { masks, scores }
                      RLE 解码 → Canvas
                      mask 列表动画更新

3. 继续点击      ──▶  重复步骤 2（始终命中同一 worker，embedding 缓存命中率 ≈ 100%）
```

### 时序图

```
Browser              Gateway                      worker (FastAPI)           SAM 2.1
  │                    │                                │                       │
  │── POST /upload ───▶│                                │                       │
  │   (multipart)      │── pick least-loaded ──┐         │                       │
  │                    │   stream proxy ───────┴───────▶│── set_image() ───────▶│
  │                    │   ModifyResponse:              │◀─ embedding cached ───│
  │                    │   sessions.Put(id, w)  ◀──────│                       │
  │◀─ {id,w,h} + X-Worker-Id ──────────────────────────│                       │
  │                    │                                │                       │
  │── POST /segment ──▶│                                │                       │
  │   (X-Request-Id)   │── lookup sessions[id] → w ───▶│── predict(pt) ───────▶│
  │                    │                                │◀─ masks, scores ──────│
  │◀─ {masks} + same X-Request-Id ─────────────────────│                       │
```

## 关键设计决策

### 1. Image Embedding 缓存

SAM 2.1 的推理分两步：
- **Image Encoder**（慢）：`set_image()` 约 0.5-3s
- **Mask Decoder**（快）：`predict()` 约 20-100ms

上传时预计算 embedding，后续每次点击只跑 decoder。

### 2. 模型尺寸选择策略

| 环境 | 推荐模型 | 大小 | 速度 |
|------|---------|------|------|
| GPU (RTX 3060+) | hiera_large | 224M | 最快 |
| GPU (入门级) | hiera_base+ | 81M | 快 |
| CPU (面试 Demo) | hiera_tiny | 39M | 可接受 |

### 3. 前端工程化 (Next.js)

- API 入口由 `NEXT_PUBLIC_API_URL` 注入（默认指向 Go Gateway），生产链路不再依赖 Next.js rewrites
- TypeScript 类型与后端 Pydantic Schema 对齐
- 自定义 Hooks 封装业务逻辑，组件只关心 UI
- Framer Motion 提供流畅的交互动效
- `lib/api.ts` 内置 429 退避重试与 410 自动恢复，对应 Gateway 的错误语义

### 4. Gateway 与 worker 的边界

| 关注点 | 归属 | 说明 |
|--------|------|------|
| 流量整形（队列 / 限流 / 路由） | Gateway | Python 不擅长无锁高并发，Go 的 channel 天然表达 |
| 业务推理（embedding / RLE） | worker | 保持 SAM 调用纯粹，便于替换模型 |
| 并发上限 | 双层 | Gateway `max_inflight` + Python `asyncio.Semaphore`，配错也不会爆显存 |
| 会话状态 | Gateway 进程内存 | Phase 3 可下沉到 Redis 让 Gateway 自身无状态 |
| 跨服务 trace | Gateway 入口生成 | `X-Request-Id` 通过 ReverseProxy 透传，backend 注入到 zerolog 字段
