# 系统架构设计

## 项目概述

FastSAM-Demo 是一个交互式图像分割 Web 应用。用户上传图片后，通过点击目标物体，后端调用 SAM 2.1 模型进行实时分割，前端使用 Canvas 将 mask 以半透明高亮叠加在原图上。

## 系统架构图

```
┌───────────────────────────────────────────────────────┐
│              Browser (React + TailwindCSS CDN)         │
│                                                        │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────┐  │
│  │ ImageUpload │  │  Click     │  │  CanvasOverlay  │  │
│  │ Component   │  │  Handler   │  │  (mask 渲染)     │  │
│  └─────┬──────┘  └─────┬──────┘  └────────▲────────┘  │
│        │               │                   │           │
└────────┼───────────────┼───────────────────┼───────────┘
         │               │ HTTP POST         │ JSON
         │               │                   │
┌────────┼───────────────┼───────────────────┼───────────┐
│                  FastAPI Server (uv managed)            │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Upload   │  │ Segment      │  │ SAM 2.1          │  │
│  │ Handler  │  │ Handler      │──▶│ ImagePredictor   │  │
│  └──────────┘  └──────────────┘  └──────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │         Image Cache (embedding + 原图)            │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
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
| 安装方式 | `pip install -e .` | `pip install segment-anything` | `pip install mobile-sam` |

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

### 前端：React + TailwindCSS（CDN + Babel）

```html
<script src="https://cdn.jsdelivr.net/npm/react@19/umd/react.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@19/umd/react-dom.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
```

**选择理由**：
- 组件化管理复杂交互状态
- TailwindCSS 快速构建美观 UI
- CDN 方式零构建，打开即用
- 单 HTML 文件，面试官一目了然

### 包管理：uv

- `uv sync` 一键安装
- 比 pip 快 10-100 倍
- 内置虚拟环境 + lockfile

## 项目目录结构

```
FastSAM-Demo/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI 入口
│   │   ├── config.py            # 配置管理
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   ├── segment.py       # 分割接口（point/box）
│   │   │   └── upload.py        # 上传接口
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── sam_service.py   # SAM 2.1 模型封装
│   │   │   └── image_service.py # 图片缓存
│   │   ├── schemas/
│   │   │   └── segment.py       # Pydantic 模型
│   │   └── utils/
│   │       └── mask_encoder.py  # RLE 编码
│   ├── checkpoints/             # 模型权重
│   ├── pyproject.toml           # uv 依赖
│   └── uv.lock
├── frontend/
│   └── index.html               # React + TailwindCSS 单文件
├── docs/
├── docker-compose.yml
├── .env.example
└── README.md
```

## 核心数据流

```
用户操作                    前端处理                     后端处理
────────                  ────────                    ────────
1. 选择图片          ──▶  FormData 上传
                          POST /api/upload        ──▶  保存图片到内存
                                                       SAM 2.1 set_image()
                                                       预计算 image embedding
                          接收 image_id           ◀──  返回 { image_id, size }
                          Canvas 绘制图片

2. 点击图片 (x,y)    ──▶  坐标映射（Canvas→原图）
                          POST /api/segment       ──▶  复用缓存的 embedding
                          {image_id, points}           SAM 2.1 predict()
                                                       生成 mask → RLE 编码
                          接收 mask 数据          ◀──  返回 { masks, scores }
                          解码 RLE → Canvas 渲染

3. 继续点击          ──▶  重复步骤 2（多 mask 叠加）
```

### 时序图

```
Browser                        FastAPI                     SAM 2.1
  │                              │                           │
  │── POST /api/upload ─────────▶│                           │
  │   (multipart/form-data)      │── set_image() ──────────▶│
  │                              │◀─ embedding cached ──────│
  │◀─ {image_id, size} ─────────│                           │
  │                              │                           │
  │── POST /api/segment ────────▶│                           │
  │   {image_id, x, y}          │── predict(point) ────────▶│
  │                              │◀─ masks, scores ─────────│
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

### 3. 前端单文件 React

通过 CDN 引入 React + Babel + TailwindCSS，整个前端就是一个 `index.html`：
- 无需 Node.js/npm/webpack
- 面试官 `open index.html` 直接看界面
- 组件化结构展示 React 能力
