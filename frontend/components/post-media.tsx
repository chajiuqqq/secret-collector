"use client";

import type { MediaItem } from "@/lib/types";
import { mediaUrl } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

function MediaImg({ m, onClick }: { m: MediaItem; onClick?: () => void }) {
  if (m.status === "pending" || m.status === "downloading") {
    return <Skeleton className="w-full h-48 rounded-lg" />;
  }
  if (m.status === "failed" || !m.url) {
    return (
      <div className="w-full h-48 rounded-lg bg-muted flex items-center justify-center text-muted-foreground text-sm">
        下载失败
      </div>
    );
  }
  const aspect = m.width && m.height ? `${m.width}/${m.height}` : "16/9";
  const src = mediaUrl(m.url);
  return (
    <button onClick={onClick} className="w-full cursor-zoom-in block">
      <img
        src={src}
        alt=""
        loading="lazy"
        style={{ aspectRatio: aspect }}
        className="w-full rounded-lg object-cover bg-muted"
      />
    </button>
  );
}

function MediaVideo({ m, onClick }: { m: MediaItem; onClick?: () => void }) {
  if (m.status === "pending" || m.status === "downloading") {
    return <Skeleton className="w-full h-48 rounded-lg" />;
  }
  if (m.status === "failed" || !m.url) {
    return (
      <div className="w-full h-48 rounded-lg bg-muted flex items-center justify-center text-muted-foreground text-sm">
        下载失败
      </div>
    );
  }
  const src = mediaUrl(m.url);
  return (
    <div className="relative">
      <video
        src={src}
        controls
        preload="metadata"
        playsInline
        className="w-full rounded-lg bg-black"
      />
      {onClick && (
        <button
          onClick={onClick}
          className="absolute top-2 right-2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
          aria-label="全屏"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
      )}
    </div>
  );
}

interface Props {
  items: MediaItem[];
  onMediaClick?: (url: string, kind: "image" | "video") => void;
}

export default function PostMedia({ items, onMediaClick }: Props) {
  const media = items.filter((m) => m.kind !== "avatar");
  if (media.length === 0) return null;

  const mkClick = (m: MediaItem) => {
    if (
      onMediaClick &&
      m.url &&
      (m.status === "downloaded" || m.url.startsWith("http"))
    ) {
      const u = m.url;
      const kind = m.kind as "image" | "video";
      return () => onMediaClick(mediaUrl(u), kind);
    }
    return undefined;
  };

  if (media.length === 1) {
    const m = media[0];
    return m.kind === "video" ? (
      <MediaVideo m={m} onClick={mkClick(m)} />
    ) : (
      <MediaImg m={m} onClick={mkClick(m)} />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-1">
      {media.slice(0, 4).map((m) => (
        <div key={m.id}>
          <MediaImg m={m} onClick={mkClick(m)} />
        </div>
      ))}
    </div>
  );
}
