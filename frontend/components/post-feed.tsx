"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PostItem } from "@/lib/types";
import { fetchPosts, deletePost } from "@/lib/api";
import PostCard from "./post-card";
import MediaLightbox from "./media-lightbox";
import TagBar from "./tag-bar";
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
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialCursor !== null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [lightbox, setLightbox] = useState<{
    url: string;
    kind: "image" | "video";
  } | null>(null);

  const [activeTag, setActiveTag] = useState<string | null>(null);
  const activeTagRef = useRef<string | null>(null);

  const handleTagChange = useCallback((tag: string | null) => {
    setActiveTag(tag);
    activeTagRef.current = tag;
    // Fetch fresh with tag filter from backend
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchPosts(20, undefined, tag ?? undefined);
        if (tag === activeTagRef.current) {
          setPosts(data.posts);
          cursorRef.current = data.next_cursor;
          setHasMore(data.next_cursor !== null);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const data = await fetchPosts(20, cursorRef.current ?? undefined, activeTagRef.current ?? undefined);
      setPosts((p) => [...p, ...data.posts]);
      cursorRef.current = data.next_cursor;
      if (!data.next_cursor) setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore]);

  useEffect(() => {
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
  }, [hasMore, loadMore]);

  const handleDelete = useCallback((id: number) => {
    setPosts((p) => p.filter((post) => post.id !== id));
    deletePost(id).catch(() => {});
  }, []);

  const handleMediaClick = useCallback(
    (url: string, kind: "image" | "video") => {
      setLightbox({ url, kind });
    },
    [],
  );

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
