package downloader

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"capture/backend/internal/config"
	"capture/backend/internal/store"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

var ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

type downloadClient struct {
	httpClient *http.Client
	mediaRoot  string
	maxBytes   int64
}

func newDownloadClient(cfg *config.Config) *downloadClient {
	return &downloadClient{
		httpClient: &http.Client{Timeout: cfg.DownloadTimeout},
		mediaRoot:  cfg.MediaRoot,
		maxBytes:   cfg.MaxMediaBytes,
	}
}

func extraHeaders(host string) map[string]string {
	if strings.HasSuffix(host, "xhscdn.com") || strings.Contains(host, "xiaohongshu") {
		return map[string]string{"Referer": "https://www.xiaohongshu.com/"}
	}
	return nil
}

func (c *downloadClient) fetch(ctx context.Context, m *store.PendingMedia) (string, *store.DownloadedInfo, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.OriginalURL, nil)
	if err != nil {
		return "", nil, fmt.Sprintf("create request: %v", err)
	}
	req.Header.Set("User-Agent", ua)
	if h, ok := extractHost(m.OriginalURL); ok {
		for k, v := range extraHeaders(h) {
			req.Header.Set(k, v)
		}
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", nil, fmt.Sprintf("http get: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Sprintf("http status %d", resp.StatusCode)
	}

	ct := resp.Header.Get("Content-Type")
	if idx := strings.IndexByte(ct, ';'); idx >= 0 {
		ct = ct[:idx]
	}
	ct = strings.TrimSpace(ct)
	if ct == "text/html" || ct == "text/plain" {
		return "", nil, fmt.Sprintf("unexpected content-type: %s", ct)
	}

	if err := os.MkdirAll(filepath.Join(c.mediaRoot, "tmp"), 0755); err != nil {
		return "", nil, fmt.Sprintf("mkdir tmp: %v", err)
	}

	tmpFile, err := os.CreateTemp(filepath.Join(c.mediaRoot, "tmp"), "dl-*")
	if err != nil {
		return "", nil, fmt.Sprintf("create temp: %v", err)
	}
	tmpPath := tmpFile.Name()
	deleteTmp := true
	defer func() {
		tmpFile.Close()
		if deleteTmp {
			os.Remove(tmpPath)
		}
	}()

	hasher := sha256.New()
	limitRdr := io.LimitReader(resp.Body, c.maxBytes+1)
	written, err := io.Copy(tmpFile, io.TeeReader(limitRdr, hasher))
	if err != nil {
		return "", nil, fmt.Sprintf("write file: %v", err)
	}
	if written > c.maxBytes {
		return "", nil, "file too large"
	}

	hash := hex.EncodeToString(hasher.Sum(nil))
	ext := extFromContentType(ct, m.Kind)
	rel := filepath.Join(m.Platform, time.Now().UTC().Format("2006/01/02"),
		hash[:2], hash+ext)

	destDir := filepath.Join(c.mediaRoot, filepath.Dir(rel))
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return "", nil, fmt.Sprintf("mkdir dest: %v", err)
	}

	destPath := filepath.Join(c.mediaRoot, rel)
	if _, err := os.Stat(destPath); os.IsNotExist(err) {
		if err := os.Rename(tmpPath, destPath); err != nil {
			return "", nil, fmt.Sprintf("rename: %v", err)
		}
		deleteTmp = false
	} else {
		os.Remove(tmpPath)
		deleteTmp = true
	}
	os.Chmod(destPath, 0644)

	info := &store.DownloadedInfo{
		LocalPath:   rel,
		ContentType: ct,
		SizeBytes:   written,
		SHA256:      hash,
	}

	if m.Kind == "image" || m.Kind == "avatar" {
		if w, h, err := decodeDimensions(destPath); err == nil {
			info.Width = &w
			info.Height = &h
		}
	}
	return rel, info, ""
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

func extFromContentType(ct string, kind string) string {
	switch ct {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/bmp":
		return ".bmp"
	case "image/tiff":
		return ".tiff"
	case "video/mp4":
		return ".mp4"
	case "video/quicktime":
		return ".mov"
	case "video/webm":
		return ".webm"
	case "video/x-msvideo":
		return ".avi"
	}
	if kind == "video" {
		return ".mp4"
	}
	return ".jpg"
}

func extractHost(raw string) (string, bool) {
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		host := raw[len("https://"):]
		if idx := strings.IndexByte(host, '/'); idx >= 0 {
			host = host[:idx]
		}
		return host, true
	}
	return "", false
}
