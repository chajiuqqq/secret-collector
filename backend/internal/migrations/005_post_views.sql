ALTER TABLE posts ADD COLUMN view_count BIGINT NOT NULL DEFAULT 0;

CREATE INDEX idx_posts_view_count ON posts (view_count) WHERE deleted_at IS NULL;
