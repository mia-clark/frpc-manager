package manager

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// Meta is the persisted daemon-level metadata stored at /data/meta.json.
// It tracks which configs should be auto-started and the user-defined
// display order. Anything else lives in the config files themselves.
type Meta struct {
	Version   int      `json:"version"`
	AutoStart []string `json:"auto_start"`
	Sort      []string `json:"sort"`
}

func defaultMeta() *Meta {
	return &Meta{Version: 1, AutoStart: []string{}, Sort: []string{}}
}

type metaStore struct {
	path string
	mu   sync.Mutex
	data *Meta
}

func openMetaStore(path string) (*metaStore, error) {
	s := &metaStore{path: path, data: defaultMeta()}
	b, err := os.ReadFile(path)
	switch {
	case err == nil:
		_ = json.Unmarshal(b, s.data)
		if s.data.Version == 0 {
			s.data.Version = 1
		}
		if s.data.AutoStart == nil {
			s.data.AutoStart = []string{}
		}
		if s.data.Sort == nil {
			s.data.Sort = []string{}
		}
	case errors.Is(err, os.ErrNotExist):
		// fresh install; write a stub so operators can see the file
		if err := s.flushLocked(); err != nil {
			return nil, err
		}
	default:
		return nil, err
	}
	return s, nil
}

func (s *metaStore) snapshot() Meta {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := *s.data
	m.AutoStart = append([]string(nil), s.data.AutoStart...)
	m.Sort = append([]string(nil), s.data.Sort...)
	return m
}

func (s *metaStore) setAutoStart(ids []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.AutoStart = append([]string(nil), ids...)
	return s.flushLocked()
}

func (s *metaStore) markAutoStart(id string, enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.data.AutoStart[:0:0]
	seen := false
	for _, x := range s.data.AutoStart {
		if x == id {
			seen = true
			if enabled {
				cur = append(cur, x)
			}
			continue
		}
		cur = append(cur, x)
	}
	if enabled && !seen {
		cur = append(cur, id)
	}
	s.data.AutoStart = cur
	return s.flushLocked()
}

func (s *metaStore) setSort(order []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Sort = append([]string(nil), order...)
	return s.flushLocked()
}

// dropIDs removes id from both AutoStart and Sort. Used after a config
// file is deleted.
func (s *metaStore) dropIDs(ids ...string) error {
	if len(ids) == 0 {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	idset := make(map[string]struct{}, len(ids))
	for _, x := range ids {
		idset[x] = struct{}{}
	}
	s.data.AutoStart = filterOut(s.data.AutoStart, idset)
	s.data.Sort = filterOut(s.data.Sort, idset)
	return s.flushLocked()
}

func (s *metaStore) flushLocked() error {
	tmp := s.path + ".tmp"
	b, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func filterOut(src []string, drop map[string]struct{}) []string {
	out := src[:0:0]
	for _, x := range src {
		if _, ok := drop[x]; ok {
			continue
		}
		out = append(out, x)
	}
	return out
}
