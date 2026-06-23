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
	// Try quoted string first: "2025-01-15T10:30:00"
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
	// Try Unix timestamp (number)
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

	indexData, err := os.ReadFile(req.IndexPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("read index file: %v", err)})
		return
	}

	var export tgExport
	if err := json.Unmarshal(indexData, &export); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("parse index json: %v", err)})
		return
	}

	authorName := export.Name
	if authorName == "" {
		authorName = export.Type
	}
	if authorName == "" {
		authorName = "TG User"
	}

	mediaFound, mediaMissing := 0, 0
	var tgPosts []store.TgPost
	var scanErrors []string

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
	}

	slog.Info("tg scan parsed", "total_messages", len(export.Messages),
		"posts", len(tgPosts), "media_found", mediaFound, "media_missing", mediaMissing)

	result, err := h.Store.CreateTgPosts(c.Request.Context(), tgPosts)
	if err != nil {
		slog.Error("create tg posts", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create posts"})
		return
	}

	result.MediaFound = mediaFound
	result.MediaMissing = mediaMissing
	result.Errors = append(scanErrors, result.Errors...)

	c.JSON(http.StatusOK, result)
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
