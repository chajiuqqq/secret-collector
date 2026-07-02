"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PostItem } from "@/lib/types";
import ShortVideoCard from "./short-video-card";

interface Props {
  posts: PostItem[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  onDelete: (id: number) => void;
}

export default function ShortVideoFeed({
  posts,
  loading,
  hasMore,
  loadMore,
  onDelete,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientHeight <= 0) return;
    const idx = Math.round(el.scrollTop / el.clientHeight);
    setActiveIndex((prev) => (prev === idx ? prev : idx));
  }, []);

  // Infinite scroll: trigger loadMore when nearing the end.
  useEffect(() => {
    if (loading || !hasMore) return;
    if (activeIndex >= posts.length - 3) {
      loadMore();
    }
  }, [activeIndex, posts.length, loading, hasMore, loadMore]);

  if (posts.length === 0 && !loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        没有匹配的帖子
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="h-full w-full overflow-y-scroll snap-y snap-mandatory scrollbar-none bg-black"
    >
      {posts.map((post, i) => (
        <div
          key={post.id}
          className="h-full w-full snap-start [scroll-snap-stop:always] shrink-0"
        >
          <ShortVideoCard post={post} active={i === activeIndex} onDelete={onDelete} />
        </div>
      ))}
      {loading &&
        Array.from({ length: 2 }).map((_, i) => (
          <div key={`sk-${i}`} className="h-full w-full snap-start shrink-0 bg-black" />
        ))}
      {!hasMore && posts.length > 0 && (
        <div className="flex h-20 items-center justify-center text-white/40 text-sm">
          没有更多了
        </div>
      )}
    </div>
  );
}
