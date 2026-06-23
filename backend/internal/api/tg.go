package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"capture/backend/internal/store"

	"github.com/gin-gonic/gin"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

type tgExport struct {
	ID       int64       `json:"id"`
	Name     string      `json:"name"`
	Type     string      `json:"type"`
	Messages []tgMessage `json:"messages"`
}

type tgMessage struct {
	ID        int64           `json:"id"`
	Date      json.RawMessage `json:"date"`
	File      string          `json:"file"`
	Text      string          `json:"text"`
	MediaType string          `json:"media_type"`
}

func parseDate(raw json.RawMessage) (*time.Time, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	if raw[0] == '"' {
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil, err
		}
		t, err := time.Parse("2006-01-02T15:04:05", strings.TrimSpace(s))
		if err != nil {
			return nil, err
		}
		return &t, nil
	}
	var unix int64
	if err := json.Unmarshal(raw, &unix); err != nil {
		return nil, err
	}
	t := time.Unix(unix, 0)
	return &t, nil
}

func (h *Handler) TgScan(c *gin.Context) {
	var req TgScanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	scanMu.Lock()
	if scanTask != nil && scanTask.Status == "running" {
		scanMu.Unlock()
		c.JSON(http.StatusConflict, gin.H{"error": "a scan task is already running"})
		return
	}

	task := newScanTask()
	scanTask = task
	scanMu.Unlock()

	go h.runScan(task, req)

	c.JSON(http.StatusAccepted, gin.H{"task_id": task.ID})
}

func (h *Handler) runScan(task *tgScanTask, req TgScanRequest) {
	slog.Info("tg scan started", "task_id", task.ID, "index", req.IndexPath)
	defer func() {
		scanMu.Lock()
		task.Status = "done"
		scanMu.Unlock()
	}()

	// Phase 1: parsing
	indexData, err := os.ReadFile(req.IndexPath)
	if err != nil {
		slog.Error("tg scan read index failed", "task_id", task.ID, "error", err)
		task.Result = &TgScanResponse{Errors: []string{fmt.Sprintf("read index: %v", err)}}
		return
	}

	var export tgExport
	if err := json.Unmarshal(indexData, &export); err != nil {
		slog.Error("tg scan parse json failed", "task_id", task.ID, "error", err)
		task.Result = &TgScanResponse{Errors: []string{fmt.Sprintf("parse json: %v", err)}}
		return
	}

	authorName := export.Name
	if authorName == "" {
		authorName = export.Type
	}
	if authorName == "" {
		authorName = "TG User"
	}

	totalMsgs := 0
	for _, msg := range export.Messages {
		if msg.File != "" {
			totalMsgs++
		}
	}

	scanMu.Lock()
	task.Progress.TotalMessages = totalMsgs
	scanMu.Unlock()

	slog.Info("tg scan phase", "task_id", task.ID, "phase", "parsing", "messages", totalMsgs)

	// Phase 2: linking
	slog.Info("tg scan phase", "task_id", task.ID, "phase", "linking")

	scanMu.Lock()
	task.Progress.Phase = "linking"
	scanMu.Unlock()

	var tgPosts []store.TgPost
	var scanErrors []string
	mediaFound, mediaMissing := 0, 0

	for _, msg := range export.Messages {
		if msg.File == "" {
			continue
		}

		fileName := fmt.Sprintf("%d_%d_%s", export.ID, msg.ID, msg.File)
		srcPath := filepath.Join(req.MediaDir, fileName)

		localPath, info, err := linkTgMedia(srcPath, h.MediaRoot)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				mediaMissing++
			} else {
				scanErrors = append(scanErrors, fmt.Sprintf("%s: %v", fileName, err))
			}
			updateProgress(task, mediaFound, mediaMissing, 0, 0)
			continue
		}

		kind := "image"
		if isVideo(msg.MediaType) {
			kind = "video"
		}

		var postedAt *time.Time
		if t, err := parseDate(msg.Date); err == nil {
			postedAt = t
		}

		mediaFound++

		tgPosts = append(tgPosts, store.TgPost{
			ChatID:     export.ID,
			MessageID:  msg.ID,
			AuthorName: authorName,
			Content:    strings.TrimSpace(msg.Text),
			PostedAt:   postedAt,
			Media: []store.TgMedia{{
				Kind:        kind,
				LocalPath:   localPath,
				ContentType: info.ContentType,
				SizeBytes:   info.SizeBytes,
				Width:       info.Width,
				Height:      info.Height,
			}},
		})

		updateProgress(task, mediaFound, mediaMissing, 0, 0)
		if mediaFound%100 == 0 {
			slog.Info("tg scan progress", "task_id", task.ID,
				"processed", mediaFound+mediaMissing, "found", mediaFound, "missing", mediaMissing)
		}
	}

	slog.Info("tg scan progress", "task_id", task.ID,
		"processed", mediaFound+mediaMissing, "found", mediaFound, "missing", mediaMissing)

	// Phase 3: writing
	slog.Info("tg scan phase", "task_id", task.ID, "phase", "writing", "posts", len(tgPosts))

	scanMu.Lock()
	task.Progress.Phase = "writing"
	task.Progress.TotalMessages = len(tgPosts)
	task.Progress.Processed = 0
	task.Progress.PostsWritten = 0
	task.Progress.PostsSkipped = 0
	scanMu.Unlock()

	result, err := h.Store.CreateTgPosts(task.Context(), tgPosts)
	if err != nil {
		slog.Error("tg scan create posts failed", "task_id", task.ID, "error", err)
		task.Result = &TgScanResponse{Errors: []string{fmt.Sprintf("create posts: %v", err)}}
		return
	}

	result.MediaFound = mediaFound
	result.MediaMissing = mediaMissing
	result.Errors = append(scanErrors, result.Errors...)

	scanResp := TgScanResponse{
		PostsCreated: result.PostsCreated,
		PostsSkipped: result.PostsSkipped,
		MediaFound:   mediaFound,
		MediaMissing: mediaMissing,
		Errors:       append(scanErrors, result.Errors...),
	}

	scanMu.Lock()
	task.Result = &scanResp
	task.Progress.Phase = "writing"
	task.Progress.Processed = result.PostsCreated + result.PostsSkipped
	task.Progress.PostsWritten = result.PostsCreated
	task.Progress.PostsSkipped = result.PostsSkipped
	task.Progress.MediaFound = mediaFound
	task.Progress.MediaMissing = mediaMissing
	scanMu.Unlock()

	slog.Info("tg scan done", "task_id", task.ID,
		"posts_created", result.PostsCreated, "posts_skipped", result.PostsSkipped,
		"media_found", mediaFound, "media_missing", mediaMissing,
		"errors", len(result.Errors))
}

