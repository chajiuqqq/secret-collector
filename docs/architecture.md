# 技术架构

双项目：**Go 后端**（`backend/`）REST API + 静态 `/media/` on `:8080`。**Next.js 16 前端**（`frontend/`）SSR + 客户端瀑布流 UI on `:3000`。前端不直连 DB，全部数据走后端 API。

```
POST /api/posts JSON ──→ Go Backend :8080 ──→ PostgreSQL
                              │
                              ├── 异步下载 Worker (4 并发, 30s 重试扫描)
                              ├── GET /api/posts (keyset 分页 + ?tag= 过滤)
                              ├── DELETE /api/posts/:id (软删除, 递减 tag)
                              ├── POST /api/capture (单/批量 URL 抓取, SSE 进度)
                              ├── GET /api/capture/progress (SSE)
                              ├── POST /api/tg/scan (TG JSON 索引, SSE 进度)
                              ├── GET /api/tg/scan/progress (SSE)
                              ├── GET /api/tags (后端维护的标签列表)
                              └── GET /media/* (静态文件)

Next.js :3000 ──rewrites──→ Backend
```

## Backend (`backend/`)

| 路径 | 用途 |
|------|------|
| `cmd/server/main.go` | 入口：连 PG、运行迁移、回填标签、启动下载池 + Gin（graceful shutdown） |
| `internal/config/config.go` | 环境变量：DATABASE_URL、MEDIA_ROOT、DOWNLOAD_WORKERS、CORS_ORIGINS 等 |
| `internal/store/store.go` | `pgxpool` 初始化 + 嵌入式迁移运行器（按文件名排序） |
| `internal/store/posts.go` | CreatePost (upsert), ListPosts (keyset cursor + `?tag=` SQL 过滤), SoftDeletePost (返回 platform+content), CreateTgPosts (批量插入 blurred=true), UpsertTags/DecrementTags/BackfillTags, ListTags |
| `internal/store/media.go` | 原子 claim/downloaded/failed/reset, 指数退避重试 |
| `internal/store/captures.go` | CreateCapturedPost (X/小红书 抓取入库, 支持混合状态媒体) |
| `internal/api/router.go` | 路由 + CORS 中间件 |
| `internal/api/posts.go` | CRUD handlers |
| `internal/api/capture.go` | POST /api/capture (创建异步任务), runCapture (exec Python 脚本) + SSE 进度 |
| `internal/api/tg.go` | TgScan (创建异步任务), runScan (按 date 分组, 硬链接媒体, 跳过零媒体), parseDate, linkTgMedia |
| `internal/api/tg_scan_task.go` | 内存任务状态（mutex 保护, 单并发）, SSE 进度推送 (300ms ticker) |
| `internal/api/tags.go` | GET /api/tags handler |
| `internal/api/dto.go` | 请求/响应类型 |
| `internal/capture/capture.go` | exec Python 脚本（X/XHS）+ 本地视频归档 |
| `internal/downloader/` | 异步下载池：worker 认领 media row, SHA256, 重命名到 MEDIA_ROOT 目录树 |
| `scripts/` | `x_capture.py`, `xhs_capture.py` — vendor 自 social-capture，yt-dlp 视频下载 |

## Frontend (`frontend/`)

用 **Next.js 16** (standalone output, Turbopack)。生产是 `next build` → `node server.js` — **无热更新**，每次改完都要 rebuild。

| 路径 | 用途 |
|------|------|
| `app/page.tsx` | SSR 首页 (`force-dynamic`), 交给 PostFeed |
| `app/layout.tsx` | Root: 字体, 主题, NSFWProvider, CaptureButton, SettingsPanel, ThemeToggle |
| `lib/api.ts` | fetchPosts (tag 参数), fetchTags, deletePost, startCapture/watchCaptureProgress, startTgScan/watchScanProgress (SSE) |
| `lib/types.ts` | PostItem (blurred 字段), MediaItem, TagItem, CaptureTask 等 |
| `components/post-feed.tsx` | CSS columns 瀑布流, IntersectionObserver 无限滚动, tag 切换后端 SQL 过滤 |
| `components/post-card.tsx` | 媒体 + 头像 + 平台 badge + 模糊切换（眼睛图标, NSFW 模式下隐藏） |
| `components/post-media.tsx` | 图片/视频, CSS filter 模糊, >4 个走 carousel |
| `components/tag-bar.tsx` | 从 GET /api/tags 拉取, X/小红书/TG 固定置顶 |
| `components/capture-button.tsx` | 多 URL 批量抓取, 每条独立进度条 |
| `components/settings-panel.tsx` | TG 扫描 + NSFW 总开关 |
| `components/bottom-sheet.tsx` | 桌面下拉/手机底部弹窗自适应, 监听 visualViewport 适配键盘 |
| `components/nsfw-context.tsx` | React Context + localStorage, NSFW 开启时全局取消模糊 |

