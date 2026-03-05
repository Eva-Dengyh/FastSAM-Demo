# 快速启动指南

5 分钟内跑通完整的图像分割 Demo。

## 环境要求

- Python 3.10+
- uv（Python 包管理器）
- 现代浏览器（Chrome / Firefox / Safari）
- GPU 可选（推荐，但 tiny 模型 CPU 也能跑）

## 第一步：安装 uv

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# 验证
uv --version
```

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

## 第六步：启动后端

```bash
cd backend
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

看到以下输出说明成功：

```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Loading SAM 2.1 model (hiera_tiny)...
INFO:     Model loaded on cuda  # 或 cpu
```

验证：访问 http://localhost:8000/docs 查看 Swagger 文档。

## 第七步：打开前端

```bash
# 方式一：直接打开
open frontend/index.html      # macOS
xdg-open frontend/index.html  # Linux

# 方式二：HTTP 服务（推荐，避免 CORS）
cd frontend && python -m http.server 3000
# 访问 http://localhost:3000
```

## 开始使用

1. 点击「上传图片」选择一张图片
2. 点击图片上的目标物体
3. 等待 ~100ms，分割结果以半透明高亮显示
4. 继续点击其他物体叠加更多 mask
5. 点击「清除」重置

## 常见启动问题

| 问题 | 解决方案 |
|------|----------|
| `uv: command not found` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| 模型下载失败 | 检查网络，或使用代理下载 |
| CORS 跨域报错 | 用 HTTP 服务打开前端，而非 `file://` |
| 首次请求慢 | 模型启动时已预加载，首次 `set_image` 需 ~1-3s |
| `Failed to build SAM 2 CUDA extension` | 可忽略，不影响主要功能 |

更多问题见 [troubleshooting.md](./troubleshooting.md)。
