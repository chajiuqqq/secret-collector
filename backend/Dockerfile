FROM golang:1.24-alpine AS build
ENV GOTOOLCHAIN=auto
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:3.21
RUN apk add --no-cache ca-certificates wget python3 py3-pip ffmpeg \
    && pip3 install --break-system-packages --no-cache-dir yt-dlp
COPY scripts/xhs_capture.py scripts/x_capture.py /skills/
COPY --from=build /out/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
