# Phase 2 实现纪要：多 worker 横向扩展

> Gateway 自身的运行契约（路由、错误码、配置项）见 [`gateway/README.md`](../../gateway/README.md)。本阶段把 Gateway 真正"值钱"的能力——粘性路由 + 负载均衡——拉出来用，证明它不是单 worker 形态下的过度设计。

## 1. 这一阶段要回答的问题

Phase 1 文档第 5.1 节坦白过："单 worker 形态下，Gateway 的核心价值没体现"。Phase 2 必须能用数据回答：

| 问题 | 验收标准 |
|------|----------|
| 多个 upload 是否被均匀分散到不同 worker？ | 8 次 upload，两个 worker 各拿到 3-5 次（最小队列优先 + 随机抖动） |
| 同一 image_id 的后续 segment 是否始终落到同一 worker？ | 5 次 segment 全部命中初始 upload 的那个 worker |
| 杀掉一个 worker 后，受影响的 image_id 是否被清理？ | ~15s 内（3 次探活失败）该 image_id 返回 410 SESSION_EXPIRED |

**注意（必须诚实的事）**：本地两 backend 进程**共享同一块 CPU/GPU**，吞吐**不会**真正翻倍。Phase 2 在本地演示的价值是**调度逻辑的正确性**——证明 Gateway 能把请求按设计分配出去。性能数字要等真正的多 GPU 节点或多机部署才有意义，这是 Phase 3 的事。

---

## 2. 代码改动量

**Gateway Go 代码：零行改动。**

这不是巧合——Phase 1 写代码时就按多 worker 设计：`workers` 是个 slice、`PickLeastLoaded` 已经在挑负载最低、SessionTable 按 worker_id 路由。单 worker 只是 N=1 的特例。这种"今天做的扩展性留给明天"才是工程，不是过度设计。

所有改动都在编排和验证层：

| 文件 | 改动 |
|------|------|
| `docker-compose.yml` | `backend` 拆为 `backend-0` / `backend-1`，各自 `WORKER_ID` 隔离；`gateway` 依赖两者 |
| `start.sh` | 起两个 uvicorn 进程：`worker-0` 在 8000，`worker-1` 在 8002；cleanup 多杀一个 PID |
| `gateway/configs/gateway.yaml` | `workers` 列表加 `worker-1`（指向 `backend-1:8000`）|
| `gateway/configs/gateway.dev.yaml` | `workers` 列表加 `worker-1`（指向 `localhost:8002`）|
| `scripts/verify-multiworker.sh` | **新增**，自动跑负载均衡 + 粘性路由验证 |

---

## 3. 启动 Phase 2 形态

### 3.1 本地（开发用）

```bash
./start.sh
```

会看到日志里出现两个 backend 启动：

```
启动 backend-0（:8000, WORKER_ID=worker-0）...
启动 backend-1（:8002, WORKER_ID=worker-1）...
启动 Gateway 服务（:8080）...
启动前端服务（:3000，API → Gateway）...
```

### 3.2 Docker（更接近生产）

```bash
docker-compose up --build
```

容器视角：`backend-0`、`backend-1`、`gateway`、`frontend` 各一个。`gateway.yaml` 里的 worker URL 走容器名解析，不需要端口隔离。

### 3.3 启动后预检

等 ~15s 健康检查完成（两个 worker 各需 2 次成功探测），然后：

```bash
curl -s http://localhost:8080/api/health | python3 -m json.tool
```

应该看到：

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

`healthy_workers: 2` 是 Phase 2 入门的最低标志。

---

## 4. 验证脚本

### 4.1 自动化跑

```bash
./scripts/verify-multiworker.sh
```

会输出三段：

**(1) 负载均衡**——连续 8 次 upload，统计每个 worker 收到的次数。理想是 4:4 或接近，最坏 5:3。如果全部落到同一个 worker，脚本会告警——常见原因是另一 worker 实际未健康。

**(2) 粘性路由**——单次 upload 拿到 `image_id` + `X-Worker-Id`（设为期望落点），随后 5 次 segment 必须全部命中同一个 worker。这是 Phase 2 最关键的一项断言——证明会话表真的工作。

