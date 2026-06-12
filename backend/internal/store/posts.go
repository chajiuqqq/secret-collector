package store

import (
	"context"
	"encoding/base64"
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
		return nil
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

func (s *Store) ListPosts(ctx context.Context, limit int, cursor string) ([]Post, string, error) {
	query := `
		SELECT id, platform, original_url, author_name, author_avatar_url,
		       avatar_media_id, content, posted_at, captured_at
		FROM posts
		WHERE deleted_at IS NULL`
	args := []any{}
	if cursor != "" {
		capturedAt, id, err := DecodeCursor(cursor)
		if err != nil {
			return nil, "", err
		}
		query += ` AND (captured_at, id) < ($1, $2)`
		args = append(args, capturedAt, id)
	}
	query += fmt.Sprintf(` ORDER BY captured_at DESC, id DESC LIMIT %d`, limit+1)

	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, "", fmt.Errorf("query posts: %w", err)
	}
	posts, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Post, error) {
		var p Post
		err := row.Scan(&p.ID, &p.Platform, &p.OriginalURL, &p.AuthorName, &p.AuthorAvatarURL,
			&p.AvatarMediaID, &p.Content, &p.PostedAt, &p.CapturedAt)
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

func (s *Store) SoftDeletePost(ctx context.Context, id int64) (bool, error) {
	tag, err := s.Pool.Exec(ctx,
		`UPDATE posts SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
