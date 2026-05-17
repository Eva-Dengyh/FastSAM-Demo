# API 接口文档

后端基于 FastAPI，启动后访问 [http://localhost:8000/docs](http://localhost:8000/docs) 查看 Swagger 文档。**生产形态下所有请求都从 Go 推理网关（默认 `http://localhost:8080`）进入**，再由网关分发到具体 worker，本文 cURL 示例同时给出网关入口与直连入口两种写法。

## 基础信息

- **Gateway Base URL**: `http://localhost:8080`（推荐，含粘性路由 + 限流）
- **Backend 直连 Base URL**: `http://localhost:8000`（用于单 worker 本地调试 / Swagger）
- **Content-Type**: `application/json`（上传接口除外）

> 网关会在响应头加上：
> - `X-Worker-Id`：本次请求实际命中的 worker（用于排查粘性路由）
> - `X-Request-Id`：贯穿 Gateway → backend 的 trace_id，未传入时自动生成

---

## 1. 健康检查

### `GET /api/health`

**通过 Gateway**：

```json
{
  "status": "ok",
  "role": "gateway",
  "healthy_workers": 2,
  "total_workers": 2,
  "workers": [
    {"id": "worker-0", "healthy": true, "queue_depth": 0},
    {"id": "worker-1", "healthy": true, "queue_depth": 0}
  ]
}
```

**直连 backend**：

```json
{
  "status": "ok",
  "worker_id": "worker-0",
  "model": "sam2.1_hiera_tiny",
  "model_loaded": true,
  "device": "cuda"
}
```

---

## 2. 上传图片

### `POST /api/upload`

上传图片并预计算 image embedding（最耗时步骤，只需一次）。Gateway 会在响应中截获 `image_id` 写入会话表，后续 `/api/segment` 凭此命中同一 worker。

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
# 走网关（推荐）
curl -X POST http://localhost:8080/api/upload -F "file=@test.jpg" -D -

# 直连 backend
curl -X POST http://localhost:8000/api/upload -F "file=@test.jpg"
```

走网关时响应头会带 `X-Worker-Id: worker-N`，记下来好对照粘性路由。

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
# 走网关（推荐，会按 image_id 命中同一 worker）
curl -X POST http://localhost:8080/api/segment \
  -H "Content-Type: application/json" \
  -d '{"image_id": "a1b2c3d4", "points": [{"x": 512, "y": 384, "label": 1}]}'

# 直连 backend（仅当 image 在该 backend 缓存时有效）
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

### Backend 直连错误码


| HTTP 状态码 | 错误码                | 说明               |
| -------- | ------------------ | ---------------- |
| 400      | BAD_REQUEST        | 参数缺失或格式错误        |
| 404      | IMAGE_NOT_FOUND    | image_id 不存在或已过期 |
| 413      | FILE_TOO_LARGE     | 图片超过 10MB        |
| 415      | UNSUPPORTED_FORMAT | 不支持的图片格式         |
| 500      | MODEL_ERROR        | 模型推理出错           |
| 503      | MODEL_NOT_READY    | 模型尚未加载完成         |


### Gateway 增量错误码

走 Gateway 时，下列状态码由网关产生，前端必须按对应动作恢复：

| HTTP 状态码 | 错误码 | 触发条件 | 前端动作 |
| -------- | ----- | -------- | -------- |
| 410 Gone | SESSION_EXPIRED | `image_id` 不在会话表（worker 重启 / TTL 过期 / worker 摘除） | 自动重新上传图片 |
| 429 Too Many Requests | QUEUE_FULL | worker 队列满；响应头 `Retry-After: 2` | 按头部退避重试 |
| 502 Bad Gateway | UPSTREAM_ERROR | 上游 worker 不可达 | 提示稍后重试 |
| 503 Service Unavailable | NO_WORKER | 无健康 worker | 等待健康检查恢复 |
| 504 Gateway Timeout | UPSTREAM_TIMEOUT | 单请求 `request_timeout_seconds` 超时 | 终止重试，告知用户 |

**错误响应格式**:

```json
{
  "detail": {
    "code": "IMAGE_NOT_FOUND",
    "message": "Image 'a1b2c3d4' not found or expired."
  }
}
```

前端 `lib/api.ts` 已对 410 / 429 做了自动恢复，业务代码层不会看到这两类错误。

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


### Gateway 引入的额外开销

实测 macOS / CPU：segment 直连 backend ~280ms，走 Gateway ~285ms，**< 5ms** 额外开销。

---

## Gateway 运维接口

| 路径 | 说明 |
|------|------|
| `GET /api/health` | 网关自检（不转发），返回各 worker 健康/队列深度 |
| `GET /metrics` | Prometheus 指标，字段名以 `gateway_` 前缀 |

关键指标：

| 指标 | 含义 |
|------|------|
| `gateway_requests_total{path, status}` | 各路径状态码分布 |
| `gateway_rejections_total{reason}` | 拒绝数（reason: `queue_full` / `no_worker` / `session_expired`） |
| `gateway_worker_healthy{worker_id}` | 各 worker 健康状态（0/1） |
| `gateway_worker_queue_depth{worker_id}` | 各 worker 当前排队深度 |
| `gateway_session_table_size` | 当前会话表大小（活跃 `image_id` 数） |
| `gateway_upstream_latency_seconds` | 上游响应延迟直方图 |

详细配置项见 [`gateway/README.md`](../gateway/README.md#配置说明)。