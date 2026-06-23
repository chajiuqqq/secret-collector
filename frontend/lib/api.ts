import type {
  ListPostsResponse,
  TgScanProgress,
  TgScanResponse,
  CaptureProgress,
  CaptureResult,
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

export async function startCapture(url: string): Promise<{ task_id: string }> {
  const res = await fetch(apiPath("/api/capture"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Capture error: ${res.status}`,
    );
  }
  return res.json();
}

export function watchCaptureProgress(
  onProgress: (p: CaptureProgress) => void,
  onDone: (r: CaptureResult) => void,
  onError: (e: string) => void,
): () => void {
  const es = new EventSource(apiPath("/api/capture/progress"));

  let done = false;
  es.addEventListener("progress", (e: MessageEvent) => {
    if (done) return;
    const task = JSON.parse(e.data) as CaptureTask;
    onProgress(task.progress);
    if (task.status === "done") {
      done = true;
      es.close();
      if (task.error) {
        onError(task.error);
      } else if (task.result) {
        onDone(task.result);
      } else {
        onError("任务结束但未返回结果");
      }
    }
  });

  es.onerror = () => {
    if (done) return;
    es.close();
    onError("连接中断");
  };

  return () => es.close();
}
