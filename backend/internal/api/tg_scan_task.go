package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

var (
	scanMu   sync.Mutex
	scanTask *tgScanTask
)

type tgScanTask struct {
	ID        string          `json:"id"`
	Status    string          `json:"status"` // "running" | "done"
	Progress  tgScanProgress  `json:"progress"`
	Result    *TgScanResponse `json:"result,omitempty"`
	StartedAt time.Time       `json:"started_at"`

	ctx    context.Context
	cancel context.CancelFunc
}

func newScanTask() *tgScanTask {
	ctx, cancel := context.WithCancel(context.Background())
	return &tgScanTask{
		ID:        generateTaskID(),
		Status:    "running",
		StartedAt: time.Now(),
		Progress:  tgScanProgress{Phase: "parsing"},
		ctx:       ctx,
		cancel:    cancel,
	}
}

func (t *tgScanTask) Context() context.Context { return t.ctx }

type tgScanProgress struct {
	Phase         string `json:"phase"` // "parsing" | "linking" | "writing"
	TotalMessages int    `json:"total_messages"`
	Processed     int    `json:"processed"`
	MediaFound    int    `json:"media_found"`
	MediaMissing  int    `json:"media_missing"`
	PostsWritten  int    `json:"posts_written"`
	PostsSkipped  int    `json:"posts_skipped"`
}

func generateTaskID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (h *Handler) TgScanProgress(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			scanMu.Lock()
			task := scanTask
			scanMu.Unlock()
			if task == nil {
				c.SSEvent("error", gin.H{"message": "no task"})
				return
			}
			c.SSEvent("progress", task)
			if task.Status == "done" {
				return
			}
		}
	}
}
