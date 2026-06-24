package api

import "time"

type MediaRequest struct {
	Kind string `json:"kind" binding:"required,oneof=image video"`
	URL  string `json:"url" binding:"required,http_url"`
}

type CreatePostRequest struct {
	Platform        string         `json:"platform" binding:"required,oneof=x xiaohongshu tg"`
	OriginalURL     string         `json:"original_url" binding:"required,http_url"`
	AuthorName      string         `json:"author_name" binding:"required"`
	AuthorAvatarURL string         `json:"author_avatar_url"`
	Content         string         `json:"content"`
	PostedAt        *time.Time     `json:"posted_at"`
	Media           []MediaRequest `json:"media"`
}

type CreatePostResponse struct {
	ID         int64   `json:"id"`
	Duplicated bool    `json:"duplicated"`
	MediaCount int     `json:"media_count"`
	MediaIDs   []int64 `json:"media_ids,omitempty"`
}

type MediaResponse struct {
	ID          int64   `json:"id"`
	Kind        string  `json:"kind"`
	Position    int     `json:"position"`
	OriginalURL string  `json:"original_url"`
	Status      string  `json:"status"`
	URL         *string `json:"url"`
	ContentType *string `json:"content_type,omitempty"`
	Width       *int    `json:"width"`
	Height      *int    `json:"height"`
}

type PostResponse struct {
	ID              int64           `json:"id"`
	Platform        string          `json:"platform"`
	OriginalURL     string          `json:"original_url"`
	AuthorName      string          `json:"author_name"`
	AuthorAvatarURL *string         `json:"author_avatar_url"`
	Content         string          `json:"content"`
	PostedAt        *time.Time      `json:"posted_at"`
	CapturedAt      time.Time       `json:"captured_at"`
	Blurred         bool            `json:"blurred"`
	Media           []MediaResponse `json:"media"`
}

type ListPostsResponse struct {
	Posts      []PostResponse `json:"posts"`
	NextCursor *string        `json:"next_cursor"`
}

type TgScanRequest struct {
	IndexPath string `json:"index_path" binding:"required"`
	MediaDir  string `json:"media_dir" binding:"required"`
}

type TgScanResponse struct {
	PostsCreated int      `json:"posts_created"`
	PostsSkipped int      `json:"posts_skipped"`
	MediaFound   int      `json:"media_found"`
	MediaMissing int      `json:"media_missing"`
	Errors       []string `json:"errors,omitempty"`
}

// CaptureRequest accepts either a single URL (legacy) or a list. Both can be
// set; they are merged and de-duplicated by normalize().
type CaptureRequest struct {
	URL  string   `json:"url"`
	URLs []string `json:"urls"`
}

// normalize returns the combined, trimmed, de-duplicated URL list.
func (r CaptureRequest) normalize() []string {
	seen := make(map[string]struct{})
	var out []string
	add := func(u string) {
		for _, ch := range " \t\r\n" {
			u = trimAll(u, byte(ch))
		}
		if u == "" {
			return
		}
		if _, ok := seen[u]; ok {
			return
		}
		seen[u] = struct{}{}
		out = append(out, u)
	}
	if r.URL != "" {
		add(r.URL)
	}
	for _, u := range r.URLs {
		add(u)
	}
	return out
}

func trimAll(s string, c byte) string {
	for len(s) > 0 && s[0] == c {
		s = s[1:]
	}
	for len(s) > 0 && s[len(s)-1] == c {
		s = s[:len(s)-1]
	}
	return s
}

// CaptureTaskDTO is the wire-format projection of a queued capture Task.
type CaptureTaskDTO struct {
	ID         string     `json:"id"`
	URL        string     `json:"url"`
	Status     string     `json:"status"`
	Phase      string     `json:"phase,omitempty"`
	PostID     *int64     `json:"post_id,omitempty"`
	Platform   string     `json:"platform,omitempty"`
	Duplicated bool       `json:"duplicated"`
	MediaCount int        `json:"media_count"`
	Error      string     `json:"error,omitempty"`
	Attempts   int        `json:"attempts"`
	CreatedAt  time.Time  `json:"created_at"`
	StartedAt  *time.Time `json:"started_at,omitempty"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}

type CaptureTasksResponse struct {
	Tasks []CaptureTaskDTO `json:"tasks"`
}
