package health

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"fastsam-gateway/internal/config"
	"fastsam-gateway/internal/pool"

	"github.com/rs/zerolog/log"
)

// Checker 对每个 worker 定期 ping /health，按阈值切换健康状态。
type Checker struct {
	pool      *pool.Pool
	cfg       config.HealthConfig
	apiPrefix string
	client    *http.Client

	mu       sync.Mutex
	failures map[string]int // worker_id → 连续失败次数
	passes   map[string]int // worker_id → 连续成功次数（仅对当前 unhealthy 的 worker 计）
}

func New(p *pool.Pool, cfg config.HealthConfig, apiPrefix string) *Checker {
	return &Checker{
		pool:      p,
		cfg:       cfg,
		apiPrefix: apiPrefix,
		client: &http.Client{
			Timeout: time.Duration(cfg.TimeoutSeconds) * time.Second,
		},
		failures: make(map[string]int),
		passes:   make(map[string]int),
	}
}

func (c *Checker) Run(ctx context.Context) {
	interval := time.Duration(c.cfg.IntervalSeconds) * time.Second
	tk := time.NewTicker(interval)
	defer tk.Stop()
	c.checkAll(ctx) // 启动时立即做一轮，避免依赖第一次 tick
	for {
		select {
		case <-ctx.Done():
			return
		case <-tk.C:
			c.checkAll(ctx)
		}
	}
}

func (c *Checker) checkAll(ctx context.Context) {
	var wg sync.WaitGroup
	for _, w := range c.pool.Workers() {
		wg.Add(1)
		go func(w *pool.Worker) {
			defer wg.Done()
			c.probe(ctx, w)
		}(w)
	}
	wg.Wait()
}

func (c *Checker) probe(ctx context.Context, w *pool.Worker) {
	url := strings.TrimRight(w.Upstream().String(), "/") + strings.TrimRight(c.apiPrefix, "/") + "/health"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		c.recordFailure(w)
		return
	}
	resp, err := c.client.Do(req)
	if err != nil {
		c.recordFailure(w)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		c.recordFailure(w)
		return
	}
	c.recordSuccess(w)
}

func (c *Checker) recordFailure(w *pool.Worker) {
	c.mu.Lock()
	c.failures[w.ID()]++
	c.passes[w.ID()] = 0
	fails := c.failures[w.ID()]
	c.mu.Unlock()

	if w.Healthy() && fails >= c.cfg.UnhealthyThreshold {
		log.Warn().Str("worker_id", w.ID()).Int("failures", fails).Msg("worker marked unhealthy")
		w.SetHealthy(false)
		c.pool.OnWorkerDown(w.ID())
	}
}

func (c *Checker) recordSuccess(w *pool.Worker) {
	c.mu.Lock()
	c.failures[w.ID()] = 0
	c.passes[w.ID()]++
	passes := c.passes[w.ID()]
	c.mu.Unlock()

	if !w.Healthy() && passes >= c.cfg.HealthyThreshold {
		log.Info().Str("worker_id", w.ID()).Int("passes", passes).Msg("worker recovered")
		w.SetHealthy(true)
	}
}
