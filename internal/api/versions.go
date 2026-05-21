package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/mia-clark/frp-manager-server/internal/frpcvers"
	"github.com/mia-clark/frp-manager-server/internal/manager"
)

// VersionsHandler serves /api/v1/versions/* — frpc binary lifecycle and
// GitHub mirror management.
type VersionsHandler struct {
	m   *manager.Manager
	log *slog.Logger
}

// NewVersionsHandler builds a VersionsHandler bound to the given manager.
func NewVersionsHandler(m *manager.Manager, log *slog.Logger) *VersionsHandler {
	return &VersionsHandler{m: m, log: log}
}

// Available proxies the upstream GitHub releases list (filtered to the
// archive that matches the daemon's host platform). Slow request — the
// frontend should show a spinner.
func (h *VersionsHandler) Available(w http.ResponseWriter, r *http.Request) {
	includePre := r.URL.Query().Get("prerelease") == "true"
	limit := 30
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	rels, err := frpcvers.ListReleases(ctx, limit, includePre)
	if err != nil {
		WriteError(w, http.StatusBadGateway, CodeUpstreamFailure, err.Error(), nil)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"items": rels})
}

// Installed lists every frpc binary on disk plus the daemon-wide default.
func (h *VersionsHandler) Installed(w http.ResponseWriter, r *http.Request) {
	items, err := h.m.FrpcStore().List()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, CodeInternal, err.Error(), nil)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"items":   items,
		"default": h.m.FrpcStore().Default(),
	})
}

// Download installs a specific release. The body may omit `proxy_url` to
// use the daemon-wide mirror; supplying it overrides for this single call
// only.
func (h *VersionsHandler) Download(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Tag      string `json:"tag"`       // e.g. "v0.68.1"
		ProxyURL string `json:"proxy_url"` // optional one-shot override
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Tag) == "" {
		WriteError(w, http.StatusBadRequest, CodeBadRequest, "tag is required", nil)
		return
	}

	// resolve the release record
	listCtx, listCancel := context.WithTimeout(r.Context(), 12*time.Second)
	rels, err := frpcvers.ListReleases(listCtx, 30, true)
	listCancel()
	if err != nil {
		WriteError(w, http.StatusBadGateway, CodeUpstreamFailure, "fetch releases: "+err.Error(), nil)
		return
	}
	var target *frpcvers.Release
	for i := range rels {
		if rels[i].Tag == body.Tag {
			target = &rels[i]
			break
		}
	}
	if target == nil {
		WriteError(w, http.StatusNotFound, CodeNotFound, "tag "+body.Tag+" not found upstream", nil)
		return
	}

	// optional one-shot proxy override — restored on exit
	originalProxy := h.m.FrpcProxy().Current()
	if body.ProxyURL != "" {
		h.m.FrpcProxy().Set(body.ProxyURL)
		defer h.m.FrpcProxy().Set(originalProxy)
	}

	// download + extract; cap at 5 minutes to avoid stalling the API forever
	dlCtx, dlCancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer dlCancel()

	inst, err := h.m.FrpcStore().Install(dlCtx, *target, nil)
	if err != nil {
		if errors.Is(err, frpcvers.ErrAlreadyInstalled) {
			WriteError(w, http.StatusConflict, CodeConflict, "version already installed", nil)
			return
		}
		WriteError(w, http.StatusBadGateway, CodeUpstreamFailure, err.Error(), nil)
		return
	}
	WriteJSON(w, http.StatusCreated, inst)
}

// Delete removes one installed binary.
func (h *VersionsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	version := chi.URLParam(r, "version")
	if err := h.m.FrpcStore().Delete(version); err != nil {
		if errors.Is(err, frpcvers.ErrNotInstalled) {
			WriteError(w, http.StatusNotFound, CodeNotFound, "version not installed", nil)
			return
		}
		WriteError(w, http.StatusInternalServerError, CodeInternal, err.Error(), nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SetDefault changes the daemon-wide default frpc version. Pass empty
// string to revert to the in-process embedded library.
func (h *VersionsHandler) SetDefault(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version string `json:"version"` // "" / "in-process" / "<semver>"
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := h.m.SetDefaultFrpcVersion(body.Version); err != nil {
		if errors.Is(err, frpcvers.ErrNotInstalled) {
			WriteError(w, http.StatusNotFound, CodeNotFound, "version not installed", nil)
			return
		}
		WriteError(w, http.StatusBadRequest, CodeBadRequest, err.Error(), nil)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"default": body.Version})
}

// MirrorList returns the curated GitHub mirror presets bundled with the daemon.
func (h *VersionsHandler) MirrorList(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]any{
		"current": h.m.FrpcProxy().Current(),
		"presets": h.m.FrpcProxy().Presets(),
	})
}

// MirrorSet picks the active GitHub mirror prefix. Pass empty string for direct.
func (h *VersionsHandler) MirrorSet(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL string `json:"url"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := h.m.SetGithubMirror(body.URL); err != nil {
		WriteError(w, http.StatusInternalServerError, CodeInternal, err.Error(), nil)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"current": h.m.FrpcProxy().Current()})
}

// MirrorPing concurrently probes each known mirror and returns per-mirror
// latency, sorted (working+fastest first). Slow request — up to ~5s.
func (h *VersionsHandler) MirrorPing(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mirrors []frpcvers.MirrorPreset `json:"mirrors"` // optional: probe only these
	}
	if r.ContentLength > 0 {
		if !decodeJSON(w, r, &body) {
			return
		}
	}
	mirrors := body.Mirrors
	if len(mirrors) == 0 {
		mirrors = h.m.FrpcProxy().Presets()
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	results := frpcvers.PingMirrors(ctx, mirrors)
	WriteJSON(w, http.StatusOK, map[string]any{"items": results})
}

// InstanceRunner records which frpc backend (in-process / specific version)
// a single instance should use. Stored in meta.json so it survives restart.
func (h *VersionsHandler) InstanceRunner(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !h.m.Exists(id) {
		WriteError(w, http.StatusNotFound, CodeConfigNotFound, "config not found", nil)
		return
	}
	var body struct {
		Version string `json:"version"` // "" / "in-process" / "<semver>"
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := h.m.SetInstanceFrpcVersion(id, body.Version); err != nil {
		if errors.Is(err, frpcvers.ErrNotInstalled) {
			WriteError(w, http.StatusNotFound, CodeNotFound, "version not installed", nil)
			return
		}
		WriteError(w, http.StatusBadRequest, CodeBadRequest, err.Error(), nil)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"id":      id,
		"version": body.Version,
		"resolved": h.m.ResolveRunnerVersion(id),
	})
}
