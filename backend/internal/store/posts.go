package store

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type NewMedia struct {
	Kind string
	URL  string
}

type NewPost struct {
	Platform        string
	OriginalURL     string
	AuthorName      string
	AuthorAvatarURL string
	Content         string
	PostedAt        *time.Time
	Media           []NewMedia
}

type CreateResult struct {
	PostID     int64
	Duplicated bool
	MediaIDs   []int64
}

func (s *Store) CreatePost(ctx context.Context, p NewPost) (CreateResult, error) {
	var res CreateResult
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var inserted bool
		err := tx.QueryRow(ctx, `
			INSERT INTO posts (platform, original_url, author_name, author_avatar_url, content, posted_at)
			VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6)
			ON CONFLICT (platform, original_url) DO UPDATE SET
				author_name = EXCLUDED.author_name,
				content = EXCLUDED.content,
				posted_at = COALESCE(EXCLUDED.posted_at, posts.posted_at)
			RETURNING id, (xmax = 0)`,
			p.Platform, p.OriginalURL, p.AuthorName, p.AuthorAvatarURL, p.Content, p.PostedAt,
		).Scan(&res.PostID, &inserted)
		if err != nil {
			return fmt.Errorf("upsert post: %w", err)
		}
		res.Duplicated = !inserted
		if res.Duplicated {
			return nil
		}

		for i, m := range p.Media {
			var id int64
			err := tx.QueryRow(ctx, `
				INSERT INTO media (post_id, kind, position, original_url)
				VALUES ($1, $2, $3, $4) RETURNING id`,
				res.PostID, m.Kind, i, m.URL,
			).Scan(&id)
			if err != nil {
				return fmt.Errorf("insert media: %w", err)
			}
			res.MediaIDs = append(res.MediaIDs, id)
		}

		if p.AuthorAvatarURL != "" {
			var avatarID int64
			err := tx.QueryRow(ctx, `
				INSERT INTO media (post_id, kind, position, original_url)
				VALUES ($1, 'avatar', 0, $2) RETURNING id`,
				res.PostID, p.AuthorAvatarURL,
			).Scan(&avatarID)
			if err != nil {
				return fmt.Errorf("insert avatar media: %w", err)
			}
			if _, err := tx.Exec(ctx,
				`UPDATE posts SET avatar_media_id = $1 WHERE id = $2`, avatarID, res.PostID,
			); err != nil {
				return fmt.Errorf("set avatar_media_id: %w", err)
			}
			res.MediaIDs = append(res.MediaIDs, avatarID)
		}
		tagNames := append([]string{p.Platform}, extractHashtags(p.Content)...); return upsertTags(ctx, tx, tagNames)
	})
	return res, err
}

type MediaItem struct {
	ID          int64
	Kind        string
	Position    int
	OriginalURL string
	Status      string
	LocalPath   *string
	ContentType *string
	Width       *int
	Height      *int
}

type Post struct {
	ID              int64
	Platform        string
	OriginalURL     string
	AuthorName      string
	AuthorAvatarURL *string
	AvatarMediaID   *int64
	Content         string
	Blurred         bool
	PostedAt        *time.Time
	CapturedAt      time.Time
	Media           []MediaItem
}

func EncodeCursor(capturedAt time.Time, id int64) string {
	raw := fmt.Sprintf("%d|%d", capturedAt.UnixNano(), id)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func DecodeCursor(cursor string) (time.Time, int64, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, 0, fmt.Errorf("invalid cursor")
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, 0, fmt.Errorf("invalid cursor")
	}
	ns, err1 := strconv.ParseInt(parts[0], 10, 64)
	id, err2 := strconv.ParseInt(parts[1], 10, 64)
	if err1 != nil || err2 != nil {
		return time.Time{}, 0, fmt.Errorf("invalid cursor")
	}
	return time.Unix(0, ns), id, nil
}


