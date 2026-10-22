package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func sample(position int64) playback {
	return playback{Playing: true, TrackKey: "track", Title: "Song", Artist: "Artist", Album: "Album", DurationMS: 180000, PositionMS: position}
}
func TestHistoryOfflineSeekPauseRestart(t *testing.T) {
	directory := t.TempDir()
	h, err := openListeningHistory(directory)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 10, 20, 23, 59, 58, 0, time.UTC)
	if err = h.Observe(sample(0), start); err != nil {
		t.Fatal(err)
	}
	h.Observe(sample(4000), start.Add(4*time.Second))
	if h.state.Event.ListenedMS != 4000 || len(h.state.Event.Days) != 2 {
		t.Fatal(h.state)
	}
	h.Observe(sample(90000), start.Add(6*time.Second))
	if h.state.Event.ListenedMS != 4000 {
		t.Fatal("seek counted")
	}
	h.Observe(playback{}, start.Add(8*time.Second))
	h.Observe(sample(90000), start.Add(time.Minute))
	h.Observe(sample(92000), start.Add(time.Minute+2*time.Second))
	if h.state.Event.ListenedMS != 6000 {
		t.Fatal("pause counted", h.state.Event)
	}
	id := h.state.Event.ID
	if _, err = openListeningHistory(directory); err == nil {
		t.Fatal("concurrent writer allowed")
	}
	h.lock.Close()
	h, err = openListeningHistory(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer h.lock.Close()
	h.Observe(sample(94000), start.Add(time.Minute+4*time.Second))
	if h.state.Event.ID != id || h.state.Event.ListenedMS != 6000 {
		t.Fatal("restart fabricated time")
	}
	h.Observe(sample(96000), start.Add(time.Minute+6*time.Second))
	if h.state.Event.ListenedMS != 8000 {
		t.Fatal(h.state.Event)
	}
}
func TestHistoryRetriesAndOnlyDeletesAcknowledgedVersion(t *testing.T) {
	h, err := openListeningHistory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer h.lock.Close()
	now := time.Now()
	h.Observe(sample(0), now)
	h.Observe(sample(2000), now.Add(2*time.Second))
	fail := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Error("missing token")
		}
		if fail {
			http.Error(w, "offline", 503)
			return
		}
		var batch struct {
			Events []listeningEvent `json:"events"`
		}
		json.NewDecoder(r.Body).Decode(&batch)
		if len(batch.Events) != 1 || batch.Events[0].ListenedMS != 2000 {
			t.Error("invalid batch")
		}
		h.Observe(sample(4000), now.Add(4*time.Second))
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	if h.sync(context.Background(), []string{server.URL}, "secret") == nil {
		t.Fatal("failure acknowledged")
	}
	entries, _ := os.ReadDir(filepath.Join(h.directory, "outbox"))
	if len(entries) != 1 {
		t.Fatal("lost offline event")
	}
	fail = false
	if err = h.sync(context.Background(), []string{server.URL}, "secret"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(h.eventPath(h.state.Event.ID))
	if err != nil {
		t.Fatal("deleted newer event")
	}
	var queued listeningEvent
	json.Unmarshal(data, &queued)
	if queued.ListenedMS != 4000 {
		t.Fatal(queued)
	}
}
