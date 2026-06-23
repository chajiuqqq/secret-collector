"use client";

import { useEffect, useRef, useState } from "react";
import { startCapture, watchCaptureProgress } from "@/lib/api";
import type { CaptureProgress, CaptureResult } from "@/lib/types";

const phaseLabels: Record<string, string> = {
  detecting: "识别平台",
  fetching: "抓取中",
  filing: "保存视频",
  writing: "写入数据库",
};

const phaseOrder = ["detecting", "fetching", "filing", "writing"] as const;

type Status =
  | { kind: "idle" }
  | { kind: "running"; progress: CaptureProgress }
  | { kind: "success"; result: CaptureResult }
  | { kind: "error"; message: string };

export default function CaptureButton({ onCaptured }: { onCaptured?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const panelRef = useRef<HTMLDivElement>(null);
  const watcherRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Stop any in-flight SSE watcher when the component unmounts.
  useEffect(() => () => watcherRef.current?.(), []);

  const handleCapture = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setStatus({ kind: "running", progress: { phase: "detecting", url: trimmed } });
    try {
      await startCapture(trimmed);
      watcherRef.current?.();
      watcherRef.current = watchCaptureProgress(
        (p) => setStatus({ kind: "running", progress: p }),
        (r) => {
          setStatus({ kind: "success", result: r });
          if (onCaptured) {
            onCaptured();
          } else if (typeof window !== "undefined" && !r.duplicated) {
            // Default: brief delay so the success line is visible, then reload
            // the feed so the new card shows up. Skip for duplicates — nothing
            // changed.
            setTimeout(() => window.location.reload(), 1200);
          }
        },
        (err) => setStatus({ kind: "error", message: err }),
      );
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  };

  const reset = () => {
    setStatus({ kind: "idle" });
    setUrl("");
  };

  // Estimate progress %: index of current phase / total phases.
  const pct =
    status.kind === "running"
      ? Math.max(1, Math.round(
          ((phaseOrder.indexOf(status.progress.phase as typeof phaseOrder[number]) + 1) /
            phaseOrder.length) * 100,
        ))
      : 0;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center justify-center w-9 h-9 rounded-md hover:bg-accent hover:text-accent-foreground"
        aria-label="添加链接"
        title="添加链接"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-card border rounded-xl shadow-lg p-4 z-50">
          <h3 className="font-medium text-sm mb-1">添加链接</h3>
          <p className="text-xs text-muted-foreground mb-3">
            支持 X/Twitter 帖子链接、小红书短链（xhslink.com/o/...）
          </p>

          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && status.kind !== "running") handleCapture();
            }}
            placeholder="https://x.com/.../status/... 或 http://xhslink.com/o/..."
            disabled={status.kind === "running"}
            className="w-full px-3 py-1.5 text-sm border rounded-md bg-background mb-3 disabled:opacity-60"
            autoFocus
          />

          <div className="flex gap-2 mb-3">
            <button
              onClick={handleCapture}
              disabled={status.kind === "running" || !url.trim()}
              className="flex-1 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {status.kind === "running" ? "抓取中..." : "抓取"}
            </button>
            {(status.kind === "success" || status.kind === "error") && (
              <button
                onClick={reset}
                className="inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                再来一个
              </button>
            )}
          </div>

          {status.kind === "running" && (
            <div className="mb-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>{phaseLabels[status.progress.phase] ?? status.progress.phase}</span>
                <span>{pct}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {status.kind === "success" && (
            <p className="text-xs text-green-600 dark:text-green-400">
              {status.result.duplicated
                ? `已存在 (post ${status.result.post_id})`
                : `成功保存 ${status.result.media_count} 个媒体 (post ${status.result.post_id})`}
            </p>
          )}

          {status.kind === "error" && (
            <p className="text-xs text-red-500 break-words">{status.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
