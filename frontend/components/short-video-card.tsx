"use client";

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

/** Vidstack controls + progress bar. Must be rendered inside <MediaPlayer>. */
function VideoControls({ active }: { active: boolean }) {
  const remote = useMediaRemote();
  const currentTime = useMediaState("currentTime");
  const duration = useMediaState("duration");
  const paused = useMediaState("paused");

  useEffect(() => {
    if (active) {
      remote.play();
    } else {
      remote.pause();
    }
  }, [active, remote]);

  const progress =
    duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <>
      {/* center play/pause indicator */}
      {!active || paused ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/40 p-4">
            <Play className="h-8 w-8 text-white" />
          </div>
        </div>
      ) : null}
      {/* progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/20">
        <div
          className="h-full bg-white transition-[width] duration-150"
          style={{ width: `${progress * 100}%` }}
        />
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
      className="h-full w-full"
      src={src}
      autoPlay={active}
      muted
      loop
      playsInline
      load="play"
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
              className="relative h-full w-full snap-center shrink-0"
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
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-1">
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
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-2">
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
