package session

import (
	"context"
	"sync"
	"time"

	"fastsam-gateway/internal/metrics"
)

type entry struct {
	workerID  string
	expiresAt time.Time
}

// Table 维护 image_id → worker_id 的粘性会话映射。
// 用 sync.RWMutex + map 即可，TTL 由后台 sweep 清理。
type Table struct {
	mu      sync.RWMutex
	entries map[string]entry
	ttl     time.Duration
}

func New(ttl time.Duration) *Table {
	return &Table{
		entries: make(map[string]entry),
		ttl:     ttl,
	}
}

// Put 写入或刷新会话；TTL 重新计时。
func (t *Table) Put(imageID, workerID string) {
	t.mu.Lock()
	t.entries[imageID] = entry{
		workerID:  workerID,
		expiresAt: time.Now().Add(t.ttl),
	}
	size := len(t.entries)
	t.mu.Unlock()
	metrics.SessionTableSize.Set(float64(size))
}

// Get 查找会话；过期或不存在返回 ("", false)。
func (t *Table) Get(imageID string) (string, bool) {
	t.mu.RLock()
	e, ok := t.entries[imageID]
	t.mu.RUnlock()
	if !ok {
		return "", false
	}
	if time.Now().After(e.expiresAt) {
		t.Delete(imageID)
		return "", false
	}
	return e.workerID, true
}

func (t *Table) Delete(imageID string) {
	t.mu.Lock()
	delete(t.entries, imageID)
	size := len(t.entries)
	t.mu.Unlock()
	metrics.SessionTableSize.Set(float64(size))
}

// DropByWorker 删除所有指向某 worker 的会话——worker 故障时调用。
// 返回被删除的条目数。
func (t *Table) DropByWorker(workerID string) int {
	t.mu.Lock()
	defer t.mu.Unlock()
	dropped := 0
	for k, v := range t.entries {
		if v.workerID == workerID {
			delete(t.entries, k)
			dropped++
		}
	}
	metrics.SessionTableSize.Set(float64(len(t.entries)))
	return dropped
}

// RunSweeper 后台清理过期条目，直到 ctx 取消。
func (t *Table) RunSweeper(ctx context.Context, interval time.Duration) {
	tk := time.NewTicker(interval)
	defer tk.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tk.C:
			t.sweepExpired()
		}
	}
}

func (t *Table) sweepExpired() {
	now := time.Now()
	t.mu.Lock()
	for k, v := range t.entries {
		if now.After(v.expiresAt) {
			delete(t.entries, k)
		}
	}
	size := len(t.entries)
	t.mu.Unlock()
	metrics.SessionTableSize.Set(float64(size))
}