func updateProgress(task *tgScanTask, found, missing, written, skipped int) {
	scanMu.Lock()
	task.Progress.Processed = found + missing
	task.Progress.MediaFound = found
	task.Progress.MediaMissing = missing
	task.Progress.PostsWritten = written
	task.Progress.PostsSkipped = skipped
	scanMu.Unlock()
}

func isVideo(mediaType string) bool {
	return mediaType == "video" || mediaType == "animation" || mediaType == "video_message"
}

func linkTgMedia(srcPath, mediaRoot string) (string, *store.DownloadedInfo, error) {
	f, err := os.Open(srcPath)
	if err != nil {
		return "", nil, err
	}
	defer f.Close()

	hasher := sha256.New()
	written, err := io.Copy(hasher, f)
	if err != nil {
		return "", nil, fmt.Errorf("hash: %w", err)
	}

	hash := hex.EncodeToString(hasher.Sum(nil))
	ext := strings.ToLower(filepath.Ext(srcPath))
	if ext == "" {
		ext = ".jpg"
	}

	rel := filepath.Join("tg", time.Now().UTC().Format("2006/01/02"),
		hash[:2], hash+ext)

	destDir := filepath.Join(mediaRoot, filepath.Dir(rel))
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return "", nil, fmt.Errorf("mkdir dest: %w", err)
	}

	destPath := filepath.Join(mediaRoot, rel)
	if _, err := os.Stat(destPath); os.IsNotExist(err) {
		if linkErr := os.Link(srcPath, destPath); linkErr != nil {
			if copyErr := copyFile(srcPath, destPath); copyErr != nil {
				return "", nil, fmt.Errorf("copy fallback: %w", copyErr)
			}
		}
	}
	os.Chmod(destPath, 0644)

	ct := detectContentTypeByExt(ext)
	info := &store.DownloadedInfo{
		LocalPath:   rel,
		ContentType: ct,
		SizeBytes:   written,
		SHA256:      hash,
	}

	if ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".gif" || ext == ".webp" || ext == ".bmp" {
		if w, h, err := decodeDimensions(destPath); err == nil {
			info.Width = &w
			info.Height = &h
		}
	}
	return rel, info, nil
}

func copyFile(src, dst string) error {
	sf, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sf.Close()

	df, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer df.Close()

	if _, err := io.Copy(df, sf); err != nil {
		os.Remove(dst)
		return err
	}
	return nil
}

func detectContentTypeByExt(ext string) string {
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".avi":
		return "video/x-msvideo"
	}
	return "application/octet-stream"
}

func decodeDimensions(path string) (int, int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0, err
	}
	return cfg.Width, cfg.Height, nil
}
