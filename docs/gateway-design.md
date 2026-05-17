# Go 网关层设计：有状态 AI 推理服务的并发与调度

> 本文档描述在 FastSAM-Demo 现有架构基础上，引入 Go 编写的中间网关层（Inference Gateway），以解决"GPU 显存受限 + 有状态推理服务"在高并发下不可扩展的问题。

## 1. 背景与目标

### 1.1 当前架构的真实痛点

读完现有代码后，下面这些问题是**真实存在**的，不是空喊：

| 问题 | 代码位置 | 影响 |
|------|----------|------|
| `SAMService` 是进程单例，GPU 推理阻塞 | `backend/app/services/sam_service.py:11` | 并发上来后任务串行排队，TTFB 暴涨 |
| 没有任何并发上限保护 | `backend/app/routers/segment.py:36` | GPU 显存随并发线性增长，会直接 OOM |
| 图片 embedding 缓存在进程内存 (`_current_image_id`) | `backend/app/services/sam_service.py:32` | **服务有状态**，同一 image_id 必须打到同一 worker；横向扩展非平凡 |
| 没有健康度反馈 / 排队可见性 | 全局 | 前端要么"转圈"要么 500，体验差 |

### 1.2 为什么不直接用 `asyncio.Semaphore`？

这是必须正面回答的问题，否则整个改造都是过度设计。

`asyncio.Semaphore` 能解决的：**单进程并发上限**。
`asyncio.Semaphore` 解决不了的：

1. **会话粘性路由**：embedding 缓存在 Python 进程内存里，多 worker 部署时，必须让同一 `image_id` 的后续 segment 请求回到同一个 worker——这件事只能在调用方/网关做，Python 进程内部做不了
2. **背压表达力**：有界队列 + 超时 + 拒绝策略 + 优先级，比 Semaphore 表达力强很多
3. **横切关注点**：鉴权、限流（令牌桶）、Prometheus 指标、链路追踪，集中在网关比每个 worker 各塞一份中间件干净
4. **worker 故障感知**：worker 进程 OOM 重启时，网关需要把它从可用池摘除并迁移路由

**结论**：单 worker 部署下，Gateway 是过度设计；**多 worker / 多 GPU 节点**下，Gateway 是唯一合理选择。本次改造的真实目标是为"未来横向扩展"打地基。

### 1.3 设计目标

- **保护下游 GPU**：任意并发输入下，单 worker 上同时执行的推理数 ≤ GPU 显存容量决定的阈值
- **保持 embedding 缓存命中率**：同一 image_id 的 upload + segment 序列必须落到同一 worker
- **平滑退化**：队列满 → 返回 429 + Retry-After；worker 挂 → 自动摘除并将受影响 image_id 标记失效（返回 410，前端重传）
- **可观测**：QPS、队列长度、worker 健康、推理 P95 延迟，全部暴露 Prometheus 指标
- **零业务改造**：FastAPI 侧只需新增一个 `worker_id` 标识与一个保护性的 Semaphore，业务逻辑不变

---

## 2. 整体架构

### 2.1 架构图

```
┌────────────────────────────────────────────────────────────────┐
│                Browser (Next.js + TypeScript)                   │
└──────────────────────────────┬─────────────────────────────────┘
                               │ HTTP (multipart / JSON)
                               ▼
┌────────────────────────────────────────────────────────────────┐
│                Inference Gateway  (Go, 端口 8080)               │
│                                                                 │
│  ┌──────────────┐   ┌──────────────────┐  ┌─────────────────┐  │
│  │  HTTP Handler│──▶│  Router          │─▶│ Per-Worker Queue│  │
│  │  /upload     │   │  (sticky by      │  │   (chan)        │  │
│  │  /segment    │   │   image_id)      │  │                 │  │
│  └──────────────┘   └──────────────────┘  └────────┬────────┘  │
│         ▲                                          │           │
│         │                                          ▼           │
│  ┌──────┴───────┐   ┌──────────────────┐  ┌─────────────────┐  │
│  │ Middleware:  │   │ Session Table:   │  │ Worker Dispatcher│  │
│  │ ratelimit /  │   │ image_id → worker│  │ (goroutine pool)│  │
│  │ metrics / log│   │ (TTL, sync.Map)  │  │                 │  │
│  └──────────────┘   └──────────────────┘  └────────┬────────┘  │
│                                                    │           │
│  ┌────────────────────────────────────────────────┼────────┐  │
│  │  Health Checker (定期 ping /health, 摘除故障节点)│        │  │
│  └────────────────────────────────────────────────┼────────┘  │
└──────────────────────────────────────────────────┬─┴──────────┘
                                                   │ httputil.ReverseProxy
                            ┌──────────────────────┼──────────────────┐
                            ▼                      ▼                  ▼
                  ┌──────────────────┐   ┌──────────────────┐   ┌────────────┐
                  │  FastAPI Worker 0│   │  FastAPI Worker 1│   │   ...      │
                  │  GPU 0           │   │  GPU 1           │   │            │
                  │  + Semaphore(N)  │   │  + Semaphore(N)  │   │            │
                  └──────────────────┘   └──────────────────┘   └────────────┘
```

