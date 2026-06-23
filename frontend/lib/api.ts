import type { ListPostsResponse } from "./types";

const BACKEND_URL =
  typeof window === "undefined"
    ? process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8080"
    : ""; // client uses relative URLs, proxied via next.config rewrites

// media paths are always relative (start with /media/...), resolved by browser + rewrites
export function mediaUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return path; // relative path, e.g. /media/x/2026/06/12/ab/cdef.jpg
}

function apiPath(path: string): string {
  return typeof window === "undefined" ? `${BACKEND_URL}${path}` : path;
}

export async function fetchPosts(
  limit = 20,
  cursor?: string,
): Promise<ListPostsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(apiPath(`/api/posts?${params}`), {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deletePost(id: number): Promise<void> {
  const res = await fetch(apiPath(`/api/posts/${id}`), {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) throw new Error(`Delete error: ${res.status}`);
}

export async function scanTgPosts(req: { index_path: string; media_dir: string }): Promise<{
  posts_created: number;
  posts_skipped: number;
  media_found: number;
  media_missing: number;
  errors?: string[];
}> {
  const res = await fetch(apiPath("/api/tg/scan"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Scan error: ${res.status}`
    );
  }
  return res.json();
}
