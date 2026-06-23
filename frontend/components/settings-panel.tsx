"use client";

import { useState, useRef } from "react";
import { startTgScan, watchScanProgress } from "@/lib/api";
import { useNSFW } from "./nsfw-context";
import BottomSheet from "./bottom-sheet";
import type { TgScanProgress, TgScanResponse } from "@/lib/types";

const scanModes = [
  { key: "index", label: "文件索引" },
  { key: "link", label: "分享链接" },
];

const phaseLabels: Record<string, string> = {
  parsing: "解析中",
  linking: "链接文件中",
  writing: "写入数据库",
};

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const { nsfw, setNsfw } = useNSFW();
  const [scanMode, setScanMode] = useState("index");
  const [indexPath, setIndexPath] = useState(
    "/vol2/@apphome/trim.openclaw/data/workspace/tg-saved-full.json"
  );
  const [mediaDir, setMediaDir] = useState("/vol1/1000/tg");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<TgScanProgress | null>(null);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  const handleScan = async () => {
    setScanning(true);
    setProgress(null);
    setResult(null);
    try {
      await startTgScan({
        index_path: indexPath,
        media_dir: mediaDir,
      });

      watchScanProgress(
        (p) => setProgress(p),
        (r: TgScanResponse) => {
          setScanning(false);
          setResult({
            type: "success",
            message: `创建 ${r.posts_created} 条帖子，跳过 ${r.posts_skipped} 条，找到 ${r.media_found} 个媒体，缺失 ${r.media_missing} 个`,
          });
        },
        (err) => {
          setScanning(false);
          setProgress(null);
          setResult({ type: "error", message: err });
        },
      );
    } catch (err) {
      setScanning(false);
      setResult({ type: "error", message: (err as Error).message });
    }
  };

  const pct = progress && progress.total_messages > 0
    ? Math.round((progress.processed / progress.total_messages) * 100)
    : 0;

  return (
    <div className="relative" ref={buttonRef}>
      <button
        onClick={() => setOpen(true)}
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

      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <h3 className="font-medium text-sm mb-3">TG 扫描设置</h3>

        <div className="flex items-center justify-between mb-3">
          <span className="text-sm">NSFW 模式</span>
          <button
            onClick={() => setNsfw(!nsfw)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              nsfw ? "bg-red-500" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                nsfw ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3 -mt-2">
          开启后所有帖子不再模糊
        </p>

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

            {(scanning || result) && progress && (
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>{phaseLabels[progress.phase] ?? progress.phase}</span>
                  <span>{pct}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2 mb-1">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  已处理 {progress.processed} / {progress.total_messages}
                  {" · "}媒体 {progress.media_found} 个
                </p>
              </div>
            )}
          </>
        )}

        {result && (
          <p
            className={`text-xs ${
              result.type === "success"
                ? "text-green-600 dark:text-green-400"
                : "text-red-500"
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
      </BottomSheet>
    </div>
  );
}
