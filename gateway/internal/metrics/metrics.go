package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	RequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_requests_total",
		Help: "Total HTTP requests handled by the gateway.",
	}, []string{"route", "status"})

	RequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "gateway_request_duration_seconds",
		Help:    "End-to-end HTTP request duration in seconds.",
		Buckets: prometheus.ExponentialBuckets(0.01, 2, 12),
	}, []string{"route"})

	QueueDepth = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "gateway_queue_depth",
		Help: "Current per-worker queue depth.",
	}, []string{"worker_id"})

	Inflight = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "gateway_inflight",
		Help: "Current per-worker in-flight inference count.",
	}, []string{"worker_id"})

	WorkerHealthy = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "gateway_worker_healthy",
		Help: "1 if worker is healthy, 0 otherwise.",
	}, []string{"worker_id"})

	SessionTableSize = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "gateway_session_table_size",
		Help: "Current size of the image_id -> worker_id session table.",
	})

	Rejections = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_rejections_total",
		Help: "Requests rejected by the gateway, grouped by reason.",
	}, []string{"reason"}) // queue_full / unhealthy / timeout / session_missing
)