### 2.2 请求生命周期

**Upload 请求**（建立会话）：

```
1. 前端 POST /upload (multipart)
2. Gateway 中间件：限流 / 鉴权 / 记录 metric
3. Router 选择 worker：负载最低（队列长度 + in-flight 加权）
4. 入对应 worker 的 channel；channel 满 → 立即 429
5. Dispatcher goroutine 取出任务，httputil.ReverseProxy 流式转发到 worker
6. 拿到 worker 返回的 image_id，写入 SessionTable: image_id → worker_id (TTL=10min)
7. 透传响应给前端
```

**Segment 请求**（命中会话）：

```
1. 前端 POST /segment {image_id, points}
2. SessionTable 查 image_id → worker_id；查不到 → 410 Gone（embedding 失效）
3. 命中：入对应 worker 的 channel
4. worker 失败 / 超时 → 标记 worker unhealthy；删除 SessionTable 中所有指向它的 image_id；本请求返回 503
5. 否则透传响应
```

---

## 3. 核心模块设计

### 3.1 接入层（HTTP + 反向代理）

- 标准库 `net/http` + `github.com/go-chi/chi`（轻量，不带 magic）
- 上传走 `httputil.ReverseProxy`，**流式**转发 multipart，不在 Gateway 内缓冲整个图片
- 写超时 / 读超时 / Idle 超时显式设置，避免慢连接拖垮 Gateway

### 3.2 会话粘性路由（Session Table）

- 数据结构：`sync.Map[string]sessionEntry`（image_id → {worker_id, expires_at}）
- TTL 与后端 `image_cache_ttl` 对齐（默认 600s），后台 goroutine 定期 sweep 过期项
- **失效场景**：worker unhealthy / TTL 过期 / 显式 `/release` 调用
- 失效后对该 image_id 的请求统一返回 `410 Gone`，前端 catch 410 → 自动触发重传上传流程

> 这里有个工程细节：image_id 由 worker 生成（`uuid.uuid4().hex[:8]`），Gateway 在 upload 响应里截获后才知道。这意味着 upload 路由阶段还**没有** image_id，必须先选 worker 再透传 → 拿到响应回填 SessionTable。这是 Gateway 而非 worker 决定路由归属的关键依据。

### 3.3 有界队列与并发控制

每个 worker 对应一组：

```go
type WorkerPool struct {
    workerID   string
    upstream   *url.URL
    queue      chan *Job          // 有界 channel，cap = maxQueue
    sem        chan struct{}      // 信号量，cap = maxInFlight
    proxy      *httputil.ReverseProxy
    healthy    atomic.Bool
}
```

- **队列容量**：`maxQueue = 32`（可配）；入队前 `select` 带 `default` 分支立即返回 429，**不阻塞**调用 goroutine
- **并发上限**：`maxInFlight = 2`（取决于 GPU 显存与模型大小，与 Python 侧 Semaphore 同值）
- **请求超时**：每个 Job 自带 `context.WithTimeout(30s)`；超时立即返回 504，**不占用** worker

### 3.4 拒绝、退避与优先级

