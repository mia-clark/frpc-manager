package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/mia-clark/frp-manager-server/internal/manager"
	"github.com/mia-clark/frp-manager-server/pkg/config"
)

// TestLogsQuery_FiltersByInstancePrefix: 合并日志含 A/B 两实例的行，
// GET /api/v1/configs/A/logs 只应返回 A 的行。
func TestLogsQuery_FiltersByInstancePrefix(t *testing.T) {
	tmp := t.TempDir()
	logsDir := filepath.Join(tmp, "logs")
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	combined := filepath.Join(logsDir, "frpc.log")
	body := strings.Join([]string{
		"2026-06-03 15:17:41.437 [I] [inst=A] try to connect",
		"2026-06-03 15:17:50.544 [D] [inst=B] heartbeat",
		"2026-06-03 15:18:20.416 [E] [inst=A] login fail",
		"",
	}, "\n")
	if err := os.WriteFile(combined, []byte(body), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	m := newTestManager(t, tmp)
	mustCreateInstance(t, m, "A")
	mustCreateInstance(t, m, "B")

	h := NewLogsHandler(m, logsDir, testLogger(), []string{"*"})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/configs/A/logs?lines=10", nil)
	req = withPathID(req, "A")
	rec := httptest.NewRecorder()
	h.Query(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Lines []string `json:"lines"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode resp: %v", err)
	}
	if len(resp.Lines) != 2 {
		t.Fatalf("expected 2 lines for inst=A, got %d: %v", len(resp.Lines), resp.Lines)
	}
	for _, l := range resp.Lines {
		if !strings.Contains(l, "[inst=A]") {
			t.Fatalf("unexpected line: %s", l)
		}
	}
}

// ---- test helpers ----

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func newTestManager(t *testing.T, dataDir string) *manager.Manager {
	t.Helper()
	opts := manager.Options{
		ProfilesDir: filepath.Join(dataDir, "profiles"),
		LogsDir:     filepath.Join(dataDir, "logs"),
		StoresDir:   filepath.Join(dataDir, "stores"),
		MetaPath:    filepath.Join(dataDir, "meta.json"),
		Logger:      testLogger(),
	}
	for _, d := range []string{opts.ProfilesDir, opts.LogsDir, opts.StoresDir} {
		_ = os.MkdirAll(d, 0o755)
	}
	m, err := manager.New(opts)
	if err != nil {
		t.Fatalf("manager.New: %v", err)
	}
	return m
}

func mustCreateInstance(t *testing.T, m *manager.Manager, id string) {
	t.Helper()
	body := []byte(`serverAddr = "127.0.0.1"
serverPort = 7000
`)
	data, err := config.UnmarshalClientConf(body)
	if err != nil {
		t.Fatalf("UnmarshalClientConf: %v", err)
	}
	if err := m.Create(id, data); err != nil {
		t.Fatalf("Create %s: %v", id, err)
	}
}

func withPathID(r *http.Request, id string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}
