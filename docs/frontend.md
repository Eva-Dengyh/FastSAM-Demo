# 前端技术文档

前端采用 React + TailwindCSS 通过 CDN 引入，整个前端是一个 `index.html` 文件。

## CDN 引入

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FastSAM Demo</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/react@19/umd/react.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@19/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    // React 代码
  </script>
</body>
</html>
```

## 组件结构

```
App
├── Header               # 标题、模型连接状态
├── ImageUploader        # 拖拽/点击上传
├── CanvasOverlay        # Canvas（图片 + mask 渲染）
├── ToolBar              # 清除、重新上传按钮
└── StatusBar            # mask 数量、提示信息
```

## 核心组件

### App - 主组件

```jsx
const { useState, useEffect, useRef, useCallback } = React;
const API_BASE = 'http://localhost:8000';

function App() {
  const [imageId, setImageId] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageSize, setImageSize] = useState(null);
  const [masks, setMasks] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleUpload = useCallback(async (file) => {
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    setImageId(data.image_id);
    setImageSize({ width: data.width, height: data.height });
    setImageUrl(URL.createObjectURL(file));
    setMasks([]);
    setLoading(false);
  }, []);

  const handlePointSegment = useCallback(async (x, y) => {
    if (!imageId || loading) return;
    setLoading(true);
    const res = await fetch(`${API_BASE}/api/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_id: imageId, points: [{ x, y, label: 1 }] }),
    });
    const data = await res.json();
    if (data.masks.length > 0) {
      setMasks(prev => [...prev, data.masks[0]]);
    }
    setLoading(false);
  }, [imageId, loading]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-8">
        {!imageUrl ? (
          <ImageUploader onUpload={handleUpload} loading={loading} />
        ) : (
          <>
            <CanvasOverlay
              imageUrl={imageUrl}
              imageSize={imageSize}
              masks={masks}
              onPointClick={handlePointSegment}
              loading={loading}
            />
            <ToolBar
              onClear={() => setMasks([])}
              onNewImage={() => { setImageUrl(null); setImageId(null); setMasks([]); }}
              maskCount={masks.length}
            />
          </>
        )}
      </main>
    </div>
  );
}
```

### ImageUploader

```jsx
function ImageUploader({ onUpload, loading }) {
  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) onUpload(file);
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      onClick={() => document.getElementById('file-input').click()}
      className="border-2 border-dashed border-gray-300 rounded-xl p-12
                 text-center hover:border-blue-400 transition-colors cursor-pointer"
    >
      <input
        id="file-input" type="file" accept="image/*" className="hidden"
        onChange={e => e.target.files[0] && onUpload(e.target.files[0])}
      />
      <p className="text-lg font-medium text-gray-500">拖拽图片到此处，或点击上传</p>
      <p className="text-sm text-gray-400 mt-2">支持 JPG / PNG / WebP</p>
      {loading && <p className="mt-4 text-blue-500 animate-pulse">上传中...</p>}
    </div>
  );
}
```

### CanvasOverlay

```jsx
function CanvasOverlay({ imageUrl, imageSize, masks, onPointClick, loading }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const containerRef = useRef(null);

  const COLORS = [
    [59, 130, 246], [239, 68, 68], [34, 197, 94],
    [249, 115, 22], [168, 85, 247],
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current?.complete || !imageSize) return;
    const ctx = canvas.getContext('2d');
    const scale = Math.min(canvas.width / imageSize.width, canvas.height / imageSize.height);
    const drawW = imageSize.width * scale;
    const drawH = imageSize.height * scale;
    const ox = (canvas.width - drawW) / 2;
    const oy = (canvas.height - drawH) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgRef.current, ox, oy, drawW, drawH);

    masks.forEach((mask, i) => {
      renderMask(ctx, mask.rle, imageSize, { ox, oy, scale }, COLORS[i % COLORS.length]);
    });
  }, [imageUrl, masks, imageSize]);

  const handleClick = (e) => {
    if (loading || !imageSize) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
    const scale = Math.min(canvas.width / imageSize.width, canvas.height / imageSize.height);
    const ox = (canvas.width - imageSize.width * scale) / 2;
    const oy = (canvas.height - imageSize.height * scale) / 2;
    const origX = Math.round((cx - ox) / scale);
    const origY = Math.round((cy - oy) / scale);

    if (origX >= 0 && origX < imageSize.width && origY >= 0 && origY < imageSize.height) {
      onPointClick(origX, origY);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-3xl mx-auto">
      <img ref={imgRef} src={imageUrl} className="hidden" onLoad={() => {
        const c = canvasRef.current;
        c.width = containerRef.current.clientWidth;
        c.height = containerRef.current.clientWidth * (imageSize.height / imageSize.width);
      }} />
      <canvas ref={canvasRef} onClick={handleClick}
        className={`w-full rounded-lg border-2 border-gray-200 ${loading ? 'cursor-wait' : 'cursor-crosshair'}`}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/10 rounded-lg">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
```

### Mask 渲染函数

```javascript
function renderMask(ctx, rle, imageSize, transform, color, opacity = 0.4) {
  const { counts, size } = rle;
  const [h, w] = size;
  const { ox, oy, scale } = transform;

  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tCtx = tmp.getContext('2d');
  const imgData = tCtx.createImageData(w, h);

  let idx = 0, val = 0;
  for (const count of counts) {
    for (let i = 0; i < count && idx < w * h; i++, idx++) {
      if (val === 1) {
        const p = idx * 4;
        imgData.data[p] = color[0];
        imgData.data[p + 1] = color[1];
        imgData.data[p + 2] = color[2];
        imgData.data[p + 3] = Math.round(opacity * 255);
      }
    }
    val = 1 - val;
  }

  tCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(tmp, ox, oy, w * scale, h * scale);
}
```

## 坐标映射

```
Canvas 点击 (clientX, clientY)
    │  减去 canvas.getBoundingClientRect()
    ▼
Canvas 内坐标
    │  乘以 (canvas.width / rect.width) — CSS 缩放
    ▼
Canvas 像素坐标
    │  减去 offset，除以 scale — 居中偏移 + 缩放
    ▼
原图坐标 (origX, origY) → 发送给后端
```

## 页面布局

```
┌────────────────────────────────────────────┐
│  FastSAM Demo            [SAM 2.1 已连接]   │
├────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │                                     │   │
│  │         Canvas 区域                  │   │
│  │     (图片 + mask 半透明叠加)         │   │
│  │                                     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  [清除选择]  [重新上传]   已选择 3 个区域    │
└────────────────────────────────────────────┘
```
