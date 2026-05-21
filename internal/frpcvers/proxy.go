// Package frpcvers manages a local repository of frpc binaries:
// listing upstream releases, downloading + extracting, picking a default,
// and probing GitHub mirror proxies for latency.
package frpcvers

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// MirrorPreset is a known GitHub download mirror. Users can pick one or
// supply their own URL prefix via SetProxy.
type MirrorPreset struct {
	// Name is a short human-readable label shown in the UI.
	Name string `json:"name"`
	// URL is the prefix that gets prepended to a github.com/owner/repo path.
	// Empty string means "direct connection to github.com".
	URL string `json:"url"`
	// Note is a short Chinese description, e.g. "海外 / 国内 / CDN".
	Note string `json:"note"`
}

// DefaultMirrorPresets is a curated list of public GitHub download mirrors
// known to work as of late 2025/early 2026. Order is preferred default
// (empty first = direct connection).
var DefaultMirrorPresets = []MirrorPreset{
	{Name: "直连 GitHub", URL: "", Note: "海外网络/科学上网下首选"},
	{Name: "ghproxy.com", URL: "https://ghproxy.com/", Note: "国内 CDN · 公益"},
	{Name: "mirror.ghproxy.com", URL: "https://mirror.ghproxy.com/", Note: "ghproxy 备用"},
	{Name: "github.moeyy.xyz", URL: "https://github.moeyy.xyz/", Note: "Moeyy 镜像"},
	{Name: "gh.api.99988866.xyz", URL: "https://gh.api.99988866.xyz/", Note: "99988866"},
	{Name: "kkgithub.com", URL: "https://kkgithub.com/", Note: "Cloudflare worker 镜像"},
	{Name: "gh-proxy.com", URL: "https://gh-proxy.com/", Note: "gh-proxy 镜像"},
}

// PingResult is the outcome of probing one mirror.
type PingResult struct {
	Mirror     MirrorPreset  `json:"mirror"`
	OK         bool          `json:"ok"`
	LatencyMs  int64         `json:"latency_ms"`
	StatusCode int           `json:"status_code,omitempty"`
	Error      string        `json:"error,omitempty"`
	Elapsed    time.Duration `json:"-"`
}

// PingMirrors probes each mirror in parallel with a short timeout and
// returns results sorted by latency (failed ones at the end). Uses a
// HEAD request to a small, always-present file (the frp README).
func PingMirrors(ctx context.Context, mirrors []MirrorPreset) []PingResult {
	const probeTarget = "github.com/fatedier/frp/releases/latest"
	results := make([]PingResult, len(mirrors))
	var wg sync.WaitGroup

	for i, m := range mirrors {
		wg.Add(1)
		go func(idx int, mirror MirrorPreset) {
			defer wg.Done()
			pingCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
			defer cancel()

			url := mirror.URL + "https://" + probeTarget
			if mirror.URL == "" {
				url = "https://" + probeTarget
			}

			req, err := http.NewRequestWithContext(pingCtx, http.MethodHead, url, nil)
			if err != nil {
				results[idx] = PingResult{Mirror: mirror, OK: false, Error: err.Error()}
				return
			}

			start := time.Now()
			client := &http.Client{Timeout: 4 * time.Second}
			resp, err := client.Do(req)
			elapsed := time.Since(start)
			res := PingResult{Mirror: mirror, LatencyMs: elapsed.Milliseconds(), Elapsed: elapsed}
			if err != nil {
				res.Error = err.Error()
				results[idx] = res
				return
			}
			defer resp.Body.Close()
			res.StatusCode = resp.StatusCode
			// 3xx (redirect to release tag) counts as reachable;
			// some mirrors return 200 directly.
			res.OK = resp.StatusCode < 500
			results[idx] = res
		}(i, m)
	}
	wg.Wait()

	sort.SliceStable(results, func(a, b int) bool {
		if results[a].OK != results[b].OK {
			return results[a].OK
		}
		return results[a].LatencyMs < results[b].LatencyMs
	})
	return results
}

// ProxyManager owns the currently selected mirror plus the curated preset list.
type ProxyManager struct {
	mu       sync.RWMutex
	current  string // mirror URL prefix; "" = direct
	presets  []MirrorPreset
}

// NewProxyManager creates a manager. initial may be "" for direct.
func NewProxyManager(initial string) *ProxyManager {
	return &ProxyManager{
		current: initial,
		presets: append([]MirrorPreset(nil), DefaultMirrorPresets...),
	}
}

// Current returns the active mirror URL prefix (may be empty = direct).
func (p *ProxyManager) Current() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.current
}

// Set updates the active mirror. Caller is responsible for persisting it.
func (p *ProxyManager) Set(url string) {
	p.mu.Lock()
	p.current = strings.TrimSpace(url)
	p.mu.Unlock()
}

// Presets returns a copy of the known mirrors list.
func (p *ProxyManager) Presets() []MirrorPreset {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]MirrorPreset, len(p.presets))
	copy(out, p.presets)
	return out
}

// RewriteGitHubURL prepends the active mirror to a github.com URL.
// Returns the input unchanged if it doesn't look like a github.com URL or
// the mirror is empty.
func (p *ProxyManager) RewriteGitHubURL(rawURL string) string {
	prefix := p.Current()
	if prefix == "" {
		return rawURL
	}
	low := strings.ToLower(rawURL)
	if !strings.HasPrefix(low, "https://github.com/") && !strings.HasPrefix(low, "http://github.com/") {
		return rawURL
	}
	return prefix + rawURL
}

// String makes ProxyManager log-friendly.
func (p *ProxyManager) String() string {
	c := p.Current()
	if c == "" {
		return "direct"
	}
	return fmt.Sprintf("via %s", c)
}
