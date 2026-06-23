package api

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"

	"capture/backend/internal/store"

	"github.com/gin-gonic/gin"
)

const defaultLimit = 20

type Handler struct {
	Store    *store.Store
	MediaRoot string
	Enqueue   func(ids []int64)
}

func (h *Handler) CreatePost(c *gin.Context) {
	var req CreatePostRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	media := make([]store.NewMedia, len(req.Media))
	for i, m := range req.Media {
		media[i] = store.NewMedia{Kind: m.Kind, URL: m.URL}
	}

	result, err := h.Store.CreatePost(c.Request.Context(), store.NewPost{
		Platform:        req.Platform,
		OriginalURL:     req.OriginalURL,
		AuthorName:      req.AuthorName,
		AuthorAvatarURL: req.AuthorAvatarURL,
		Content:         req.Content,
		PostedAt:        req.PostedAt,
		Media:           media,
	})
	if err != nil {
		slog.Error("create post", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create post"})
		return
	}

	if len(result.MediaIDs) > 0 {
		h.Enqueue(result.MediaIDs)
	}

	status := http.StatusCreated
	if result.Duplicated {
		status = http.StatusOK
	}
	c.JSON(status, CreatePostResponse{
		ID:         result.PostID,
		Duplicated: result.Duplicated,
		MediaCount: len(result.MediaIDs),
		MediaIDs:   result.MediaIDs,
	})
}

func (h *Handler) ListPosts(c *gin.Context) {
	var q struct {
		Limit  int    `form:"limit"`
		Cursor string `form:"cursor"`
	}
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if q.Limit <= 0 || q.Limit > 100 {
		q.Limit = defaultLimit
	}

	posts, nextCursor, err := h.Store.ListPosts(c.Request.Context(), q.Limit, q.Cursor)
	if err != nil {
		slog.Error("list posts", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list posts"})
		return
	}

	out := make([]PostResponse, len(posts))
	for pi, p := range posts {
		media := make([]MediaResponse, 0, len(p.Media))
		for _, m := range p.Media {
			if m.Kind == "avatar" {
				continue
			}
			mr := MediaResponse{
				ID:          m.ID,
				Kind:        m.Kind,
				Position:    m.Position,
				OriginalURL: m.OriginalURL,
				Status:      m.Status,
				ContentType: m.ContentType,
				Width:       m.Width,
				Height:      m.Height,
			}
			if m.LocalPath != nil {
				up := "/media/" + *m.LocalPath
				mr.URL = &up
			} else if m.Status == "pending" || m.Status == "downloading" {
				mr.URL = &m.OriginalURL
			}
			media = append(media, mr)
		}
		avatarURL := p.AuthorAvatarURL
		for _, m := range p.Media {
			if m.Kind == "avatar" && m.LocalPath != nil {
				up := "/media/" + *m.LocalPath
				avatarURL = &up
				break
			}
		}
		out[pi] = PostResponse{
			ID:              p.ID,
			Platform:        p.Platform,
			OriginalURL:     p.OriginalURL,
			AuthorName:      p.AuthorName,
			AuthorAvatarURL: avatarURL,
			Content:         p.Content,
			PostedAt:        p.PostedAt,
			Blurred:         p.Blurred,
			CapturedAt:      p.CapturedAt,
			Media:           media,
		}
	}

	resp := ListPostsResponse{Posts: out}
	if nextCursor != "" {
		resp.NextCursor = &nextCursor
	}
	c.JSON(http.StatusOK, resp)
}

func (h *Handler) DeletePost(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	ok, platform, content, err := h.Store.SoftDeletePost(c.Request.Context(), id)
	if err != nil {
		slog.Error("soft delete", "id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete failed"})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
		// Decrement tags in background (best-effort)
		go func() {
			if err := h.Store.DecrementPostTags(context.Background(), platform, content); err != nil {
				slog.Error("decrement tags", "id", id, "error", err)
			}
		}()
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}
