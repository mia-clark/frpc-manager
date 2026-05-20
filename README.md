# frpmgr-server

Headless FRP client manager — manages multiple `frpc` instances inside a single Linux process, exposes the full management surface over HTTP + WebSocket. Designed for Docker.

> Forked from the Windows GUI tool [frpmgr](https://github.com/mia-clark/frp-manager-server). The Windows GUI is gone; the configuration model, hot-reload, and frpc embedding are kept. See [`docs/superpowers/specs/2026-05-20-frpmgr-docker-migration-design.md`](docs/superpowers/specs/2026-05-20-frpmgr-docker-migration-design.md) for the migration rationale.

## What it gives you

- **Multi-instance frpc** in one process (goroutines, not separate containers)
- **Hot reload** without losing proxy state — same `svc.Reload` path the original GUI used
- **Full REST API** covering config / proxy CRUD, lifecycle (start/stop/reload), validation, import/export, NAT-hole discovery
- **WebSocket event stream** for state changes, proxy status diffs, errors, and live log tail
- **Bearer-token auth** (single static token via env var) + configurable CORS
- **OpenAPI 3.1** description ready to feed Swagger Codegen / openapi-typescript

The intended client is your own React/Vue webui — the API is built to be browser-friendly.

## Install

### Option A — pre-built Docker image (recommended)

```bash
docker pull ghcr.io/mia-clark/frp-manager-server:latest
docker run -d --name frpmgrd --network host \
  -e FRPMGR_API_TOKEN="$(openssl rand -hex 32)" \
  -v $(pwd)/data:/data \
  ghcr.io/mia-clark/frp-manager-server:latest
```

Images are published on every push to `main` (tag `latest`, `main`, `main-<sha>`) and on every release tag (`vX.Y.Z`, `vX.Y`, `vX`).

### Option B — pre-built CLI binary

Download from [releases](https://github.com/mia-clark/frp-manager-server/releases) — Linux (amd64/arm64/armv7), macOS (amd64/arm64), Windows (amd64/arm64).

```bash
# Linux amd64 example
curl -L https://github.com/mia-clark/frp-manager-server/releases/latest/download/frpmgrd_*_linux_amd64.tar.gz | tar -xz
FRPMGR_API_TOKEN=$(openssl rand -hex 32) ./frpmgrd serve
```

### Option C — docker compose (build locally)

```bash
cd deploy/
cp .env.example .env       # paste a real token
docker compose up -d --build
curl http://localhost:8080/api/v1/health
```

See **[`docs/README-server.md`](docs/README-server.md)** for the full deployment & API guide.

## Repo layout

```
cmd/frpmgrd/        # daemon entrypoint
internal/api/       # HTTP + WebSocket handlers, middleware
internal/manager/   # instance registry + lifecycle (replaces Windows SCM)
internal/eventbus/  # in-process pub/sub for WS push
internal/logtail/   # tail -f for log files
internal/appcfg/    # env var parsing
pkg/config/         # FRP config model (INI/TOML, V1 conversion)
pkg/consts/         # protocol/proxy type constants
pkg/util/           # cross-platform helpers (file IO, strings)
pkg/sec/            # password hashing
pkg/version/        # version stamps
services/           # FrpClientService wrapper (unchanged from upstream)
deploy/             # Dockerfile, docker-compose.yml, .env.example
docs/api/           # OpenAPI spec
docs/superpowers/   # design spec + implementation plan
```

## Building

```bash
make build          # Linux static binary -> bin/frpmgrd
make build-host     # native (e.g. Windows for local dev) -> bin/frpmgrd
make test           # go test ./...
make docker         # docker build using deploy/Dockerfile
```

## Status

| Milestone | What | Status |
|---|---|---|
| M1 | Scaffolding (cleanup, http server, /health) | done |
| M2 | Manager + configs/proxies CRUD + lifecycle | done |
| M3 | EventBus + WebSocket /events + log tail | done |
| M4 | Import/export + AutoDelete + nathole | done |
| M5 | Docker packaging + docs | done |
| M6 | System/container metrics (`/api/v1/system/*`) + per-proxy connection count | done |
| M7 | Embedded Scalar API docs at `/api/docs/` | done |
| M8 | CI: Docker (multi-arch → ghcr.io) + Release (goreleaser, 7 platform binaries) | done |

## Releasing

Tag a commit on `main` to trigger the full release pipeline:

```bash
git tag v0.1.0
git push origin v0.1.0
```

This fires two parallel workflows:

1. **`Docker`** — builds and pushes `ghcr.io/mia-clark/frp-manager-server:0.1.0` plus `0.1`, `0`, and updates `latest` (multi-arch: amd64 + arm64).
2. **`Release`** — cross-compiles 7 binaries via `goreleaser`, generates `checksums.txt`, drafts a GitHub Release with auto-generated changelog.

For a snapshot build without tagging: `Actions → Release → Run workflow` with empty tag input — produces a downloadable artifact for testing.

### First-time GitHub setup

Both workflows need:
- **Settings → Actions → General → Workflow permissions** → set to **Read and write**
- **Settings → Packages → Manage Actions access** → ensure repo has write access (auto-granted by `GITHUB_TOKEN` permissions in the workflow)

The first `ghcr.io` push makes the package; afterwards visit https://github.com/users/mia-clark/packages and set visibility to public if desired.

## License

Same as upstream — see [`LICENSE`](LICENSE).
