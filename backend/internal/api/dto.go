package api

import "time"

type MediaRequest struct {
	Kind string `json:"kind" binding:"required,oneof=image video"`
	URL  string `json:"url" binding:"required,http_url"`
}

type CreatePostRequest struct {
	Platform        string         `json:"platform" binding:"required,oneof=x xiaohongshu"`
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
	Media           []MediaResponse `json:"media"`
}

type ListPostsResponse struct {
	Posts      []PostResponse `json:"posts"`
	NextCursor *string        `json:"next_cursor"`
}
