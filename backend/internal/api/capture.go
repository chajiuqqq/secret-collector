package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"capture/backend/internal/capture"
	"capture/backend/internal/store"

	"github.com/gin-gonic/gin"
)

// BuildCaptureRunner returns a RunFunc bound to this handler's store + runner
// + downloader. The returned function is what the Queue's worker invokes for
// each task; it updates the task in place (Phase, PostID, Platform,
// Duplicated, MediaCount) and returns an error to mark it failed.
func (h *Handler) BuildCaptureRunner() RunFunc {
	return func(ctx context.Context, t *Task) error {
		platform := capture.Detect(t.URL)
		if platform == "" {
			return errors.New("unsupported URL: only x.com, twitter.com, xiaohongshu.com, xhslink.com are supported")
		}
		t.Platform = platform
		setPhase(t, "fetching")

		runner := capture.NewRunner(h.MediaRoot)
		cp, err := runner.Run(ctx, t.URL)
		if err != nil {
			return err
		}

		setPhase(t, "writing")

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

		result, err := h.Store.CreateCapturedPost(ctx, store.CapturedPost{
			Platform:        cp.Platform,
			OriginalURL:     cp.OriginalURL,
			AuthorName:      cp.AuthorName,
			AuthorAvatarURL: cp.AuthorAvatarURL,
			Content:         cp.Content,
			PostedAt:        cp.PostedAt,
			Media:           media,
		})
		if err != nil {
			return fmt.Errorf("save post: %w", err)
		}

		if len(result.PendingDownloadIDs) > 0 {
			h.Enqueue(result.PendingDownloadIDs)
		}

		postID := result.PostID
		t.PostID = &postID
		t.Platform = cp.Platform
		t.Duplicated = result.Duplicated
		t.MediaCount = len(result.MediaIDs)
		return nil
	}
}

// BuildRetryMediaFunc returns a RetryMediaFunc that resets failed media on a
// post and re-enqueues them to the downloader pool.
func (h *Handler) BuildRetryMediaFunc() RetryMediaFunc {
	return func(ctx context.Context, postID int64) (int, error) {
		ids, err := h.Store.ResetFailedMedia(ctx, postID)
		if err != nil {
			return 0, err
		}
		if len(ids) > 0 {
			h.Enqueue(ids)
		}
		return len(ids), nil
	}
}

// setPhase atomically updates a task's Phase under the queue mutex. The
// queue mutex isn't accessible from here; phase updates only happen on the
// single worker goroutine and read happens under q.mu for snapshots, so a
// plain assignment is fine — but we keep this helper for readability and as
// a hook if locking changes.
func setPhase(t *Task, phase string) {
	t.Phase = phase
}

// Capture handler — POST /api/capture
//
// Accepts either `{url: "..."}` (legacy single) or `{urls: ["..."]}` (batch).
// Returns 200 + {tasks: [...]} with all newly-created task records. URLs
// that fail platform detection are rejected per-item in the response (with
// a synthetic task carrying status="error"); the request never returns 409.
func (h *Handler) Capture(c *gin.Context) {
	var req CaptureRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	urls := req.normalize()
	if len(urls) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "url(s) required"})
		return
	}

	// Pre-validate every URL so the caller knows which were rejected. Valid
	// ones are enqueued; invalid ones are pushed to the queue as already-failed
	// tasks so the SSE stream broadcasts them to all subscribers.
	var enqueueURLs []string
	var rejected []*Task
	for _, u := range urls {
		if capture.Detect(u) == "" {
			rejected = append(rejected, h.CaptureQueue.AddRejected(u,
				"unsupported URL: only x.com, twitter.com, xiaohongshu.com, xhslink.com are supported"))
			continue
		}
		enqueueURLs = append(enqueueURLs, u)
	}

	created := h.CaptureQueue.Enqueue(enqueueURLs)
	all := append([]*Task{}, created...)
	all = append(all, rejected...)

	c.JSON(http.StatusOK, CaptureTasksResponse{Tasks: toTaskDTOs(all)})
}

// CaptureList — GET /api/capture/tasks — returns the current snapshot.
func (h *Handler) CaptureList(c *gin.Context) {
	c.JSON(http.StatusOK, CaptureTasksResponse{Tasks: toTaskDTOs(h.CaptureQueue.Snapshot())})
}

// CaptureRetry — POST /api/capture/tasks/:id/retry
func (h *Handler) CaptureRetry(c *gin.Context) {
	id := c.Param("id")
	n, err := h.CaptureQueue.Retry(c.Request.Context(), id)
	if err != nil {
		if IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reenqueued": n})
}

// CaptureProgress streams the full task snapshot via SSE.
//
// Events fire on every state transition (worker notifies) and at most once
// per 300ms in any case (heartbeat). Each event payload is the same shape
// returned by GET /api/capture/tasks: {tasks: [...]}.
func (h *Handler) CaptureProgress(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	signal, unsubscribe := h.CaptureQueue.Subscribe()
	defer unsubscribe()

	// Initial push so the client doesn't wait for the first transition.
	c.SSEvent("progress", CaptureTasksResponse{Tasks: toTaskDTOs(h.CaptureQueue.Snapshot())})
	c.Writer.Flush()

	heartbeat := time.NewTicker(300 * time.Millisecond)
	defer heartbeat.Stop()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-signal:
			c.SSEvent("progress", CaptureTasksResponse{Tasks: toTaskDTOs(h.CaptureQueue.Snapshot())})
			c.Writer.Flush()
		case <-heartbeat.C:
			c.SSEvent("progress", CaptureTasksResponse{Tasks: toTaskDTOs(h.CaptureQueue.Snapshot())})
			c.Writer.Flush()
		}
	}
}

func toTaskDTOs(ts []*Task) []CaptureTaskDTO {
	out := make([]CaptureTaskDTO, len(ts))
	for i, t := range ts {
		out[i] = CaptureTaskDTO{
			ID:         t.ID,
			URL:        t.URL,
			Status:     t.Status,
			Phase:      t.Phase,
			PostID:     t.PostID,
			Platform:   t.Platform,
			Duplicated: t.Duplicated,
			MediaCount: t.MediaCount,
			Error:      t.Error,
			Attempts:   t.Attempts,
			CreatedAt:  t.CreatedAt,
			StartedAt:  t.StartedAt,
			FinishedAt: t.FinishedAt,
		}
	}
	return out
}
