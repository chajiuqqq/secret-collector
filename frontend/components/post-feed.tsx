"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PostItem } from "@/lib/types";
import { fetchPosts, fetchRandomPosts, deletePost } from "@/lib/api";
import PostCard from "./post-card";
import MediaLightbox from "./media-lightbox";
import TagBar from "./tag-bar";
import ShortVideoFeed from "./short-video-feed";
import { useViewMode } from "./view-mode-context";
import { Skeleton } from "@/components/ui/skeleton";

export default function PostFeed({
  initialPosts,
  initialCursor,
}: {
  initialPosts: PostItem[];
  initialCursor: string | null;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const cursorRef = useRef<string | null>(initialCursor);
  // excludeRef: post ids already shown in the current short-video cycle (dedup
  // for the weighted-random endpoint). Reset on tag/mode change or pool exhaust.
  const excludeRef = useRef<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialCursor !== null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [lightbox, setLightbox] = useState<{
    url: string;
    kind: "image" | "video";
  } | null>(null);

  const [activeTag, setActiveTag] = useState<string | null>(null);
  const activeTagRef = useRef<string | null>(null);
  const { mode } = useViewMode();
  // Token to ignore stale fresh-load responses (rapid tag/mode switches).
  const loadTokenRef = useRef(0);

  // Fresh load (page 1) for the current mode + tag. Replaces posts entirely.
  const loadFresh = useCallback(async (tag: string | null, m: "waterfall" | "short") => {
    const token = ++loadTokenRef.current;
    setLoading(true);
    try {
      if (m === "short") {
        const data = await fetchRandomPosts(20, tag ?? undefined, []);
        if (token !== loadTokenRef.current) return;
        setPosts(data.posts);
        if (data.next_cursor) {
          excludeRef.current = new Set(data.posts.map((p) => p.id));
          setHasMore(true);
        } else if (data.posts.length > 0) {
          // Pool smaller than one batch: exhausted immediately → allow reshuffle.
          excludeRef.current = new Set();
          setHasMore(true);
        } else {
          excludeRef.current = new Set();
          setHasMore(false);
        }
        cursorRef.current = null;
      } else {
        const data = await fetchPosts(20, undefined, tag ?? undefined);
        if (token !== loadTokenRef.current) return;
        setPosts(data.posts);
        cursorRef.current = data.next_cursor;
        excludeRef.current = new Set();
        setHasMore(data.next_cursor !== null);
      }
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }, []);

  const handleTagChange = useCallback(
    (tag: string | null) => {
      setActiveTag(tag);
      activeTagRef.current = tag;
      excludeRef.current = new Set();
      cursorRef.current = null;
      loadFresh(tag, mode);
    },
    [loadFresh, mode],
  );

  // On mode change (and initial mount): reload page 1 in the correct ordering.
  useEffect(() => {
    loadFresh(activeTagRef.current, mode);
  }, [mode, loadFresh]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      if (mode === "short") {
        const data = await fetchRandomPosts(
          20,
          activeTagRef.current ?? undefined,
          [...excludeRef.current],
        );
        setPosts((p) => [...p, ...data.posts]);
        for (const p of data.posts) excludeRef.current.add(p.id);
        if (data.next_cursor) {
          setHasMore(true);
        } else if (excludeRef.current.size > 0) {
          // Cycle exhausted → reset exclude so next load reshuffles.
          excludeRef.current = new Set();
          setHasMore(true);
        } else {
          setHasMore(false);
        }
      } else {
        const data = await fetchPosts(
          20,
          cursorRef.current ?? undefined,
          activeTagRef.current ?? undefined,
        );
        setPosts((p) => [...p, ...data.posts]);
        cursorRef.current = data.next_cursor;
        if (!data.next_cursor) setHasMore(false);
      }
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, mode]);

  useEffect(() => {
    if (mode !== "waterfall") return;
    if (!sentinel.current || !hasMore) return;
    const el = sentinel.current;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMore, mode]);

  const handleDelete = useCallback((id: number) => {
    setPosts((p) => p.filter((post) => post.id !== id));
    excludeRef.current.delete(id);
    deletePost(id).catch(() => {});
  }, []);

  const handleMediaClick = useCallback(
    (url: string, kind: "image" | "video") => {
      setLightbox({ url, kind });
    },
    [],
  );

  if (mode === "short") {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
        <TagBar activeTag={activeTag} onTagChange={handleTagChange} />
        <div className="min-h-0 flex-1">
          <ShortVideoFeed
            posts={posts}
            loading={loading}
            hasMore={hasMore}
            loadMore={loadMore}
            onDelete={handleDelete}
          />
        </div>
        {lightbox && (
          <MediaLightbox
            url={lightbox.url}
            kind={lightbox.kind}
            onClose={() => setLightbox(null)}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <TagBar activeTag={activeTag} onTagChange={handleTagChange} />
      <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 p-4">
        {posts.map((post) => (
          <div key={post.id} className="break-inside-avoid mb-4">
            <PostCard
              post={post}
              onDelete={handleDelete}
              onMediaClick={handleMediaClick}
            />
          </div>
        ))}
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={`sk-${i}`} className="break-inside-avoid mb-4">
              <Skeleton className="w-full h-64 rounded-xl" />
            </div>
          ))}
      </div>
      <div ref={sentinel} className="h-1" />
      {posts.length === 0 && !loading && (
        <p className="text-center text-muted-foreground py-8 text-sm">
          没有匹配的帖子
        </p>
      )}
      {!hasMore && posts.length > 0 && (
        <p className="text-center text-muted-foreground py-8 text-sm">
          没有更多了
        </p>
      )}
      {lightbox && (
        <MediaLightbox
          url={lightbox.url}
          kind={lightbox.kind}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}
