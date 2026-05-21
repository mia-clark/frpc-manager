# syntax=docker/dockerfile:1.7
# ----- build stage -----
FROM golang:1.25-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates tzdata
COPY go.mod go.sum ./
RUN go mod download
COPY . .

# WebUI 通过 //go:embed dist 嵌入 Go 二进制 —— 必须确保 web/dist/index.html
# 在构建上下文里存在。本 Dockerfile 故意不跑 npm build，由调用方（make /
# 开发者）提前生成 web/dist。漏跑时这里 fail-fast，而不是出空白 WebUI。
RUN test -f web/dist/index.html || ( \
      echo "ERROR: web/dist/index.html 不存在 —— 请先在仓库根目录跑 'make web' 或 'cd web && npm run build'，再 docker build" >&2; \
      exit 1 )

ARG VERSION=dev
ARG BUILD_DATE=unknown
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w \
      -X github.com/mia-clark/frp-manager-server/pkg/version.Number=${VERSION} \
      -X github.com/mia-clark/frp-manager-server/pkg/version.BuildDate=${BUILD_DATE}" \
    -o /out/frpmgrd ./cmd/frpmgrd

# ----- runtime stage -----
# alpine + su-exec, the same pattern the official postgres/redis images
# use: start as root, fix /data ownership, drop privileges, exec daemon.
# Trade ~5MB of base image size for a self-contained init flow (no
# sidecar, no host-side chown) that works for both named volumes and
# host bind mounts.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata su-exec \
    && addgroup -g 65532 -S nonroot \
    && adduser -u 65532 -G nonroot -S -D -H nonroot

COPY --from=build /out/frpmgrd /usr/local/bin/frpmgrd
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/frpmgrd

ENV FRPMGR_DATA_DIR=/data \
    FRPMGR_HTTP_ADDR=:8080 \
    FRPMGR_LOG_LEVEL=info \
    FRPMGR_CORS_ORIGINS="*"

EXPOSE 8080
VOLUME ["/data"]

# Intentionally no USER directive — entrypoint.sh starts as root just
# long enough to chown /data, then re-execs as UID 65532 via su-exec.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["serve"]
