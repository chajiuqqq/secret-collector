"use client";

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
  return (
    <Card className="overflow-hidden group">
      {post.media.length > 0 && (
        <PostMedia items={post.media} onMediaClick={onMediaClick} />
      )}
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
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(post.id)}
              aria-label="删除"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
            </Button>
          )}
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
