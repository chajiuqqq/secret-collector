"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaItem } from "@/lib/types";
import { mediaUrl } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

function useAutoplayVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.play().catch(() => {});
          } else {
            el.pause();
          }
        }
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return ref;
}

function MediaImg({ m, blurred, onClick }: { m: MediaItem; blurred?: boolean; onClick?: () => void }) {
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
    <button onClick={onClick} className="w-full cursor-zoom-in block relative">
      <img
        src={src}
        alt=""
        loading="lazy"
        style={{ aspectRatio: aspect, ...(blurred ? { filter: "blur(24px)" } : {}) }}
        className="w-full rounded-lg object-cover bg-muted"
      />
      {blurred && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white text-xs bg-black/50 rounded-full px-2 py-0.5">模糊</span>
        </div>
      )}
    </button>
  );
}

function MediaVideo({ m, blurred, onClick }: { m: MediaItem; blurred?: boolean; onClick?: () => void }) {
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
        preload="none"
        muted
        loop
        playsInline
        className="w-full rounded-lg bg-black"
        style={blurred ? { filter: "blur(24px)" } : undefined}
      />
      {blurred && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-white text-xs bg-black/50 rounded-full px-2 py-0.5">模糊</span>
        </div>
      )}
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
  blurred?: boolean;
  onMediaClick?: (url: string, kind: "image" | "video") => void;
}

export default function PostMedia({ items, blurred, onMediaClick }: Props) {
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
      <MediaVideo m={m} blurred={blurred} onClick={mkClick(m)} />
    ) : (
      <MediaImg m={m} blurred={blurred} onClick={mkClick(m)} />
    );
  }

  if (media.length > 4) {
    return <MediaCarousel media={media} blurred={blurred} mkClick={mkClick} />;
  }

  return (
    <div className="grid grid-cols-2 gap-1">
      {media.slice(0, 4).map((m) => (
        <div key={m.id}>
          {m.kind === "video" ? (
            <MediaVideo m={m} blurred={blurred} onClick={mkClick(m)} />
          ) : (
            <MediaImg m={m} blurred={blurred} onClick={mkClick(m)} />
          )}
        </div>
      ))}
    </div>
  );
}

function MediaCarousel({
  media,
  blurred,
  mkClick,
}: {
  media: MediaItem[];
  blurred?: boolean;
  mkClick: (m: MediaItem) => (() => void) | undefined;
}) {
  const [active, setActive] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.clientWidth <= 0) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  return (
    <div>
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none"
        >
          {media.map((m) => (
            <div
              key={m.id}
              className="snap-center shrink-0 w-full"
            >
              {m.kind === "video" ? (
                <MediaVideo m={m} blurred={blurred} onClick={mkClick(m)} />
              ) : (
                <MediaImg m={m} blurred={blurred} onClick={mkClick(m)} />
              )}
            </div>
          ))}
        </div>
        <span className="absolute top-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
          {active + 1}/{media.length}
        </span>
      </div>
      <div className="flex justify-center gap-1 mt-2">
        {media.map((_, i) => (
          <button
            key={i}
            aria-label={`第 ${i + 1} 张`}
            className={`h-1.5 rounded-full transition-all ${
              i === active
                ? "w-4 bg-primary"
                : "w-1.5 bg-muted-foreground/30"
            }`}
            onClick={() => {
              scrollRef.current?.children[i]?.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
                inline: "center",
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}
