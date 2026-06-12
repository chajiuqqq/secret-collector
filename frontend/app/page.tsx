import { fetchPosts } from "@/lib/api";
import type { PostItem } from "@/lib/types";
import PostFeed from "@/components/post-feed";

export const dynamic = "force-dynamic";

export default async function Home() {
  let posts: PostItem[] = [];
  let nextCursor: string | null = null;
  try {
    const data = await fetchPosts(20);
    posts = data.posts;
    nextCursor = data.next_cursor;
  } catch {
    // fallthrough
  }

  return (
    <>
      {posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground">
          <p className="text-lg">暂无帖子</p>
          <p className="text-sm mt-1">提交帖子后将在此显示</p>
        </div>
      ) : (
        <PostFeed initialPosts={posts} initialCursor={nextCursor} />
      )}
    </>
  );
}
