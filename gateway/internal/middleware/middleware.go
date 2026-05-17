package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"fastsam-gateway/internal/metrics"

	"github.com/rs/zerolog/log"
)

const TraceIDHeader = "X-Request-Id"

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

// newTraceID 生成 16 字节随机 hex，长度 32。
// 不严格遵循 UUID 格式（省一个依赖），但唯一性足够。
func newTraceID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand 失败时退化为时间戳，仍可读
		return hex.EncodeToString([]byte(time.Now().Format("20060102150405.999999")))
	}
	return hex.EncodeToString(b[:])
}

// Observe 记录请求指标 + 结构化访问日志，并生成/透传 X-Request-Id。
//
// trace_id 流向：
//   1. 客户端可以在请求头携带 X-Request-Id；没有则在此 middleware 生成
//   2. 写入 request header → ReverseProxy 透传给上游 backend，backend middleware 读出后挂到日志
//   3. 写入响应头 → 客户端能拿到这次请求的 trace_id，方便报障时回报
//   4. 写入本进程访问日志 → 排查时一个 ID 串联 Gateway + backend 两侧
func Observe(route string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			traceID := r.Header.Get(TraceIDHeader)
			if traceID == "" {
				traceID = newTraceID()
				r.Header.Set(TraceIDHeader, traceID)
			}
			w.Header().Set(TraceIDHeader, traceID)

			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w}
			next.ServeHTTP(rec, r)

			elapsed := time.Since(start)
			status := rec.status
			if status == 0 {
				status = http.StatusOK
			}

			metrics.RequestsTotal.WithLabelValues(route, http.StatusText(status)).Inc()
			metrics.RequestDuration.WithLabelValues(route).Observe(elapsed.Seconds())

			log.Info().
				Str("trace_id", traceID).
				Str("route", route).
				Str("method", r.Method).
				Int("status", status).
				Int("bytes", rec.bytes).
				Dur("elapsed", elapsed).
				Str("remote", r.RemoteAddr).
				Msg("http")
		})
	}
}

// Recover 捕获 handler panic 防止整个进程退出。
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Error().Interface("panic", rec).Str("path", r.URL.Path).Msg("handler panic")
				http.Error(w, `{"detail":{"code":"INTERNAL_ERROR","message":"网关内部错误"}}`, http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
