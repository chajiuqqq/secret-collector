"use client";

import { useEffect, useState } from "react";
import { fetchTags } from "@/lib/api";
import type { TagItem } from "@/lib/types";

interface Props {
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
}

const platformLabels: Record<string, string> = {
  x: "X",
  xiaohongshu: "小红书",
  tg: "TG",
};

export default function TagBar({ activeTag, onTagChange }: Props) {
  const [tags, setTags] = useState<TagItem[]>([]);

  useEffect(() => {
    fetchTags().then(setTags).catch(() => {});
  }, []);

  const platforms = tags.filter((t) => platformLabels[t.name]);
  const hashtags = tags.filter((t) => t.name.startsWith("#"));

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
      {platforms.map((t) => (
        <button
          key={t.name}
          onClick={() => onTagChange(t.name)}
          className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            activeTag === t.name
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {platformLabels[t.name] ?? t.name}
          <span className="ml-1 text-[10px] opacity-60">{t.post_count}</span>
        </button>
      ))}
      {hashtags.length > 0 && (
        <span className="w-px h-4 bg-border shrink-0" />
      )}
      {hashtags.map((t) => (
        <button
          key={t.name}
          onClick={() => onTagChange(t.name)}
          className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            activeTag === t.name
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {t.name}
          <span className="ml-1 text-[10px] opacity-60">{t.post_count}</span>
        </button>
      ))}
    </div>
  );
}
