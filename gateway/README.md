# Inference Gateway

Go 编写的轻量推理网关，位于 Next.js 前端与 FastAPI 推理 worker 之间，负责：

- 并发控流：每个 worker 一个有界队列 + N 个消费 goroutine（≈ N 并发 in-flight）
- 粘性会话：`image_id → worker_id` 映射，确保 embedding 缓存命中
- 健康摘除：定期探活，故障 worker 自动摘除并清空其会话
- 可观测：Prometheus `/metrics`、结构化日志、`/api/health` 网关自检

## 快速本地起

```bash
cd gateway
go mod tidy
go run ./cmd/gateway -config configs/gateway.yaml
```

默认监听 `:8080`，转发到 `configs/gateway.yaml` 里的 workers。

## 关键路由

| 路径 | 说明 |
|------|------|
| `POST /api/upload` | 选最低负载 worker，流式转发；响应里截获 `image_id` 写会话表 |
| `POST /api/segment` | 按 `image_id` 命中粘性路由；会话过期返回 410 |
| `GET /api/health` | 网关自检（不转发），返回各 worker 状态 |
| `GET /metrics` | Prometheus 指标 |

## 错误语义

| 状态码 | 含义 | 前端动作 |
|--------|------|----------|
| 200 | 成功 | 正常处理 |
| 400 | 请求格式错误 | 修请求 |
| 410 | image_id 失效（worker 重启 / TTL 过期 / worker 不健康） | 重新上传图片 |
| 429 | worker 队列满 | 退避重试（Retry-After 头） |
| 502 | 上游不可达 | 用户提示稍后重试 |
| 503 | 无可用 worker | 等待健康检查恢复 |
| 504 | 上游超时 | 用户提示稍后重试 |

## 配置说明

见 `configs/gateway.yaml`，关键字段：

- `workers[].max_inflight`：单 worker 同时跑的推理数，应**等于**或**小于**该 worker 的 Python Semaphore 值（双层保护）
- `workers[].max_queue`：单 worker 队列容量，超过立即 429
- `request_timeout_seconds`：单请求总超时（含排队）
- `session_ttl_seconds`：image_id 会话有效期，应**对齐** backend `image_cache_ttl`

## 验证清单

启动后用 curl 跑通基础链路：

```bash
# 网关自检
curl http://localhost:8080/api/health

# 指标
curl http://localhost:8080/metrics | grep gateway_

# 上传（替换为真实图片路径）
curl -F "file=@/path/to/cat.jpg" http://localhost:8080/api/upload

# 分割
curl -X POST -H "Content-Type: application/json" \
  -d '{"image_id":"<上一步返回的>","points":[{"x":100,"y":100,"label":1}]}' \
  http://localhost:8080/api/segment
```
