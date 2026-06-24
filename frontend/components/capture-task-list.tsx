"use client";

import { useEffect, useRef, useState } from "react";
import { fetchCaptureTasks, retryCaptureTask } from "@/lib/api";
import type { CaptureTask } from "@/lib/types";

const phaseLabels: Record<string, string> = {
  detecting: "识别平台",
  fetching: "抓取中",
  writing: "写入数据库",
};

const phaseOrder = ["detecting", "fetching", "writing"] as const;

interface Props {
  onAnyDone?: () => void;
}

// Polls the backend's capture-task sliding window every second while mounted.
// We previously used SSE here but switched to polling because the Next.js
// rewrite proxy buffered events unpredictably in some browser setups — polling
// is dumb but works everywhere. Calls onAnyDone for any newly-terminal success
// that wasn't already present at mount time.
export default function CaptureTaskList({ onAnyDone }: Props) {
  const [tasks, setTasks] = useState<CaptureTask[]>([]);
  const [lastTick, setLastTick] = useState<Date | null>(null);
  // Track which task IDs we've already reported as done so onAnyDone fires
  // exactly once per task, not on every poll.
  const reportedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const t = await fetchCaptureTasks();
        if (!alive) return;
        setTasks(t);
        setLastTick(new Date());
        if (!seededRef.current) {
          for (const x of t) {
            if (x.status === "done" || x.status === "error") {
              reportedRef.current.add(x.id);
            }
          }
          seededRef.current = true;
          return;
        }
        for (const x of t) {
          if (
            x.status === "done" &&
            !x.duplicated &&
            x.media_count > 0 &&
            !reportedRef.current.has(x.id)
          ) {
            reportedRef.current.add(x.id);
            onAnyDone?.();
          }
        }
      } catch {
        // Network blip: leave previous state, next tick will retry.
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render newest first.
  const ordered = [...tasks].reverse();

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-muted-foreground">最近任务</p>
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          {lastTick ? "实时更新中" : "连接中…"}
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          暂无任务
        </p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {ordered.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: CaptureTask }) {
  const [retrying, setRetrying] = useState(false);
  const short = task.url.length > 50 ? task.url.slice(0, 50) + "…" : task.url;

  const phaseIndex = task.phase
    ? phaseOrder.indexOf(task.phase as (typeof phaseOrder)[number])
    : -1;
  const pct =
    task.status === "running" && phaseIndex >= 0
      ? Math.round(((phaseIndex + 1) / phaseOrder.length) * 100)
      : 0;

  // Retry is exposed for error (re-run capture) and for done with no media
  // saved (likely all downloads failed) — backend decides what actually happens.
  const canRetry =
    task.status === "error" ||
    (task.status === "done" && !task.duplicated && task.media_count === 0);

  const onRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await retryCaptureTask(task.id);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="border rounded-md p-2 text-xs">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span
          className="truncate flex-1 font-mono text-muted-foreground"
          title={task.url}
        >
          {short}
        </span>
        <span className="shrink-0 flex items-center gap-2">
          <StatusBadge task={task} pct={pct} />
          {canRetry && (
            <button
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex items-center justify-center px-2 py-0.5 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
            >
              {retrying ? "…" : "重试"}
            </button>
          )}
        </span>
      </div>
      {task.status === "running" && (
        <div className="w-full bg-muted rounded-full h-1">
          <div
            className="bg-primary h-1 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {task.status === "error" && task.error && (
        <details className="mt-1 group">
          <summary className="text-red-500 cursor-pointer text-[11px] select-none list-none flex items-center gap-1">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform group-open:rotate-90"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            查看错误
          </summary>
          <pre className="mt-1 p-2 rounded bg-muted text-red-500 text-[10px] leading-tight whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono">
            {task.error}
          </pre>
        </details>
      )}
      {task.attempts > 1 && (
        <p className="text-[10px] text-muted-foreground mt-1">
          已尝试 {task.attempts} 次
        </p>
      )}
    </div>
  );
}

function StatusBadge({ task, pct }: { task: CaptureTask; pct: number }) {
  switch (task.status) {
    case "queued":
      return <span className="text-muted-foreground">等待</span>;
    case "running":
      return (
        <span className="text-primary">
          {phaseLabels[task.phase ?? ""] ?? task.phase ?? "进行中"} {pct}%
        </span>
      );
    case "done":
      if (task.duplicated)
        return (
          <span className="text-amber-600 dark:text-amber-400">已存在</span>
        );
      return (
        <span className="text-green-600 dark:text-green-400">
          保存 {task.media_count} 个
        </span>
      );
    case "error":
      return <span className="text-red-500">失败</span>;
  }
}
