package downloader

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"

	"capture/backend/internal/config"
	"capture/backend/internal/store"
)

// Queue sends media IDs for download. Non-blocking; if the channel is full the
// IDs are dropped (the periodic DB scan will pick them up).
func Queue(ch chan int64, ids []int64) {
	for _, id := range ids {
		select {
		case ch <- id:
		default:
			slog.Warn("download queue full, dropping id", "media_id", id)
		}
	}
}

// Enqueue returns a function that pushes IDs into the given channel.
func Enqueue(ch chan int64) func([]int64) {
	return func(ids []int64) {
		Queue(ch, ids)
	}
}

type Downloader struct {
	store  *store.Store
	cfg    *config.Config
	client *downloadClient
	queue  chan int64
	active atomic.Int32
}

func New(s *store.Store, cfg *config.Config) *Downloader {
	d := &Downloader{
		store:  s,
		cfg:    cfg,
		client: newDownloadClient(cfg),
		queue:  make(chan int64, 1024),
	}
	for i := 0; i < cfg.DownloadWorkers; i++ {
		go d.worker()
	}
	go d.scanner()
	return d
}

func (d *Downloader) Queue() chan int64 { return d.queue }

const maxRetries = 5

func (d *Downloader) scanner() {
	n, err := d.store.ResetStuckDownloading(context.Background())
	if err != nil {
		slog.Error("reset stuck downloading", "error", err)
	} else if n > 0 {
		slog.Info("reset stuck downloading rows", "count", n)
	}
	d.enqueueRetryable()

	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for range tick.C {
		d.enqueueRetryable()
	}
}

func (d *Downloader) enqueueRetryable() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ids, err := d.store.FindRetryable(ctx, maxRetries, 50)
	if err != nil {
		slog.Error("find retryable", "error", err)
		return
	}
	Queue(d.queue, ids)
}

func (d *Downloader) worker() {
	for id := range d.queue {
		d.active.Add(1)
		d.process(id)
		d.active.Add(-1)
	}
}

func (d *Downloader) process(id int64) {
	ctx, cancel := context.WithTimeout(context.Background(), d.cfg.DownloadTimeout)
	defer cancel()

	m, err := d.store.ClaimMedia(ctx, id)
	if err != nil {
		slog.Error("claim media", "id", id, "error", err)
		return
	}
	if m == nil {
		return
	}

	slog.Info("downloading", "id", m.ID, "url", m.OriginalURL, "attempt", m.Attempts)

	localPath, info, reason := d.client.fetch(ctx, m)
	if reason != "" {
		slog.Warn("download failed", "id", m.ID, "url", m.OriginalURL, "reason", reason)
		if err := d.store.MarkFailed(ctx, m.ID, reason); err != nil {
			slog.Error("mark failed", "id", m.ID, "error", err)
		}
		return
	}

	if err := d.store.MarkDownloaded(ctx, m.ID, *info); err != nil {
		slog.Error("mark downloaded", "id", m.ID, "error", err)
		return
	}
	slog.Info("downloaded", "id", m.ID, "path", localPath)
}
