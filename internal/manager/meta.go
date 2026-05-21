package manager

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// Meta is the persisted daemon-level metadata stored at /data/meta.json.
// It tracks which configs should be auto-started, the user-defined
// display order, the active frpc binary version, the GitHub mirror used
// for downloading new versions, and the per-instance run-mode override.
// Anything else lives in the config files themselves.
type Meta struct {
	Version int `json:"version"`

	AutoStart []string `json:"auto_start"`
	Sort      []string `json:"sort"`

	// FrpcDefaultVersion is the label (e.g. "0.68.1") of the frpc binary
	// instances should use unless they override it. Empty = use the
	// daemon's in-process embedded frp library (current default behavior).
	FrpcDefaultVersion string `json:"frpc_default_version,omitempty"`

	// FrpcInstanceVersions stores per-instance overrides keyed by config id.
	// Value "" means "follow FrpcDefaultVersion"; value "in-process" forces
	// the embedded library regardless of the default.
	FrpcInstanceVersions map[string]string `json:"frpc_instance_versions,omitempty"`

	// GithubMirror is the URL prefix used to rewrite github.com download
	// URLs for new frpc versions. Empty = direct connection.
	GithubMirror string `json:"github_mirror,omitempty"`
}

const InProcessVersion = "in-process"

func defaultMeta() *Meta {
	return &Meta{
		Version:              1,
		AutoStart:            []string{},
		Sort:                 []string{},
		FrpcInstanceVersions: map[string]string{},
	}
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
		if s.data.FrpcInstanceVersions == nil {
			s.data.FrpcInstanceVersions = map[string]string{}
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
	m.FrpcInstanceVersions = make(map[string]string, len(s.data.FrpcInstanceVersions))
	for k, v := range s.data.FrpcInstanceVersions {
		m.FrpcInstanceVersions[k] = v
	}
	return m
}

// setFrpcDefaultVersion persists the global default frpc version label.
// Pass "" to revert to in-process.
func (s *metaStore) setFrpcDefaultVersion(v string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.FrpcDefaultVersion = v
	return s.flushLocked()
}

// setFrpcInstanceVersion sets / clears the per-instance run-mode override.
// version values: "" = follow default, InProcessVersion = force in-process,
// any other = use that installed binary.
func (s *metaStore) setFrpcInstanceVersion(id, version string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.FrpcInstanceVersions == nil {
		s.data.FrpcInstanceVersions = map[string]string{}
	}
	if version == "" {
		delete(s.data.FrpcInstanceVersions, id)
	} else {
		s.data.FrpcInstanceVersions[id] = version
	}
	return s.flushLocked()
}

// setGithubMirror persists the GitHub mirror URL prefix.
func (s *metaStore) setGithubMirror(url string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.GithubMirror = url
	return s.flushLocked()
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
	for id := range idset {
		delete(s.data.FrpcInstanceVersions, id)
	}
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
