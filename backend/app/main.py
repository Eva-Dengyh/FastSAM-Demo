import contextvars
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import health, segment, upload
from app.services.sam_service import sam_service

# 跨 await 边界的 trace_id，由 X-Request-Id middleware 设置，由 logging filter 注入到每条 log
trace_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("trace_id", default="-")


class TraceIDFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.trace_id = trace_id_var.get()
        return True


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - [trace=%(trace_id)s] %(message)s",
)
# 给所有 root handler 挂 filter，确保 format 里的 %(trace_id)s 永远有值
for _h in logging.getLogger().handlers:
    _h.addFilter(TraceIDFilter())

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时加载模型，关闭时释放资源"""
    sam_service.load(settings.model_cfg, settings.checkpoint_path)
    yield
    sam_service.unload()


app = FastAPI(
    title="FastSAM Demo API",
    description="基于 SAM 2.1 的交互式图像分割服务",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


# 给所有响应加 worker 标识，Gateway 用来回填会话表、排查粘性路由
@app.middleware("http")
async def attach_worker_id(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Worker-Id"] = settings.worker_id
    return response


# X-Request-Id 跨服务 trace：读 Gateway 透传的 ID（没有则自生成），挂到 contextvar
# 让本次请求处理期间所有日志都带 trace_id，便于跨进程关联
@app.middleware("http")
async def trace_id_middleware(request: Request, call_next):
    trace_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    token = trace_id_var.set(trace_id)
    try:
        response = await call_next(request)
        response.headers["X-Request-Id"] = trace_id
        return response
    finally:
        trace_id_var.reset(token)


# 全局异常处理
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """捕获未处理的异常，返回友好错误信息并记录日志"""
    logger.exception("Unhandled error: %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": {"code": "INTERNAL_ERROR", "message": "服务器内部错误，请稍后重试"}},
    )


# 注册路由
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(segment.router, prefix="/api", tags=["segment"])
