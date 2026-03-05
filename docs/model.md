# 模型技术文档

## SAM 2.1 简介

SAM 2（Segment Anything Model 2）是 Meta FAIR 于 2024 年发布的图像和视频分割基础模型。SAM 2.1 是 2024 年 9 月发布的改进版本，包含优化的 checkpoint 和更好的性能。

### 核心特点

- 统一处理图片和视频分割（将图片视为单帧视频）
- Hiera 视觉编码器（比 SAM 1 的 ViT 更高效）
- Streaming Memory 机制实现实时视频处理
- 4 种模型尺寸适配不同场景
- Apache 2.0 完全开源，权重直接下载

## 架构

```
┌──────────────────────────────────────────────────────┐
│                     SAM 2.1 架构                      │
│                                                       │
│  ┌─────────────────┐                                  │
│  │  Hiera Encoder   │◄── 图片/视频帧                  │
│  │  (图像编码器)     │                                  │
│  └────────┬─────────┘                                  │
│           │                                            │
│           ▼                                            │
│  ┌─────────────────┐    ┌──────────────────┐          │
│  │ Image Embedding │    │ Prompt Encoder   │          │
│  │                 │    │ (点/框/mask)       │          │
│  └────────┬────────┘    └────────┬─────────┘          │
│           │                      │                     │
│           ▼                      ▼                     │
│  ┌──────────────────────────────────────────┐         │
│  │           Mask Decoder                    │         │
│  │  输出: masks + scores + logits            │         │
│  └──────────────────────────────────────────┘         │
│                                                       │
│  ┌──────────────────────────────────────────┐         │
│  │     Memory Attention (视频模式)            │         │
│  │     跨帧传递分割信息                       │         │
│  └──────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────┘
```

## SAM 2.1 Checkpoint 对比

| 模型 | 参数量 | 速度(FPS) | SA-V test (J&F) | MOSE val (J&F) |
|------|--------|----------|-----------------|----------------|
| **sam2.1_hiera_tiny** | **38.9M** | **91.2** | 76.5 | 71.8 |
| sam2.1_hiera_small | 46M | 84.8 | 76.6 | 73.5 |
| sam2.1_hiera_base_plus | 80.8M | 64.1 | 78.2 | 73.7 |
| sam2.1_hiera_large | 224.4M | 39.5 | 79.5 | 74.6 |

> 速度在 A100 GPU 上测量。

### 模型选择建议

| 场景 | 推荐模型 | 理由 |
|------|---------|------|
| 面试 Demo (CPU) | tiny | 最小最快，CPU 可用 |
| 面试 Demo (GPU) | small 或 base+ | 精度速度均衡 |
| 追求精度 | large | 最高精度 |
| 视频分割 | small+ | 需要足够速度保证实时性 |

## SAM 2.1 vs SAM 1 对比

| 指标 | SAM 2.1 | SAM 1 (ViT-H) | SAM 1 (ViT-B) |
|------|---------|----------------|----------------|
| 架构 | Hiera + Memory | ViT-H | ViT-B |
| 参数量 | 39M~224M | 641M | 91M |
| 视频分割 | 支持 | 不支持 | 不支持 |
| 图片分割 | 支持 | 支持 | 支持 |
| 推理速度 | 更快（Hiera 高效） | 慢 | 中等 |
| 训练数据 | SA-1B + SA-V | SA-1B | SA-1B |
| 许可证 | Apache 2.0 | Apache 2.0 | Apache 2.0 |

SAM 2.1 在更少参数量下实现了更好的图片分割效果，同时新增视频分割能力。

## Prompt 模式

### 1. Point Prompt（本项目使用）

```python
predictor.set_image(image)
masks, scores, logits = predictor.predict(
    point_coords=np.array([[500, 300]]),
    point_labels=np.array([1]),  # 1=前景
    multimask_output=True,       # 返回 3 个候选
)
```

### 2. Box Prompt

```python
masks, scores, logits = predictor.predict(
    box=np.array([100, 150, 500, 450]),  # [x1, y1, x2, y2]
)
```

### 3. 多点 + 背景点

```python
masks, scores, logits = predictor.predict(
    point_coords=np.array([[500, 300], [100, 100]]),
    point_labels=np.array([1, 0]),  # 1=前景, 0=背景
)
```

### 4. Multimask Output

当 `multimask_output=True` 时返回 3 个候选 mask：
- **mask 0**: 子部分（如桌腿）
- **mask 1**: 部分（如桌子）
- **mask 2**: 整体（如桌子+椅子）

取 score 最高的即可。

## 模型权重下载

所有权重**无需注册，直接下载**：

```bash
# tiny (38.9MB) - 推荐 Demo
wget https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt

# small (46MB)
wget https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt

# base+ (80.8MB)
wget https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt

# large (224.4MB)
wget https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt
```

或通过 HuggingFace（同样无需申请）：

```python
predictor = SAM2ImagePredictor.from_pretrained("facebook/sam2.1-hiera-tiny")
```

## 推理性能基准

### Image Encoder / set_image()

| 模型 | GPU (A100) | GPU (RTX 3060) | CPU (M1) |
|------|-----------|---------------|----------|
| tiny | ~50ms | ~150ms | ~2s |
| small | ~70ms | ~200ms | ~3s |
| base+ | ~120ms | ~350ms | ~5s |
| large | ~200ms | ~600ms | ~10s |

### Mask Decoder / predict()

| 环境 | 耗时 |
|------|------|
| GPU | ~10-30ms |
| CPU | ~50-100ms |

### 显存占用

| 模型 | GPU 显存 |
|------|---------|
| tiny | ~500 MB |
| small | ~600 MB |
| base+ | ~1 GB |
| large | ~2.5 GB |
