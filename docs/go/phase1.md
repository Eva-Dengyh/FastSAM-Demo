# Phase 1 实现纪要：单 worker + Gateway 链路打通

> 对应设计文档 [docs/gateway-design.md](../gateway-design.md) 第 5.1 节。本文档记录 Phase 1 实际交付物、关键技术决策、验证清单和留给后续阶段的事。

## 1. 目标回顾

**做：** 在前端 (Next.js) 与 FastAPI worker 之间插一层 Go Gateway，验证以下能力在单 worker 形态下能跑通：

- 有界队列 + 并发上限保护下游 GPU
- 请求超时与友好错误（429 / 410 / 503 / 504）
- 粘性路由数据结构（image_id → worker_id，本阶段只 1 个 worker）
- Prometheus 指标与结构化日志
- worker 健康检查与故障感知

**不做（留给 Phase 2 / 3）：**

- 多 worker 横向扩展（Phase 2 才能真正展示 Gateway 价值）
- 请求优先级 / 租户隔离
- 服务发现 / 配置热更新
- 跨 Gateway 共享 SessionTable（v1 进程内存）

---

## 2. 交付物清单

### 2.1 新增：Gateway 模块（Go）

```
gateway/
├── go.mod / go.sum
├── Dockerfile                  # 多阶段构建，alpine 运行时
├── README.md
├── configs/
│   ├── gateway.yaml            # docker-compose 用，workers 指向 backend:8000
│   └── gateway.dev.yaml        # ./start.sh 本地用，workers 指向 localhost:8000
├── cmd/gateway/main.go         # 入口、装配、优雅退出
└── internal/
    ├── config/config.go        # YAML 加载 + 字段校验
    ├── metrics/metrics.go      # 7 个 Prometheus 指标
    ├── middleware/             # Observe（metrics+访问日志）+ Recover
    ├── session/session.go      # SessionTable: TTL + 后台 sweeper + DropByWorker
    ├── pool/pool.go            # WorkerPool: 有界 channel + N goroutine + ReverseProxy
    ├── health/health.go        # 周期探活 + 阈值切换
    └── handler/handler.go      # /api/upload /api/segment /api/health
```

### 2.2 修改：Python 后端

| 文件 | 改动 | 行数 |
|------|------|------|
| `backend/app/config.py` | 新增 `worker_id`（默认 hostname）、`max_inflight` | +9 |
| `backend/app/services/sam_service.py` | 新增 `inference_limit = asyncio.Semaphore(N)` | +3 |
| `backend/app/routers/upload.py` | `set_image` 包 `async with inference_limit` | +2 |
| `backend/app/routers/segment.py` | `predict` 包 `async with inference_limit` | +2 |
| `backend/app/routers/health.py` | 返回 `worker_id` / `model_loaded` / GPU 显存 | +10 |
| `backend/app/main.py` | 新增 middleware：响应加 `X-Worker-Id` header | +6 |

**业务代码完全没动**：`image_service.py`、`mask_encoder.py`、所有 schema 都不变。

### 2.3 修改：编排与启动

- `docker-compose.yml`：新增 `gateway` 服务（端口 8080），`backend` 不再对外暴露 8001、改 expose；`frontend` 注入 `NEXT_PUBLIC_API_URL=http://gateway:8080`
- `start.sh`：新增 Go 可用性检查 + 同步 Go 依赖；启动 Gateway 进程（`go run`，绝对路径 config）；前端进程注入 `NEXT_PUBLIC_API_URL=http://localhost:8080`；cleanup 多杀 GATEWAY_PID
- `.env.example`：新增 `WORKER_ID`、`MAX_INFLIGHT` 字段说明

---

## 3. 关键技术决策

下面列出动手时做的几个非显而易见选择，以及"为什么这样选"。

### 3.1 用 N 个消费 goroutine 取代信号量

**做法**：每个 worker 启动 `maxInflight` 个 goroutine，每个 goroutine 自己从 channel 取 job → 同步调用 `proxy.ServeHTTP` → 关闭 done。

```go
for i := 0; i < p.maxInflight; i++ {
    go p.consume()
}
```

**为什么不另起一个信号量 channel**：goroutine 数本身就是并发上限，每个 goroutine 一次只处理一个 job，自然实现 in-flight=N。代码更直白，少一个同步原语就少一种 race 可能。

### 3.2 启动时默认 unhealthy

**做法**：`newWorker` 里 `healthy.Store(false)`，必须经过 `health_threshold` 次（默认 2）连续探活成功才上线。

