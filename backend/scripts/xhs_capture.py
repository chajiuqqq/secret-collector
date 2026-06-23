#!/usr/bin/env python3
"""Capture a Xiaohongshu post via xhs API and output JSON for secret-collector.

Supports both short links (xhslink.com) and full URLs.
Handles image posts (图文) and video posts (视频).

Video download:
  - Requires cookies for yt-dlp to work with Xiaohongshu.
  - Set XHS_COOKIE_FILE env var to path of cookies.txt, or
  - Set XHS_COOKIE_BROWSER env var to browser name (e.g. chrome).
  - Without cookies, video posts will capture metadata only (media: []).
"""

import json
import os
import subprocess
import sys
import urllib.request

if len(sys.argv) < 2:
    print("Usage: xhs_capture.py <XHS_POST_URL>", file=sys.stderr)
    sys.exit(1)

INPUT_URL = sys.argv[1]
API_URL = "https://xhs.chajiuqqq.cn/xhs/detail"
COOKIE_FILE = os.environ.get("XHS_COOKIE_FILE", "")
COOKIE_BROWSER = os.environ.get("XHS_COOKIE_BROWSER", "")

# 1. Call xhs API
req_body = json.dumps({"url": INPUT_URL, "download": False}).encode()
req = urllib.request.Request(API_URL, data=req_body, headers={
    "Content-Type": "application/json",
    "Accept": "application/json",
})
with urllib.request.urlopen(req) as resp:
    result = json.loads(resp.read())

# API returns either {"code": 0, "data": ...} or {"message": "success", "data": ...}
# Check for error: if code exists and != 0, OR if message indicates failure
code = result.get("code")
msg = result.get("message", result.get("msg", ""))
if code is not None and code != 0:
    print(f"API error (code={code}): {msg}", file=sys.stderr)
    sys.exit(1)
if isinstance(msg, str) and ("失败" in msg or "error" in msg.lower()):
    print(f"API error: {msg}", file=sys.stderr)
    sys.exit(1)

data = result.get("data", {})

# 2. Extract fields
note_id = data.get("作品ID", data.get("note_id", ""))
author = data.get("作者昵称", "")
avatar = data.get("作者链接", "")
title = data.get("作品标题", "")
desc = data.get("作品描述", "")
post_type = data.get("作品类型", "")  # "图文" or "视频"
posted_raw = data.get("发布时间", "")  # "YYYY-MM-DD_HH:MM:SS"
media_urls = data.get("下载地址", [])
canonical_url = data.get("作品链接", "")

# Build content: title first, then description
content_parts = []
if title:
    content_parts.append(title)
if desc and desc != title:
    content_parts.append(desc)
content = "\n".join(content_parts)

# Convert posted_at
posted_at = ""
if posted_raw:
    try:
        date_part, time_part = posted_raw.split("_")
        posted_at = f"{date_part}T{time_part}+08:00"
    except ValueError:
        posted_at = posted_raw

def download_video_xhs(url, output_path="/tmp/xhs_video.mp4"):
    """Download Xiaohongshu video using yt-dlp.

    Requires cookies for video access. Try cookie file then browser.
    Returns path on success, None on failure.
    """
    download_url = url
    cmd = [
        "yt-dlp", "--no-warnings", "--no-cache-dir",
        "--force-overwrites",
        "-f", "best",
        "-o", output_path,
    ]
    # Add cookies if available
    if COOKIE_FILE and os.path.exists(COOKIE_FILE):
        cmd.extend(["--cookies", COOKIE_FILE])
    elif COOKIE_BROWSER:
        cmd.extend(["--cookies-from-browser", COOKIE_BROWSER])

    cmd.append(download_url)

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        stderr = result.stderr or ""
        if "No video formats found" in stderr:
            print("yt-dlp: No video formats found (XHS requires cookies)", file=sys.stderr)
            print("yt-dlp hint: Set XHS_COOKIE_FILE or XHS_COOKIE_BROWSER env var", file=sys.stderr)
        else:
            print(f"yt-dlp warning: {stderr}", file=sys.stderr)
        if not os.path.exists(output_path):
            return None
    return output_path


# Build media
media = []
if post_type == "视频":
    download_src = canonical_url if canonical_url else f"https://www.xiaohongshu.com/explore/{note_id}"
    video_path = download_video_xhs(download_src)
    if video_path:
        media.append({"kind": "video", "url": video_path})
elif post_type == "图文" and media_urls:
    for url in media_urls:
        if url:
            media.append({"kind": "image", "url": url})

# Build output
output = {
    "platform": "xiaohongshu",
    "original_url": canonical_url if canonical_url else (
        f"https://www.xiaohongshu.com/explore/{note_id}" if note_id else INPUT_URL
    ),
    "author_name": author,
    "content": content,
    "media": media,
}
if avatar:
    output["author_avatar_url"] = avatar
if posted_at:
    output["posted_at"] = posted_at

print(json.dumps(output, ensure_ascii=False))
