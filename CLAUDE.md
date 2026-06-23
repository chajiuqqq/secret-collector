# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick start

```bash
cp .env.example .env
docker compose up -d --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8080

## Development (without Docker)

```bash
# Start postgres
docker run -d --name capture-pg -e POSTGRES_USER=capture -e POSTGRES_PASSWORD=capture -e POSTGRES_DB=capture -p 5432:5432 postgres:17-alpine

# Backend (Go)
DATABASE_URL="postgres://capture:capture@localhost:5432/capture?sslmode=disable" \
MEDIA_ROOT=/tmp/capture-media \
go run ./cmd/server

# Frontend (Next.js)
BACKEND_INTERNAL_URL=http://localhost:8080 npm run dev
```

## Architecture

Dual-project: **Go backend** (`backend/`) serves a REST API and static `/media/` files, backed by PostgreSQL. **Next.js frontend** (`frontend/`) renders a masonry waterfall UI. The frontend never hits the database directly — all data goes through the backend API. Next.js rewrites `/api/*` and `/media/*` to the backend, so the browser uses relative URLs.

```
POST /api/posts JSON ──→ Go Backend :8080 ──→ PostgreSQL
                              │
                              ├── Async download workers (4 concurrent, 30s retry scan)
                              ├── GET /api/posts (keyset pagination)
                              ├── DELETE /api/posts/:id (soft delete)
                              └── GET /media/* (static files)

Next.js :3000 ──rewrites──→ Backend
```

### Backend (`backend/`)

- **`cmd/server/main.go`** — Entry point: connects to PG, runs migrations, starts downloader pool, starts Gin HTTP server with graceful shutdown.
- **`internal/config/config.go`** — Reads env vars with defaults (DATABASE_URL, MEDIA_ROOT, DOWNLOAD_WORKERS, etc.).
- **`internal/store/`** — Database layer using `pgxpool`. `store.go` has connection setup and migration runner (embedded SQL files sorted by name). `posts.go` has CreatePost (upsert on `platform + original_url`), ListPosts (keyset cursor pagination with media eager-loading), and SoftDeletePost. `media.go` has atomic claim/downloaded/failed/reset operations with exponential backoff retry logic.
- **`internal/api/`** — Gin HTTP handlers. `router.go` sets up routes and CORS middleware. `posts.go` handles CRUD with validation. `dto.go` defines request/response types. `cors.go` parses the comma-separated CORS_ORIGINS env var (supports `*` wildcard).
- **`internal/downloader/`** — Async media download pool. Workers pull from a buffered channel (cap 1024). A scanner goroutine runs every 30s to find retryable media and reset stuck `downloading` rows. `fetch.go` does the actual HTTP download: SHA256 hashing, temp file → rename, width/height decoding for images, Referer header injection for xhscdn.com domains.
- **`internal/migrations/`** — Embedded SQL migration files. `001_init.sql` creates `posts` and `media` tables with constraints. `002_soft_delete.sql` adds `deleted_at` column and a filtered index for active posts.

### Frontend (`frontend/`)

- Built with **Next.js 16** (standalone output mode) — read `frontend/node_modules/next/dist/docs/` if unsure about API changes.
- **`app/page.tsx`** — Server component that fetches the first page (SSR `force-dynamic`), then hands off to `PostFeed` client component for infinite scroll.
- **`app/layout.tsx`** — Root layout with Geist fonts, sticky header, next-themes Provider, and ThemeToggle.
- **`lib/api.ts`** — `fetchPosts` and `deletePost` helpers. On the server, uses `BACKEND_INTERNAL_URL` for direct backend calls. On the client, uses relative paths (proxied by Next.js rewrites).
- **`components/post-feed.tsx`** — Main client component: CSS columns waterfall, IntersectionObserver infinite scroll, skeleton loading, delete with optimistic UI removal, lightbox state.
- **`components/post-card.tsx`** — Card layout: media at top, avatar + author name + platform badge + relative time in header, linked content text body, red delete button (absolute positioned, hover-visible on card).
- **`components/post-media.tsx`** — Media rendering with status handling: skeleton for pending/downloading, error state for failed. Images respect aspect ratio. Videos auto-play when visible (IntersectionObserver). Single media renders full-width; 2-4 items in a 2-col grid; >4 items in a scroll-snap carousel with dot indicators.
- **`components/media-lightbox.tsx`** — Full-screen overlay for images/videos (ESC or backdrop click to close).

### Database

- **posts**: `id`, `platform` (x/xiaohongshu), `original_url` (UNIQUE), `author_name`, `author_avatar_url`, `avatar_media_id → media`, `content`, `posted_at`, `captured_at`, `deleted_at`
- **media**: `id`, `post_id → posts`, `kind` (image/video/avatar), `position`, `original_url`, `status` (pending/downloading/downloaded/failed), `local_path`, `content_type`, `size_bytes`, `width`, `height`, `sha256`, `attempts`, `last_error`
- Keyset pagination on `(captured_at DESC, id DESC) WHERE deleted_at IS NULL`
- Soft delete: `deleted_at` timestamp, filtered out by the active index

### Media download flow

1. POST creates post + media rows (status `pending`), enqueues media IDs.
2. Worker claims a row atomically (status → `downloading`).
3. Downloads to temp file, SHA256-hashes, renames to `{platform}/{YYYY/MM/DD}/{sha256[:2]}/{sha256}.{ext}`.
4. On success: status → `downloaded`, local_path + metadata set.
5. On failure: status → `failed`, last_error set. Retried up to 5 times with exponential backoff (`5^(attempts-1)` minutes).
6. Crash recovery: startup resets `downloading` → `pending`. Scanner runs every 30s picking up pending + retryable-failed media.

### Environment variables

Backend: `DATABASE_URL`, `MEDIA_ROOT` (default `/data/media`), `LISTEN_ADDR` (`:8080`), `DOWNLOAD_WORKERS` (4), `DOWNLOAD_TIMEOUT` (120s), `MAX_MEDIA_BYTES` (500MB), `CORS_ORIGINS` (`*`).
Frontend: `BACKEND_INTERNAL_URL` (`http://backend:8080`) — used for SSR and rewrites; never exposed to the browser.

## Production environment

See `运维手册.md` for full details.

| | |
|---|---|
| SSH | `chajiuqqq@100.114.94.119` |
| Project path | `/vol2/1000/secret-collector` |
| Media storage | `/vol1/1000/capture` |
| Docker | May require `sg docker -c "..."` |

```bash
# Check status
cd /vol2/1000/secret-collector && docker compose ps

# Restart
docker compose restart [backend|frontend|postgres]

# Logs
docker compose logs -f backend
docker compose logs --tail=50

# Update & rebuild
git pull && docker compose up -d --build
```

### Common SQL (connect via `docker exec -it secret-collector-postgres-1 psql -U capture -d capture`)

```sql
-- Post counts
SELECT platform, COUNT(*) FROM posts WHERE deleted_at IS NULL GROUP BY platform;

-- Media status distribution
SELECT status, COUNT(*) FROM media GROUP BY status;

-- Reset all failed media for retry
UPDATE media SET status = 'pending', attempts = 0, last_error = NULL WHERE status = 'failed';
```

### Troubleshooting

- **Frontend down**: `docker compose logs frontend`, then check `curl http://localhost:8080/healthz`
- **Media download failures**: check backend logs `docker compose logs backend | grep -i error`, then reset failed rows
- **DB connection failure**: wait for postgres healthy (`docker compose ps`), then restart backend

## Common commands

```bash
# Backend
go run ./cmd/server                          # run backend
go build -o /dev/null ./...                  # compile check
DATABASE_URL="..." go run ./cmd/server       # with custom PG

# Frontend
npm run dev          # Next.js dev server
npm run build        # production build
npm run lint         # ESLint

# Docker
docker compose up -d --build                 # full stack
docker compose logs -f backend               # backend logs
docker compose exec postgres psql -U capture -d capture  # DB shell

# API
curl -X POST http://localhost:8080/api/posts -H "Content-Type: application/json" -d '{...}'
curl "http://localhost:8080/api/posts?limit=20"
curl -X DELETE "http://localhost:8080/api/posts/1"
```

## 踩过的坑

### 前端是 production standalone，改源码必须 rebuild
`frontend/Dockerfile` 是多阶段 production 构建：`RUN npm run build` → 最终 stage 跑 `node server.js`（Next.js standalone）。所以**改 frontend 源码后必须 `docker compose build frontend && docker compose up -d frontend`，不会热更新**。

容器启动日志写着 `▲ Next.js 16.2.9 / Ready in 0ms`，看着像 dev mode，但其实是 standalone 服务器的启动 banner — 别被骗。

验证是否真的生效：standalone 镜像里**找不到** `.tsx` 源文件（只有编译产物），所以无法 `docker exec ... grep` 直接验证；要用 `curl http://localhost:3000 | grep <新增字符串>` 之类的间接方式。

### Header 的 backdrop-blur 会困住 position:fixed
`app/layout.tsx` 的 `<header>` 带 `backdrop-blur` —— 这个 CSS 属性会**创建 containing block**，导致它内部任何 `position: fixed` 元素以 header 为基准而不是 viewport，手机端就会溢出屏幕。

所有需要 viewport-relative 定位的 popover / dialog / modal，**必须用 `createPortal(content, document.body)`** 渲染到 body 之下，绕开这个陷阱。参考 `frontend/components/capture-button.tsx` 的实现（含 iPhone X `env(safe-area-inset-bottom)` 适配）。

