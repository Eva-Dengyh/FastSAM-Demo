# --- build stage ---
FROM golang:1.22-alpine AS builder

WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/gateway ./cmd/gateway

# --- runtime stage ---
FROM alpine:3.20

RUN apk add --no-cache ca-certificates && adduser -D -u 10001 gateway

WORKDIR /app
COPY --from=builder /out/gateway /app/gateway
COPY configs/gateway.yaml /app/configs/gateway.yaml

USER gateway
EXPOSE 8080

ENTRYPOINT ["/app/gateway", "-config", "/app/configs/gateway.yaml"]
