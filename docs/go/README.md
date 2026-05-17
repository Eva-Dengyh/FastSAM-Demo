# Go 网关相关文档

本目录记录 Go Gateway 改造的分阶段实施过程。设计原文档在上一层 [`gateway-design.md`](../gateway-design.md)，下面是各阶段的实现纪要。

| 文档 | 阶段 | 状态 |
|------|------|------|
| [phase1.md](./phase1.md) | 单 worker + Gateway 链路打通 | ✅ 完成 |
| [phase2.md](./phase2.md) | 多 worker 横向扩展（粘性路由 + 负载均衡） | ✅ 完成 |
| _phase3.md_（计划中） | Redis 共享 SessionTable / 加权调度 / trace_id 贯穿 | ⏳ 未启动 |

阅读顺序：先看 `gateway-design.md` 理解整体思路，再按 phase 顺序读实现纪要。
