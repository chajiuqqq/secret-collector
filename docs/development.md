# 开发环境

## Docker (推荐)

```bash
cp .env.example .env
docker compose up -d --build
```

- 前端：http://localhost:3000
- 后端 API：http://localhost:8080
- Postgres：localhost:5432（容器内，宿主机不暴露）

修改后端代码后：

```bash
docker compose build backend && docker compose up -d backend
```

修改前端代码后（**production standalone 构建，不会热更新**）：

```bash
docker compose build frontend && docker compose up -d frontend
```

## 本地裸跑（不用 Docker）

需要本地装 Go 1.25+ 和 Node 22+。

```bash
# 启 Postgres
docker run -d --name capture-pg \
  -e POSTGRES_USER=capture -e POSTGRES_PASSWORD=capture -e POSTGRES_DB=capture \
  -p 5432:5432 postgres:17-alpine

# 后端（从 backend/ 目录）
cd backend
DATABASE_URL="postgres://capture:capture@localhost:5432/capture?sslmode=disable" \
MEDIA_ROOT=/tmp/capture-media \
go run ./cmd/server

# 前端（从 frontend/ 目录，支持热更新）
cd frontend
BACKEND_INTERNAL_URL=http://localhost:8080 npm run dev
```

## 常用命令

```bash
# Go 编译检查（从 backend/ 目录）
go build -o /dev/null ./...

# 进 DB shell
docker compose exec postgres psql -U capture -d capture

# 查日志
docker compose logs -f backend
```

## API 测试

```bash
# 提交一个帖子（X）
curl -X POST http://localhost:8080/api/posts \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "x",
    "original_url": "https://x.com/user/status/123",
    "author_name": "作者",
    "content": "正文 #标签",
    "media": [{"kind": "image", "url": "https://example.com/img.jpg"}]
  }'

# 启动 TG 扫描（异步）
curl -X POST http://localhost:8080/api/tg/scan \
  -H "Content-Type: application/json" \
  -d '{"index_path":"/tg-index/tg-saved-full.json","media_dir":"/tg-media"}'

# 查询帖子
curl "http://localhost:8080/api/posts?limit=20&tag=tg"
curl "http://localhost:8080/api/tags"

# 删除
curl -X DELETE "http://localhost:8080/api/posts/1"
```

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
| `XHS_COOKIE_FILE` | _空_ | 小红书视频 cookies（Netscape 格式 cookies.txt），仅捕获视频帖子时需要 |
| `HTTPS_PROXY` | _空_ | X/Twitter 抓取代理（如果网络不通） |

### Frontend

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BACKEND_INTERNAL_URL` | `http://backend:8080` | SSR / rewrites 代理目标 |