| 场景 | HTTP 状态 | Header | 前端处理 |
|------|-----------|--------|----------|
| 队列满 | 429 | `Retry-After: 2` | 退避重试，最多 3 次 |
| 会话失效 | 410 | — | 重新上传图片 |
| Worker 故障 | 503 | `Retry-After: 5` | 提示用户稍后再试 |
| 请求超时 | 504 | — | 终止并提示 |

可选：在 header 里允许 `X-Priority: vip|normal`，VIP 走独立 channel，避免被普通流量饿死。**不在 v1 实现**，留作演进。

### 3.5 健康检查与熔断

- 后台 goroutine 每 5s 对每个 worker `GET /health` 探活，连续 3 次失败 → 标记 unhealthy
- unhealthy worker：从可路由池摘除；清空 SessionTable 中所有指向它的 entry；停止 Dispatcher 出队但保留 in-flight 让其超时自然回收
- 恢复策略：探测到 `/health` 连续成功 2 次 → 恢复路由

### 3.6 可观测性

Prometheus 指标（最小集）：

```
gateway_requests_total{route, status}            counter
gateway_request_duration_seconds{route}          histogram
gateway_queue_depth{worker_id}                   gauge
gateway_inflight{worker_id}                      gauge
gateway_worker_healthy{worker_id}                gauge (0/1)
gateway_session_table_size                       gauge
gateway_rejections_total{reason}                 counter   // queue_full / unhealthy / timeout
```

日志结构化（zerolog 或 zap），关键字段：`trace_id`、`image_id`、`worker_id`、`queue_wait_ms`、`upstream_latency_ms`。

---

## 4. Python 后端的配合修改

**改动量很小，业务零侵入。**

1. `app/config.py` 新增 `worker_id`（来自环境变量，默认 hostname）
2. `app/main.py` 启动时记录该 worker_id，并通过 `X-Worker-Id` 响应头透出
3. `app/services/sam_service.py` 推理入口加 `asyncio.Semaphore(max_inflight)` 兜底——即使 Gateway 配错，Python 也不会爆显存（**双层保护，不是单点**）
4. `/api/health` 扩展返回 `{worker_id, model_loaded, gpu_memory_used}`，供 Gateway 健康检查使用

---

## 5. 演进路线

分三个阶段推进，每个阶段都可独立交付演示：

### Phase 1 — 单 worker + Gateway（先把链路打通）

- 部署 1 个 FastAPI worker + 1 个 Go Gateway
- 验证：限流、排队、超时、metrics 全跑通
- 价值：**演示工程能力**，但此时 Python Semaphore 单独也能做到大部分事
- 时间预估：3-5 天

### Phase 2 — 多 worker 横向扩展

- docker-compose 起 2-3 个 FastAPI worker，每个绑定不同 GPU（或 CPU 核心）
- Gateway 启用粘性路由 + 负载均衡（最小队列优先）
- 验证：embedding 缓存命中率不退化；worker 重启时受影响请求平滑迁移
- 价值：**Gateway 的真实价值在这里才体现**——asyncio.Semaphore 永远做不到这件事
- 时间预估：3-4 天

### Phase 3 — 跨节点 / 多 GPU 集群（可选展望）

- 服务发现从静态配置升级为 etcd / consul
- 引入 Redis 共享 SessionTable，Gateway 自身无状态可水平扩展
- 加入请求优先级、租户隔离、计费埋点
- 价值：完整工业级形态，但**不建议作为 Demo 阶段目标**，作为架构演进 roadmap 讲即可

---

## 6. 风险与权衡（坦诚清单）

写设计文档不列风险，是不诚实的。

| 风险 | 说明 | 缓解 |
|------|------|------|
| **过度设计** | 单 worker 下 Gateway 价值有限，容易被质疑 | 故事必须落在 Phase 2/3，演示要把多 worker 跑起来 |
| **新增故障域** | Gateway 自己挂了整个服务就挂 | Gateway 必须极简、无业务逻辑；做好健康检查 + 进程守护 |
| **粘性路由的负载倾斜** | 长任务全堆在一个 worker | 监控队列长度差异，必要时拒绝新 upload 而非强行下发 |
| **上传文件流转性能** | Gateway 多一跳，大图上传变慢 | 用 `ReverseProxy` 流式转发，不全量缓冲；实测应 < 5ms 增量 |
| **SessionTable 内存增长** | 长期运行可能泄漏 | TTL + 后台 sweep；指标 `gateway_session_table_size` 报警阈值 |
| **Go / Python 双语言运维成本** | 团队要维护两套技术栈 | 先 Demo 评估收益，业务规模没起来前不必迁移生产 |

