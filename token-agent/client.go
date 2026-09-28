package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	defaultServerURL = "http://100.64.0.2:9464"
	defaultBatchSize = 500
	clientTimeout    = 20 * time.Second
)

type clientConfig struct {
	Server      string
	Token       string
	TokenFile   string
	StateDir    string
	SessionsDir string
	BatchSize   int
	HTTPClient  *http.Client
}

func defaultClientConfig() (clientConfig, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return clientConfig{}, err
	}
	stateDir := filepath.Join(home, ".local", "state", "token-agent")
	if runtime.GOOS == "darwin" {
		stateDir = filepath.Join(home, "Library", "Application Support", "dev.leodeng.token-agent")
	} else if runtime.GOOS == "windows" {
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			stateDir = filepath.Join(local, "token-agent")
		}
	} else if state := os.Getenv("XDG_STATE_HOME"); state != "" {
		stateDir = filepath.Join(state, "token-agent")
	}
	return clientConfig{
		Server:      defaultServerURL,
		TokenFile:   filepath.Join(stateDir, "token"),
		StateDir:    stateDir,
		SessionsDir: filepath.Join(home, ".codex", "sessions"),
		BatchSize:   defaultBatchSize,
	}, nil
}

func (config clientConfig) token() (string, error) {
	if strings.TrimSpace(config.Token) != "" {
		return strings.TrimSpace(config.Token), nil
	}
	if value := strings.TrimSpace(os.Getenv("TOKEN_AGENT_TOKEN")); value != "" {
		return value, nil
	}
	data, err := os.ReadFile(config.TokenFile)
	if err != nil {
		return "", fmt.Errorf("read token file: %w", err)
	}
	value := strings.TrimSpace(string(data))
	if len(value) < 32 {
		return "", errors.New("token must be at least 32 characters")
	}
	return value, nil
}

func collect(config clientConfig) (int, int, error) {
	if _, err := os.Stat(config.SessionsDir); err != nil {
		return 0, 0, fmt.Errorf("Codex sessions directory: %w", err)
	}
	discovered, err := scanCodex(config.SessionsDir)
	if err != nil {
		return 0, 0, err
	}
	archivePath := filepath.Join(config.StateDir, "events.jsonl")
	_, known, err := loadEvents(archivePath)
	if err != nil {
		return 0, 0, err
	}
	newEvents := make([]UsageEvent, 0)
	for _, event := range discovered {
		if previous, ok := known[event.EventKey]; ok {
			if subtle.ConstantTimeCompare([]byte(previous), []byte(eventDigest(event))) != 1 {
				return 0, len(discovered), fmt.Errorf("event %s changed after archival", event.EventKey)
			}
			continue
		}
		newEvents = append(newEvents, event)
	}
	if err := appendEvents(archivePath, newEvents); err != nil {
		return 0, len(discovered), err
	}
	return len(newEvents), len(discovered), nil
}

func syncEvents(config clientConfig) (int, int, error) {
	token, err := config.token()
	if err != nil {
		return 0, 0, err
	}
	server, err := url.Parse(config.Server)
	if err != nil || (server.Scheme != "http" && server.Scheme != "https") || server.Host == "" {
		return 0, 0, errors.New("server must be an http or https URL")
	}
	deviceID, err := loadOrCreateDeviceID(config.StateDir)
	if err != nil {
		return 0, 0, err
	}
	events, _, err := loadEvents(filepath.Join(config.StateDir, "events.jsonl"))
	if err != nil {
		return 0, 0, err
	}
	acked, err := loadKeys(filepath.Join(config.StateDir, "acked"))
	if err != nil {
		return 0, 0, err
	}
	pending := make([]UsageEvent, 0)
	for _, event := range events {
		if _, ok := acked[event.EventKey]; !ok {
			pending = append(pending, event)
		}
	}
	if len(pending) == 0 {
		return 0, 0, nil
	}

	batchSize := config.BatchSize
	if batchSize < 1 || batchSize > 1000 {
		return 0, len(pending), errors.New("batch size must be between 1 and 1000")
	}
	sent := 0
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: clientTimeout}
	}
	for start := 0; start < len(pending); start += batchSize {
		end := min(start+batchSize, len(pending))
		batch := EventBatch{SchemaVersion: schemaVersion, DeviceID: deviceID, Events: pending[start:end]}
		body, err := json.Marshal(batch)
		if err != nil {
			return sent, len(pending) - sent, err
		}
		endpoint := strings.TrimRight(config.Server, "/") + "/v1/events"
		request, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			return sent, len(pending) - sent, err
		}
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("User-Agent", "token-agent/"+version)
		response, err := client.Do(request)
		if err != nil {
			return sent, len(pending) - sent, err
		}
		responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, 64*1024))
		response.Body.Close()
		if readErr != nil {
			return sent, len(pending) - sent, readErr
		}
		if response.StatusCode != http.StatusOK {
			return sent, len(pending) - sent, fmt.Errorf("hub returned %s: %s", response.Status, strings.TrimSpace(string(responseBody)))
		}
		var result BatchResult
		if err := json.Unmarshal(responseBody, &result); err != nil {
			return sent, len(pending) - sent, fmt.Errorf("decode hub response: %w", err)
		}
		if result.Accepted+result.Duplicates != end-start {
			return sent, len(pending) - sent, errors.New("hub acknowledgement count does not match batch")
		}
		if err := appendKeys(filepath.Join(config.StateDir, "acked"), pending[start:end]); err != nil {
			return sent, len(pending) - sent, err
		}
		sent += end - start
	}
	return sent, len(pending) - sent, nil
}

func clientStatus(config clientConfig) error {
	events, _, err := loadEvents(filepath.Join(config.StateDir, "events.jsonl"))
	if err != nil {
		return err
	}
	acked, err := loadKeys(filepath.Join(config.StateDir, "acked"))
	if err != nil {
		return err
	}
	pending := 0
	for _, event := range events {
		if _, ok := acked[event.EventKey]; !ok {
			pending++
		}
	}
	fmt.Printf("archive: %d events\n", len(events))
	fmt.Printf("pending: %d events\n", pending)
	fmt.Printf("state:   %s\n", config.StateDir)
	fmt.Printf("logs:    %s\n", config.SessionsDir)
	fmt.Printf("hub:     %s\n", config.Server)
	return nil
}
