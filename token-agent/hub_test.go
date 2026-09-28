package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func testEvent() UsageEvent {
	return UsageEvent{
		EventKey:   "codex:" + strings.Repeat("a", 64),
		Timestamp:  "2026-09-27T10:00:00Z",
		LocalDay:   "2026-09-27",
		Provider:   "codex",
		Model:      "gpt-5.4",
		Input:      100,
		Output:     10,
		CacheRead:  50,
		Responses:  1,
		SessionKey: "codex-session:" + strings.Repeat("b", 64),
	}
}

func TestHubAcceptsAndDeduplicates(t *testing.T) {
	token := strings.Repeat("secret", 8)
	inbox := filepath.Join(t.TempDir(), "inbox.jsonl")
	hub, err := newHub(token, inbox)
	if err != nil {
		t.Fatal(err)
	}
	handler := hub.routes()

	batch := EventBatch{SchemaVersion: 1, DeviceID: strings.Repeat("c", 32), Events: []UsageEvent{testEvent()}}
	first := postBatch(t, handler, token, batch)
	if first.Accepted != 1 || first.Duplicates != 0 {
		t.Fatalf("first result = %#v", first)
	}
	second := postBatch(t, handler, token, batch)
	if second.Accepted != 0 || second.Duplicates != 1 {
		t.Fatalf("second result = %#v", second)
	}

	reloaded, err := newHub(token, inbox)
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.digests) != 1 {
		t.Fatalf("reloaded %d events, want 1", len(reloaded.digests))
	}
}

func TestHubRejectsConflictingDuplicate(t *testing.T) {
	token := strings.Repeat("secret", 8)
	hub, err := newHub(token, filepath.Join(t.TempDir(), "inbox.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	handler := hub.routes()

	batch := EventBatch{SchemaVersion: 1, DeviceID: strings.Repeat("c", 32), Events: []UsageEvent{testEvent()}}
	postBatch(t, handler, token, batch)
	batch.Events[0].Output++
	body, _ := json.Marshal(batch)
	request := httptest.NewRequest(http.MethodPost, "/v1/events", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", response.Code)
	}
}

func TestHubDeduplicatesWithinOneBatch(t *testing.T) {
	token := strings.Repeat("secret", 8)
	inbox := filepath.Join(t.TempDir(), "inbox.jsonl")
	hub, err := newHub(token, inbox)
	if err != nil {
		t.Fatal(err)
	}
	event := testEvent()
	batch := EventBatch{
		SchemaVersion: 1,
		DeviceID:      strings.Repeat("c", 32),
		Events:        []UsageEvent{event, event},
	}
	result := postBatch(t, hub.routes(), token, batch)
	if result.Accepted != 1 || result.Duplicates != 1 {
		t.Fatalf("result = %#v", result)
	}
	reloaded, err := newHub(token, inbox)
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.digests) != 1 {
		t.Fatalf("stored %d events, want 1", len(reloaded.digests))
	}
}

func postBatch(t *testing.T, handler http.Handler, token string, batch EventBatch) BatchResult {
	t.Helper()
	body, err := json.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/events", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	var result BatchResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return result
}
