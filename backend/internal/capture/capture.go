// Package capture executes the vendored social-capture Python scripts to
// extract post metadata + media URLs from X/Twitter and Xiaohongshu URLs.
//
// Scripts are vendored under backend/scripts/ and copied to /skills/ inside the
// Docker image (see backend/Dockerfile). The capture flow is:
//
//  1. Detect platform from URL host
//  2. exec python3 /skills/{x,xhs}_capture.py "<URL>" → JSON on stdout
//  3. For each media[].url that is a local file path (videos downloaded by
//     yt-dlp inside the script), file it into MEDIA_ROOT and replace with a
//     synthetic LocalMediaItem marker so the caller can register status=downloaded.
//
// HTTP-URL media (images) are returned as-is so the existing downloader pool
// handles them asynchronously.
package capture

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	PlatformX   = "x"
	PlatformXHS = "xiaohongshu"

	scriptsDir = "/skills"
)

// CapturedPost is the parsed output of a capture script, normalized for the
// backend's store.NewPost shape.
type CapturedPost struct {
	Platform        string
	OriginalURL     string
	AuthorName      string
	AuthorAvatarURL string
	Content         string
	PostedAt        *time.Time
	// RemoteMedia is HTTP-URL media (downloaded async by the downloader pool).
	RemoteMedia []RemoteMediaItem
	// LocalMedia is files already on disk inside MEDIA_ROOT (status=downloaded).
	LocalMedia []LocalMediaItem
}

type RemoteMediaItem struct {
	Kind string // "image" | "video"
	URL  string
}

type LocalMediaItem struct {
	Kind        string
	LocalPath   string // relative to MEDIA_ROOT
	ContentType string
	SizeBytes   int64
	SHA256      string
	Width       *int
	Height      *int
}

// scriptOutput matches the JSON shape emitted by xhs_capture.py / x_capture.py.
type scriptOutput struct {
	Platform        string  `json:"platform"`
	OriginalURL     string  `json:"original_url"`
	AuthorName      string  `json:"author_name"`
	AuthorAvatarURL string  `json:"author_avatar_url,omitempty"`
	Content         string  `json:"content"`
	PostedAt        string  `json:"posted_at,omitempty"`
	Media           []struct {
		Kind string `json:"kind"`
		URL  string `json:"url"`
	} `json:"media"`
}

// Runner exec's the vendored capture scripts and assembles a CapturedPost.
type Runner struct {
	ScriptsDir string        // default "/skills"
	MediaRoot  string        // for filing local video files
	Timeout    time.Duration // per-script timeout; default 120s
	Env        []string      // extra env vars (XHS_COOKIE_FILE, HTTPS_PROXY, ...)
}

func NewRunner(mediaRoot string) *Runner {
	return &Runner{
		ScriptsDir: scriptsDir,
		MediaRoot:  mediaRoot,
		Timeout:    120 * time.Second,
	}
}

// Detect returns "x", "xiaohongshu", or "" for unsupported.
func Detect(rawURL string) string {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Host == "" {
		return ""
	}
	host := strings.ToLower(u.Host)
	switch {
	case host == "x.com" || strings.HasSuffix(host, ".x.com") ||
		host == "twitter.com" || strings.HasSuffix(host, ".twitter.com"):
		return PlatformX
	case host == "xiaohongshu.com" || strings.HasSuffix(host, ".xiaohongshu.com") ||
		host == "xhslink.com" || strings.HasSuffix(host, ".xhslink.com"):
		return PlatformXHS
	}
	return ""
}

