package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"
)

type codexRow struct {
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

type sessionMeta struct {
	ID             string `json:"id"`
	SessionID      string `json:"session_id"`
	ParentThreadID string `json:"parent_thread_id"`
}

type turnContext struct {
	Model string `json:"model"`
}

type tokenEvent struct {
	Type string `json:"type"`
	Info struct {
		Last  tokenUsage     `json:"last_token_usage"`
		Total map[string]any `json:"total_token_usage"`
	} `json:"info"`
}

type tokenUsage struct {
	Input      int64 `json:"input_tokens"`
	Cached     int64 `json:"cached_input_tokens"`
	CacheWrite int64 `json:"cache_write_input_tokens"`
	Output     int64 `json:"output_tokens"`
}

func scanCodex(root string) ([]UsageEvent, error) {
	paths := make([]string, 0)
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".jsonl" {
			paths = append(paths, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)

	byKey := make(map[string]UsageEvent)
	for _, path := range paths {
		events, err := scanCodexFile(path)
		if err != nil {
			return nil, fmt.Errorf("scan %s: %w", path, err)
		}
		for _, event := range events {
			// Match homelab/tokens.py's INSERT OR IGNORE behavior exactly.
			// Codex can repeat a cumulative counter while revising the attached
			// last_token_usage. The established archive treats the first version
			// in sorted transcript order as canonical.
			if _, exists := byKey[event.EventKey]; !exists {
				byKey[event.EventKey] = event
			}
		}
	}

	events := make([]UsageEvent, 0, len(byKey))
	for _, event := range byKey {
		events = append(events, event)
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].Timestamp == events[j].Timestamp {
			return events[i].EventKey < events[j].EventKey
		}
		return events[i].Timestamp < events[j].Timestamp
	})
	return events, nil
}

func scanCodexFile(path string) ([]UsageEvent, error) {
	handle, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer handle.Close()

	scanner := bufio.NewScanner(handle)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	var session, model string
	var sidechain bool
	var events []UsageEvent

	for scanner.Scan() {
		var row codexRow
		decoder := json.NewDecoder(bytes.NewReader(scanner.Bytes()))
		decoder.UseNumber()
		if err := decoder.Decode(&row); err != nil {
			continue
		}

		switch row.Type {
		case "session_meta":
			var meta sessionMeta
			if json.Unmarshal(row.Payload, &meta) == nil {
				if meta.ID != "" {
					session = meta.ID
				} else if meta.SessionID != "" {
					session = meta.SessionID
				}
				sidechain = meta.ParentThreadID != ""
			}
		case "turn_context":
			var context turnContext
			if json.Unmarshal(row.Payload, &context) == nil && context.Model != "" {
				model = context.Model
			}
		case "event_msg":
			var message tokenEvent
			decoder := json.NewDecoder(bytes.NewReader(row.Payload))
			decoder.UseNumber()
			if decoder.Decode(&message) != nil || message.Type != "token_count" {
				continue
			}
			if session == "" || model == "" || row.Timestamp == "" || len(message.Info.Total) == 0 {
				continue
			}
			stamp, err := time.Parse(time.RFC3339Nano, row.Timestamp)
			if err != nil {
				continue
			}
			material, err := json.Marshal(message.Info.Total)
			if err != nil {
				continue
			}
			sum := sha256.Sum256(append(append([]byte(session), 0), material...))
			cached := max64(0, message.Info.Last.Cached)
			input := max64(0, message.Info.Last.Input-cached)
			event := UsageEvent{
				EventKey:    "codex:" + hex.EncodeToString(sum[:]),
				Timestamp:   stamp.UTC().Format(time.RFC3339Nano),
				LocalDay:    stamp.Local().Format("2006-01-02"),
				Provider:    "codex",
				Model:       model,
				Input:       input,
				Output:      max64(0, message.Info.Last.Output),
				CacheWrite5: max64(0, message.Info.Last.CacheWrite),
				CacheRead:   cached,
				Responses:   1,
				SessionKey:  opaqueSessionKey(session),
				Sidechain:   sidechain,
			}
			if event.validate() == nil {
				events = append(events, event)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
