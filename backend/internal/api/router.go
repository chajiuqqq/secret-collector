package api

import (
	"capture/backend/internal/config"

	"github.com/gin-gonic/gin"
)

func SetupRouter(h *Handler, cfg *config.Config) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware(cfg.CORSOrigins))
	r.Use(gin.LoggerWithWriter(gin.DefaultWriter, "/healthz /media/"))

	r.Static("/media", cfg.MediaRoot)

	api := r.Group("/api")
	{
		api.POST("/posts", h.CreatePost)
		api.GET("/posts", h.ListPosts)
		api.DELETE("/posts/:id", h.DeletePost)
		api.POST("/tg/scan", h.TgScan)
		api.GET("/tg/scan/progress", h.TgScanProgress)
	}

	r.GET("/healthz", func(c *gin.Context) {
		if err := h.Store.Pool.Ping(c.Request.Context()); err != nil {
			c.JSON(503, gin.H{"status": "unhealthy"})
			return
		}
		c.JSON(200, gin.H{"status": "ok"})
	})

	return r
}