## 数据库

- **posts**: `id`, `platform` (x/xiaohongshu/tg), `original_url` (UNIQUE with platform), `author_name`, `content`, `blurred` (default false, TG=true), `posted_at`, `captured_at` (keyset cursor), `deleted_at`
- **media**: `id`, `post_id → posts`, `kind` (image/video/avatar), `status` (pending/downloading/downloaded/failed), `local_path`, `content_type`, `size_bytes`, `width`, `height`, `sha256`
- **tags**: `id`, `name` (UNIQUE), `post_count` — 在 post 创建/删除时维护, 启动时回填
- Keyset 分页：`ORDER BY captured_at DESC, id DESC WHERE deleted_at IS NULL`
- 迁移：`001_init`, `002_soft_delete`, `003_tg_platform`, `004_post_blurred` (blurred 列 + tags 表)

## 媒体下载流程

1. POST 创建 post + media rows（status `pending`），入队 media IDs
2. Worker 原子认领（status → `downloading`）
3. 下载到临时文件 → SHA256 哈希 → 重命名到 `{platform}/{YYYY/MM/DD}/{sha256前2位}/{sha256}.{ext}`
4. 成功：status → `downloaded`, local_path + 元数据写入
5. 失败：status → `failed`, last_error 写入。最多重试 5 次，指数退避 `5^(attempts-1)` 分钟
6. 崩溃恢复：启动时重置 `downloading` → `pending`。Scanner 每 30s 扫一次 pending + 可重试 failed

## TG 扫描流程

1. `POST /api/tg/scan` → 创建异步任务，立即返回 `task_id`（如已有运行中返回 409）
2. `GET /api/tg/scan/progress` → SSE 每 300ms 推送（phase: parsing→linking→writing, 计数）
3. 后端：读 JSON 索引 → 按 `date` 字段分组（同 date = 一个帖子）→ 硬链接文件从 media_dir 到 MEDIA_ROOT/tg/YYYY/MM/DD/{chatID}_{messageID}_{filename} → 跳过零媒体的分组

## 踩过的坑

### 前端是 production standalone，改源码必须 rebuild

`frontend/Dockerfile` 是多阶段 production 构建：`RUN npm run build` → 最终 stage 跑 `node server.js`（Next.js standalone）。所以**改 frontend 源码后必须 `docker compose build frontend && docker compose up -d frontend`，不会热更新**。

容器启动日志写着 `▲ Next.js 16.2.9 / Ready in 0ms`，看着像 dev mode，但其实是 standalone 服务器的启动 banner — 别被骗。

验证是否真的生效：standalone 镜像里**找不到** `.tsx` 源文件（只有编译产物），所以无法 `docker exec ... grep` 直接验证；要用 `curl http://localhost:3000 | grep <新增字符串>` 之类的间接方式。

### Header 的 backdrop-blur 会困住 position:fixed

`app/layout.tsx` 的 `<header>` 带 `backdrop-blur` —— 这个 CSS 属性会**创建 containing block**，导致它内部任何 `position: fixed` 元素以 header 为基准而不是 viewport，手机端就会溢出屏幕。

所有需要 viewport-relative 定位的 popover / dialog / modal，**必须用 `createPortal(content, document.body)`** 渲染到 body 之下，绕开这个陷阱。参考 `frontend/components/bottom-sheet.tsx` 的实现（含 iOS X `env(safe-area-inset-bottom)` 适配）。

### 视频通过 file extension 识别

TG JSON 没有 `media_type` 字段（全是空），所以 `internal/api/tg.go` 里的 `isVideoExt(fileName)` 按 `.mp4 / .mov / .webm / .avi / .mkv` 后缀判定。`isVideo(MediaType)` 兜底支持 Telegram 导出的标准 type。
