"use client";

import { useMemo } from "react";
import type { PostItem } from "@/lib/types";

interface Props {
  posts: PostItem[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
}

const platformLabels: Record<string, string> = {
  x: "X",
  xiaohongshu: "小红书",
  tg: "TG",
};

function extractHashtags(content: string): string[] {
  const matches = content.match(/#[\w一-鿿]+/g);
  return matches ? [...new Set(matches)] : [];
}

export default function TagBar({ posts, activeTag, onTagChange }: Props) {
  const tags = useMemo(() => {
    const platformSet = new Set<string>();
    const hashtagSet = new Set<string>();
    for (const p of posts) {
      platformSet.add(p.platform);
      for (const tag of extractHashtags(p.content)) {
        hashtagSet.add(tag);
      }
    }
    return {
      platforms: Array.from(platformSet),
      hashtags: Array.from(hashtagSet).sort(),
    };
  }, [posts]);

  return (
    <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto border-b">
      <button
        onClick={() => onTagChange(null)}
        className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
          activeTag === null
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
        }`}
      >
        全部
      </button>
      {tags.platforms.map((p) => (
        <button
          key={p}
          onClick={() => onTagChange(p)}
          className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            activeTag === p
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {platformLabels[p] ?? p}
        </button>
      ))}
      {tags.hashtags.length > 0 && (
        <span className="w-px h-4 bg-border shrink-0" />
      )}
      {tags.hashtags.map((tag) => (
        <button
          key={tag}
          onClick={() => onTagChange(tag)}
          className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            activeTag === tag
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
