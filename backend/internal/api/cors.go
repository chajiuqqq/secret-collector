package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func corsMiddleware(origins string) gin.HandlerFunc {
	allowed := make(map[string]bool)
	for _, o := range strings.Split(origins, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			allowed[o] = true
		}
	}
	allowAll := allowed["*"]

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if allowAll {
			c.Header("Access-Control-Allow-Origin", "*")
		} else if allowed[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		c.Header("Access-Control-Max-Age", "43200")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
