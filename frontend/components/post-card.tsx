"use client";

import { useState } from "react";
import type { PostItem } from "@/lib/types";
import { mediaUrl } from "@/lib/api";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import PlatformBadge from "./platform-badge";
import PostMedia from "./post-media";

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

interface Props {
  post: PostItem;
  onDelete?: (id: number) => void;
  onMediaClick?: (url: string, kind: "image" | "video") => void;
}

export default function PostCard({ post, onDelete, onMediaClick }: Props) {
  const [blurred, setBlurred] = useState(post.blurred);

  return (
    <Card className={`overflow-hidden relative ${post.media.length > 0 ? "pt-0" : ""}`}>
      {post.media.length > 0 && (
        <PostMedia items={post.media} blurred={blurred} onMediaClick={onMediaClick} />
      )}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 rounded-full ${blurred ? "bg-amber-500/80 text-white hover:bg-amber-600" : "bg-black/30 text-white hover:bg-black/50"}`}
          onClick={() => setBlurred(!blurred)}
          aria-label={blurred ? "显示图片" : "模糊图片"}
        >
          {blurred ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          )}
        </Button>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full bg-red-500/80 text-white hover:bg-red-600 hover:text-white"
            onClick={() => onDelete(post.id)}
            aria-label="删除"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
          </Button>
        )}
      </div>
      <CardHeader className="p-3 pb-0">
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage
              src={post.author_avatar_url ? mediaUrl(post.author_avatar_url) : undefined}
              alt={post.author_name}
            />
            <AvatarFallback>{post.author_name[0]}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm truncate">{post.author_name}</span>
              <PlatformBadge platform={post.platform} />
            </div>
            <span className="text-xs text-muted-foreground">
              {timeAgo(post.captured_at)}
            </span>
          </div>
        </div>
      </CardHeader>
      {post.content && (
        <CardContent className="p-3 pt-2">
          <a
            href={post.original_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm whitespace-pre-wrap line-clamp-6 hover:text-primary/80 transition-colors block"
          >
            {post.content}
          </a>
        </CardContent>
      )}
    </Card>
  );
}
