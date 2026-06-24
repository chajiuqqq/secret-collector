package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"sort"
	"sync"
	"time"
)

// Task is one URL submitted to the capture pipeline. State is held entirely
// in memory: a sliding window of the most recent maxWindow tasks survives the
// process lifetime; older terminal tasks are evicted. Active tasks are never
// evicted.
type Task struct {
	ID         string     `json:"id"`
	URL        string     `json:"url"`
	Status     string     `json:"status"` // queued | running | done | error
	Phase      string     `json:"phase"`  // detecting | fetching | writing (only while running)
	PostID     *int64     `json:"post_id,omitempty"`
	Platform   string     `json:"platform,omitempty"`
	Duplicated bool       `json:"duplicated"`
	MediaCount int        `json:"media_count"`
	Error      string     `json:"error,omitempty"`
	Attempts   int        `json:"attempts"`
	CreatedAt  time.Time  `json:"created_at"`
	StartedAt  *time.Time `json:"started_at,omitempty"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}

// RunFunc runs one captured task to completion. It updates task in place
// (phase, post_id, platform, duplicated, media_count) and returns an error
// if the run failed. The queue handles status transitions and notifications.
type RunFunc func(ctx context.Context, t *Task) error

// RetryMediaFunc resets failed media for an already-captured post and returns
// the count of media that were re-enqueued. Returning 0 with nil error means
// "nothing to retry" — handler treats this as a benign no-op for the UI.
type RetryMediaFunc func(ctx context.Context, postID int64) (int, error)

const (
	maxWindow    = 50
	jobsCapacity = 256
)

type Queue struct {
	mu        sync.Mutex
	tasks     []*Task // insertion order
	byID      map[string]*Task
	jobs      chan string
	listeners map[chan struct{}]struct{}

	runFn        RunFunc
	retryMediaFn RetryMediaFunc
}

func NewQueue(runFn RunFunc, retryMediaFn RetryMediaFunc) *Queue {
	q := &Queue{
		tasks:        make([]*Task, 0, maxWindow),
		byID:         make(map[string]*Task, maxWindow),
		jobs:         make(chan string, jobsCapacity),
		listeners:    make(map[chan struct{}]struct{}),
		runFn:        runFn,
		retryMediaFn: retryMediaFn,
	}
	go q.worker()
	return q
}

// Enqueue creates one Task per URL, evicts oldest terminal tasks if the
// window is full, and pushes each task's ID onto the worker channel.
func (q *Queue) Enqueue(urls []string) []*Task {
	created := make([]*Task, 0, len(urls))
	q.mu.Lock()
	for _, u := range urls {
		t := &Task{
			ID:        newID(),
			URL:       u,
			Status:    "queued",
			CreatedAt: time.Now(),
		}
		q.tasks = append(q.tasks, t)
		q.byID[t.ID] = t
		q.evictLocked()
		created = append(created, t)
	}
	q.mu.Unlock()

	for _, t := range created {
		q.push(t.ID)
	}
	q.notify()
	return created
}

// AddRejected appends already-terminal error tasks to the window (no worker
// run). Used for URLs the handler rejected before enqueue (e.g. unsupported
// platform) — they need to show up in the SSE snapshot just like real tasks.
func (q *Queue) AddRejected(url, reason string) *Task {
	now := time.Now()
	finished := now
	t := &Task{
		ID:         newID(),
		URL:        url,
		Status:     "error",
		Error:      reason,
		CreatedAt:  now,
		FinishedAt: &finished,
	}
	q.mu.Lock()
	q.tasks = append(q.tasks, t)
	q.byID[t.ID] = t
	q.evictLocked()
	q.mu.Unlock()
	q.notify()
	return t
}

// Retry routes a retry request based on task status:
//   - error  : re-queue the task to rerun the full capture pipeline.
//   - done   : reset failed media on the existing post and re-enqueue them.
//   - queued/running : no-op (returns nil; UI shouldn't expose the button).
//
// The int return is informational: re-queued count (1) for error tasks, or
// media count for done tasks.
func (q *Queue) Retry(ctx context.Context, id string) (int, error) {
	q.mu.Lock()
	t, ok := q.byID[id]
	if !ok {
		q.mu.Unlock()
		return 0, errNotFound
	}
	status := t.Status
	var postID *int64
	if t.PostID != nil {
		v := *t.PostID
		postID = &v
	}
	q.mu.Unlock()

	switch status {
	case "error":
		q.mu.Lock()
		t.Status = "queued"
		t.Phase = ""
		t.Error = ""
		t.StartedAt = nil
		t.FinishedAt = nil
		q.mu.Unlock()
		q.push(id)
		q.notify()
		return 1, nil
	case "done":
		if postID == nil {
			return 0, nil
		}
		n, err := q.retryMediaFn(ctx, *postID)
		if err != nil {
			return 0, err
		}
		q.notify()
		return n, nil
	default:
		return 0, nil
	}
}

// Snapshot returns a deep copy of every task in insertion order (oldest first).
func (q *Queue) Snapshot() []*Task {
	q.mu.Lock()
	defer q.mu.Unlock()
	out := make([]*Task, len(q.tasks))
	for i, t := range q.tasks {
		c := *t
		out[i] = &c
	}
	return out
}

// Subscribe registers a channel that receives a non-blocking signal whenever
// any task transitions. Unsubscribe via the returned func.
func (q *Queue) Subscribe() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	q.mu.Lock()
	q.listeners[ch] = struct{}{}
	q.mu.Unlock()
	return ch, func() {
		q.mu.Lock()
		delete(q.listeners, ch)
		q.mu.Unlock()
	}
}

func (q *Queue) push(id string) {
	select {
	case q.jobs <- id:
	default:
		// Channel full: best-effort drop into a goroutine so producers don't
		// block. The task stays in 'queued' and the worker drains as it can.
		go func() { q.jobs <- id }()
	}
}

func (q *Queue) notify() {
	q.mu.Lock()
	defer q.mu.Unlock()
	for ch := range q.listeners {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// evictLocked is called with q.mu held. Drops the oldest done/error tasks
// until len(tasks) <= maxWindow. Active tasks (queued/running) are never
// evicted, so the window can temporarily exceed maxWindow under burst load.
func (q *Queue) evictLocked() {
	if len(q.tasks) <= maxWindow {
		return
	}
	// Build evict-candidate index list (terminal tasks) in oldest-first order.
	overflow := len(q.tasks) - maxWindow
	keep := q.tasks[:0]
	dropped := 0
	for _, t := range q.tasks {
		if dropped < overflow && (t.Status == "done" || t.Status == "error") {
			delete(q.byID, t.ID)
			dropped++
			continue
		}
		keep = append(keep, t)
	}
	q.tasks = keep
	// Re-sort by insertion order is unnecessary — keep preserved order.
	sort.SliceStable(q.tasks, func(i, j int) bool {
		return q.tasks[i].CreatedAt.Before(q.tasks[j].CreatedAt)
	})
}

func (q *Queue) worker() {
	for id := range q.jobs {
		q.mu.Lock()
		t, ok := q.byID[id]
		if !ok {
			// Evicted between enqueue and worker pickup — rare; skip.
			q.mu.Unlock()
			continue
		}
		// Guard against duplicate pushes (e.g. eviction reorder): only run
		// tasks that are still queued.
		if t.Status != "queued" {
			q.mu.Unlock()
			continue
		}
		now := time.Now()
		t.Status = "running"
		t.Phase = "detecting"
		t.StartedAt = &now
		t.Attempts++
		q.mu.Unlock()
		q.notify()

		ctx, cancel := context.WithCancel(context.Background())
		err := q.runFn(ctx, t)
		cancel()

		q.mu.Lock()
		finished := time.Now()
		t.FinishedAt = &finished
		if err != nil {
			t.Status = "error"
			t.Error = err.Error()
			slog.Info("capture failed", "task_id", t.ID, "url", t.URL, "error", err)
		} else {
			t.Status = "done"
			slog.Info("capture done", "task_id", t.ID, "url", t.URL, "post_id", t.PostID, "media", t.MediaCount, "duplicated", t.Duplicated)
		}
		q.mu.Unlock()
		q.notify()
	}
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// errNotFound is returned by Retry for unknown task IDs.
var errNotFound = &notFoundError{}

type notFoundError struct{}

func (*notFoundError) Error() string { return "task not found" }

// IsNotFound reports whether err signals an unknown task ID.
func IsNotFound(err error) bool {
	_, ok := err.(*notFoundError)
	return ok
}
