# FastSAM-Demo

基于 SAM 2.1（Segment Anything Model 2）的交互式图像分割 Web 应用。用户上传图片后，点击任意物体即可实时分割并高亮显示。

## 技术栈

- **后端**: FastAPI + SAM 2.1（Meta 最新分割模型，Apache 2.0 开源）
- **前端**: React + TailwindCSS（CDN 引入，单 HTML 文件，零构建）
- **模型**: SAM 2.1 Hiera — 支持图片/视频分割，无需申请，直接下载
- **包管理**: uv

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

# 安装依赖（使用 uv）
cd backend
uv sync

# 下载模型权重（tiny 39MB，无需认证）
mkdir -p checkpoints
wget -O checkpoints/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt

# 启动后端
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# 打开前端（新终端）
open ../frontend/index.html
```

详细步骤见 [docs/quickstart.md](docs/quickstart.md)。

## 项目结构

```
FastSAM-Demo/
├── backend/              # FastAPI 后端
│   ├── app/              # 应用代码
│   ├── checkpoints/      # 模型权重
│   ├── pyproject.toml    # uv 依赖管理
│   └── uv.lock
├── frontend/             # React + TailwindCSS (CDN)
│   └── index.html        # 单文件前端
├── docs/                 # 完整技术文档
└── docker-compose.yml
```

## 文档

| 文档 | 说明 |
|------|------|
| [架构设计](docs/architecture.md) | 系统架构、技术选型、数据流 |
| [快速启动](docs/quickstart.md) | 5 分钟跑通指南 |
| [API 文档](docs/api.md) | RESTful 接口详细说明 |
| [前端文档](docs/frontend.md) | React CDN + TailwindCSS 实现 |
| [后端文档](docs/backend.md) | FastAPI + SAM 2.1 推理服务 |
| [模型文档](docs/model.md) | SAM 2.1 架构、模型对比、性能基准 |
| [部署方案](docs/deployment.md) | 本地 / Colab / Docker |
| [面试指南](docs/interview-guide.md) | Demo 脚本、技术话术 |
| [问题排查](docs/troubleshooting.md) | 常见问题与解决方案 |

## License

MIT
