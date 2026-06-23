# 生产部署

## 部署架构

| 项 | 值 |
|---|---|
| SSH | `chajiuqqq@100.114.94.119` |
| 项目路径 | `/vol2/1000/secret-collector` |
| 媒体存储 | `/vol1/1000/capture` |
| Docker | 可能需要 `sg docker -c "..."` |
| 代理 | `git pull` 前 `export https_proxy=http://100.85.18.9:7890` |

## 部署命令

```bash
ssh chajiuqqq@100.114.94.119 'export https_proxy=http://100.85.18.9:7890 && cd /vol2/1000/secret-collector && git pull && sg docker -c "docker compose up -d --build"'
```

## 单独重建前端（最常用）

前端是 Next.js standalone 镜像，**改源码后必须 rebuild**：

```bash
ssh chajiuqqq@100.114.94.119 'cd /vol2/1000/secret-collector && git pull && sg docker -c "docker compose build frontend && docker compose up -d frontend"'
```

## 运维

```bash
# 查日志
ssh chajiuqqq@100.114.94.119 'cd /vol2/1000/secret-collector && sg docker -c "docker compose logs --tail=50 backend"'

# DB shell
ssh chajiuqqq@100.114.94.119 'docker exec secret-collector-postgres-1 psql -U capture -d capture'

# 容器状态
ssh chajiuqqq@100.114.94.119 'cd /vol2/1000/secret-collector && sg docker -c "docker compose ps"'
```

## 常用 SQL

```sql
-- 各平台帖子数
SELECT platform, COUNT(*) FROM posts WHERE deleted_at IS NULL GROUP BY platform;

-- 媒体下载状态分布
SELECT status, COUNT(*) FROM media GROUP BY status;

-- 重置所有 failed 媒体重试
UPDATE media SET status = 'pending', attempts = 0, last_error = NULL WHERE status = 'failed';

-- 清空所有 TG 帖子（保留磁盘上的硬链接文件）
DELETE FROM media WHERE post_id IN (SELECT id FROM posts WHERE platform = 'tg');
DELETE FROM posts WHERE platform = 'tg';
DELETE FROM tags WHERE name = 'tg';
```

## 故障排查

### 前端没更新
镜像 layer 缓存可能命中旧代码。强制清缓存重建：

```bash
docker compose build --no-cache frontend && docker compose up -d frontend
```

### Git pull 冲突
生产服务器的 `docker-compose.yaml` 通常有本地代理/挂载修改：

```bash
git stash && git pull && git stash pop
# 如果 stash pop 冲突，手动解决；或者：
git checkout --theirs docker-compose.yaml && git add docker-compose.yaml
```

### 视频抓取失败
- X 平台：检查 `HTTPS_PROXY` 是否可达 x.com
- 小红书：需要 `XHS_COOKIE_FILE`，从浏览器导出 Netscape 格式 cookies.txt

## 镜像源（中国大陆构建）

`backend/Dockerfile` 已配置：
- Go：`GOPROXY=https://goproxy.cn,direct`
- Alpine apk：`mirrors.ustc.edu.cn`
- pip：`mirrors.aliyun.com`

`frontend/Dockerfile`：
- npm：`registry.npmmirror.com`
