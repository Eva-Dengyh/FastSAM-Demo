# 面试展示策略

## 2 分钟 Demo 脚本

### 第 1 步：一句话介绍（10 秒）

> "这是一个交互式图像分割 Demo。用的是 Meta 开源的 SAM 2.1 模型，点击图片上的任意物体就能实时分割出来。"

### 第 2 步：现场演示（60 秒）

1. 上传一张室内场景图
2. 点击一个物体 → 蓝色高亮 → "点一下就分割出来了"
3. 点击另一个物体 → 红色高亮 → "支持多物体选择，不同颜色区分"
4. 点击已选区域 → 取消 → "也可以取消"

### 第 3 步：技术亮点（50 秒）

> "几个技术点：
> 1. **两阶段推理**：上传时预计算 image embedding（~1s），后续每次点击只跑 mask decoder（~30ms），所以后续交互非常快
> 2. **SAM 2.1 比 SAM 1 更高效**：Hiera 编码器替代了 ViT，同等精度下参数量更小、速度更快
> 3. **Mask 用 RLE 压缩传输**：512×512 的 mask 从 262KB 压缩到 <5KB
> 4. 前端用 React + TailwindCSS CDN，单 HTML 文件，零构建
> 5. 后端用 uv 管理依赖，`uv sync` 一键安装"

## 技术话术

### "为什么用 SAM 2.1 不用 SAM 3？"

> "SAM 3 确实更强——支持文本 prompt 分割。但它需要 HuggingFace 人工审批且必须 GPU。SAM 2.1 完全开放、Apache 2.0、权重直接下载、CPU 也能跑。对面试 Demo 来说，可用性比功能丰富更重要。"

### "前端为什么用 CDN 引入 React？"

> "Demo 追求快速可演示。CDN + Babel 方式整个前端一个 HTML 文件，打开即用。但代码是组件化的 React 结构。生产环境会用 Vite 构建。"

### "为什么用 uv？"

> "uv 是 Astral（Ruff 作者）做的 Python 包管理器，Rust 写的，比 pip 快 10-100 倍。有 lockfile 确保可复现，内置虚拟环境管理。是 Python 社区最受关注的新工具。"

### "性能怎么优化的？"

> "核心是 image embedding 缓存。SAM 的 image encoder 是最耗时的部分，上传时算一次缓存起来，后续不管点哪里都只跑 mask decoder。响应从秒级降到毫秒级。"

## 常见面试 Q&A

### Q: 能用在实际产品中吗？

> "核心分割逻辑完全可以。产品化需要加：用户认证、图片持久化存储（OSS）、异步推理队列、GPU 推理服务（Triton）、前端框架化。"

### Q: SAM 2.1 能做视频分割？

> "对，SAM 2.1 原生支持视频分割。它有 Memory Attention 机制，在帧间传递分割信息，不需要每帧都点击。这也是 SAM 2 相比 SAM 1 的最大升级。"

### Q: 如何支持并发？

> "当前单进程 Demo。生产方案：Gunicorn 多 worker + 推理请求用线程池不阻塞。大规模场景把推理拆成独立服务，通过 gRPC 调用。"

### Q: 模型怎么选？

> "SAM 2.1 有 4 种尺寸。tiny(39M) CPU 够用，large(224M) 精度最高。根据部署环境的 GPU 显存选择。Demo 用 tiny 就够了。"

## 延伸方向

- **视频分割追踪**：SAM 2.1 原生支持，首帧点击后续自动追踪
- **Inpainting**：分割 + Stable Diffusion 做区域替换
- **自动分割**：SAM 2.1 的 Automatic Mask Generator 全图分割
- **商业场景**：电商抠图、室内设计、医学影像、自动驾驶标注

## 展示准备清单

- [ ] 后端服务正常 (`curl http://localhost:8000/api/health`)
- [ ] 准备 2-3 张测试图片
- [ ] 首次请求已预热
- [ ] Swagger 文档可访问 (http://localhost:8000/docs)
- [ ] 录屏备用（30 秒 Demo 视频）
