# Go 网关相关文档

本目录记录 Go Gateway 改造的分阶段实施过程。Gateway 自身的运行说明、路由、配置、错误语义在 [`gateway/README.md`](../../gateway/README.md)，下面是各阶段的实现纪要。

| 文档 | 阶段 | 状态 |
|------|------|------|
| [phase1.md](./phase1.md) | 单 worker + Gateway 链路打通 | ✅ 完成 |
| [phase2.md](./phase2.md) | 多 worker 横向扩展（粘性路由 + 负载均衡） | ✅ 完成 |

阅读顺序：先看 `gateway/README.md` 理解 Gateway 对外契约，再按 phase 顺序读实现纪要中的关键决策。