// Run executes the appropriate script and returns a normalized CapturedPost.
// Local video files referenced by media[].url are filed into MEDIA_ROOT.
func (r *Runner) Run(ctx context.Context, rawURL string) (*CapturedPost, error) {
	platform := Detect(rawURL)
	if platform == "" {
		return nil, fmt.Errorf("unsupported URL: must be x.com, twitter.com, xiaohongshu.com, or xhslink.com")
	}

	timeout := r.Timeout
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	scriptName := "x_capture.py"
	if platform == PlatformXHS {
		scriptName = "xhs_capture.py"
	}
	scriptPath := filepath.Join(r.ScriptsDir, scriptName)

	cmd := exec.CommandContext(cctx, "python3", scriptPath, rawURL)
	// Inherit current env (so HTTPS_PROXY/XHS_COOKIE_FILE set on the backend
	// process are visible to the script), then layer on caller-supplied vars.
	cmd.Env = append(os.Environ(), r.Env...)

	stdout, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return nil, fmt.Errorf("script %s failed: %s", scriptName, strings.TrimSpace(string(exitErr.Stderr)))
		}
		return nil, fmt.Errorf("exec %s: %w", scriptName, err)
	}

	var out scriptOutput
	if err := json.Unmarshal(stdout, &out); err != nil {
		return nil, fmt.Errorf("parse script output: %w (raw: %s)", err, truncate(string(stdout), 200))
	}

	post := &CapturedPost{
		Platform:        out.Platform,
		OriginalURL:     out.OriginalURL,
		AuthorName:      out.AuthorName,
		AuthorAvatarURL: out.AuthorAvatarURL,
		Content:         out.Content,
	}
	if out.PostedAt != "" {
		if t, err := time.Parse(time.RFC3339, out.PostedAt); err == nil {
			post.PostedAt = &t
		}
	}

	// Required by backend DTO. Scripts may return empty author for niche cases;
	// fall back to a platform-prefixed placeholder so the post can still save.
	if post.AuthorName == "" {
		post.AuthorName = platform + " user"
	}

	for _, m := range out.Media {
		if isHTTPURL(m.URL) {
			post.RemoteMedia = append(post.RemoteMedia, RemoteMediaItem{Kind: m.Kind, URL: m.URL})
			continue
		}
		// Local file (typically a yt-dlp video at /tmp/...).
		local, err := r.fileLocal(m.Kind, m.URL, platform)
		if err != nil {
			return nil, fmt.Errorf("file local media %s: %w", m.URL, err)
		}
		post.LocalMedia = append(post.LocalMedia, *local)
	}

	return post, nil
}

// fileLocal hashes srcPath, moves it under MEDIA_ROOT/<platform>/YYYY/MM/DD/<hash[:2]>/<hash><ext>,
// and returns a LocalMediaItem ready to insert with status=downloaded. The source
// file is removed on success (it's expected to be a yt-dlp tempfile under /tmp).
func (r *Runner) fileLocal(kind, srcPath, platform string) (*LocalMediaItem, error) {
	f, err := os.Open(srcPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	hasher := sha256.New()
	written, err := io.Copy(hasher, f)
	if err != nil {
		return nil, fmt.Errorf("hash: %w", err)
	}
	hash := hex.EncodeToString(hasher.Sum(nil))

	ext := strings.ToLower(filepath.Ext(srcPath))
	if ext == "" {
		if kind == "video" {
			ext = ".mp4"
		} else {
			ext = ".jpg"
		}
	}

	rel := filepath.Join(platform, time.Now().UTC().Format("2006/01/02"), hash[:2], hash+ext)
	destDir := filepath.Join(r.MediaRoot, filepath.Dir(rel))
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir dest: %w", err)
	}
	destPath := filepath.Join(r.MediaRoot, rel)

	if _, err := os.Stat(destPath); os.IsNotExist(err) {
		// Try rename (fast path, same filesystem), fall back to copy if it
		// crosses devices (e.g. /tmp tmpfs → /data/media bind mount).
		if renameErr := os.Rename(srcPath, destPath); renameErr != nil {
			if copyErr := copyFile(srcPath, destPath); copyErr != nil {
				return nil, fmt.Errorf("copy fallback: %w", copyErr)
			}
			os.Remove(srcPath)
		}
	} else {
		// Already exists (same sha256); just clean up the tempfile.
		os.Remove(srcPath)
	}
	os.Chmod(destPath, 0o644)

	return &LocalMediaItem{
		Kind:        kind,
		LocalPath:   rel,
		ContentType: contentTypeByExt(ext, kind),
		SizeBytes:   written,
		SHA256:      hash,
	}, nil
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

func contentTypeByExt(ext, kind string) string {
	switch ext {
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".mkv":
		return "video/x-matroska"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	}
	if kind == "video" {
		return "video/mp4"
	}
	return "application/octet-stream"
}

func isHTTPURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
