package middleware

import (
	"net/http"
	"time"

	"fastsam-gateway/internal/metrics"

	"github.com/rs/zerolog/log"
)

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

// Observe 记录请求指标 + 结构化访问日志。route 用于聚合标签（实际 URL 可能含 id）。
func Observe(route string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
