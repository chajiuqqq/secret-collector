export interface MediaItem {
  id: number;
  kind: "image" | "video" | "avatar";
  position: number;
  original_url: string;
  status: "pending" | "downloading" | "downloaded" | "failed";
  url: string | null;
  content_type?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface PostItem {
  id: number;
  platform: "x" | "xiaohongshu" | "tg";
  original_url: string;
  author_name: string;
  author_avatar_url: string | null;
  content: string;
  posted_at: string | null;
  captured_at: string;
  media: MediaItem[];
}

export interface ListPostsResponse {
  posts: PostItem[];
  next_cursor: string | null;
}

export interface TgScanRequest {
  index_path: string;
  media_dir: string;
}

export interface TgScanResponse {
  posts_created: number;
  posts_skipped: number;
  media_found: number;
  media_missing: number;
  errors?: string[];
}

export interface TgScanProgress {
  phase: "parsing" | "linking" | "writing";
  total_messages: number;
  processed: number;
  media_found: number;
  media_missing: number;
  posts_written: number;
  posts_skipped: number;
}
