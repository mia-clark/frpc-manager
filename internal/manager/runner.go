package manager

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fatedier/frp/client/proxy"

	"github.com/mia-clark/frp-manager-server/services"
)

// runner abstracts the frpc execution backend so the instance scheduler
// can drive either the in-process embedded library or an external frpc
// binary uniformly.
//
// Implementations:
//   - inProcRunner — wraps services.FrpClientService (the embedded library)
//   - execRunner   — runs an external frpc binary as a subprocess
type runner interface {
	// Run blocks until the underlying frpc exits or ctx is cancelled.
	Run() error
	// Stop signals graceful shutdown. It must be safe to call multiple times.
	Stop(force bool)
	// Reload re-reads the config file. May return an error if not supported.
	Reload() error
	// GetProxyStatus returns the working status for a given proxy alias.
	// External backends usually return (nil, false) — UI will degrade
	// gracefully by showing empty status badges.
	GetProxyStatus(alias string) (*proxy.WorkingStatus, bool)
}

// ----- in-process runner: thin wrapper around services.FrpClientService -----

type inProcRunner struct {
	svc *services.FrpClientService
}

func newInProcRunner(configPath string) (*inProcRunner, error) {
	svc, err := services.NewFrpClientService(configPath)
	if err != nil {
		return nil, err
	}
	return &inProcRunner{svc: svc}, nil
}

func (r *inProcRunner) Run() error                                    { r.svc.Run(); return nil }
func (r *inProcRunner) Stop(force bool)                               { r.svc.Stop(force) }
func (r *inProcRunner) Reload() error                                 { return r.svc.Reload() }
func (r *inProcRunner) GetProxyStatus(a string) (*proxy.WorkingStatus, bool) {
	return r.svc.GetProxyStatus(a)
}

// ----- exec runner: spawns an external frpc binary as a subprocess -----

type execRunner struct {
	cmd        *exec.Cmd
	binPath    string
	configPath string
	logPath    string
	version    string
	logger     *slog.Logger

	mu       sync.Mutex
	started  atomic.Bool
	exited   atomic.Bool
	exitErr  error
	doneCh   chan struct{}
}

func newExecRunner(binPath, configPath, logPath, version string, logger *slog.Logger) *execRunner {
	return &execRunner{
		binPath:    binPath,
		configPath: configPath,
		logPath:    logPath,
		version:    version,
		logger:     logger,
		doneCh:     make(chan struct{}),
	}
}

// Run starts the frpc subprocess and blocks until it exits or its context
// is cancelled. The frpc binary is invoked with "-c <config>"; its stdout
// and stderr are merged into the per-instance log file (which is the same
// file the embedded library writes to, so the /logs API works unchanged).
func (r *execRunner) Run() error {
	if !r.started.CompareAndSwap(false, true) {
		return errors.New("execRunner: already started")
	}

	// Ensure the log file exists and is opened in append mode so frpc
	// can stream into it.
	logF, err := os.OpenFile(r.logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		// fallback to discarding output if we can't open the log file
		r.logger.Warn("open log file failed; subprocess output will be lost",
			slog.String("log_path", r.logPath), slog.Any("err", err))
		logF = nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	// keep cancel so Stop() can fire it
	r.mu.Lock()
	r.cmd = exec.CommandContext(ctx, r.binPath, "-c", r.configPath)
	r.cmd.Cancel = func() error {
		// On Windows .Kill() is the only reliable way to stop a console process
		// without attaching a debug helper; SIGINT is unsupported on subprocess.
		return r.cmd.Process.Kill()
	}
	if logF != nil {
		r.cmd.Stdout = logF
		r.cmd.Stderr = logF
	} else {
		r.cmd.Stdout = io.Discard
		r.cmd.Stderr = io.Discard
	}
	cmd := r.cmd
	r.mu.Unlock()

	r.logger.Info("starting external frpc",
		slog.String("bin", r.binPath),
		slog.String("config", r.configPath),
		slog.String("version", r.version),
	)

	if err := cmd.Start(); err != nil {
		cancel()
		r.exited.Store(true)
		r.exitErr = fmt.Errorf("start frpc: %w", err)
		close(r.doneCh)
		if logF != nil {
			logF.Close()
		}
		return r.exitErr
	}

	// Wait synchronously; the instance scheduler will call Stop() (which
	// triggers ctx cancel) to make us return.
	waitErr := cmd.Wait()
	if logF != nil {
		logF.Close()
	}
	cancel()
	r.exited.Store(true)
	r.exitErr = waitErr
	close(r.doneCh)
	return waitErr
}

// Stop kills the frpc subprocess. Safe to call multiple times.
func (r *execRunner) Stop(_ bool) {
	r.mu.Lock()
	cmd := r.cmd
	r.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return
	}
	if r.exited.Load() {
		return
	}
	// Best-effort graceful kill — frpc has no SIGTERM handler difference on Windows
	_ = cmd.Process.Kill()

	// Wait briefly so Stop() callers see the process gone before
	// returning. The Run() goroutine will close doneCh.
	select {
	case <-r.doneCh:
	case <-time.After(3 * time.Second):
	}
}

// Reload is not currently supported for external binaries — the embedded
// library exposes a Go function we can call, but the subprocess only
// supports HTTP /api/reload via its own webServer block. Callers can
// hot-swap config by stopping + starting the instance.
func (r *execRunner) Reload() error {
	return errors.New("hot-reload is not supported when using an external frpc binary; please restart the instance")
}

// GetProxyStatus always returns false — external processes don't expose
// per-proxy stats to the daemon. The /status API will show empty badges
// for these instances, which is acceptable.
func (r *execRunner) GetProxyStatus(_ string) (*proxy.WorkingStatus, bool) {
	return nil, false
}
