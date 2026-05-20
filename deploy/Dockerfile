# syntax=docker/dockerfile:1.7
# ----- build stage -----
FROM golang:1.25-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates tzdata
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
ARG BUILD_DATE=unknown
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w \
      -X github.com/mia-clark/frp-manager-server/pkg/version.Number=${VERSION} \
      -X github.com/mia-clark/frp-manager-server/pkg/version.BuildDate=${BUILD_DATE}" \
    -o /out/frpmgrd ./cmd/frpmgrd

# Pre-seed the /data tree with the right ownership. When the user mounts
# a docker named volume, Docker will copy this skeleton into the volume
# on first start (with permissions intact), so the daemon can immediately
# write profiles/logs/stores without any host-side chown ritual.
#
# For host bind mounts this layer is shadowed, so users must either
# chown 65532:65532 on the host OR use the init-permissions sidecar in
# the standalone compose file. The trade-off is documented there.
RUN mkdir -p /out/data/profiles /out/data/logs /out/data/stores \
    && chown -R 65532:65532 /out/data

# ----- runtime stage -----
FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/frpmgrd /usr/local/bin/frpmgrd
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=build --chown=65532:65532 /out/data /data

ENV FRPMGR_DATA_DIR=/data \
    FRPMGR_HTTP_ADDR=:8080 \
    FRPMGR_LOG_LEVEL=info \
    FRPMGR_CORS_ORIGINS="*"

EXPOSE 8080
VOLUME ["/data"]
USER nonroot:nonroot

ENTRYPOINT ["/usr/local/bin/frpmgrd"]
CMD ["serve"]
