# Telegram Saved Messages 媒体下载脚本

通过 [tdl](https://github.com/iyear/tdl) 下载 Telegram Saved Messages 中的所有媒体文件。

## 前置条件

- `tdl` 已安装（服务器上已安装于 `/usr/local/bin/tdl`）
- 已登录 Telegram：
  
  ```bash
  tdl login --type qr --proxy socks5://100.85.18.9:7890
  ```
  
  用手机 Telegram → 设置 → 设备 → 扫码登录

## 三步走

### 1. 导出 Saved Messages 消息索引（仅媒体文件名）

```bash
tdl chat export --all \
  -o /vol2/@apphome/trim.openclaw/data/workspace/tg-saved-messages.json \
  --proxy socks5://100.85.18.9:7890
```

> 导出的 JSON 只含消息 ID 和文件名，不包含文本内容。约 ~3900 条消息。

### 2. （可选）导出完整消息索引（含文本内容）

```bash
tdl chat export --all \
  -o /vol2/@apphome/trim.openclaw/data/workspace/tg-saved-full.json \
  --with-content \
  --proxy socks5://100.85.18.9:7890
```

> `--with-content` 会把消息文本也写进 JSON，文件更大，导出更慢。

### 3. 下载所有媒体文件

```bash
tdl download \
  -f /vol2/@apphome/trim.openclaw/data/workspace/tg-saved-messages.json \
  -d /vol1/1000/tg \
  --proxy socks5://100.85.18.9:7890 \
  --skip-same
```

| 参数            | 含义                   |
| ------------- | -------------------- |
| `-f`          | 导入的 JSON 文件（第 1 步产出） |
| `-d`          | 下载目录                 |
| `--proxy`     | SOCKS5 代理（服务器需要）     |
| `--skip-same` | 跳过已存在的同名文件，支持断点续传    |

## 断点续传

如果下载中断（网络问题 / 手动 Ctrl+C），重新执行第 3 步即可。`--skip-same` 会自动跳过已下载的文件。

也可以使用 `--continue` 恢复上次下载：

```bash
tdl download --continue
```

## 其他有用参数

```bash
# 提高并发速度（默认 2，可调高）
tdl download ... -l 4 -t 8

# 只下载特定类型
tdl download ... -i mp4,jpg    # 只下载 mp4 和 jpg
tdl download ... -e webp       # 排除 webp

# 按时间倒序下载（新的优先）
tdl download ... --desc

# 跳过同名同大小的文件
tdl download ... --skip-same
```

## 注意事项

- **不要同时跑多个 tdl 进程** —— session 文件是单进程独占的，多进程会互相踩踏
- 如果遇到 `not authorized`，说明 session 过期了，重新 `tdl login --type qr`
- 下载大量文件时 Telegram 有速率限制，tdl 会自动处理（间歇性暂停）
- 可用 `du -sh /vol1/1000/tg/` 查看已下载总大小
