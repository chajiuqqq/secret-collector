# Capture scripts

Vendored from https://github.com/chajiuqqq/social-capture (skill `social-capture`).

These scripts are exec'd by `internal/capture` to extract post metadata + media URLs from
X/Twitter and Xiaohongshu URLs. They are copied into `/skills/` inside the backend
Docker image (see `../Dockerfile`).

To update: pull the latest scripts from the upstream repo and replace these files.
Source commit: `2f60d5c` (2026-06-23).
