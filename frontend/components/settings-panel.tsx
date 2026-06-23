"use client";

import { useState, useRef, useEffect } from "react";
import { scanTgPosts } from "@/lib/api";

const scanModes = [
  { key: "index", label: "文件索引" },
  { key: "link", label: "分享链接" },
];

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [scanMode, setScanMode] = useState("index");
  const [indexPath, setIndexPath] = useState(
    "/vol2/@apphome/trim.openclaw/data/workspace/tg-saved-full.json"
  );
  const [mediaDir, setMediaDir] = useState("/vol1/1000/tg");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  const handleScan = async () => {
    setScanning(true);
    setResult(null);
    try {
      const res = await scanTgPosts({
        index_path: indexPath,
        media_dir: mediaDir,
      });
      setResult({
        type: "success",
        message: `创建 ${res.posts_created} 条帖子，跳过 ${res.posts_skipped} 条，找到 ${res.media_found} 个媒体，缺失 ${res.media_missing} 个`,
      });
    } catch (err) {
      setResult({ type: "error", message: (err as Error).message });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center justify-center w-9 h-9 rounded-md hover:bg-accent hover:text-accent-foreground"
        aria-label="设置"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card border rounded-xl shadow-lg p-4 z-50">
          <h3 className="font-medium text-sm mb-3">TG 扫描设置</h3>

          <div className="flex gap-1 mb-3">
            {scanModes.map((m) => (
              <button
                key={m.key}
                onClick={() => setScanMode(m.key)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  scanMode === m.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {scanMode === "index" && (
            <>
              <label className="text-xs text-muted-foreground block mb-1">
                JSON 索引路径
              </label>
              <input
                type="text"
                value={indexPath}
                onChange={(e) => setIndexPath(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border rounded-md bg-background mb-3"
              />
              <label className="text-xs text-muted-foreground block mb-1">
                媒体存储路径
              </label>
              <input
                type="text"
                value={mediaDir}
                onChange={(e) => setMediaDir(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border rounded-md bg-background mb-3"
              />
              <button
                onClick={handleScan}
                disabled={scanning}
                className="w-full inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 mb-2"
              >
                {scanning ? "扫描中..." : "扫描录入"}
              </button>
            </>
          )}

          {result && (
            <p
              className={`text-xs ${
                result.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-500"
              } mb-2`}
            >
              {result.message}
            </p>
          )}

          <hr className="my-3" />

          <h3 className="font-medium text-sm mb-2">TG 分享链接下载</h3>
          <input
            type="text"
            placeholder="https://t.me/..."
            className="w-full px-3 py-1.5 text-sm border rounded-md bg-background mb-2"
          />
          <button
            disabled
            className="w-full inline-flex items-center justify-center rounded-md bg-muted text-muted-foreground px-3 py-1.5 text-sm font-medium"
          >
            暂未开放
          </button>
        </div>
      )}
    </div>
  );
}
