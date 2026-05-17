package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"fastsam-gateway/internal/config"
	"fastsam-gateway/internal/metrics"
	"fastsam-gateway/internal/pool"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// readJSONBody 全量读出 body 并把 r.Body 重置回原始字节流，以便 ReverseProxy 继续读。
// 只用于小 JSON（segment 请求体），不要用于 multipart 上传。
func readJSONBody(r *http.Request, dst any) error {
	b, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	_ = r.Body.Close()
	r.Body = io.NopCloser(bytes.NewReader(b))
	r.ContentLength = int64(len(b))
	return json.Unmarshal(b, dst)
}

func writeJSON(w http.ResponseWriter, status int, payload string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(payload))
}

type Handler struct {
	pool   *pool.Pool
	cfg    *config.Config
}

func New(p *pool.Pool, cfg *config.Config) *Handler {
	return &Handler{pool: p, cfg: cfg}
}

// Mount 把所有路由注册到 chi router。
func (h *Handler) Mount(r chi.Router) {
	prefix := strings.TrimRight(h.cfg.APIPrefix, "/")
	r.Route(prefix, func(r chi.Router) {
		r.Get("/health", h.GatewayHealth)
		r.Post("/upload", h.Upload)
		r.Post("/segment", h.Segment)
	})
}

// GatewayHealth 由 Gateway 自己回答，**不**转发到 worker。
// 用于让前端和负载均衡器探测 Gateway 本身是否在线。
func (h *Handler) GatewayHealth(w http.ResponseWriter, r *http.Request) {
	workers := h.pool.Workers()
	type workerStatus struct {
		ID         string `json:"id"`
		Healthy    bool   `json:"healthy"`
		QueueDepth int    `json:"queue_depth"`
	}
	statuses := make([]workerStatus, 0, len(workers))
	healthyCount := 0
	for _, wk := range workers {
		if wk.Healthy() {
			healthyCount++
		}
		statuses = append(statuses, workerStatus{
			ID:         wk.ID(),
			Healthy:    wk.Healthy(),
			QueueDepth: wk.QueueDepth(),
		})
	}
	resp := map[string]any{
		"status":         "ok",
		"role":           "gateway",
		"healthy_workers": healthyCount,
		"total_workers":  len(workers),
		"workers":        statuses,
	}
	w.Header().Set("Content-Type", "application/json")
	if healthyCount == 0 {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// Upload 选最低负载的健康 worker，流式转发 multipart 上传。
// 拿到响应里的 image_id 后，由 pool.ModifyResponse 写入 SessionTable。
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	worker := h.pool.PickLeastLoaded()
	if worker == nil {
		metrics.Rejections.WithLabelValues("unhealthy").Inc()
		writeJSON(w, http.StatusServiceUnavailable,
			`{"detail":{"code":"NO_WORKER","message":"无可用推理节点"}}`)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.cfg.RequestTimeout())
	defer cancel()
	r = r.WithContext(ctx)

	if err := worker.Submit(w, r); err != nil {
		h.handleSubmitError(w, err, http.StatusTooManyRequests /* fallback */)
		return
	}
}

// Segment 必须命中已存在的 image_id 会话，否则 410。
func (h *Handler) Segment(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ImageID string `json:"image_id"`
	}
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest,
			`{"detail":{"code":"BAD_REQUEST","message":"请求体不是合法 JSON"}}`)
		return
	}
	if body.ImageID == "" {
		writeJSON(w, http.StatusBadRequest,
			`{"detail":{"code":"MISSING_IMAGE_ID","message":"缺少 image_id"}}`)
		return
	}

	worker := h.pool.PickByImageID(body.ImageID)
	if worker == nil {
		metrics.Rejections.WithLabelValues("session_missing").Inc()
		log.Info().Str("image_id", body.ImageID).Msg("session not found, returning 410")
		writeJSON(w, http.StatusGone,
			`{"detail":{"code":"SESSION_EXPIRED","message":"图片会话已过期，请重新上传"}}`)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.cfg.RequestTimeout())
	defer cancel()
	r = r.WithContext(ctx)

	if err := worker.Submit(w, r); err != nil {
		h.handleSubmitError(w, err, http.StatusTooManyRequests)
		return
	}
}

func (h *Handler) handleSubmitError(w http.ResponseWriter, err error, _ int) {
	switch {
	case errors.Is(err, pool.ErrQueueFull):
		metrics.Rejections.WithLabelValues("queue_full").Inc()
		w.Header().Set("Retry-After", strconv.Itoa(2))
		writeJSON(w, http.StatusTooManyRequests,
			`{"detail":{"code":"QUEUE_FULL","message":"网关繁忙，请稍后重试"}}`)
	case errors.Is(err, pool.ErrUnhealthy):
		metrics.Rejections.WithLabelValues("unhealthy").Inc()
		w.Header().Set("Retry-After", strconv.Itoa(5))
		writeJSON(w, http.StatusServiceUnavailable,
			`{"detail":{"code":"WORKER_UNHEALTHY","message":"推理节点不可用"}}`)
	default:
		writeJSON(w, http.StatusInternalServerError,
			`{"detail":{"code":"INTERNAL_ERROR","message":"网关内部错误"}}`)
	}
}
