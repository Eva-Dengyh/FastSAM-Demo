package pool

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"

	"fastsam-gateway/internal/config"
	"fastsam-gateway/internal/metrics"
	"fastsam-gateway/internal/session"

	"github.com/rs/zerolog/log"
)

var (
	ErrQueueFull = errors.New("worker queue full")
	ErrUnhealthy = errors.New("worker unhealthy")
	ErrNoWorker  = errors.New("no worker available")
)

// Job 是一次代理转发任务，handler 投递后阻塞在 done 上。
type Job struct {
	w    http.ResponseWriter
	r    *http.Request
	done chan struct{}
}

// Worker 封装单个上游 FastAPI 后端：有界 channel + N 个消费 goroutine + ReverseProxy。
type Worker struct {
	id          string
	upstream    *url.URL
	maxInflight int
	queue       chan *Job
	proxy       *httputil.ReverseProxy
	healthy     atomic.Bool

	stopCh   chan struct{}
	stopOnce sync.Once
	wg       sync.WaitGroup
}

func newWorker(cfg config.WorkerConfig, sessions *session.Table, apiPrefix string) (*Worker, error) {
	u, err := url.Parse(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("parse worker url %q: %w", cfg.URL, err)
	}

	w := &Worker{
		id:          cfg.ID,
		upstream:    u,
		maxInflight: cfg.MaxInflight,
		queue:       make(chan *Job, cfg.MaxQueue),
		stopCh:      make(chan struct{}),
	}
	// 启动时默认 unhealthy；首次健康探测成功后才接收流量，避免冷启动假健康窗口
	w.healthy.Store(false)

	proxy := httputil.NewSingleHostReverseProxy(u)
	proxy.ModifyResponse = w.makeModifyResponse(sessions, apiPrefix)
	proxy.ErrorHandler = w.errorHandler
	w.proxy = proxy

	return w, nil
}

// Start 启动 maxInflight 个消费 goroutine。
// 自然限制 in-flight=maxInflight，无需额外信号量。
func (w *Worker) Start() {
	for i := 0; i < w.maxInflight; i++ {
		w.wg.Add(1)
		go w.consume()
	}
}

func (w *Worker) consume() {
	defer w.wg.Done()
	for {
		select {
		case <-w.stopCh:
			return
		case job, ok := <-w.queue:
			if !ok {
				return
			}
			metrics.QueueDepth.WithLabelValues(w.id).Set(float64(len(w.queue)))
			metrics.Inflight.WithLabelValues(w.id).Inc()
			w.proxy.ServeHTTP(job.w, job.r)
			metrics.Inflight.WithLabelValues(w.id).Dec()
			close(job.done)
		}
	}
}

// Submit 投递任务并阻塞等待完成。
// 队列满立即返回 ErrQueueFull；worker 不健康返回 ErrUnhealthy。
func (w *Worker) Submit(rw http.ResponseWriter, r *http.Request) error {
	if !w.healthy.Load() {
		return ErrUnhealthy
	}
	job := &Job{w: rw, r: r, done: make(chan struct{})}
	select {
	case w.queue <- job:
		metrics.QueueDepth.WithLabelValues(w.id).Set(float64(len(w.queue)))
	default:
		return ErrQueueFull
	}
	<-job.done
	return nil
}

func (w *Worker) ID() string         { return w.id }
func (w *Worker) Upstream() *url.URL { return w.upstream }
func (w *Worker) QueueDepth() int    { return len(w.queue) }
func (w *Worker) Healthy() bool      { return w.healthy.Load() }

func (w *Worker) SetHealthy(h bool) {
	w.healthy.Store(h)
	v := 0.0
	if h {
		v = 1.0
	}
	metrics.WorkerHealthy.WithLabelValues(w.id).Set(v)
}

func (w *Worker) Stop() {
	w.stopOnce.Do(func() { close(w.stopCh) })
	w.wg.Wait()
}