func (s *Store) ListPosts(ctx context.Context, limit int, cursor, tag string) ([]Post, string, error) {
	query := `
		SELECT id, platform, original_url, author_name, author_avatar_url,
		       avatar_media_id, content, blurred, posted_at, captured_at
		FROM posts
		WHERE deleted_at IS NULL`
	args := []any{}
	n := 0
	if tag != "" {
		n++
		if tag == "x" || tag == "xiaohongshu" || tag == "tg" {
			query += fmt.Sprintf(` AND platform = $%d`, n)
		} else {
			query += fmt.Sprintf(` AND content LIKE '%%' || $%d || '%%'`, n)
		}
		args = append(args, tag)
	}
	if cursor != "" {
		capturedAt, id, err := DecodeCursor(cursor)
		if err != nil {
			return nil, "", err
		}
		n++
		query += fmt.Sprintf(` AND (captured_at, id) < ($%d, $%d)`, n, n+1)
		args = append(args, capturedAt, id)
		n++
	}
	n++
	query += fmt.Sprintf(` ORDER BY captured_at DESC, id DESC LIMIT $%d`, n)
	args = append(args, limit+1)

	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, "", fmt.Errorf("query posts: %w", err)
	}
	posts, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Post, error) {
		var p Post
		err := row.Scan(&p.ID, &p.Platform, &p.OriginalURL, &p.AuthorName, &p.AuthorAvatarURL,
			&p.AvatarMediaID, &p.Content, &p.Blurred, &p.PostedAt, &p.CapturedAt)
		return p, err
	})
	if err != nil {
		return nil, "", fmt.Errorf("scan posts: %w", err)
	}

	nextCursor := ""
	if len(posts) > limit {
		posts = posts[:limit]
		last := posts[len(posts)-1]
		nextCursor = EncodeCursor(last.CapturedAt, last.ID)
	}
	if len(posts) == 0 {
		return posts, "", nil
	}

	postIDs := make([]int64, len(posts))
	idx := make(map[int64]*Post, len(posts))
	for i := range posts {
		postIDs[i] = posts[i].ID
		idx[posts[i].ID] = &posts[i]
	}

	mrows, err := s.Pool.Query(ctx, `
		SELECT id, post_id, kind, position, original_url, status, local_path, content_type, width, height
		FROM media WHERE post_id = ANY($1) ORDER BY post_id, position, id`, postIDs)
	if err != nil {
		return nil, "", fmt.Errorf("query media: %w", err)
	}
	defer mrows.Close()
	for mrows.Next() {
		var m MediaItem
		var postID int64
		if err := mrows.Scan(&m.ID, &postID, &m.Kind, &m.Position, &m.OriginalURL,
			&m.Status, &m.LocalPath, &m.ContentType, &m.Width, &m.Height); err != nil {
			return nil, "", fmt.Errorf("scan media: %w", err)
		}
		if p, ok := idx[postID]; ok {
			p.Media = append(p.Media, m)
		}
	}
	if err := mrows.Err(); err != nil {
		return nil, "", fmt.Errorf("iterate media: %w", err)
	}
	return posts, nextCursor, nil
}

func (s *Store) SoftDeletePost(ctx context.Context, id int64) (bool, string, string, error) {
	var platform, content string
	err := s.Pool.QueryRow(ctx,
		`UPDATE posts SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL
		 RETURNING platform, content`, id).Scan(&platform, &content)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, "", "", nil
		}
		return false, "", "", err
	}
	return true, platform, content, nil
}


type TgMedia struct {
	Kind        string
	LocalPath   string
	ContentType string
	SizeBytes   int64
	Width       *int
	Height      *int
}

type TgPost struct {
	ChatID     int64
	Date       string
	AuthorName string
	Content    string
	PostedAt   *time.Time
	Media      []TgMedia
}

type TgScanResult struct {
	PostsCreated int
	PostsSkipped int
	MediaFound   int
	MediaMissing int
	Errors       []string
}

