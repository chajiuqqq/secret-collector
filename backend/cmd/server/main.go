package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"capture/backend/internal/api"
	"capture/backend/internal/config"
	"capture/backend/internal/downloader"
	"capture/backend/internal/store"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	s, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("connect database", "error", err)
		os.Exit(1)
	}
	defer s.Close()

	if err := s.Migrate(ctx); err != nil {
		slog.Error("migrate", "error", err)
		os.Exit(1)
	}

	// Backfill tags from existing posts on startup (use fresh context, not the migration timeout)
	bgCtx, bgCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer bgCancel()
	if err := s.BackfillTags(bgCtx); err != nil {
		slog.Error("backfill tags", "error", err)
		os.Exit(1)
	}

	fi, err := os.Stat(cfg.MediaRoot)
	if err != nil {
		if err := os.MkdirAll(cfg.MediaRoot, 0755); err != nil {
			slog.Error("create media root", "path", cfg.MediaRoot, "error", err)
			os.Exit(1)
		}
	} else if !fi.IsDir() {
		slog.Error("media root is not a directory", "path", cfg.MediaRoot)
		os.Exit(1)
	}

	dl := downloader.New(s, &cfg)

	h := &api.Handler{
		Store:     s,
		MediaRoot: cfg.MediaRoot,
		Enqueue:   downloader.Enqueue(dl.Queue()),
	}
	router := api.SetupRouter(h, &cfg)

	srv := &http.Server{
		Addr:    cfg.ListenAddr,
		Handler: router,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		slog.Info("shutting down", "signal", sig.String())
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()
		srv.Shutdown(shutdownCtx)
	}()

	slog.Info("listening", "addr", cfg.ListenAddr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
	slog.Info("stopped")
}
