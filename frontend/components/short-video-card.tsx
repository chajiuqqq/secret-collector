"use client";

import "@vidstack/react/player/styles/base.css";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MediaPlayer,
  MediaProvider,
  useMediaRemote,
  useMediaState,
} from "@vidstack/react";
import { Play, Film, Trash2, Eye, EyeOff } from "lucide-react";
import type { MediaItem, PostItem } from "@/lib/types";
import { mediaUrl } from "@/lib/api";
import { useNSFW } from "./nsfw-context";
import PlatformBadge from "./platform-badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";

function timeAgo(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(dateStr).toLocaleDateString("zh-CN");
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Vidstack controls + gestures. Must be rendered inside <MediaPlayer>. */
function VideoControls({ active }: { active: boolean }) {
  const remote = useMediaRemote();
  const currentTime = useMediaState("currentTime");
  const duration = useMediaState("duration");
  const paused = useMediaState("paused");

  // Keep latest values for use in async tap/seek handlers (avoid stale closures).
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    if (active) {
      remote.play();
    } else {
      remote.pause();
    }
  }, [active, remote]);

  // --- Tap gesture: single = toggle play/pause, double = seek ±3s (left/right) ---
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [seekHint, setSeekHint] = useState<{ dir: "fwd" | "back"; key: number } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onTap = useCallback((e: React.PointerEvent) => {
    const now = Date.now();
    if (now - lastTap.current < 280 && clickTimer.current) {
      // double tap → seek ±3s based on left/right half
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      lastTap.current = 0;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const isRight = e.clientX - rect.left > rect.width / 2;
      const t = currentTimeRef.current;
      const d = durationRef.current;
      const target = isRight ? Math.min(d, t + 3) : Math.max(0, t - 3);
      remote.seek(target);
      setSeekHint({ dir: isRight ? "fwd" : "back", key: now });
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setSeekHint(null), 600);
    } else {
      lastTap.current = now;
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        if (pausedRef.current) remote.play();
        else remote.pause();
      }, 280);
    }
  }, [remote]);

  // --- Draggable progress bar ---
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);

  const ratioFromEvent = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const onTrackDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const t = ratioFromEvent(e.clientX) * (durationRef.current || 0);
    setDragging(true);
    setDragTime(t);
    remote.seeking(t);
  };
  const onTrackMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    e.stopPropagation();
    const t = ratioFromEvent(e.clientX) * (durationRef.current || 0);
    setDragTime(t);
    remote.seeking(t);
  };
  const onTrackUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    e.stopPropagation();
    const t = ratioFromEvent(e.clientX) * (durationRef.current || 0);
    setDragging(false);
    remote.seek(t);
  };

  const displayTime = dragging ? dragTime : currentTime;
  const progress = duration > 0 ? Math.min(1, displayTime / duration) : 0;

  return (
    <>
      {/* gesture layer: single tap = toggle, double tap = seek ±3s */}
      <div className="absolute inset-0 z-0" onPointerUp={onTap} />

      {/* seek hint */}
      {seekHint && (
        <div
          key={seekHint.key}
          className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center"
        >
          <span className="animate-fade-in rounded-full bg-black/50 px-3 py-1 text-sm text-white">
            {seekHint.dir === "fwd" ? "3s »" : "« 3s"}
          </span>
        </div>
      )}

      {/* center play/pause indicator */}
      {(!active || paused) && (
        <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
          <div className="rounded-full bg-black/40 p-4">
            <Play className="h-8 w-8 text-white" />
          </div>
        </div>
      )}

      {/* progress bar + time */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 px-3 pb-2">
        <span className="w-9 text-right text-[10px] tabular-nums text-white/80">
          {formatTime(displayTime)}
        </span>
        <div
          ref={trackRef}
          onPointerDown={onTrackDown}
          onPointerMove={onTrackMove}
          onPointerUp={onTrackUp}
          onPointerCancel={onTrackUp}
          className="relative flex h-3 flex-1 cursor-pointer touch-none items-center"
        >
          <div className="h-0.5 w-full rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div
            className="absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-white"
            style={{ left: `${progress * 100}%` }}
          />
        </div>
        <span className="w-9 text-[10px] tabular-nums text-white/80">
          {formatTime(duration)}
        </span>
      </div>
    </>
  );
}

