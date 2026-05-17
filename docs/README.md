<!--
 * @Author: DengYH
 * @Date: 2026-05-17 18:45:22
-->
# FastSAM-Demo 文档中心

基于 SAM 2.1 的交互式图像分割 Web 应用 — 完整技术文档。

## 文档目录

| 文档 | 说明 |
|------|------|
| [architecture.md](./architecture.md) | 系统架构、技术选型、数据流 |
| [quickstart.md](./quickstart.md) | 5 分钟快速启动指南 |
| [api.md](./api.md) | RESTful API 接口文档（含 Gateway 错误码） |
| [frontend.md](./frontend.md) | Next.js + TypeScript 前端实现 |
| [backend.md](./backend.md) | FastAPI + SAM 2.1 后端详解 |
| [go/](./go/) | Go 推理网关分阶段实施纪要（Phase 1/2） |
| [model.md](./model.md) | SAM 2.1 模型原理与性能基准 |
| [deployment.md](./deployment.md) | 部署方案（本地/Colab/Docker） |
| [interview-guide.md](./interview-guide.md) | 面试展示策略 |
| [troubleshooting.md](./troubleshooting.md) | 常见问题排查 |

> Go 网关本身的接口契约（路由、错误码、配置）在 [`gateway/README.md`](../gateway/README.md)；`docs/go/` 记录的是分阶段的实现纪要与设计决策。

## 阅读建议

- **开发者**: 先看 [architecture.md](./architecture.md)，再看 [api.md](./api.md)，最后翻 [go/phase2.md](./go/phase2.md) 看多 worker 调度
- **快速体验**: 直接看 [quickstart.md](./quickstart.md)
- **深入理解**: architecture → go/phase1 → go/phase2 → backend → frontend
