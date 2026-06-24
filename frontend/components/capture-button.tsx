"use client";

import { useState } from "react";
import { startCapture } from "@/lib/api";
import BottomSheet from "./bottom-sheet";
import CaptureTaskList from "./capture-task-list";

export default function CaptureButton({
  onCaptured,
}: { onCaptured?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const parseUrls = (raw: string): string[] =>
    raw
      .split(/[\n\r]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  const handleSubmit = async () => {
    const urls = parseUrls(text);
    if (urls.length === 0 || submitting) return;
    setSubmitting(true);
    setHint(null);
    try {
      const { tasks } = await startCapture(urls);
      setText("");
      setHint(`已加入队列 ${tasks.length} 条`);
    } catch (err) {
      setHint((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Notify parent (PostFeed) that new captures have completed so it can
  // refetch. If the parent didn't pass a callback we do nothing — the queue
  // panel itself updates live via SSE; reloading the page would close the
  // sheet and defeat the whole point of the redesign.
  const onAnyDone = () => {
    onCaptured?.();
  };

  const urls = parseUrls(text);

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

      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <h3 className="font-medium text-sm mb-1 pr-8">添加链接</h3>
        <p className="text-xs text-muted-foreground mb-3">
          支持 X/Twitter、小红书（xhslink.com/o/...），每行一个 URL
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"https://x.com/.../status/...\nhttp://xhslink.com/o/..."}
          rows={3}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background mb-3 resize-y font-mono"
        />

        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={handleSubmit}
            disabled={submitting || urls.length === 0}
            className="flex-1 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting
              ? "提交中…"
              : urls.length > 0
                ? `加入队列 (${urls.length})`
                : "加入队列"}
          </button>
          {hint && (
            <span className="text-xs text-muted-foreground truncate">
              {hint}
            </span>
          )}
        </div>

        <div className="border-t -mx-4 px-4 pt-3">
          <CaptureTaskList onAnyDone={onAnyDone} />
        </div>
      </BottomSheet>
    </div>
  );
}
