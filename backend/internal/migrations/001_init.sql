CREATE TABLE posts (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    platform          TEXT        NOT NULL CHECK (platform IN ('x', 'xiaohongshu')),
    original_url      TEXT        NOT NULL,
    author_name       TEXT        NOT NULL,
    author_avatar_url TEXT,
    avatar_media_id   BIGINT,
    content           TEXT        NOT NULL DEFAULT '',
    posted_at         TIMESTAMPTZ,
    captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (platform, original_url)
);

CREATE TABLE media (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    post_id       BIGINT      NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    kind          TEXT        NOT NULL CHECK (kind IN ('image', 'video', 'avatar')),
    position      INT         NOT NULL DEFAULT 0,
    original_url  TEXT        NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'downloading', 'downloaded', 'failed')),
    local_path    TEXT,
    content_type  TEXT,
    size_bytes    BIGINT,
    width         INT,
    height        INT,
    sha256        TEXT,
    attempts      INT         NOT NULL DEFAULT 0,
    last_error    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE posts ADD CONSTRAINT fk_avatar_media
    FOREIGN KEY (avatar_media_id) REFERENCES media(id) ON DELETE SET NULL;

CREATE INDEX idx_posts_captured_at ON posts (captured_at DESC, id DESC);
CREATE INDEX idx_media_post_id ON media (post_id);
CREATE INDEX idx_media_retry ON media (status) WHERE status IN ('pending', 'failed');