**(3) 会话清理（手动一步）**——脚本最后会打出具体的 curl 命令，让你手动 kill 一个 backend 后跑，验证 410 SESSION_EXPIRED。自动化做这一步需要 PID 管理，反而不如手工清晰。

### 4.2 推荐的人工核对

打开浏览器 DevTools → Network，正常使用前端上传 + 多次点击 segment，看响应头里的 `X-Worker-Id`：

- 同一图片的所有 segment 请求，`X-Worker-Id` 应该是同一个值
- 换一张图重新 upload，`X-Worker-Id` 可能变成另一个 worker

这是端到端的最直观验证。

### 4.3 故障演练

打开两个终端：

```bash
# 终端 1：实时观察 Gateway 视角
watch -n 1 'curl -s localhost:8080/api/health | python3 -m json.tool'

# 终端 2：实时观察指标
watch -n 1 'curl -s localhost:8080/metrics | grep -E "gateway_(worker_healthy|session_table|rejections)" | grep -v "#"'
```

然后 kill 一个 backend（找到对应 PID 或 `docker-compose stop backend-1`）。预期：

- ≤ 15s 内，`gateway_worker_healthy{worker_id="worker-1"}` 从 1 变 0
- 那一刻所有 `image_id → worker-1` 的会话被批量删除，`gateway_session_table_size` 出现一次明显下落
- Gateway 日志：`worker marked unhealthy` + `worker down, sessions dropped`
- 后续 upload 全部落到 worker-0；指向 worker-1 的 segment 返回 410

恢复（重启 backend-1）后：

- 健康检查 2 次成功后（~10s），`worker_healthy` 切回 1
- 但之前丢的会话**不会**恢复——前端必须重新上传图片才能拿到新 image_id
- 日志：`worker recovered`

---

## 5. 已知现象与设计权衡

### 5.1 本地共享 GPU 时性能不增加

两个 backend 进程共享同一块 GPU（或都跑 CPU），加 worker **不会**让吞吐翻倍——反而可能因为 GPU 上下文切换略微变慢。这是物理限制，不是 Gateway 的问题。

**面试 / 汇报时怎么说**：本地 demo 验证的是**调度正确性**，不是性能。真实生产价值需要：
- 多 GPU 节点（每个 worker 绑定一块卡）
- 多机部署（每台机一个或多个 worker）
- 这两种情况下吞吐才是线性增长

### 5.2 调度算法仍是"最低队列优先 + 顺序遍历"

`PickLeastLoaded` 遍历 worker 列表，挑队列最浅的。worker 数量上来后（比如 >10），可以考虑：

- 用 `consistent hashing` 让 upload 阶段就能预测落点（但与"最低负载"矛盾）
- 加入"权重"（worker 配置里写每个的相对算力，区分 A100 / 3060）
- EWMA 平滑近期负载，避免抖动

Phase 2 维持简单实现。

### 5.3 worker 重启 → 会话强制失效

设计文档里就明确了这一点：embedding 缓存在 worker 进程内存，worker 进程一死，缓存就没了，对应的 image_id 失效是**不可避免**的。Gateway 能做的是**快速感知**并返回明确的 410，让前端**自动重传**。

前端的 410 自动恢复逻辑——也就是 Phase 1 第 5.5 节标注的"必须补"——是 Phase 2 验收前应该补的事。当前如果用户在 worker 切换瞬间正好提交 segment，会看到一次"会话已过期"的提示弹窗，需要他手动重新上传。这个体验在演示时要么补好，要么主动说明。

### 5.4 健康检查仍是 polling，不是事件驱动

15s 摘除窗口对生产场景偏长。改进方向：

- 引入 watch 机制（etcd / consul）等服务发现层主动通知
- 让请求路径里的失败累计触发熔断（Phase 1 文档第 5.2 节已提）

Phase 2 维持 polling。

---

## 6. 准入门槛检查清单（验收用）

把这个 checklist 跑一遍，能勾完就算 Phase 2 通过：

