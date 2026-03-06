# API 接口文档

后端基于 FastAPI，启动后访问 [http://localhost:8000/docs](http://localhost:8000/docs) 查看 Swagger 文档。

## 基础信息

- **Base URL**: `http://localhost:8000`
- **Content-Type**: `application/json`（上传接口除外）

---

## 1. 健康检查

### `GET /api/health`

```json
{
  "status": "ok",
  "model": "sam2.1_hiera_tiny",
  "device": "cuda"
}
```

---

## 2. 上传图片

### `POST /api/upload`

上传图片并预计算 image embedding（最耗时步骤，只需一次）。

**请求**: `multipart/form-data`


| 参数   | 类型   | 必填  | 说明                 |
| ---- | ---- | --- | ------------------ |
| file | File | 是   | 图片文件（jpg/png/webp） |


**响应**:

```json
{
  "image_id": "a1b2c3d4",
  "width": 1024,
  "height": 768
}
```

**cURL**:

```bash
curl -X POST http://localhost:8000/api/upload -F "file=@test.jpg"
```

**耗时**: GPU ~0.5s, CPU ~2-5s（主要是 image encoder）

---

## 3. 点击分割

### `POST /api/segment`

根据点击坐标进行分割。

**请求**:

```json
{
  "image_id": "a1b2c3d4",
  "points": [
    { "x": 512, "y": 384, "label": 1 }
  ]
}
```


| 字段             | 类型     | 必填  | 说明            |
| -------------- | ------ | --- | ------------- |
| image_id       | string | 是   | 上传时返回的图片 ID   |
| points         | array  | 是   | 点击坐标数组        |
| points[].x     | int    | 是   | x 坐标（原图像素）    |
| points[].y     | int    | 是   | y 坐标（原图像素）    |
| points[].label | int    | 否   | 1=前景（默认），0=背景 |


**响应**:

```json
{
  "masks": [
    {
      "rle": {
        "counts": [12345, 50, 12500, 30],
        "size": [768, 1024]
      },
      "bbox": [100, 200, 450, 500],
      "score": 0.98,
      "area": 52340
    }
  ],
  "image_id": "a1b2c3d4"
}
```

**响应字段**:


| 字段                 | 类型     | 说明                           |
| ------------------ | ------ | ---------------------------- |
| masks[].rle.counts | int[]  | RLE 编码（交替 0/1 像素数）           |
| masks[].rle.size   | int[2] | [height, width]              |
| masks[].bbox       | int[4] | [x_min, y_min, x_max, y_max] |
| masks[].score      | float  | 置信度 0-1                      |
| masks[].area       | int    | mask 像素面积                    |


**cURL**:

```bash
curl -X POST http://localhost:8000/api/segment \
  -H "Content-Type: application/json" \
  -d '{"image_id": "a1b2c3d4", "points": [{"x": 512, "y": 384, "label": 1}]}'
```

**耗时**: GPU ~20-50ms, CPU ~80-200ms（embedding 已缓存）

---

## 4. 多点分割

支持多个前景/背景点提高精度：

```json
{
  "image_id": "a1b2c3d4",
  "points": [
    { "x": 512, "y": 384, "label": 1 },
    { "x": 520, "y": 400, "label": 1 },
    { "x": 100, "y": 100, "label": 0 }
  ]
}
```

- `label: 1` = 前景点（要分割的区域）
- `label: 0` = 背景点（排除的区域）

---

## RLE 编码格式

Run-Length Encoding 将 binary mask 压缩为交替的 0/1 像素计数：

```
原始: 0 0 0 1 1 1 1 0 0 1 1 0
RLE:  [3, 4, 2, 2, 1]
含义: 3个0, 4个1, 2个0, 2个1, 1个0
```

**前端解码**:

```javascript
function decodeRLE(counts, height, width) {
  const mask = new Uint8Array(height * width);
  let idx = 0, val = 0;
  for (const count of counts) {
    const end = Math.min(idx + count, mask.length);
    if (val === 1) mask.fill(1, idx, end);
    idx = end;
    val = 1 - val;
  }
  return mask;
}
```

---

## 错误码


| HTTP 状态码 | 错误码                | 说明               |
| -------- | ------------------ | ---------------- |
| 400      | BAD_REQUEST        | 参数缺失或格式错误        |
| 404      | IMAGE_NOT_FOUND    | image_id 不存在或已过期 |
| 413      | FILE_TOO_LARGE     | 图片超过 10MB        |
| 415      | UNSUPPORTED_FORMAT | 不支持的图片格式         |
| 500      | MODEL_ERROR        | 模型推理出错           |
| 503      | MODEL_NOT_READY    | 模型尚未加载完成         |


**错误响应格式**:

```json
{
  "detail": {
    "code": "IMAGE_NOT_FOUND",
    "message": "Image 'a1b2c3d4' not found or expired."
  }
}
```

---

## 性能基准

### GPU (NVIDIA RTX 3060)


| 接口                     | 平均耗时 |
| ---------------------- | ---- |
| POST /api/upload (1MB) | 0.8s |
| POST /api/segment (单点) | 35ms |


### CPU (Apple M1)


| 接口                     | 平均耗时  |
| ---------------------- | ----- |
| POST /api/upload (1MB) | 3.5s  |
| POST /api/segment (单点) | 120ms |


