# 私密收藏夹

双项目：Go 后端 REST API + Next.js 前端瀑布流展示。用于捕获 X/Twitter 和小红书帖子，自动下载媒体文件。

## 启动

```bash
cp .env.example .env          # 可选：设置 MEDIA_PATH=/mnt/nas/capture
docker compose up -d --build
```

- 前端：http://localhost:3000
- 后端 API：http://localhost:8080

## 架构

```
[POST JSON] ──→ Go Backend :8080 ──→ PostgreSQL :5432
                    │                    ├── posts 表
                    ├── 异步下载 Worker      ├── media 表
                    ├── GET /media/*       │── schema_migrations
                    └── /api/posts          └── 软删除 (deleted_at)

Next.js :3000 ──SSR/rewrites──→ Backend
    ├── /api/* ──rewrite──→ backend:8080
    └── /media/* ─rewrite──→ backend:8080
```

- 前端不直连数据库，所有数据走后端 API
- 前端访问图片/视频统一用相对路径 `/media/...`，通过 Next.js rewrites 代理到后端
- 无需 `NEXT_PUBLIC_BACKEND_URL`，支持任意 host 访问

## 捕获帖子

```bash
curl -X POST http://localhost:8080/api/posts \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "x",
    "original_url": "https://x.com/user/status/123",
    "author_name": "作者名",
    "author_avatar_url": "https://example.com/avatar.jpg",
    "content": "帖子正文",
    "media": [
      {"kind": "image", "url": "https://example.com/img1.jpg"},
      {"kind": "video", "url": "https://example.com/vid1.mp4"}
    ]
  }'
```

`platform` 取值：`x` | `xiaohongshu`。`original_url` 用于去重（`UNIQUE (platform, original_url)`），重复提交返回 `duplicated: true`。

## 查询帖子

```bash
curl "http://localhost:8080/api/posts?limit=20&cursor=<base64>"
```

keyset 分页，按 `captured_at DESC, id DESC`。

## 删除帖子

```bash
curl -X DELETE "http://localhost:8080/api/posts/:id"
```

软删除（设 `deleted_at` 时间戳），已删除的不会再出现，重复删除返回 404。前端删除后即时从 DOM 移除，不刷新页面。

## 媒体下载

后端收到元数据后异步下载媒体文件到 `MEDIA_ROOT`（默认 `/data/media`，通过 Docker volume 挂载到 host）。

- **目录结构**：`{platform}/{YYYY/MM/DD}/{sha256前2位}/{sha256}.{ext}`
- **去重**：SHA256 命名，相同内容只存一份
- **防盗链**：xhscdn.com 域名自动带 `Referer: https://www.xiaohongshu.com/`
- **权限**：下载后自动 chmod 644，host 可直接打开
- **状态**：pending → downloading → downloaded / failed
- **重试**：最多 5 次，指数退避（1m, 5m, 25m, 125m）
- **崩溃恢复**：启动时重置 stuck downloading → pending，30s 周期扫描
- **安全限制**：单文件最大 500MB，拒绝 text/html 响应

## 前端功能

| 功能 | 说明 |
|------|------|
| 瀑布流 | CSS columns，响应式 1~4 列 |
| 无限滚动 | IntersectionObserver + keyset 光标分页 |
| 暗色模式 | next-themes，header 切换按钮，跟随系统 |
| 媒体灯箱 | 点击图片/视频全屏查看，ESC 或点击遮罩关闭 |
| 原链跳转 | 点击正文在新标签页打开原帖 |
| 删除按钮 | hover 显示垃圾桶图标，乐观删除 |
| 时间显示 | 相对时间（刚刚/X分钟前） |
| 平台标识 | X（灰黑）/ 小红书（红色）Badge |
| 加载占位 | Skeleton 骨架屏 |
| 空态 | "暂无帖子" |

## 数据库

**posts 表**：id, platform, original_url (UNIQUE), author_name, author_avatar_url, avatar_media_id → media, content, posted_at, captured_at, deleted_at

**media 表**：id, post_id → posts, kind (image/video/avatar), position, original_url, status, local_path, content_type, size_bytes, width, height, sha256, attempts, last_error

## 环境变量

### Backend

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `postgres://capture:capture@postgres:5432/capture` | PG 连接串 |
| `MEDIA_ROOT` | `/data/media` | 媒体存储目录 |
| `LISTEN_ADDR` | `:8080` | 监听地址 |
| `DOWNLOAD_WORKERS` | `4` | 下载并发数 |
| `DOWNLOAD_TIMEOUT` | `120s` | 单文件下载超时 |
| `MAX_MEDIA_BYTES` | `524288000` | 单文件 500MB 上限 |
| `CORS_ORIGINS` | `*` | 跨域来源 |

### Frontend

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BACKEND_INTERNAL_URL` | `http://backend:8080` | SSR / rewrites 代理目标 |

## 本地开发

```bash
# 起一个 postgres
docker run -d --name capture-pg -e POSTGRES_USER=capture -e POSTGRES_PASSWORD=capture -e POSTGRES_DB=capture -p 5432:5432 postgres:17-alpine

# 后端
DATABASE_URL="postgres://capture:capture@localhost:5432/capture?sslmode=disable" \
MEDIA_ROOT=/tmp/capture-media \
go run ./cmd/server

# 前端
BACKEND_INTERNAL_URL=http://localhost:8080 npm run dev
```

## 项目结构

```
capture/
├── docker-compose.yaml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── go.mod / go.sum
│   ├── cmd/server/main.go
│   └── internal/
│       ├── config/config.go
│       ├── api/{router,cors,posts,dto}.go
│       ├── store/{store,posts,media}.go
│       ├── downloader/{downloader,fetch}.go
│       └── migrations/{001_init.sql,002_soft_delete.sql,embed.go}
└── frontend/
    ├── Dockerfile
    ├── next.config.ts
    ├── app/{layout,page,globals}.tsx/css
    ├── components/
    │   ├── post-feed.tsx          # 瀑布流 + 无限滚动
    │   ├── post-card.tsx          # 卡片（头像/作者/平台/正文/删除）
    │   ├── post-media.tsx         # 媒体展示（img/video + 点击灯箱）
    │   ├── media-lightbox.tsx     # 灯箱弹窗
    │   ├── platform-badge.tsx     # 平台标识
    │   ├── theme-toggle.tsx       # 暗色切换
    │   ├── providers.tsx          # ThemeProvider 包装
    │   └── ui/                    # shadcn 组件
    └── lib/{api,types}.ts
```