function VideoPage({
  m,
  active,
  blurred,
}: {
  m: MediaItem;
  active: boolean;
  blurred: boolean;
}) {
  // Only mount the player when this page is the visible one of an active card.
  // Unmounting pauses the video and stops any further buffering/network load.
  const shouldMount = active;
  const src = m.url ? mediaUrl(m.url) : "";

  if (m.status === "pending" || m.status === "downloading") {
    return <Skeleton className="h-full w-full bg-white/5" />;
  }
  if (m.status === "failed" || !m.url) {
    return (
      <div className="flex h-full w-full items-center justify-center text-white/50 text-sm">
        下载失败
      </div>
    );
  }

  if (!shouldMount) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Film className="h-10 w-10 text-white/30" />
      </div>
    );
  }

  return (
    <MediaPlayer
      className="short-video-player h-full w-full"
      src={src}
      autoPlay={active}
      muted
      loop
      playsInline
    >
      <MediaProvider />
      <VideoControls active={active} />
      <div
        className="pointer-events-none absolute inset-0"
        style={blurred ? { filter: "blur(24px)" } : undefined}
      />
    </MediaPlayer>
  );
}

function ImagePage({
  m,
  blurred,
}: {
  m: MediaItem;
  blurred: boolean;
}) {
  if (m.status === "pending" || m.status === "downloading") {
    return <Skeleton className="h-full w-full bg-white/5" />;
  }
  if (m.status === "failed" || !m.url) {
    return (
      <div className="flex h-full w-full items-center justify-center text-white/50 text-sm">
        下载失败
      </div>
    );
  }
  return (
    <img
      src={mediaUrl(m.url)}
      alt=""
      loading="lazy"
      draggable={false}
      className="h-full w-full object-contain"
      style={blurred ? { filter: "blur(24px)" } : undefined}
    />
  );
}

interface Props {
  post: PostItem;
  active: boolean;
  onDelete?: (id: number) => void;
}

export default function ShortVideoCard({ post, active, onDelete }: Props) {
  const { nsfw } = useNSFW();
  const [blurred, setBlurred] = useState(post.blurred);
  const effectiveBlurred = nsfw ? false : blurred;

  const media = post.media.filter((m) => m.kind !== "avatar");
  const [mediaIndex, setMediaIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth <= 0) return;
    setMediaIndex(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  const scrollToPage = (i: number) => {
    scrollRef.current?.children[i]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  };

  return (
    <div className="relative h-full w-full snap-start overflow-hidden bg-black">
      {/* media (horizontal snap carousel; one media per page) */}
      {media.length > 0 ? (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex h-full w-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory scrollbar-none"
        >
          {media.map((m, i) => (
            <div
              key={m.id}
              className="relative h-full w-full snap-center [scroll-snap-stop:always] shrink-0"
            >
              {m.kind === "video" ? (
                <VideoPage
                  m={m}
                  active={active && i === mediaIndex}
                  blurred={effectiveBlurred}
                />
              ) : (
                <ImagePage m={m} blurred={effectiveBlurred} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/30 text-sm">
          无媒体
        </div>
      )}

      {/* page indicator */}
      {media.length > 1 && (
        <div className="absolute top-3 left-1/2 z-30 flex -translate-x-1/2 gap-1">
          {media.map((_, i) => (
            <button
              key={i}
              aria-label={`第 ${i + 1} 个`}
              onClick={() => scrollToPage(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === mediaIndex ? "w-4 bg-white" : "w-1.5 bg-white/40"
              }`}
            />
          ))}
        </div>
      )}

      {/* top-right action cluster */}
      <div className="absolute top-3 right-3 z-30 flex flex-col gap-2">
        {!nsfw && (
          <button
            onClick={() => setBlurred((b) => !b)}
            aria-label={blurred ? "显示" : "模糊"}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
          >
            {blurred ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
        {onDelete && (
          <button
            onClick={() => onDelete(post.id)}
            aria-label="删除"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-red-600/80"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* bottom-left text overlay */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-4 pb-5 pt-16">
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8 shrink-0 border border-white/30">
            <AvatarImage
              src={
                post.author_avatar_url
                  ? mediaUrl(post.author_avatar_url)
                  : undefined
              }
              alt={post.author_name}
            />
            <AvatarFallback className="text-xs">
              {post.author_name?.[0]}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-semibold text-white truncate">
            {post.author_name}
          </span>
          <PlatformBadge platform={post.platform} />
          <span className="text-xs text-white/60 shrink-0">
            {timeAgo(post.captured_at)}
          </span>
        </div>
        {post.content && (
          <a
            href={post.original_url}
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto mt-2 block text-sm text-white/90 whitespace-pre-wrap line-clamp-3 hover:text-white"
          >
            {post.content}
          </a>
        )}
      </div>
    </div>
  );
}
