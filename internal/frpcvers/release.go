package frpcvers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strings"
	"time"
)

// Release is a slim view of one GitHub release of fatedier/frp.
type Release struct {
	Tag         string    `json:"tag"`            // e.g. "v0.68.1"
	Name        string    `json:"name,omitempty"` // release title
	PublishedAt time.Time `json:"published_at"`
	Prerelease  bool      `json:"prerelease"`
	Asset       Asset     `json:"asset"` // the platform-specific archive picked for this host
}

// Asset is a single downloadable file (the archive that contains frpc).
type Asset struct {
	Name        string `json:"name"`         // e.g. frp_0.68.1_windows_amd64.zip
	URL         string `json:"url"`          // original GitHub URL (rewrite via ProxyManager before fetching)
	Size        int64  `json:"size"`
	ContentType string `json:"content_type,omitempty"`
}

// ListReleases fetches up to `limit` newest releases from the upstream
// repo. proxy may rewrite the api.github.com host transparently — but
// most mirrors only proxy github.com/raw paths, not the API. So we ALWAYS
// try direct api.github.com first; if a HTTP proxy env is set Go will
// honor it.
//
// includePrerelease == false hides RC builds.
func ListReleases(ctx context.Context, limit int, includePrerelease bool) ([]Release, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	url := fmt.Sprintf("https://api.github.com/repos/fatedier/frp/releases?per_page=%d", limit)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "frpmgr/dev (+https://github.com/mia-clark/frp-manager-server)")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch releases: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<10))
		return nil, fmt.Errorf("github api status %d: %s", resp.StatusCode, string(body))
	}

	var raw []struct {
		TagName     string    `json:"tag_name"`
		Name        string    `json:"name"`
		PublishedAt time.Time `json:"published_at"`
		Prerelease  bool      `json:"prerelease"`
		Assets      []struct {
			Name        string `json:"name"`
			URL         string `json:"browser_download_url"`
			Size        int64  `json:"size"`
			ContentType string `json:"content_type"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode releases: %w", err)
	}

	out := make([]Release, 0, len(raw))
	platSuffix := platformAssetSuffix() // e.g. "_windows_amd64.zip"
	for _, r := range raw {
		if r.Prerelease && !includePrerelease {
			continue
		}
		rel := Release{
			Tag:         r.TagName,
			Name:        r.Name,
			PublishedAt: r.PublishedAt,
			Prerelease:  r.Prerelease,
		}
		// pick the asset that matches this host
		for _, a := range r.Assets {
			if strings.HasSuffix(a.Name, platSuffix) {
				rel.Asset = Asset{Name: a.Name, URL: a.URL, Size: a.Size, ContentType: a.ContentType}
				break
			}
		}
		out = append(out, rel)
	}
	return out, nil
}

// platformAssetSuffix builds the part of frp release asset name that
// identifies the current host architecture. fatedier/frp publishes assets
// like "frp_0.68.1_windows_amd64.zip" and "frp_0.68.1_linux_arm64.tar.gz".
func platformAssetSuffix() string {
	os := runtime.GOOS
	arch := runtime.GOARCH
	// frp uses arm64 / amd64 as-is; arm has variants (arm6/arm7)
	if os == "windows" {
		return fmt.Sprintf("_windows_%s.zip", arch)
	}
	return fmt.Sprintf("_%s_%s.tar.gz", os, arch)
}

// ArchiveExt returns the file extension of the asset for the current
// platform: ".zip" on Windows, ".tar.gz" elsewhere.
func ArchiveExt() string {
	if runtime.GOOS == "windows" {
		return ".zip"
	}
	return ".tar.gz"
}

// FrpcBinName returns the executable file name on the current platform.
func FrpcBinName() string {
	if runtime.GOOS == "windows" {
		return "frpc.exe"
	}
	return "frpc"
}
