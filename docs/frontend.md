# 前端技术文档

前端采用 Next.js 15 (App Router) + TypeScript + Tailwind CSS v4 构建，配合 Framer Motion 动效和 Lucide React 图标库。

## 技术栈

| 组件 | 版本 | 用途 |
|------|------|------|
| Next.js | 15+ | React 全栈框架 (App Router) |
| TypeScript | 5+ | 类型安全 |
| Tailwind CSS | v4 | 原子化样式 |
| Framer Motion | 11+ | 动效库 |
| Lucide React | latest | 图标库 |

## 项目结构

```
frontend/
├── package.json
├── next.config.ts          # API 代理配置
├── tsconfig.json
├── public/
├── src/
│   ├── app/
│   │   ├── layout.tsx      # 根布局 + 字体 + 全局样式
│   │   ├── page.tsx        # 主页面（客户端组件）
│   │   └── globals.css     # Tailwind + CSS 变量 + 网格背景
│   ├── components/
│   │   ├── Header.tsx      # 顶栏（Logo + 状态 + GitHub）
│   │   ├── ImageUploader.tsx  # 拖拽上传区
│   │   ├── SegmentCanvas.tsx  # Canvas 画布（图片 + mask 渲染）
│   │   ├── ControlPanel.tsx   # 右侧控制面板
│   │   ├── MaskList.tsx       # mask 结果列表
│   │   └── StatusBadge.tsx    # 连接状态徽章
│   ├── hooks/
│   │   ├── useSegmentation.ts # 分割业务逻辑
│   │   └── useHealthCheck.ts  # 后端健康检查轮询
│   ├── lib/
│   │   ├── api.ts          # API 请求封装（类型安全）
│   │   ├── mask.ts         # RLE 解码 + Canvas 渲染
│   │   └── constants.ts    # 常量配置
│   └── types/
│       └── index.ts        # TypeScript 类型定义
```

## 架构设计

### 分层架构

```
types/       → 类型定义（与后端 Schema 对齐）
lib/         → 工具层（API 封装、mask 渲染、常量）
hooks/       → 业务逻辑层（状态管理、副作用）
components/  → UI 组件层（纯展示 + 交互）
app/         → 页面层（组合组件）
```

### API 代理

通过 Next.js rewrites 将 `/api/*` 代理到后端，避免 CORS 问题：

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8000/api/:path*',
      },
    ];
  },
};
```

## 核心组件

### useSegmentation — 分割业务 Hook

集中管理上传、分割、清除等状态和操作：

```typescript
export function useSegmentation() {
  const [imageId, setImageId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [masks, setMasks] = useState<MaskResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (file: File) => { /* ... */ }, []);
  const segment = useCallback(async (x: number, y: number) => { /* ... */ }, [imageId, loading]);
  const clearMasks = useCallback(() => setMasks([]), []);
  const removeMask = useCallback((index: number) => { /* ... */ }, []);
  const reset = useCallback(() => { /* ... */ }, [imageUrl]);

  return { imageUrl, imageSize, masks, loading, error, upload, segment, clearMasks, removeMask, reset, clearError };
}
```

### SegmentCanvas — Canvas 画布

负责图片渲染、mask 叠加、点击坐标映射：

```typescript
interface SegmentCanvasProps {
  imageUrl: string;
  imageSize: ImageSize;
  masks: MaskResult[];
  onPointClick: (x: number, y: number) => void;
  loading: boolean;
}
```

### API 层 — 类型安全封装

```typescript
export async function uploadImage(file: File): Promise<UploadResponse> { /* ... */ }
export async function segmentImage(imageId: string, points: PointInput[]): Promise<SegmentResponse> { /* ... */ }
export async function checkHealth(): Promise<HealthResponse> { /* ... */ }
```

### Mask 渲染函数

```typescript
export function renderMask(
  ctx: CanvasRenderingContext2D,
  rle: RLEMask,
  transform: CanvasTransform,
  color: [number, number, number],
  opacity = MASK_OPACITY,
): void {
  // RLE 解码 → 临时 Canvas → 主 Canvas 绘制
}
```

## 坐标映射

```
Canvas 点击 (clientX, clientY)
    │  减去 canvas.getBoundingClientRect()
    ▼
Canvas 内坐标
    │  乘以 (canvas.width / rect.width) — CSS 缩放修正
    ▼
Canvas 像素坐标
    │  减去 offset，除以 scale — 居中偏移 + 缩放
    ▼
原图坐标 (origX, origY) → 发送给后端
```

## 视觉设计

暗黑科技感主题：

- 深色背景 `#0a0a0f` + 微妙网格纹理
- 霓虹蓝 `#00d4ff` + 紫色高光 `#a855f7`
- 毛玻璃卡片 (`backdrop-blur` + 半透明边框)
- JetBrains Mono (标题) + Geist Sans (正文)
- Framer Motion 页面加载动画 + mask 列表过渡

## 页面布局

```
┌──────────────────────────────────────────────────┐
│  FastSAM    Interactive Segmentation    [●] [GH] │
├──────────────────────────────────────────────────┤
│                                                   │
│  ┌─────────────────────────┐ ┌─────────────────┐ │
│  │                         │ │ 操作指南         │ │
│  │     Canvas 画布          │ │                 │ │
│  │   (图片 + mask 叠加)     │ │ 分割结果 [3]    │ │
│  │                         │ │ ● 区域 1  95.2% │ │
│  │                         │ │ ● 区域 2  87.1% │ │
│  └─────────────────────────┘ │ ● 区域 3  92.4% │ │
│                               │                 │ │
│                               │ [清除] [重新上传]│ │
│                               └─────────────────┘ │
├──────────────────────────────────────────────────┤
│      Next.js  TypeScript  Tailwind  FastAPI  SAM │
└──────────────────────────────────────────────────┘
```

## 启动方式

```bash
cd frontend
npm install
npm run dev     # 开发模式 → http://localhost:3000
npm run build   # 生产构建
npm start       # 生产启动
```
