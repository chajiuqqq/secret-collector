ALTER TABLE posts DROP CONSTRAINT posts_platform_check;
ALTER TABLE posts ADD CONSTRAINT posts_platform_check
    CHECK (platform IN ('x', 'xiaohongshu', 'tg'));