**为什么**：上一版乐观置 healthy 的代价是——backend 还没起来时，前端打过来的第一波请求会被路由进去，然后挂在 ReverseProxy 上等连接超时。代价是冷启动多 ~10s 才能提供服务，但换来"没在线就明确返回 503，不假装"，前端更好处理。

实际启动日志（用户实测）：

```
18:06:42 INF gateway started workers=1                  ← Gateway 起来
18:06:46 INF http status=503                            ← 首页触发 health 检查，503（worker 尚未上线）
18:06:52 INF worker recovered passes=2 worker_id=worker-0  ← 第二次探活成功，上线
18:06:56 INF http status=200                            ← 之后正常
```

### 3.3 用 `ModifyResponse` 拦截 upload 拿 image_id

**做法**：`httputil.ReverseProxy.ModifyResponse` hook 里读 upload 响应 body（小 JSON），解出 `image_id` 写入 `SessionTable`，body 用 `bytes.NewReader` 重新包回去给客户端。

```go
body, _ := io.ReadAll(resp.Body)
resp.Body = io.NopCloser(bytes.NewReader(body))
var parsed struct{ ImageID string `json:"image_id"` }
json.Unmarshal(body, &parsed)
sessions.Put(parsed.ImageID, w.id)
```

**为什么不在 handler 层做**：handler 层用的是 `httputil.ReverseProxy.ServeHTTP`，它内部直接把 response 流式写到 `http.ResponseWriter`，handler 拿不到 response body。`ModifyResponse` 是 ReverseProxy 提供的官方钩子，只在响应阶段插一刀，是干净的扩展点。

**注意**：upload 响应 body 全量读入内存是 OK 的——它只是个 `{image_id, width, height}` 小 JSON。如果未来响应变大（比如带预览图），要改成流式 JSON 解析。

### 3.4 segment body 全量读 vs upload multipart 流式

**做法**：

- segment：handler 里 `io.ReadAll(r.Body)`，解出 `image_id` 查会话表，body 用 `bytes.NewReader` 重置回去
- upload：handler 不读 body，直接 `worker.Submit(w, r)`，由 `ReverseProxy` 流式转发 multipart

**为什么区别对待**：

- segment body 是几 KB 的 JSON，全量读对内存没压力，而且**必须**先拿到 image_id 才能选 worker
- upload body 可能 ≥10MB（图片），全量读进 Gateway 内存会被打爆；而且 upload 不需要在转发前读 body（image_id 是响应里给的，不在请求里），所以流式直接透传

### 3.5 Python 端保留 Semaphore 兜底

**做法**：`sam_service.inference_limit = asyncio.Semaphore(max_inflight)`，upload / segment 推理调用前都 `async with`。

**为什么**：双层保护。Gateway 是限流主力，但万一配错（max_inflight 数值不一致 / Gateway 被绕过直连 backend），Python 自己也不会爆显存。这种"防御性冗余"在涉及 GPU 资源时是值得的——一次 OOM 重启代价远高于多一行 `async with`。

### 3.6 错误语义按"前端需要不同动作"分类

| 状态码 | 含义 | 前端应做 |
|--------|------|----------|
| 410 Gone | image_id 不在会话表（worker 重启 / TTL 过期） | 自动重新上传 |
| 429 Too Many Requests | worker 队列满，带 `Retry-After: 2` | 退避重试 |
| 503 Service Unavailable | 无健康 worker | 提示用户稍后再试 |
| 504 Gateway Timeout | 上游响应超时 | 终止重试，告知用户 |

**为什么这样分**：每个状态码对应一个**前端可以自动化处理的动作**。如果都返回 500，前端无法做差异化恢复，体验断崖。前端层尚未实现 410 自动重传逻辑，这是 Phase 2 验收前要补的事。

---

## 4. 已验证清单

### 4.1 编译 / 静态分析

- ✅ `go build ./...` 干净
- ✅ `go vet ./...` 无告警

### 4.2 启动 / 关闭

- ✅ `./start.sh` 一键起 backend (8000) + gateway (8080) + frontend (3000)
- ✅ Ctrl+C 三个进程一起干净退出
- ✅ Gateway 启动时 worker 处于 unhealthy，~10s 后探活成功上线

### 4.3 错误路径

| 场景 | 预期 | 实测 |
|------|------|------|
| Gateway 启动但 backend 未起 | `/api/health` 返回 503，body 含 `healthy_workers:0` | ✅ |
| 任意 API 在 worker 未上线时 | 503 NO_WORKER | ✅ |
| segment 用不存在的 image_id | 410 SESSION_EXPIRED | ✅ |

