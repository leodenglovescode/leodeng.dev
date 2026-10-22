VERSION ?= dev
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: all mac test clean

all: test mac

test:
	mkdir -p .cache
	GOCACHE=$(CURDIR)/.cache go test ./...

mac:
	mkdir -p bin .cache
	GOCACHE=$(CURDIR)/.cache CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
		go build -trimpath -ldflags "$(LDFLAGS)" -o bin/now-playing-agent-darwin-arm64 .
	chmod 755 bin/now-playing-agent-darwin-arm64

clean:
	rm -rf bin .cache
