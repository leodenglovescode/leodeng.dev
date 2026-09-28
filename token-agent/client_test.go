package main

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClientSyncAcknowledgesPersistedEvent(t *testing.T) {
	token := strings.Repeat("secret", 8)
	hub, err := newHub(token, filepath.Join(t.TempDir(), "inbox.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	handler := hub.routes()

	state := t.TempDir()
	tokenFile := filepath.Join(state, "token")
	if err := os.WriteFile(tokenFile, []byte(token+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := appendEvents(filepath.Join(state, "events.jsonl"), []UsageEvent{testEvent()}); err != nil {
		t.Fatal(err)
	}
	config := clientConfig{
		Server: "http://token-hub.test", TokenFile: tokenFile, StateDir: state, BatchSize: 500,
		HTTPClient: &http.Client{Transport: handlerTransport{handler: handler}},
	}
	sent, pending, err := syncEvents(config)
	if err != nil {
		t.Fatal(err)
	}
	if sent != 1 || pending != 0 {
		t.Fatalf("sent=%d pending=%d", sent, pending)
	}
	sent, pending, err = syncEvents(config)
	if err != nil {
		t.Fatal(err)
	}
	if sent != 0 || pending != 0 {
		t.Fatalf("second sync sent=%d pending=%d", sent, pending)
	}
}

type handlerTransport struct {
	handler http.Handler
}

func (transport handlerTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	recorder := httptest.NewRecorder()
	transport.handler.ServeHTTP(recorder, request)
	result := recorder.Result()
	data, err := io.ReadAll(result.Body)
	result.Body.Close()
	if err != nil {
		return nil, err
	}
	result.Body = io.NopCloser(bytes.NewReader(data))
	return result, nil
}