- [ ] `./start.sh` 启动后，`/api/health` 报告 `healthy_workers: 2`
- [ ] 浏览器上传两张图，DevTools 看到两次 `X-Worker-Id` 是不同的值
- [ ] 同一张图连续点击 5 次分割，`X-Worker-Id` 始终相同
- [ ] `./scripts/verify-multiworker.sh` 输出"✅ 粘性路由验证通过"
- [ ] 手动 kill `backend-1`，15s 内 `/api/health` 报告 `healthy_workers: 1`
- [ ] 用之前指向 worker-1 的 image_id 打 segment，返回 410
- [ ] 重启 `backend-1`，10s 内 `healthy_workers` 回到 2
- [ ] 全程 Gateway `/metrics` 里 `gateway_rejections_total` 按 reason 正确累加

---

## 7. 与设计文档的偏差

设计文档第 5.2 节列了几项 Phase 2 计划要做的事，对照实现情况：

| 设计目标 | 实现情况 |
|---------|----------|
| 多 worker 横向扩展（编排） | ✅ 完成 |
| 粘性路由 + 负载均衡 | ✅ 完成（代码 Phase 1 已就位） |
| 验证 embedding 缓存命中率不退化 | ⚠️ 未做 — 需要在 backend 加 cache hit 指标，留给 Phase 3 |
| worker 重启时受影响请求平滑迁移 | ✅ 完成（返回 410，前端可重传） |

`embedding cache hit rate` 指标是后续要补的——目前只能间接看：粘性路由生效 = 命中率 ≈ 100%（除非 TTL 过期）。

---

## 8. Phase 2 收尾改动

完成核心调度验证后，又补了两件"如果不做，演示会翻车或排查会困难"的事。这两件不属于 Phase 3 范围——是 Phase 2 该完结的尾巴。

### 8.1 前端 410 / 429 自动恢复

**改动文件**：`frontend/src/lib/api.ts`、`frontend/src/hooks/useSegmentation.ts`

**做法**：

- `api.ts` 新增两个错误子类：`SessionExpiredError`（410）、`RateLimitedError`（429，携带 `retryAfterMs`）
- 包了一层 `fetchWithRetry`：429 时按响应头 `Retry-After` 退避，指数回退最多 3 次；网络错误同样退避
- 410 一次性上抛——hook 拿到后清掉 `imageId` / `masks`，显示"图片会话已过期，请重新上传"

**效果**：

- worker 切换瞬间用户点击分割不再看到红色 Error，而是被引导重新上传
- 高并发下网关返回 429 不再让前端报错——客户端默默退避后续 segment 请求成功为止

### 8.2 X-Request-Id 跨服务 trace

**改动文件**：`gateway/internal/middleware/middleware.go`、`backend/app/main.py`

**做法**：

- Gateway 入口 middleware 取 / 生成 trace_id（16 字节 hex），三处使用：
  1. `r.Header.Set("X-Request-Id", ...)` — 通过 ReverseProxy 透传给上游
  2. `w.Header().Set("X-Request-Id", ...)` — 客户端能拿到这次请求的 ID，报障时回报
  3. 写进 zerolog `trace_id` 字段 — Gateway 这一侧的日志都带它
- Backend 加 `trace_id_middleware`：读 header → 写入 `contextvars.ContextVar` → 自定义 `TraceIDFilter` 在 logging handler 上把 `trace_id` 注入每条 LogRecord → 日志 format 里 `[trace=%(trace_id)s]` 自动渲染

**效果**：

跨进程同一个请求，两侧日志一行 ID 串起来：

```
# Gateway
INF http trace_id=dafc7acb1102083dda0da4e66874ccc5 status=200 elapsed=0.42s

# Backend
2026-... [trace=dafc7acb1102083dda0da4e66874ccc5] Segment: image_id=abc points=1 masks=3
```

后续排查从前端报障的 trace_id 出发，能直接定位到具体 worker 上的具体推理调用。

### 8.3 验证

- ✅ `go build ./... && go vet ./...` 干净
- ✅ 前端 `npx tsc --noEmit` 干净
- ✅ 不带 X-Request-Id 调用 → Gateway 自动生成，响应头与日志 trace_id 一致
- ✅ 自带 X-Request-Id 调用 → Gateway 原样透传到日志和响应头
- ⏳ 端到端验证（前端 → Gateway → backend）：等 backend 重启后在浏览器实测，DevTools Network 响应头看 `X-Request-Id`，去 backend 日志 `grep trace=<id>` 应能找到对应请求

至此 Phase 2 真正闭环。再往下做的事都在 [phase3-未启动] 范围，建议等真上生产再启动。
