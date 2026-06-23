"use client";

import { useEffect, useRef, useState } from "react";
import { startCapture, watchCaptureProgress } from "@/lib/api";
import type { CaptureProgress, CaptureResult } from "@/lib/types";
import BottomSheet from "./bottom-sheet";

const phaseLabels: Record<string, string> = {
  detecting: "识别平台",
  fetching: "抓取中",
  filing: "保存视频",
  writing: "写入数据库",
};

const phaseOrder = ["detecting", "fetching", "filing", "writing"] as const;

type ItemStatus =
  | { kind: "pending" }
  | { kind: "running"; progress: CaptureProgress }
  | { kind: "success"; result: CaptureResult }
  | { kind: "error"; message: string };

interface QueueItem {
  url: string;
  status: ItemStatus;
}

export default function CaptureButton({ onCaptured }: { onCaptured?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const watcherRef = useRef<(() => void) | null>(null);

  // Stop any in-flight SSE watcher when the component unmounts.
  useEffect(() => () => watcherRef.current?.(), []);

  const parseUrls = (raw: string): string[] => {
    return raw
      .split(/[\n\r]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  const handleCapture = async () => {
    const urls = parseUrls(text);
    if (urls.length === 0 || running) return;

    setRunning(true);
    const initial: QueueItem[] = urls.map((url) => ({
      url,
      status: { kind: "pending" },
    }));
    setQueue(initial);

    let createdAny = false;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const setItem = (s: ItemStatus) => {
        setQueue((q) => {
          const next = [...q];
          next[i] = { url, status: s };
          return next;
        });
      };

      setItem({ kind: "running", progress: { phase: "detecting", url } });

      try {
        await startCapture(url);
        await new Promise<void>((resolve) => {
          watcherRef.current?.();
          watcherRef.current = watchCaptureProgress(
            (p) => setItem({ kind: "running", progress: p }),
            (r) => {
              setItem({ kind: "success", result: r });
              if (!r.duplicated) createdAny = true;
              resolve();
            },
            (err) => {
              setItem({ kind: "error", message: err });
              resolve();
            },
          );
        });
      } catch (err) {
        setItem({ kind: "error", message: (err as Error).message });
      }
    }

    setRunning(false);

    if (onCaptured) {
      onCaptured();
    } else if (createdAny && typeof window !== "undefined") {
      setTimeout(() => window.location.reload(), 1200);
    }
  };

  const reset = () => {
    setQueue([]);
    setText("");
  };

  const handleClose = () => {
    if (running) return; // don't close while batch is running
    setOpen(false);
  };

  const allDone = queue.length > 0 && queue.every((q) =>
    q.status.kind === "success" || q.status.kind === "error"
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(true)}
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

      <BottomSheet open={open} onClose={handleClose}>
        <h3 className="font-medium text-sm mb-1 pr-8">添加链接</h3>
        <p className="text-xs text-muted-foreground mb-3">
          支持 X/Twitter、小红书（xhslink.com/o/...），每行一个 URL
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"https://x.com/.../status/...\nhttp://xhslink.com/o/..."}
          disabled={running}
          rows={4}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background mb-3 disabled:opacity-60 resize-y font-mono"
        />

        <div className="flex gap-2 mb-3">
          <button
            onClick={handleCapture}
            disabled={running || parseUrls(text).length === 0}
            className="flex-1 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {running
              ? `抓取中 (${queue.filter((q) => q.status.kind !== "pending" && q.status.kind !== "running").length}/${queue.length})`
              : `抓取 ${parseUrls(text).length > 0 ? `(${parseUrls(text).length})` : ""}`}
          </button>
          {allDone && (
            <button
              onClick={reset}
              className="inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              再来一组
            </button>
          )}
        </div>

        {queue.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {queue.map((item, i) => (
              <CaptureRow key={i} item={item} />
            ))}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function CaptureRow({ item }: { item: QueueItem }) {
  const { url, status } = item;
  const short = url.length > 50 ? url.slice(0, 50) + "…" : url;

  const pct =
    status.kind === "running"
      ? Math.max(1, Math.round(
          ((phaseOrder.indexOf(status.progress.phase as typeof phaseOrder[number]) + 1) /
            phaseOrder.length) * 100,
        ))
      : 0;

  return (
    <div className="border rounded-md p-2 text-xs">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="truncate flex-1 font-mono text-muted-foreground" title={url}>
          {short}
        </span>
        <span className="shrink-0">
          {status.kind === "pending" && <span className="text-muted-foreground">等待</span>}
          {status.kind === "running" && (
            <span className="text-primary">
              {phaseLabels[status.progress.phase] ?? status.progress.phase} {pct}%
            </span>
          )}
          {status.kind === "success" && (
            <span className="text-green-600 dark:text-green-400">
              {status.result.duplicated ? "已存在" : `保存 ${status.result.media_count} 个`}
            </span>
          )}
          {status.kind === "error" && <span className="text-red-500">失败</span>}
        </span>
      </div>
      {status.kind === "running" && (
        <div className="w-full bg-muted rounded-full h-1">
          <div
            className="bg-primary h-1 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {status.kind === "error" && (
        <p className="text-red-500 break-words mt-1">{status.message}</p>
      )}
    </div>
  );
}
