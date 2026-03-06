# FastSAM-Demo

基于 SAM 2.1（Segment Anything Model 2）的交互式图像分割 Web 应用。用户上传图片后，点击任意物体即可实时分割并高亮显示。

## 技术栈

- **后端**: FastAPI + SAM 2.1（Meta 分割模型，Apache 2.0 开源）
- **前端**: Next.js 15 + TypeScript + Tailwind CSS v4 + Framer Motion
- **模型**: SAM 2.1 Hiera — 支持图片/视频分割，无需申请，直接下载
- **包管理**: uv (后端) + npm (前端)

## 核心特性

- **点击即分割**: click-to-segment 交互，毫秒级响应
- **多模型选择**: tiny(39M) / small(46M) / base+(81M) / large(224M)
- **CPU/GPU 双模式**: tiny 模型 CPU 也能跑
- **多物体选择**: 不同颜色标注多个分割区域
- **RLE 压缩传输**: mask 数据压缩率 > 98%
- **无需申请**: 模型权重直接下载，Apache 2.0 许可

## 快速开始

```bash
# 克隆项目
git clone https://github.com/Eva-Dengyh/FastSAM-Demo.git
cd FastSAM-Demo

# 一键启动（自动安装依赖 + 下载模型 + 启动前后端）
./start.sh
```

或手动启动：

```bash
# 安装后端依赖
cd backend && uv sync

# 下载模型权重（tiny 39MB，无需认证）
mkdir -p checkpoints
wget -O checkpoints/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt

# 启动后端
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# 安装前端依赖并启动（新终端）
cd ../frontend && npm install && npm run dev
```

前端 http://localhost:3000 · 后端 API 文档 http://localhost:8000/docs

详细步骤见 [docs/quickstart.md](docs/quickstart.md)。

## 项目结构

```
FastSAM-Demo/
├── backend/              # FastAPI 后端
│   ├── app/              # 应用代码 (routers/services/schemas/utils)
│   ├── tests/            # 单元测试
│   ├── checkpoints/      # 模型权重
│   ├── pyproject.toml    # uv 依赖管理
│   └── uv.lock
├── frontend/             # Next.js + TypeScript
│   ├── src/
│   │   ├── app/          # App Router 页面
│   │   ├── components/   # UI 组件
│   │   ├── hooks/        # 业务逻辑 Hooks
│   │   ├── lib/          # API 封装 + 工具函数
│   │   └── types/        # TypeScript 类型定义
│   ├── next.config.ts    # API 代理配置
│   └── package.json
├── docs/                 # 完整技术文档
├── start.sh              # 一键启动脚本
└── .env.example
```

## 文档

| 文档 | 说明 |
|------|------|
| [架构设计](docs/architecture.md) | 系统架构、技术选型、数据流 |
| [快速启动](docs/quickstart.md) | 5 分钟跑通指南 |
| [API 文档](docs/api.md) | RESTful 接口详细说明 |
| [前端文档](docs/frontend.md) | Next.js + TypeScript 前端实现 |
| [后端文档](docs/backend.md) | FastAPI + SAM 2.1 推理服务 |
| [模型文档](docs/model.md) | SAM 2.1 架构、模型对比、性能基准 |
| [部署方案](docs/deployment.md) | 本地 / Colab / Docker |
| [面试指南](docs/interview-guide.md) | Demo 脚本、技术话术 |
| [问题排查](docs/troubleshooting.md) | 常见问题与解决方案 |

## License

MIT
