package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const maxRequestBytes = 4 * 1024 * 1024

type hub struct {
	token   string
	inbox   string
	mu      sync.Mutex
	digests map[string]string
}

func newHub(token, inbox string) (*hub, error) {
	token = strings.TrimSpace(token)
	if len(token) < 32 {
		return nil, errors.New("hub token must be at least 32 characters")
	}
	digests, err := loadStoredEvents(inbox)
	if err != nil {
		return nil, err
	}
	return &hub{token: token, inbox: inbox, digests: digests}, nil
}

func (hub *hub) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", hub.health)
	mux.HandleFunc("POST /v1/events", hub.ingest)
	return mux
}

func (hub *hub) health(writer http.ResponseWriter, _ *http.Request) {
	hub.mu.Lock()
	events := len(hub.digests)
	hub.mu.Unlock()
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "events": events})
}

func (hub *hub) ingest(writer http.ResponseWriter, request *http.Request) {
	auth := request.Header.Get("Authorization")
	provided := ""
	if strings.HasPrefix(auth, "Bearer ") {
		provided = strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	if len(provided) != len(hub.token) || subtle.ConstantTimeCompare([]byte(provided), []byte(hub.token)) != 1 {
		writeJSON(writer, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, maxRequestBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var batch EventBatch
	if err := decoder.Decode(&batch); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid request: " + err.Error()})
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "request must contain one JSON object"})
		return
	}
	if batch.SchemaVersion != schemaVersion {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "unsupported schema version"})
		return
	}
	if !validDeviceID(batch.DeviceID) {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid device ID"})
		return
	}
	if len(batch.Events) == 0 || len(batch.Events) > 1000 {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "batch must contain 1 to 1000 events"})
		return
	}
	for index, event := range batch.Events {
		if err := event.validate(); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("event %d: %v", index, err)})
			return
		}
	}

	hub.mu.Lock()
	defer hub.mu.Unlock()
	newRecords := make([]storedEvent, 0)
	duplicates := 0
	batchDigests := make(map[string]string, len(hub.digests)+len(batch.Events))
	for key, digest := range hub.digests {
		batchDigests[key] = digest
	}
	for _, event := range batch.Events {
		digest := eventDigest(event)
		if previous, ok := batchDigests[event.EventKey]; ok {
			if previous != digest {
				writeJSON(writer, http.StatusConflict, map[string]string{"error": "event key has conflicting contents: " + event.EventKey})
				return
			}
			duplicates++
			continue
		}
		batchDigests[event.EventKey] = digest
		newRecords = append(newRecords, storedEvent{
			DeviceID: batch.DeviceID,
			Received: time.Now().UTC().Format(time.RFC3339Nano),
			Event:    event,
		})
	}
	if err := appendStoredEvents(hub.inbox, newRecords); err != nil {
		log.Printf("persist batch: %v", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "could not persist batch"})
		return
	}
	for _, record := range newRecords {
		hub.digests[record.Event.EventKey] = eventDigest(record.Event)
	}
	writeJSON(writer, http.StatusOK, BatchResult{Accepted: len(newRecords), Duplicates: duplicates})
}

func runHub(listen, inbox, token, tokenFile string) error {
	if strings.TrimSpace(token) == "" {
		token = strings.TrimSpace(os.Getenv("TOKEN_AGENT_TOKEN"))
	}
	if strings.TrimSpace(token) == "" && tokenFile != "" {
		data, err := os.ReadFile(tokenFile)
		if err != nil {
			return fmt.Errorf("read hub token file: %w", err)
		}
		token = strings.TrimSpace(string(data))
	}
	if err := ensurePrivateDir(filepath.Dir(inbox)); err != nil {
		return err
	}
	hub, err := newHub(token, inbox)
	if err != nil {
		return err
	}
	server := &http.Server{
		Addr:              listen,
		Handler:           hub.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}
	log.Printf("token hub listening on http://%s with %d archived events", listen, len(hub.digests))
	return server.ListenAndServe()
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