// makeModifyResponse 拦截 upload 响应，把 image_id → worker_id 写入 SessionTable。
// 不修改 body 内容，只透传。
func (w *Worker) makeModifyResponse(sessions *session.Table, apiPrefix string) func(*http.Response) error {
	uploadPath := strings.TrimRight(apiPrefix, "/") + "/upload"
	return func(resp *http.Response) error {
		// 总是给响应打 worker 标签，方便排查
		resp.Header.Set("X-Worker-Id", w.id)

		if resp.Request == nil {
			return nil
		}
		if resp.StatusCode != http.StatusOK {
			return nil
		}
		if !strings.HasSuffix(resp.Request.URL.Path, uploadPath) {
			return nil
		}

		// upload 响应是小 JSON，全量读取是可接受的
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return fmt.Errorf("read upload response: %w", err)
		}
		_ = resp.Body.Close()
		resp.Body = io.NopCloser(bytes.NewReader(body))

		var parsed struct {
			ImageID string `json:"image_id"`
		}
		if err := json.Unmarshal(body, &parsed); err != nil {
			log.Warn().Err(err).Str("worker_id", w.id).Msg("parse upload response failed")
			return nil // 不阻塞响应，仅放弃记录会话
		}
		if parsed.ImageID != "" {
			sessions.Put(parsed.ImageID, w.id)
			log.Debug().Str("image_id", parsed.ImageID).Str("worker_id", w.id).Msg("session bound")
		}
		return nil
	}
}

// errorHandler 在上游不可达或 ctx 取消时被调用。
// 这里只负责返回友好错误；worker 健康状态由独立的 health checker 维护。
func (w *Worker) errorHandler(rw http.ResponseWriter, r *http.Request, err error) {
	metrics.Rejections.WithLabelValues("upstream_error").Inc()
	log.Warn().Err(err).Str("worker_id", w.id).Str("path", r.URL.Path).Msg("upstream error")

	if errors.Is(err, http.ErrAbortHandler) {
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	if r.Context().Err() != nil {
		rw.WriteHeader(http.StatusGatewayTimeout)
		_, _ = rw.Write([]byte(`{"detail":{"code":"UPSTREAM_TIMEOUT","message":"上游服务超时"}}`))
		return
	}
	rw.WriteHeader(http.StatusBadGateway)
	_, _ = rw.Write([]byte(`{"detail":{"code":"UPSTREAM_ERROR","message":"上游服务不可用"}}`))
}

// Pool 管理所有 worker，并提供路由选择策略。
type Pool struct {
	workers   []*Worker
	byID      map[string]*Worker
	sessions  *session.Table
	apiPrefix string
}

func New(cfg *config.Config, sessions *session.Table) (*Pool, error) {
	p := &Pool{
		byID:      make(map[string]*Worker, len(cfg.Workers)),
		sessions:  sessions,
		apiPrefix: cfg.APIPrefix,
	}
	for _, wc := range cfg.Workers {
		w, err := newWorker(wc, sessions, cfg.APIPrefix)
		if err != nil {
			return nil, err
		}
		metrics.WorkerHealthy.WithLabelValues(w.id).Set(0)
		p.workers = append(p.workers, w)
		p.byID[w.id] = w
	}
	return p, nil
}

func (p *Pool) Start() {
	for _, w := range p.workers {
		w.Start()
	}
}

func (p *Pool) Stop() {
	for _, w := range p.workers {
		w.Stop()
	}
}

func (p *Pool) Workers() []*Worker { return p.workers }

func (p *Pool) Get(id string) *Worker { return p.byID[id] }

// PickByImageID 优先粘性路由；image_id 不在会话表里时返回 nil（调用方决定怎么处理）。
func (p *Pool) PickByImageID(imageID string) *Worker {
	workerID, ok := p.sessions.Get(imageID)
	if !ok {
		return nil
	}
	w := p.byID[workerID]
	if w == nil || !w.Healthy() {
		// worker 已被摘除：清理孤儿会话
		p.sessions.Delete(imageID)
		return nil
	}
	return w
}

// PickLeastLoaded 为新会话（upload）选 worker：健康且队列最浅的优先。
func (p *Pool) PickLeastLoaded() *Worker {
	var pick *Worker
	bestDepth := -1
	for _, w := range p.workers {
		if !w.Healthy() {
			continue
		}
		d := w.QueueDepth()
		if pick == nil || d < bestDepth {
			pick = w
			bestDepth = d
		}
	}
	return pick
}

// OnWorkerDown 健康检查器在摘除 worker 时调用——清空它的会话。
func (p *Pool) OnWorkerDown(workerID string) {
	dropped := p.sessions.DropByWorker(workerID)
	if dropped > 0 {
		log.Warn().Str("worker_id", workerID).Int("dropped_sessions", dropped).Msg("worker down, sessions dropped")
	}
}