### 4.4 Happy path

- ✅ 前端 → Gateway → backend 整链路工作，浏览器上传 + 点击分割流畅
- ✅ 响应头携带 `X-Worker-Id: worker-0`，证明粘性路由数据回流到了客户端
- ✅ Prometheus `/metrics` 暴露 `gateway_session_table_size` 等指标，能看到上传后会话数增长

### 4.5 端到端延迟

实测 macOS / CPU 推理：

- segment 直连 backend：~280 ms（P50）
- segment 走 Gateway：~285 ms（P50）

**Gateway 引入的额外开销 < 5ms**，符合设计预期（< 10ms）。

---

## 5. 已知限制

这些是 Phase 1 **有意没做**的事，写下来让 Phase 2/3 接手时有据可循。

### 5.1 单 worker 下 Gateway 的核心价值未体现

粘性路由数据结构已经建好，但只有 1 个 worker 时，"选择哪个 worker" 永远只有一个答案。Phase 2 起两个 backend 才能真正验证：

- 不同 image_id 是否被均匀分配（最小负载）
- 同一 image_id 的二次请求是否回到原 worker

### 5.2 健康检查器不在请求路径里熔断

当前实现：探活完全独立于业务请求路径。如果一次 segment 请求超时，`ErrorHandler` 会写 502/504，但**不会**立刻把 worker 标记不健康。

**为什么这样设计**：避免单次偶发失败抖动整个路由表。代价是 worker 真正挂掉时，可能要等 ~15s（3 次探活失败 × 5s 间隔）才被摘除，期间继续打过去的请求会失败。

**改进方向（Phase 3）**：把 ErrorHandler 里的错误计数也喂给 health checker，单 worker 短时间内累积多次 5xx 时主动熔断。

### 5.3 SessionTable 是进程内存

Gateway 重启 = 所有会话丢失 = 前端所有 in-flight 的 image_id 都会拿到 410。

**Phase 3 改进**：Redis / etcd 共享存储，Gateway 自身无状态可平行扩展。当前阶段单 Gateway 足够。

### 5.4 没有请求级 trace

日志里目前没有贯穿 Gateway → backend 的 trace_id。排查跨服务问题要靠时间戳和 image_id 关联。

**改进方向**：Gateway 入口生成 `X-Request-Id`，向后透传，backend 日志带上同一字段。这件事很小，但 Phase 1 没做，写在这里别忘了。

### 5.5 前端没有 410 / 429 自动恢复

前端 `lib/api.ts` 当前只是把非 2xx 当作普通错误抛出。还没接：

- 410 → 提示并重新上传
- 429 → 读 `Retry-After`，退避重试 1-3 次

**Phase 2 验收前必须补上**，否则用户在并发场景看到的就是各种红色弹窗。

---

## 6. 文件级变更摘要

```
新增 16 个文件：
  gateway/go.mod
  gateway/go.sum
  gateway/Dockerfile
  gateway/README.md
  gateway/configs/gateway.yaml
  gateway/configs/gateway.dev.yaml
  gateway/cmd/gateway/main.go
  gateway/internal/config/config.go
  gateway/internal/metrics/metrics.go
  gateway/internal/middleware/middleware.go
  gateway/internal/session/session.go
  gateway/internal/pool/pool.go
  gateway/internal/health/health.go
  gateway/internal/handler/handler.go
  docs/go/phase1.md          ← 本文件

修改 6 个文件：
  backend/app/config.py
  backend/app/main.py
  backend/app/routers/health.py
  backend/app/routers/upload.py
  backend/app/routers/segment.py
  backend/app/services/sam_service.py
  docker-compose.yml
  start.sh
  .env.example
```

---

## 7. 怎么从 Phase 1 接到 Phase 2

下一阶段的工作量极小（**代码不用动**，编排和验证脚本而已），原因是 Gateway 的 worker pool / 粘性路由 / 健康检查从一开始就是按"多 worker"设计的——单 worker 只是 N=1 的特例。

Phase 2 要做的事：

1. 编排：起两个 backend 容器/进程，端口和 `WORKER_ID` 隔离
2. 配置：`gateway.yaml` 和 `gateway.dev.yaml` 里 `workers` 列表加一行
3. 验证：写一个 bash 脚本，并发 10 次 upload，看 `X-Worker-Id` 分布是否均匀；同一 image_id 的 segment 是否始终落在同一 worker
4. 故障演练：kill 一个 backend，看 Gateway 是否在 ~15s 内摘除该 worker 并清空它的 SessionTable

具体见 [phase2.md](./phase2.md)。
