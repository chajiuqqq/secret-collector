package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"capture/backend/internal/capture"
	"capture/backend/internal/store"

	"github.com/gin-gonic/gin"
)

// captureTask tracks one in-flight URL capture. Same single-task pattern as
// tgScanTask: at most one task runs at a time; subsequent requests are rejected
// with 409 until the current one finishes.
type captureTask struct {
	ID        string         `json:"id"`
	Status    string         `json:"status"` // "running" | "done"
	Progress  captureProgress `json:"progress"`
	Result    *CaptureResult `json:"result,omitempty"`
	Error     string         `json:"error,omitempty"`
	StartedAt time.Time      `json:"started_at"`

	ctx    context.Context
	cancel context.CancelFunc
}

type captureProgress struct {
	// Phase progresses: "detecting" → "fetching" → "filing" → "writing" → "done"
	Phase string `json:"phase"`
	URL   string `json:"url"`
}

var (
	captureMu  sync.Mutex
	captureCur *captureTask
)

func newCaptureTask(rawURL string) *captureTask {
	ctx, cancel := context.WithCancel(context.Background())
	b := make([]byte, 8)
	rand.Read(b)
	return &captureTask{
		ID:        hex.EncodeToString(b),
		Status:    "running",
		StartedAt: time.Now(),
		Progress:  captureProgress{Phase: "detecting", URL: rawURL},
		ctx:       ctx,
		cancel:    cancel,
	}
}

// Capture is the public entry point: POST /api/capture {url}
// Returns 202 + task_id immediately; the actual work runs in a goroutine and
// progress is streamed via GET /api/capture/progress (SSE).
func (h *Handler) Capture(c *gin.Context) {
	var req CaptureRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	platform := capture.Detect(req.URL)
	if platform == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "unsupported URL: only x.com, twitter.com, xiaohongshu.com, xhslink.com are supported",
		})
		return
	}

	captureMu.Lock()
	if captureCur != nil && captureCur.Status == "running" {
		captureMu.Unlock()
		c.JSON(http.StatusConflict, gin.H{"error": "a capture task is already running"})
		return
	}
	task := newCaptureTask(req.URL)
	captureCur = task
	captureMu.Unlock()

	go h.runCapture(task, req.URL)

	c.JSON(http.StatusAccepted, CaptureResponse{TaskID: task.ID})
}

func (h *Handler) runCapture(task *captureTask, rawURL string) {
	slog.Info("capture started", "task_id", task.ID, "url", rawURL)
	defer func() {
		captureMu.Lock()
		task.Status = "done"
		captureMu.Unlock()
		slog.Info("capture done", "task_id", task.ID, "url", rawURL,
			"error", task.Error, "result", task.Result)
	}()

	// Phase 1: fetching (Python script does API call + yt-dlp for videos)
	setCapturePhase(task, "fetching")
	runner := capture.NewRunner(h.MediaRoot)
	cp, err := runner.Run(task.ctx, rawURL)
	if err != nil {
		task.Error = err.Error()
		return
	}

	// Phase 2: filing — already done inside runner.Run (local videos moved into MEDIA_ROOT).
	setCapturePhase(task, "writing")

	media := make([]store.CapturedMedia, 0, len(cp.RemoteMedia)+len(cp.LocalMedia))
	for _, m := range cp.RemoteMedia {
		media = append(media, store.CapturedMedia{Kind: m.Kind, URL: m.URL})
	}
	for _, m := range cp.LocalMedia {
		media = append(media, store.CapturedMedia{
			Kind:        m.Kind,
			LocalPath:   m.LocalPath,
			ContentType: m.ContentType,
			SizeBytes:   m.SizeBytes,
			SHA256:      m.SHA256,
			Width:       m.Width,
			Height:      m.Height,
		})
	}

	result, err := h.Store.CreateCapturedPost(task.ctx, store.CapturedPost{
		Platform:        cp.Platform,
		OriginalURL:     cp.OriginalURL,
		AuthorName:      cp.AuthorName,
		AuthorAvatarURL: cp.AuthorAvatarURL,
		Content:         cp.Content,
		PostedAt:        cp.PostedAt,
		Media:           media,
	})
	if err != nil {
		task.Error = fmt.Sprintf("save post: %v", err)
		return
	}

	if len(result.PendingDownloadIDs) > 0 {
		h.Enqueue(result.PendingDownloadIDs)
	}

	task.Result = &CaptureResult{
		PostID:      result.PostID,
		Platform:    cp.Platform,
		OriginalURL: cp.OriginalURL,
		Duplicated:  result.Duplicated,
		MediaCount:  len(result.MediaIDs),
	}
}

func setCapturePhase(task *captureTask, phase string) {
	captureMu.Lock()
	task.Progress.Phase = phase
	captureMu.Unlock()
}

// CaptureProgress streams the current task state via SSE.
// Same shape as TgScanProgress: tick every 300ms, emit "progress" event,
// stop when the task is done.
func (h *Handler) CaptureProgress(c *gin.Context) {
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
			captureMu.Lock()
			task := captureCur
			captureMu.Unlock()
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
