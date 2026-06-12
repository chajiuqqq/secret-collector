ALTER TABLE posts ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE INDEX idx_posts_active ON posts (captured_at DESC, id DESC) WHERE deleted_at IS NULL;