---

## 7. 目录结构与技术选型

### 7.1 新增目录

```
FastSAM-Demo/
├── gateway/                          # 新增
│   ├── cmd/
│   │   └── gateway/
│   │       └── main.go               # 入口
│   ├── internal/
│   │   ├── config/                   # 配置加载（YAML/env）
│   │   ├── router/                   # 粘性路由、SessionTable
│   │   ├── pool/                     # WorkerPool、队列、信号量
│   │   ├── health/                   # 健康检查器
│   │   ├── proxy/                    # ReverseProxy 封装
│   │   ├── middleware/               # 限流、日志、metrics
│   │   └── metrics/                  # Prometheus 指标定义
│   ├── configs/
│   │   └── gateway.yaml              # 默认配置
│   ├── Dockerfile
│   ├── go.mod
│   └── README.md
├── docker-compose.yml                # 修改：加入 gateway 服务，前端依赖改为 gateway
└── frontend/next.config.ts           # 修改：API 代理目标改为 gateway:8080
```

### 7.2 技术选型

| 维度 | 选型 | 理由 |
|------|------|------|
| 语言 | Go 1.22+ | 标准库强，goroutine + channel 天然契合本场景 |
| HTTP 框架 | chi | 轻量，与 net/http 兼容，无 magic |
| 反向代理 | `net/http/httputil` | 标准库，流式转发 multipart 无需自己实现 |
| 配置 | YAML + envconfig | 简单清晰，不引 viper |
| 日志 | zerolog | 结构化日志，零分配 |
| 指标 | prometheus/client_golang | 事实标准 |
| 测试 | testify + httptest | 标准做法 |

---

## 8. 验证方案

文档结尾必须能回答"怎么证明它有用"，否则就是 PPT。

**压测脚本**（基于 `vegeta` 或 `k6`）：

1. **基线**：直接打 FastAPI，并发 50，观察 OOM / 错误率
2. **Phase 1**：经过 Gateway，相同并发，观察 429 比例、P95 延迟、GPU 显存峰值
3. **Phase 2**：2 个 worker，观察吞吐近似翻倍、embedding 命中率 > 95%
4. **故障演练**：手动 kill 一个 worker，观察对应 image_id 请求返回 410、未受影响请求继续正常服务

成功标准：

- 并发 50 下后端无 OOM
- P95 segment 延迟相比基线增加 < 10%
- 单 worker kill 后，5s 内健康检查感知并摘除，剩余 worker 继续服务

---

## 9. 不做的事（明确划线）

- **不**在 Gateway 里做模型推理或图像处理（只做调度）
- **不**做 WebSocket / 长连接（v1 阶段，HTTP/JSON 够用）
- **不**实现请求优先级和租户隔离（Phase 3 再说）
- **不**自建服务发现（Phase 1/2 用静态配置，够用）
- **不**做请求级缓存（embedding 缓存在 worker 内，Gateway 不重复缓存）

---

## 附录 A：与"直接用 asyncio.Semaphore"的对比

| 能力 | asyncio.Semaphore | Go Gateway |
|------|-------------------|------------|
| 单进程并发上限 | ✅ | ✅ |
| 有界队列 + 拒绝 | ⚠️ 需要自己写 | ✅ 原生 channel |
| 请求超时与回收 | ⚠️ 需要 wrap context | ✅ |
| 多 worker 粘性路由 | ❌ | ✅ |
| Worker 健康摘除 | ❌ | ✅ |
| 横切关注点（限流/鉴权/指标） | ⚠️ 中间件分散 | ✅ 统一入口 |
| 复杂度 | 极低 | 中 |

**结论再强调一次**：单 worker → Semaphore 够用；多 worker → 必须 Gateway。本项目的改造价值，押在"未来要扩到多 worker / 多 GPU"这个判断上。
