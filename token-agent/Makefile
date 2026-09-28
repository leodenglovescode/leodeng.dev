GOCACHE ?= $(CURDIR)/.cache/go-build
.PHONY: test darwin-arm64 linux-amd64 all clean

test:
	GOCACHE="$(GOCACHE)" go test ./...

darwin-arm64:
	mkdir -p bin
	GOCACHE="$(GOCACHE)" CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
		go build -trimpath -ldflags '-s -w' -o bin/token-agent-darwin-arm64 .

linux-amd64:
	mkdir -p bin
	GOCACHE="$(GOCACHE)" CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
		go build -trimpath -ldflags '-s -w' -o bin/token-agent-linux-amd64 .

all: test darwin-arm64 linux-amd64

clean:
	GOCACHE="$(GOCACHE)" go clean -cache
