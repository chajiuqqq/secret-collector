import type {
  ListPostsResponse,
  TagItem,
  TgScanProgress,
  TgScanResponse,
  CaptureTask,
} from "./types";

const BACKEND_URL =
  typeof window === "undefined"
    ? process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8080"
    : "";

export function mediaUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return path;
}

function apiPath(path: string): string {
  return typeof window === "undefined" ? `${BACKEND_URL}${path}` : path;
}

export async function fetchPosts(
  limit = 20,
  cursor?: string,
  tag?: string,
): Promise<ListPostsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (tag) params.set("tag", tag);
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

export async function startTgScan(req: {
  index_path: string;
  media_dir: string;
}): Promise<{ task_id: string }> {
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

export function watchScanProgress(
  onProgress: (p: TgScanProgress) => void,
  onDone: (r: TgScanResponse) => void,
  onError: (e: string) => void,
): () => void {
  const es = new EventSource(apiPath("/api/tg/scan/progress"));

  es.addEventListener("progress", (e: MessageEvent) => {
    const task = JSON.parse(e.data);
    onProgress(task.progress);
  });

  es.onerror = () => {
    es.close();
    onError("连接中断");
  };

  // The server pushes "progress" events; when status is "done",
  // the progress event includes the result.
  let done = false;
  es.addEventListener("progress", (e: MessageEvent) => {
    const task = JSON.parse(e.data);
    if (task.status === "done" && !done) {
      done = true;
      es.close();
      onDone(task.result ?? {
        posts_created: task.progress.posts_written,
        posts_skipped: task.progress.posts_skipped,
        media_found: task.progress.media_found,
        media_missing: task.progress.media_missing,
      });
    }
  });

  return () => es.close();
}

// Submit one or more URLs to the capture queue. Returns the newly-created
// task records (one per URL). Unsupported URLs come back already in
// status="error" so the caller can render them uniformly.
export async function startCapture(
  urls: string[],
): Promise<{ tasks: CaptureTask[] }> {
  const res = await fetch(apiPath("/api/capture"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Capture error: ${res.status}`,
    );
  }
  return res.json();
}

export async function fetchCaptureTasks(): Promise<CaptureTask[]> {
  const res = await fetch(apiPath("/api/capture/tasks"), { cache: "no-store" });
  if (!res.ok) return [];
  const body = (await res.json()) as { tasks: CaptureTask[] };
  return body.tasks ?? [];
}

// Subscribe to the full capture-task snapshot stream. The callback receives
// the entire task list on every state transition (and ~3×/s heartbeat).
// Returns an unsubscribe function.
export function watchCaptureTasks(
  onSnapshot: (tasks: CaptureTask[]) => void,
): () => void {
  const es = new EventSource(apiPath("/api/capture/progress"));
  es.addEventListener("progress", (e: MessageEvent) => {
    try {
      const body = JSON.parse(e.data) as { tasks: CaptureTask[] };
      onSnapshot(body.tasks ?? []);
    } catch {
      // ignore malformed payload
    }
  });
  // Errors here are typically the EventSource auto-reconnecting; leave it.
  return () => es.close();
}

export async function retryCaptureTask(id: string): Promise<void> {
  const res = await fetch(apiPath(`/api/capture/tasks/${id}/retry`), {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Retry error: ${res.status}`,
    );
  }
}

export async function fetchTags(): Promise<TagItem[]> {
  const res = await fetch(apiPath("/api/tags"), { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}
