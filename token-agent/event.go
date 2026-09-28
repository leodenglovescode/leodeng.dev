package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const schemaVersion = 1

var (
	dayPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	// Match the existing Cloudflare ingest contract so one bad remote model
	// cannot make the combined daily rollup fail when the server publishes it.
	modelPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{0,63}$`)
	keyPattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9:._-]{15,159}$`)
)

// UsageEvent is the privacy boundary between a device and the hub. It carries
// counts and opaque identifiers only. Prompts, responses, paths and project
// names never enter this structure and therefore cannot cross the network.
type UsageEvent struct {
	EventKey    string `json:"eventKey"`
	Timestamp   string `json:"timestamp"`
	LocalDay    string `json:"localDay"`
	Provider    string `json:"provider"`
	Model       string `json:"model"`
	Input       int64  `json:"input"`
	Output      int64  `json:"output"`
	CacheWrite5 int64  `json:"cacheWrite5m"`
	CacheWrite1 int64  `json:"cacheWrite1h"`
	CacheRead   int64  `json:"cacheRead"`
	Responses   int64  `json:"responses"`
	SessionKey  string `json:"sessionKey"`
	Sidechain   bool   `json:"sidechain,omitempty"`
}

type EventBatch struct {
	SchemaVersion int          `json:"schemaVersion"`
	DeviceID      string       `json:"deviceId"`
	Events        []UsageEvent `json:"events"`
}

type BatchResult struct {
	Accepted   int `json:"accepted"`
	Duplicates int `json:"duplicates"`
}

type storedEvent struct {
	DeviceID string     `json:"deviceId"`
	Received string     `json:"receivedAt"`
	Event    UsageEvent `json:"event"`
}

func (event UsageEvent) validate() error {
	if !keyPattern.MatchString(event.EventKey) {
		return errors.New("invalid event key")
	}
	if event.Provider != "codex" {
		return fmt.Errorf("unsupported provider %q", event.Provider)
	}
	if !modelPattern.MatchString(event.Model) {
		return errors.New("invalid model")
	}
	if !dayPattern.MatchString(event.LocalDay) {
		return errors.New("invalid local day")
	}
	stamp, err := time.Parse(time.RFC3339Nano, event.Timestamp)
	if err != nil || stamp.IsZero() {
		return errors.New("invalid timestamp")
	}
	if event.Responses < 1 || event.Responses > 1_000_000 {
		return errors.New("invalid response count")
	}
	for name, value := range map[string]int64{
		"input": event.Input, "output": event.Output,
		"cacheWrite5m": event.CacheWrite5, "cacheWrite1h": event.CacheWrite1,
		"cacheRead": event.CacheRead,
	} {
		if value < 0 || value > 1_000_000_000_000_000 {
			return fmt.Errorf("invalid %s count", name)
		}
	}
	if !strings.HasPrefix(event.SessionKey, "codex-session:") || len(event.SessionKey) != 78 {
		return errors.New("invalid session key")
	}
	return nil
}

func eventDigest(event UsageEvent) string {
	data, _ := json.Marshal(event)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func opaqueSessionKey(session string) string {
	sum := sha256.Sum256([]byte("codex-session\x00" + session))
	return "codex-session:" + hex.EncodeToString(sum[:])
}
