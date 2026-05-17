package main

import (
	"context"
	"errors"
	"flag"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"fastsam-gateway/internal/config"
	"fastsam-gateway/internal/handler"
	"fastsam-gateway/internal/health"
	gwmw "fastsam-gateway/internal/middleware"
	"fastsam-gateway/internal/pool"
	"fastsam-gateway/internal/session"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	configPath := flag.String("config", "configs/gateway.yaml", "path to gateway.yaml")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatal().Err(err).Str("path", *configPath).Msg("load config failed")
	}

	setupLogger(cfg.LogLevel)

	sessions := session.New(cfg.SessionTTL())
	wpool, err := pool.New(cfg, sessions)
	if err != nil {
		log.Fatal().Err(err).Msg("build worker pool failed")
	}
	wpool.Start()
	defer wpool.Stop()

	rootCtx, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()

	// 后台任务：会话清理 + 健康探测
	go sessions.RunSweeper(rootCtx, time.Minute)
	checker := health.New(wpool, cfg.Health, cfg.APIPrefix)
	go checker.Run(rootCtx)

	r := chi.NewRouter()
	r.Use(gwmw.Recover)

	// 业务路由（带 metrics 标签）
	apiObserve := gwmw.Observe("api")
	r.Group(func(r chi.Router) {
		r.Use(apiObserve)
		handler.New(wpool, cfg).Mount(r)
	})

	// 指标端点（不参与业务 metrics 统计，避免自污染）
	r.Handle("/metrics", promhttp.Handler())

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Info().Str("listen", cfg.Listen).Int("workers", len(cfg.Workers)).Msg("gateway started")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal().Err(err).Msg("http server failed")
		}
	}()

	// 优雅关闭：等信号，停止接收新连接，等 in-flight 完成
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Info().Str("signal", sig.String()).Msg("shutdown requested")

	cancelRoot()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("graceful shutdown failed")
	}
}

func setupLogger(level string) {
	zerolog.TimeFieldFormat = time.RFC3339
	lvl, err := zerolog.ParseLevel(level)
	if err != nil || level == "" {
		lvl = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(lvl)
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339})
}
