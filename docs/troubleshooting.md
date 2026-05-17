# 常见问题排查

## 1. uv 相关

### `uv: command not found`

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc  # 或 source ~/.zshrc
```

### `uv sync` 失败

```bash
uv cache clean && uv sync

# 网络问题使用镜像
UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple uv sync
```

---

## 2. Node.js / 前端相关

### `node: command not found`

安装 Node.js 18+：

```bash
# macOS (Homebrew)
brew install node

# 或使用 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 18
```

### `npm install` 失败

```bash
# 清除缓存重试
rm -rf node_modules package-lock.json
npm install

# 网络问题使用镜像
npm config set registry https://registry.npmmirror.com
npm install
```

### 前端端口被占用

```bash
# 检查占用
lsof -i :3000

# 使用其他端口
npm run dev -- --port 3001
```

---

## 3. SAM 2 安装问题

### `Failed to build the SAM 2 CUDA extension`

**可以忽略**。这只影响部分后处理功能，不影响主要的分割结果。

如果想解决，安装 CUDA Toolkit：

```bash
nvcc --version
# 如果没有，安装对应版本的 CUDA Toolkit
```

### `ModuleNotFoundError: No module named 'sam2'`

```bash
cd backend
uv sync  # pyproject.toml 中已包含 sam2 依赖

# 或手动安装
git clone https://github.com/facebookresearch/sam2.git /tmp/sam2
cd /tmp/sam2 && pip install -e .
```

---

## 4. 模型权重问题

### 下载失败

权重托管在 Meta 的 CDN，无需认证。如果下载慢：

```bash
# 使用 curl 断点续传
curl -C - -L -o checkpoints/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
```

### 权重文件损坏

```bash
ls -lh checkpoints/sam2.1_hiera_tiny.pt
# tiny 应约 39MB, small 约 46MB, base+ 约 81MB, large 约 224MB

# 重新下载
rm checkpoints/sam2.1_hiera_tiny.pt
wget -O checkpoints/sam2.1_hiera_tiny.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
```

---

## 5. GPU / CUDA 问题

### 没有 GPU 也想跑

完全可以，SAM 2.1 支持 CPU 推理。使用 tiny 模型：

```env
MODEL_CFG=configs/sam2.1/sam2.1_hiera_t.yaml
CHECKPOINT_PATH=checkpoints/sam2.1_hiera_tiny.pt
```

CPU 上 `set_image` 约 2s，`predict` 约 100ms，Demo 够用。

### PyTorch 版本不匹配

```bash
# SAM 2.1 需要 PyTorch 2.5.1+
uv run python -c "import torch; print(torch.__version__)"

# 如果版本低，升级
uv pip install torch>=2.5.1 torchvision>=0.20.1
```

---

## 6. API 代理 / 网络问题

### 前端无法连接后端

确认整条链路：前端 → Gateway → backend。

```bash
# 1. backend 直连
curl http://localhost:8000/api/health   # worker-0
curl http://localhost:8002/api/health   # worker-1

# 2. Gateway 自检
curl http://localhost:8080/api/health
# 期望: healthy_workers >= 1
```

前端通过 `NEXT_PUBLIC_API_URL` 指向 Gateway，本地开发 `start.sh` 已自动注入；如果手动启动，确认环境变量：

```bash
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev
```

---

## 7. Go / Gateway 相关

### `go: command not found`

安装 Go 1.22+：

```bash
# macOS
brew install go

# 其他平台见 https://go.dev/dl/
```

### `go mod download` 网络失败

```bash
# 走代理
export GOPROXY=https://goproxy.cn,direct
cd gateway && go mod download
```

### Gateway 启动后 `healthy_workers: 0`

最常见原因是 backend 未起或地址不对。

```bash
# 1. 看 Gateway 日志里 health 探活的报错
#    (zerolog: "health probe failed")

# 2. 校对配置里的 worker URL 与实际 backend 监听地址
cat gateway/configs/gateway.dev.yaml   # 本地用
cat gateway/configs/gateway.yaml       # 容器用

# 3. 直连 backend 看是否响应
curl http://localhost:8000/api/health
```

通常需要等 ~10-15s（每个 worker 连续 2 次成功探活）才会上线。

### 经常出现 429 QUEUE_FULL

调大 `gateway.yaml` 里的 `workers[].max_inflight` 或 `max_queue`；前端 `lib/api.ts` 已对 429 做退避重试，业务层不会看到。

### segment 返回 410 SESSION_EXPIRED

`image_id` 在 Gateway 的会话表里找不到。常见诱因：

- 命中的 worker 被摘除（看 Gateway 日志 `worker marked unhealthy`）
- 超出 `session_ttl_seconds`
- Gateway 重启（会话存在进程内存）

前端层会自动引导用户重新上传，无需手动处理。

---

## 8. 坐标映射

### 点击和分割位置不对应

在浏览器控制台检查 SegmentCanvas 的坐标计算。常见原因：高 DPI 屏幕需要 `devicePixelRatio` 修正、图片居中偏移计算错误。

---

## 9. 后端启动

### `Address already in use`

```bash
lsof -i :8000     # 或 :8002 / :8080
kill -9 <PID>
# 或换端口
uv run uvicorn app.main:app --port 8001
```

### 首次启动慢

模型在 lifespan 中预加载。tiny 模型首次加载约 2-5 秒，后续请求正常。

---

## 10. 诊断脚本

```bash
uv run python diagnose.py
```

```python
# backend/diagnose.py
import sys

def check(name, func):
    try:
        print(f"[OK] {name}: {func()}")
    except Exception as e:
        print(f"[FAIL] {name}: {e}")

check("Python", lambda: sys.version.split()[0])
check("PyTorch", lambda: __import__('torch').__version__)
check("CUDA", lambda: __import__('torch').cuda.is_available())
check("SAM 2", lambda: __import__('sam2') and "installed")
check("FastAPI", lambda: __import__('fastapi').__version__)

import os
ckpt = "checkpoints/sam2.1_hiera_tiny.pt"
check("Checkpoint", lambda: f"exists={os.path.exists(ckpt)}, "
      f"size={os.path.getsize(ckpt)//1024//1024}MB" if os.path.exists(ckpt) else "missing")
```
