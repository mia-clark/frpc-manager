package frpcvers

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Installed represents one locally extracted frpc binary.
type Installed struct {
	Version    string    `json:"version"`     // tag without leading 'v' for nicer sort, e.g. "0.68.1"
	Tag        string    `json:"tag"`         // raw upstream tag, e.g. "v0.68.1"
	Path       string    `json:"path"`        // absolute path to frpc binary
	Size       int64     `json:"size"`        // binary size in bytes
	InstalledAt time.Time `json:"installed_at"`
}

// Store manages the local on-disk repository of frpc binaries.
//
// Layout:
//   <root>/
//     <version>/
//       frpc[.exe]
//       _meta.json   (installation metadata: tag, installed_at, sha, ...)
//     _default.txt   (single line: the version label that is currently active)
type Store struct {
	root     string
	proxy    *ProxyManager
	mu       sync.RWMutex // guards the on-disk default pointer cache
	defaultV string
}

// NewStore initializes a Store at the given root directory. root is
// created if missing. proxy is used to rewrite asset URLs at download
// time and may be nil (= direct).
func NewStore(root string, proxy *ProxyManager) (*Store, error) {
	if root == "" {
		return nil, errors.New("frpcvers: empty store root")
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir store root: %w", err)
	}
	s := &Store{root: root, proxy: proxy}
	s.defaultV = s.readDefault()
	return s, nil
}

// Root returns the on-disk root directory.
func (s *Store) Root() string { return s.root }

// Default returns the currently active version label (e.g. "0.68.1"), or
// empty string when nothing is selected / nothing installed.
func (s *Store) Default() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.defaultV
}

// SetDefault marks the given version label as the active one and persists
// it. Returns ErrNotInstalled if the version isn't present on disk.
func (s *Store) SetDefault(version string) error {
	if _, err := s.Get(version); err != nil {
		return err
	}
	s.mu.Lock()
	s.defaultV = version
	s.mu.Unlock()
	return os.WriteFile(filepath.Join(s.root, "_default.txt"), []byte(version), 0o644)
}

// readDefault loads the default pointer file lazily.
func (s *Store) readDefault() string {
	b, err := os.ReadFile(filepath.Join(s.root, "_default.txt"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// List returns every installed frpc binary, sorted by descending semver.
func (s *Store) List() ([]Installed, error) {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	out := make([]Installed, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), "_") || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		inst, err := s.Get(e.Name())
		if err != nil {
			continue // binary missing — silently skip
		}
		out = append(out, inst)
	}
	sort.SliceStable(out, func(a, b int) bool {
		return semverGreater(out[a].Version, out[b].Version)
	})
	return out, nil
}

// Get returns the Installed record for a specific version label or
// ErrNotInstalled if it's not present.
func (s *Store) Get(version string) (Installed, error) {
	dir := filepath.Join(s.root, version)
	bin := filepath.Join(dir, FrpcBinName())
	st, err := os.Stat(bin)
	if err != nil {
		return Installed{}, ErrNotInstalled
	}
	meta := readMeta(dir)
	return Installed{
		Version:     version,
		Tag:         meta.Tag,
		Path:        bin,
		Size:        st.Size(),
		InstalledAt: meta.InstalledAt,
	}, nil
}

// Delete removes one installed version. If the deleted version was the
// default, the default pointer is cleared.
func (s *Store) Delete(version string) error {
	dir := filepath.Join(s.root, version)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return ErrNotInstalled
	}
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("remove %s: %w", dir, err)
	}
	s.mu.Lock()
	if s.defaultV == version {
		s.defaultV = ""
		_ = os.Remove(filepath.Join(s.root, "_default.txt"))
	}
	s.mu.Unlock()
	return nil
}

