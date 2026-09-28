package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestScanCodexDeduplicatesCumulativeCounters(t *testing.T) {
	originalLocal := time.Local
	time.Local = time.FixedZone("UTC+8", 8*60*60)
	t.Cleanup(func() { time.Local = originalLocal })

	root := t.TempDir()
	path := filepath.Join(root, "2026", "09", "27", "rollout.jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	rows := []any{
		map[string]any{"timestamp": "2026-09-27T15:59:00Z", "type": "session_meta", "payload": map[string]any{"id": "session-1"}},
		map[string]any{"timestamp": "2026-09-27T15:59:01Z", "type": "turn_context", "payload": map[string]any{"model": "gpt-5.4"}},
		tokenRow("2026-09-27T15:59:02Z", 100, 30, 5, 140),
		tokenRowWithTotal("2026-09-27T15:59:03Z", 999, 111, 88, 100, 30, 5, 140),
		tokenRow("2026-09-27T16:01:00Z", 250, 80, 15, 345),
	}
	handle, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	encoder := json.NewEncoder(handle)
	for _, row := range rows {
		if err := encoder.Encode(row); err != nil {
			t.Fatal(err)
		}
	}
	if err := handle.Close(); err != nil {
		t.Fatal(err)
	}

	events, err := scanCodex(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("got %d events, want 2", len(events))
	}
	if events[0].Input != 70 || events[0].CacheRead != 30 || events[0].Output != 5 {
		t.Fatalf("unexpected first event: %#v", events[0])
	}
	if events[0].LocalDay != "2026-09-27" || events[1].LocalDay != "2026-09-28" {
		t.Fatalf("local days = %q, %q", events[0].LocalDay, events[1].LocalDay)
	}

	material := []byte(`{"cached_input_tokens":30,"input_tokens":100,"output_tokens":5,"total_tokens":140}`)
	sum := sha256.Sum256(append(append([]byte("session-1"), 0), material...))
	wantKey := "codex:" + hex.EncodeToString(sum[:])
	if events[0].EventKey != wantKey {
		t.Fatalf("event key = %q, want %q", events[0].EventKey, wantKey)
	}
}

func tokenRow(stamp string, input, cached, output, total int64) map[string]any {
	usage := map[string]any{
		"input_tokens": input, "cached_input_tokens": cached,
		"output_tokens": output, "total_tokens": total,
	}
	return tokenRowPayload(stamp, usage, usage)
}

func tokenRowWithTotal(stamp string, input, cached, output, totalInput, totalCached, totalOutput, total int64) map[string]any {
	last := map[string]any{
		"input_tokens": input, "cached_input_tokens": cached,
		"output_tokens": output, "total_tokens": input + output,
	}
	cumulative := map[string]any{
		"input_tokens": totalInput, "cached_input_tokens": totalCached,
		"output_tokens": totalOutput, "total_tokens": total,
	}
	return tokenRowPayload(stamp, last, cumulative)
}

func tokenRowPayload(stamp string, last, total map[string]any) map[string]any {
	return map[string]any{
		"timestamp": stamp,
		"type":      "event_msg",
		"payload": map[string]any{
			"type": "token_count",
			"info": map[string]any{"last_token_usage": last, "total_token_usage": total},
		},
	}
}
