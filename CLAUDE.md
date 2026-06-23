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

# Backend (Go) — run from backend/ directory
cd backend
DATABASE_URL="postgres://capture:capture@localhost:5432/capture?sslmode=disable" \
MEDIA_ROOT=/tmp/capture-media \
go run ./cmd/server

# Frontend (Next.js) — run from frontend/ directory
cd frontend
BACKEND_INTERNAL_URL=http://localhost:8080 npm run dev
```

## Architecture

Dual-project: **Go backend** (`backend/`) REST API + static `/media/` on `:8080`. **Next.js 16 frontend** (`frontend/`) SSR + client waterfall UI on `:3000`. Frontend never hits DB directly — all data through backend API.

```
POST /api/posts JSON ──→ Go Backend :8080 ──→ PostgreSQL
                              │
                              ├── Async download workers (4 concurrent, 30s retry scan)
                              ├── GET /api/posts (keyset pagination, ?tag= filter)
                              ├── DELETE /api/posts/:id (soft delete, decrements tags)
                              ├── POST /api/tg/scan (async, SSE progress)
                              ├── GET /api/tg/scan/progress (SSE)
                              ├── GET /api/tags (server-maintained tag list)
                              └── GET /media/* (static files)

Next.js :3000 ──rewrites──→ Backend
```

### Backend (`backend/`)

| Path | Purpose |
|------|---------|
| `cmd/server/main.go` | Entry: connects PG, runs migrations, backfills tags, starts downloader pool + Gin with graceful shutdown |
| `internal/config/config.go` | Env vars: DATABASE_URL, MEDIA_ROOT, DOWNLOAD_WORKERS, CORS_ORIGINS, etc. |
| `internal/store/store.go` | `pgxpool` init + embedded migration runner (sorted `.sql` files) |
| `internal/store/posts.go` | CreatePost (upsert), ListPosts (keyset cursor + `?tag=` SQL filter), SoftDeletePost (returns platform+content), CreateTgPosts (batch insert with blurred=true), UpsertTags/DecrementTags/BackfillTags, ListTags |
| `internal/store/media.go` | Atomic claim/downloaded/failed/reset, exponential backoff retry |
| `internal/api/router.go` | Routes + CORS middleware |
| `internal/api/posts.go` | CRUD handlers |
| `internal/api/tg.go` | TgScan (creates async task), runScan (groups messages by date, hardlinks media, creates posts with zero-media guard), parseDate, linkTgMedia, video-by-ext detection |
| `internal/api/tg_scan_task.go` | In-memory task state (mutex-guarded, single concurrent), SSE progress streaming (300ms ticker) |
| `internal/api/tags.go` | GET /api/tags handler |
| `internal/api/dto.go` | Request/response types |
| `internal/downloader/` | Async download pool: workers claim media rows, SHA256-hash, rename into MEDIA_ROOT tree |

### Frontend (`frontend/`)

Built with **Next.js 16** (standalone output, Turbopack). Production is `next build` → `node server.js` — **no hot reload**; rebuild after every change.

| Path | Purpose |
|------|---------|
| `app/page.tsx` | SSR first page (`force-dynamic`), hands off to PostFeed |
| `app/layout.tsx` | Root: fonts, theme, NSFWProvider, SettingsPanel, ThemeToggle |
| `lib/api.ts` | fetchPosts (tag param), fetchTags, deletePost, startTgScan, watchScanProgress (EventSource SSE) |
| `lib/types.ts` | PostItem (blurred field), MediaItem, TgScanProgress, TagItem, etc. |
| `components/post-feed.tsx` | CSS columns waterfall, IntersectionObserver infinite scroll, tag change resets posts from backend |
| `components/post-card.tsx` | Media + avatar + platform badge + blur toggle (eye icon, hidden in NSFW mode) |
| `components/post-media.tsx` | Image/video rendering with blur support (CSS filter), carousel for >4 items |
| `components/tag-bar.tsx` | Fetches from GET /api/tags, fixed X/小红书/TG always first |
| `components/settings-panel.tsx` | TG scan controls + progress bar + NSFW toggle |
| `components/nsfw-context.tsx` | React context + localStorage — when on, all blur disabled |

### Database

- **posts**: `id`, `platform` (x/xiaohongshu/tg), `original_url` (UNIQUE with platform), `author_name`, `content`, `blurred` (default false, TG=true), `posted_at`, `captured_at` (keyset cursor), `deleted_at`
- **media**: `id`, `post_id → posts`, `kind` (image/video/avatar), `status` (pending/downloading/downloaded/failed), `local_path`, `content_type`, `size_bytes`, `width`, `height`, `sha256`
- **tags**: `id`, `name` (UNIQUE), `post_count` — maintained on post create/delete, backfilled on startup
- Keyset pagination: `ORDER BY captured_at DESC, id DESC WHERE deleted_at IS NULL`
- Migrations: `001_init`, `002_soft_delete`, `003_tg_platform`, `004_post_blurred` (blurred column + tags table)

### TG scan flow

1. `POST /api/tg/scan` → creates async task, returns `task_id` immediately (409 if already running)
2. `GET /api/tg/scan/progress` → SSE events every 300ms (phase: parsing→linking→writing, counts)
3. Backend: reads JSON index, groups messages by `date` field (same date = one post), hardlinks files from media_dir into MEDIA_ROOT/tg/YYYY/MM/DD/{chatID}_{messageID}_{filename}, skips groups with zero media found

## Production environment

| | |
|---|---|
| SSH | `chajiuqqq@100.114.94.119` |
| Project path | `/vol2/1000/secret-collector` |
| Media storage | `/vol1/1000/capture` |
| Docker | May require `sg docker -c "..."` |
| Proxy | `export https_proxy=http://100.85.18.9:7890` before git pull |

```bash
# Deploy
ssh chajiuqqq@100.114.94.119 'export https_proxy=http://100.85.18.9:7890 && cd /vol2/1000/secret-collector && git pull && sg docker -c "docker compose up -d --build"'

# Logs
ssh chajiuqqq@100.114.94.119 'cd /vol2/1000/secret-collector && sg docker -c "docker compose logs --tail=50 backend"'

# DB shell
ssh chajiuqqq@100.114.94.119 'docker exec secret-collector-postgres-1 psql -U capture -d capture'

# Rebuild frontend only (no --no-cache needed unless caching issue)
ssh chajiuqqq@100.114.94.119 'cd /vol2/1000/secret-collector && git pull && sg docker -c "docker compose build frontend && docker compose up -d frontend"'
```

## Common commands

```bash
# Docker
docker compose up -d --build                 # full stack
docker compose build backend                 # backend only
docker compose build frontend                # frontend only
docker compose exec postgres psql -U capture -d capture  # DB shell

# Go (from backend/)
go build -o /dev/null ./...                  # compile check

# Frontend (from frontend/)
npm run dev          # dev server (hot reload for local dev only)

# API
curl -X POST http://localhost:8080/api/tg/scan -H "Content-Type: application/json" -d '{"index_path":"/tg-index/tg-saved-full.json","media_dir":"/tg-media"}'
curl "http://localhost:8080/api/posts?limit=20&tag=tg"
curl "http://localhost:8080/api/tags"
curl -X DELETE "http://localhost:8080/api/posts/1"
```

## 踩过的坑

### 前端是 production standalone，改源码必须 rebuild
`frontend/Dockerfile` 是多阶段 production 构建：`RUN npm run build` → 最终 stage 跑 `node server.js`（Next.js standalone）。所以**改 frontend 源码后必须 `docker compose build frontend && docker compose up -d frontend`，不会热更新**。

容器启动日志写着 `▲ Next.js 16.2.9 / Ready in 0ms`，看着像 dev mode，但其实是 standalone 服务器的启动 banner — 别被骗。

验证是否真的生效：standalone 镜像里**找不到** `.tsx` 源文件（只有编译产物），所以无法 `docker exec ... grep` 直接验证；要用 `curl http://localhost:3000 | grep <新增字符串>` 之类的间接方式。

### Header 的 backdrop-blur 会困住 position:fixed
`app/layout.tsx` 的 `<header>` 带 `backdrop-blur` —— 这个 CSS 属性会**创建 containing block**，导致它内部任何 `position: fixed` 元格以 header 为基准而不是 viewport，手机端就会溢出屏幕。

所有需要 viewport-relative 定位的 popover / dialog / modal，**必须用 `createPortal(content, document.body)`** 渲染到 body 之下，绕开这个陷阱。参考 `frontend/components/capture-button.tsx` 的实现（含 iPhone X `env(safe-area-inset-bottom)` 适配）。
