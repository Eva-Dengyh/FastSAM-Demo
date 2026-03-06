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
│  │     useSegmentation Hook (业务逻辑层)           │     │
│  └──────────────────┬─────────────────────────────┘     │
│                     │ API 调用 (/api/*)                  │
└─────────────────────┼───────────────────────────────────┘
                      │ Next.js rewrites 代理
┌─────────────────────┼───────────────────────────────────┐
│                FastAPI Server (uv managed)                │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Upload   │  │ Segment      │  │ SAM 2.1          │   │
│  │ Handler  │  │ Handler      │──▶│ ImagePredictor   │   │
│  └──────────┘  └──────────────┘  └──────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │         Image Cache (embedding + 原图)            │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

## 技术选型

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

- **Next.js 15 (App Router)**：React 主流全栈框架，SSR/SSG 能力，rewrites API 代理
- **TypeScript**：全量类型覆盖，与后端 Pydantic Schema 对齐
- **Tailwind CSS v4**：最新版原子化样式，CSS 变量驱动主题
- **Framer Motion**：专业级动效（页面过渡、mask 列表动画）
- **自定义 Hooks**：`useSegmentation` 封装分割业务逻辑，组件专注 UI

**选择理由**：
- 工程化方案展示全栈能力（面试加分）
- 清晰分层：types → lib → hooks → components → app
- TypeScript + API 层封装体现代码规范

### 包管理：uv (后端) + npm (前端)

- 后端 `uv sync` 一键安装，比 pip 快 10-100 倍
- 前端标准 npm 管理，Next.js 生态兼容

## 项目目录结构

```
FastSAM-Demo/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI 入口
│   │   ├── config.py            # 配置管理
│   │   ├── routers/
│   │   │   ├── segment.py       # 分割接口
│   │   │   ├── upload.py        # 上传接口
│   │   │   └── health.py        # 健康检查
│   │   ├── services/
│   │   │   ├── sam_service.py   # SAM 2.1 模型封装
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
│   │   ├── hooks/               # 业务逻辑 Hooks
│   │   ├── lib/                 # 工具层（API、mask 渲染）
│   │   └── types/               # TypeScript 类型
│   ├── package.json
│   └── next.config.ts           # API 代理配置
├── docs/                        # 技术文档
├── .env.example
├── start.sh                     # 一键启动脚本
└── README.md
```

## 核心数据流

```
用户操作                    前端处理                         后端处理
────────                  ────────                        ────────
1. 选择图片          ──▶  FormData 上传
                          POST /api/upload            ──▶  保存图片到内存
                          (Next.js rewrites 代理)           SAM 2.1 set_image()
                                                           预计算 image embedding
                          接收 UploadResponse          ◀──  返回 { image_id, size }
                          Canvas 绘制图片

2. 点击图片 (x,y)    ──▶  坐标映射（Canvas→原图）
                          POST /api/segment            ──▶  复用缓存的 embedding
                          {image_id, points}                SAM 2.1 predict()
                          (类型安全的 API 调用)               生成 mask → RLE 编码
                          接收 SegmentResponse          ◀──  返回 { masks, scores }
                          RLE 解码 → Canvas 渲染
                          mask 列表动画更新

3. 继续点击          ──▶  重复步骤 2（多 mask 叠加）
```

### 时序图

```
Browser (Next.js)              FastAPI                     SAM 2.1
  │                              │                           │
  │── POST /api/upload ─────────▶│                           │
  │   (multipart/form-data)      │── set_image() ──────────▶│
  │   (via Next.js rewrites)     │◀─ embedding cached ──────│
  │◀─ {image_id, size} ─────────│                           │
  │                              │                           │
  │── POST /api/segment ────────▶│                           │
  │   {image_id, x, y}          │── predict(point) ────────▶│
  │   (typed API call)           │◀─ masks, scores ─────────│
  │◀─ {masks: [...]} ───────────│                           │
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

- Next.js rewrites 代理 API 请求，消除 CORS 问题
- TypeScript 类型与后端 Pydantic Schema 对齐
- 自定义 Hooks 封装业务逻辑，组件只关心 UI
- Framer Motion 提供流畅的交互动效
