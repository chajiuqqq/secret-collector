package api

import (
	"net/http"
	"capture/backend/internal/store"

	"github.com/gin-gonic/gin"
)

func (h *Handler) ListTags(c *gin.Context) {
	tags, err := h.Store.ListTags(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list tags"})
		return
	}
	if tags == nil {
		tags = []store.TagItem{}
	}
	c.JSON(http.StatusOK, tags)
}