// Install downloads, extracts, and registers a release's frpc binary.
// Returns the resulting Installed entry. If a binary for `version`
// already exists, returns ErrAlreadyInstalled (the caller can delete
// + re-install if they really want).
//
// progress, if not nil, is called periodically with (downloadedBytes, totalBytes).
func (s *Store) Install(ctx context.Context, rel Release, progress func(downloaded, total int64)) (Installed, error) {
	if rel.Asset.URL == "" {
		return Installed{}, fmt.Errorf("release %s has no asset matching this platform (%s)", rel.Tag, platformAssetSuffix())
	}
	version := strings.TrimPrefix(rel.Tag, "v")
	dir := filepath.Join(s.root, version)
	if _, err := os.Stat(filepath.Join(dir, FrpcBinName())); err == nil {
		return Installed{}, ErrAlreadyInstalled
	}

	// 1. download
	tmpFile, err := os.CreateTemp(s.root, "frpc-dl-*"+ArchiveExt())
	if err != nil {
		return Installed{}, fmt.Errorf("temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	url := rel.Asset.URL
	if s.proxy != nil {
		url = s.proxy.RewriteGitHubURL(url)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		tmpFile.Close()
		return Installed{}, err
	}
	req.Header.Set("User-Agent", "frpmgr/dev")
	client := &http.Client{Timeout: 0 /* unlimited; ctx controls */}
	resp, err := client.Do(req)
	if err != nil {
		tmpFile.Close()
		return Installed{}, fmt.Errorf("download %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		tmpFile.Close()
		return Installed{}, fmt.Errorf("download status %d from %s: %s", resp.StatusCode, url, string(body))
	}
	total := resp.ContentLength
	if total <= 0 && rel.Asset.Size > 0 {
		total = rel.Asset.Size
	}

	pr := &progressReader{r: resp.Body, total: total, onProgress: progress}
	if _, err := io.Copy(tmpFile, pr); err != nil {
		tmpFile.Close()
		return Installed{}, fmt.Errorf("save archive: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return Installed{}, err
	}

	// 2. extract
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Installed{}, fmt.Errorf("mkdir version dir: %w", err)
	}
	binPath := filepath.Join(dir, FrpcBinName())
	if strings.HasSuffix(rel.Asset.Name, ".zip") {
		err = extractZipPickFrpc(tmpPath, binPath)
	} else {
		err = extractTarGzPickFrpc(tmpPath, binPath)
	}
	if err != nil {
		os.RemoveAll(dir)
		return Installed{}, err
	}
	if err := os.Chmod(binPath, 0o755); err != nil {
		// non-fatal on Windows
	}

	// 3. persist metadata
	writeMeta(dir, metaFile{Tag: rel.Tag, InstalledAt: time.Now()})

	// 4. if no default yet, auto-elect this one
	s.mu.Lock()
	if s.defaultV == "" {
		s.defaultV = version
		_ = os.WriteFile(filepath.Join(s.root, "_default.txt"), []byte(version), 0o644)
	}
	s.mu.Unlock()

	st, _ := os.Stat(binPath)
	var size int64
	if st != nil {
		size = st.Size()
	}
	return Installed{
		Version:     version,
		Tag:         rel.Tag,
		Path:        binPath,
		Size:        size,
		InstalledAt: time.Now(),
	}, nil
}

// ----- helpers -----

// ErrNotInstalled / ErrAlreadyInstalled are sentinel errors.
var (
	ErrNotInstalled     = errors.New("frpcvers: not installed")
	ErrAlreadyInstalled = errors.New("frpcvers: already installed")
)

type metaFile struct {
	Tag         string    `json:"tag"`
	InstalledAt time.Time `json:"installed_at"`
}

func writeMeta(dir string, m metaFile) {
	b, _ := json.Marshal(m)
	_ = os.WriteFile(filepath.Join(dir, "_meta.json"), b, 0o644)
}

func readMeta(dir string) metaFile {
	b, err := os.ReadFile(filepath.Join(dir, "_meta.json"))
	if err != nil {
		return metaFile{}
	}
	var m metaFile
	if json.Unmarshal(b, &m) != nil {
		return metaFile{}
	}
	return m
}

// extractZipPickFrpc walks the archive looking for the `frpc.exe` entry
// and writes it to `dest`. Other files are skipped.
func extractZipPickFrpc(archivePath, dest string) error {
	zr, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("open zip: %w", err)
	}
	defer zr.Close()
	want := FrpcBinName()
	for _, f := range zr.File {
		if filepath.Base(f.Name) != want {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		defer rc.Close()
		out, err := os.Create(dest)
		if err != nil {
			return err
		}
		defer out.Close()
		if _, err := io.Copy(out, rc); err != nil {
			return err
		}
		return nil
	}
	return fmt.Errorf("frpc binary not found in zip %s", archivePath)
}

// extractTarGzPickFrpc handles the .tar.gz format used for Linux / macOS builds.
func extractTarGzPickFrpc(archivePath, dest string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("open tar.gz: %w", err)
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("gzip header: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	want := FrpcBinName()
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("tar walk: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		if filepath.Base(hdr.Name) != want {
			continue
		}
		out, err := os.Create(dest)
		if err != nil {
			return err
		}
		defer out.Close()
		if _, err := io.Copy(out, tr); err != nil {
			return err
		}
		return nil
	}
	return fmt.Errorf("frpc binary not found in tarball %s", archivePath)
}

// progressReader wraps an io.Reader emitting periodic progress callbacks.
type progressReader struct {
	r          io.Reader
	total      int64
	downloaded int64
	lastEmit   time.Time
	onProgress func(downloaded, total int64)
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.downloaded += int64(n)
	if p.onProgress != nil && time.Since(p.lastEmit) > 250*time.Millisecond {
		p.lastEmit = time.Now()
		p.onProgress(p.downloaded, p.total)
	}
	if err == io.EOF && p.onProgress != nil {
		p.onProgress(p.downloaded, p.total)
	}
	return n, err
}

// semverGreater compares two dotted version strings ("1.2.3"). It's a
// permissive comparator that handles missing minor/patch fields by
// treating them as 0.
func semverGreater(a, b string) bool {
	pa := splitVer(a)
	pb := splitVer(b)
	for i := 0; i < 3; i++ {
		var ai, bi int
		if i < len(pa) {
			ai = pa[i]
		}
		if i < len(pb) {
			bi = pb[i]
		}
		if ai != bi {
			return ai > bi
		}
	}
	return false
}

func splitVer(v string) []int {
	v = strings.TrimPrefix(v, "v")
	parts := strings.Split(v, ".")
	out := make([]int, 0, 3)
	for _, p := range parts {
		// strip suffix like "-rc1"
		end := 0
		for end < len(p) && p[end] >= '0' && p[end] <= '9' {
			end++
		}
		if end == 0 {
			out = append(out, 0)
			continue
		}
		n := 0
		for i := 0; i < end; i++ {
			n = n*10 + int(p[i]-'0')
		}
		out = append(out, n)
	}
	return out
}
