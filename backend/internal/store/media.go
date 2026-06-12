package store

import (
	"context"
	"fmt"
)

type PendingMedia struct {
	ID          int64
	Platform    string
	Kind        string
	OriginalURL string
	Attempts    int
}

// Claim atomically transitions a media row to 'downloading'. Returns nil if
// another worker already claimed it.
func (s *Store) ClaimMedia(ctx context.Context, id int64) (*PendingMedia, error) {
	var m PendingMedia
	err := s.Pool.QueryRow(ctx, `
		UPDATE media SET status = 'downloading', attempts = attempts + 1, updated_at = now()
		WHERE id = $1 AND status IN ('pending', 'failed')
		RETURNING id, (SELECT platform FROM posts WHERE posts.id = media.post_id), kind, original_url, attempts`,
		id,
	).Scan(&m.ID, &m.Platform, &m.Kind, &m.OriginalURL, &m.Attempts)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("claim media %d: %w", id, err)
	}
	return &m, nil
}

type DownloadedInfo struct {
	LocalPath   string
	ContentType string
	SizeBytes   int64
	SHA256      string
	Width       *int
	Height      *int
}

func (s *Store) MarkDownloaded(ctx context.Context, id int64, info DownloadedInfo) error {
	_, err := s.Pool.Exec(ctx, `
		UPDATE media SET status = 'downloaded', local_path = $2, content_type = $3,
			size_bytes = $4, sha256 = $5, width = $6, height = $7, last_error = NULL, updated_at = now()
		WHERE id = $1`,
		id, info.LocalPath, info.ContentType, info.SizeBytes, info.SHA256, info.Width, info.Height)
	return err
}

func (s *Store) MarkFailed(ctx context.Context, id int64, reason string) error {
	_, err := s.Pool.Exec(ctx, `
		UPDATE media SET status = 'failed', last_error = $2, updated_at = now()
		WHERE id = $1`, id, reason)
	return err
}

// ResetStuckDownloading recovers rows left in 'downloading' after a crash.
func (s *Store) ResetStuckDownloading(ctx context.Context) (int64, error) {
	tag, err := s.Pool.Exec(ctx,
		`UPDATE media SET status = 'pending', updated_at = now() WHERE status = 'downloading'`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// FindRetryable returns media ids that are pending, or failed with backoff
// elapsed (1m, 5m, 25m, ... = 5^(attempts-1) minutes) and attempts < maxAttempts.
func (s *Store) FindRetryable(ctx context.Context, maxAttempts, limit int) ([]int64, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id FROM media
		WHERE status = 'pending'
		   OR (status = 'failed' AND attempts < $1
		       AND updated_at < now() - (power(5, attempts - 1) * interval '1 minute'))
		ORDER BY id LIMIT $2`, maxAttempts, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