func (s *Store) CreateTgPosts(ctx context.Context, posts []TgPost) (TgScanResult, error) {
	var res TgScanResult
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		for _, p := range posts {
			originalURL := fmt.Sprintf("tg://%d/%s", p.ChatID, p.Date)
			var postID int64
			err := tx.QueryRow(ctx, `
				INSERT INTO posts (platform, original_url, author_name, content, posted_at, captured_at, blurred)
				VALUES ('tg', $1, $2, $3, $4, $5, true)
				ON CONFLICT (platform, original_url) DO NOTHING
				RETURNING id`,
				originalURL, p.AuthorName, p.Content, p.PostedAt, p.PostedAt,
			).Scan(&postID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					res.PostsSkipped++
					continue
				}
				res.Errors = append(res.Errors, fmt.Sprintf("post %d/%s: %v", p.ChatID, p.Date, err))
				continue
			}
			res.PostsCreated++

			for i, m := range p.Media {
				_, err := tx.Exec(ctx, `
					INSERT INTO media (post_id, kind, position, original_url, status, local_path, content_type, size_bytes, width, height)
					VALUES ($1, $2, $3, '', 'downloaded', $4, $5, $6, $7, $8)`,
					postID, m.Kind, i, m.LocalPath, m.ContentType, m.SizeBytes, m.Width, m.Height)
				if err != nil {
					res.Errors = append(res.Errors, fmt.Sprintf("media %s: %v", m.LocalPath, err))
				} else {
					res.MediaFound++
				}
			}

			// Upsert tags for this post
			tagNames := append([]string{"tg"}, extractHashtags(p.Content)...)
			if err := upsertTags(ctx, tx, tagNames); err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("tags: %v", err))
			}
		}
		return nil
	})
	return res, err
}
func extractHashtags(content string) []string {
	var tags []string
	seen := map[string]bool{}
	for _, word := range strings.Fields(content) {
		if strings.HasPrefix(word, "#") && len(word) > 1 {
			w := strings.TrimRight(word, ",.!?;:，。！？；：")
			if !seen[w] {
				seen[w] = true
				tags = append(tags, w)
			}
		}
	}
	return tags
}

func upsertTags(ctx context.Context, tx pgx.Tx, names []string) error {
	for _, name := range names {
		_, err := tx.Exec(ctx, `
			INSERT INTO tags (name, post_count) VALUES ($1, 1)
			ON CONFLICT (name) DO UPDATE SET post_count = tags.post_count + 1`, name)
		if err != nil {
			return fmt.Errorf("upsert tag %s: %w", name, err)
		}
	}
	return nil
}

func decrementTags(ctx context.Context, tx pgx.Tx, names []string) error {
	for _, name := range names {
		tag, err := tx.Exec(ctx,
			`DELETE FROM tags WHERE name = $1 AND post_count <= 1`, name)
		if err != nil {
			return fmt.Errorf("decrement tag %s: %w", name, err)
		}
		if tag.RowsAffected() == 0 {
			_, err = tx.Exec(ctx,
				`UPDATE tags SET post_count = post_count - 1 WHERE name = $1`, name)
			if err != nil {
				return fmt.Errorf("decrement tag %s: %w", name, err)
			}
		}
	}
	return nil
}

func (s *Store) DecrementPostTags(ctx context.Context, platform, content string) error {
	tagNames := append([]string{platform}, extractHashtags(content)...)
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		return decrementTags(ctx, tx, tagNames)
	})
}

type TagItem struct {
	Name      string `json:"name"`
	PostCount int    `json:"post_count"`
}

func hasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

func (s *Store) BackfillTags(ctx context.Context) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM tags`); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT platform, COALESCE(content, '') FROM posts WHERE deleted_at IS NULL`)
		if err != nil {
			return err
		}
		type row struct {
			platform, content string
		}
		var all []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.platform, &r.content); err != nil {
				rows.Close()
				return err
			}
			all = append(all, r)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, r := range all {
			names := append([]string{r.platform}, extractHashtags(r.content)...)
			if err := upsertTags(ctx, tx, names); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) ListTags(ctx context.Context) ([]TagItem, error) {
	rows, err := s.Pool.Query(ctx, `SELECT name, post_count FROM tags WHERE post_count > 0 ORDER BY post_count DESC, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tags []TagItem
	// Fixed platform tags always come first
	fixed := map[string]int{"x": 0, "xiaohongshu": 0, "tg": 0}
	seen := map[string]bool{}
	for rows.Next() {
		var t TagItem
		if err := rows.Scan(&t.Name, &t.PostCount); err != nil {
			return nil, err
		}
		seen[t.Name] = true
		if _, isFixed := fixed[t.Name]; isFixed {
			fixed[t.Name] = t.PostCount
		} else {
			tags = append(tags, t)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Prepend fixed platform tags in order (always shown, even if count=0)
	fixedTags := make([]TagItem, 0, 3)
	for _, p := range []string{"x", "xiaohongshu", "tg"} {
		fixedTags = append(fixedTags, TagItem{Name: p, PostCount: fixed[p]})
	}
	return append(fixedTags, tags...), nil
}
