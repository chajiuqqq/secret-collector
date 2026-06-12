package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	DatabaseURL     string
	MediaRoot       string
	ListenAddr      string
	DownloadWorkers int
	DownloadTimeout time.Duration
	MaxMediaBytes   int64
	CORSOrigins     string
}

func Load() Config {
	return Config{
		DatabaseURL:     getenv("DATABASE_URL", "postgres://capture:capture@localhost:5432/capture?sslmode=disable"),
		MediaRoot:       getenv("MEDIA_ROOT", "/data/media"),
		ListenAddr:      getenv("LISTEN_ADDR", ":8080"),
		DownloadWorkers: getenvInt("DOWNLOAD_WORKERS", 4),
		DownloadTimeout: getenvDuration("DOWNLOAD_TIMEOUT", 120*time.Second),
		MaxMediaBytes:   getenvInt64("MAX_MEDIA_BYTES", 500*1024*1024),
		CORSOrigins:     getenv("CORS_ORIGINS", "*"),
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getenvInt64(key string, def int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return def
}

func getenvDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
