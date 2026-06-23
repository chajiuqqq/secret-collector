FROM golang:1.25-alpine AS build
ENV GOTOOLCHAIN=local
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:3.21
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories \
    && apk add --no-cache ca-certificates wget python3 py3-pip ffmpeg \
    && pip3 install --break-system-packages --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple yt-dlp
COPY scripts/xhs_capture.py scripts/x_capture.py /skills/
COPY --from=build /out/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
