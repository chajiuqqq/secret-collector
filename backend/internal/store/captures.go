package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// CapturedMedia represents a single media item from a real-time capture.
// Either URL (HTTP, will be downloaded async) or LocalPath (already on disk,
// inserted as status='downloaded') is set.
type CapturedMedia struct {
	Kind string

	// Remote download: URL set, LocalPath empty.
	URL string

	// Local file already filed under MEDIA_ROOT: LocalPath relative, other fields set.
	LocalPath   string
	ContentType string
	SizeBytes   int64
	SHA256      string
	Width       *int
	Height      *int
}

// CapturedPost is what the capture pipeline (Python scripts + Go filing) produces.
// It mirrors NewPost but with media items that may be remote or already local.
type CapturedPost struct {
	Platform        string
	OriginalURL     string
	AuthorName      string
	AuthorAvatarURL string
	Content         string
	PostedAt        *time.Time
	Media           []CapturedMedia
}

// CreateCapturedResult extends CreateResult with the subset of media ids that
// need async download (the local-file ones are already done).
type CreateCapturedResult struct {
	PostID            int64
	Duplicated        bool
	MediaIDs          []int64 // all inserted media (excluding avatar)
	PendingDownloadIDs []int64 // subset that need the downloader pool
}

// CreateCapturedPost is like CreatePost but supports mixed-status media:
// HTTP-URL items are inserted with status='pending' (caller should enqueue
// them to the downloader), and local-file items are inserted with
// status='downloaded' + path + hash.
func (s *Store) CreateCapturedPost(ctx context.Context, p CapturedPost) (CreateCapturedResult, error) {
	var res CreateCapturedResult
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
			if m.LocalPath != "" {
				// Already on disk → insert as downloaded.
				err := tx.QueryRow(ctx, `
					INSERT INTO media (post_id, kind, position, original_url, status,
					                   local_path, content_type, size_bytes, sha256, width, height)
					VALUES ($1, $2, $3, $4, 'downloaded', $5, $6, $7, $8, $9, $10) RETURNING id`,
					res.PostID, m.Kind, i, m.URL, m.LocalPath, m.ContentType, m.SizeBytes, m.SHA256, m.Width, m.Height,
				).Scan(&id)
				if err != nil {
					return fmt.Errorf("insert local media: %w", err)
				}
			} else {
				err := tx.QueryRow(ctx, `
					INSERT INTO media (post_id, kind, position, original_url)
					VALUES ($1, $2, $3, $4) RETURNING id`,
					res.PostID, m.Kind, i, m.URL,
				).Scan(&id)
				if err != nil {
					return fmt.Errorf("insert remote media: %w", err)
				}
				res.PendingDownloadIDs = append(res.PendingDownloadIDs, id)
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
			res.PendingDownloadIDs = append(res.PendingDownloadIDs, avatarID)
		}
		return nil
	})
	return res, err
}
