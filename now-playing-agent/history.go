package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

type listeningEvent struct {
	ID         string           `json:"id"`
	Title      string           `json:"title"`
	Artist     string           `json:"artist"`
	Album      string           `json:"album"`
	DurationMS int64            `json:"durationMs"`
	StartedAt  int64            `json:"startedAt"`
	UpdatedAt  int64            `json:"updatedAt"`
	ListenedMS int64            `json:"listenedMs"`
	Days       map[string]int64 `json:"days"`
}
type listeningState struct {
	Event    listeningEvent `json:"event"`
	Key      string         `json:"key"`
	Position int64          `json:"position"`
	At       int64          `json:"at"`
	Playing  bool           `json:"playing"`
}
type listeningHistory struct {
	mu        sync.Mutex
	directory string
	state     listeningState
	lock      *os.File
}

func atomicJSON(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(path+".tmp", path); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
func openListeningHistory(directory string) (*listeningHistory, error) {
	if err := os.MkdirAll(filepath.Join(directory, "outbox"), 0700); err != nil {
		return nil, err
	}
	lock, err := os.OpenFile(filepath.Join(directory, "queue.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		return nil, fmt.Errorf("listening queue already in use")
	}
	h := &listeningHistory{directory: directory, lock: lock}
	data, err := os.ReadFile(filepath.Join(directory, "active.json"))
	if err == nil {
		if err = json.Unmarshal(data, &h.state); err != nil {
			return nil, fmt.Errorf("invalid listening state: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	// A crash after active-state persistence but before queue persistence is repaired.
	if h.state.Event.ID != "" {
		if err = atomicJSON(h.eventPath(h.state.Event.ID), h.state.Event); err != nil {
			return nil, err
		}
	}
	// Never credit time across process restarts, sleep, or unavailable observations.
	h.state.Playing = false
	return h, nil
}
func (h *listeningHistory) eventPath(id string) string {
	return filepath.Join(h.directory, "outbox", id+".json")
}
func (h *listeningHistory) Observe(p playback, now time.Time) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := h.state
	stamp := now.UnixMilli()
	elapsed := stamp - s.At
	repeated := p.Playing && s.Playing && p.TrackKey == s.Key && s.Position >= s.Event.DurationMS-10000 && p.PositionMS < 10000 && p.PositionMS+1000 < s.Position
	if p.Playing && (s.Event.ID == "" || p.TrackKey != s.Key || repeated || stamp-s.Event.UpdatedAt > 30*time.Minute.Milliseconds()) {
		id := make([]byte, 16)
		if _, err := rand.Read(id); err != nil {
			return err
		}
		s = listeningState{Key: p.TrackKey, Event: listeningEvent{ID: hex.EncodeToString(id), Title: p.Title, Artist: p.Artist, Album: p.Album, DurationMS: p.DurationMS, StartedAt: stamp, Days: map[string]int64{}}}
	}
	if s.Event.ID == "" || (!p.Playing && !s.Playing) {
		return nil
	}
	delta := p.PositionMS - s.Position
	if p.Playing && s.Playing && p.TrackKey == s.Key && elapsed > 0 && elapsed <= 15000 && delta > 0 && delta <= elapsed+1500 {
		credit := delta
		if credit > elapsed {
			credit = elapsed
		}
		s.Event.ListenedMS += credit
		// Store UTC day buckets; later uploads retain the original listening dates.
		start := stamp - credit
		for start < stamp {
			day := time.UnixMilli(start).UTC()
			boundary := time.Date(day.Year(), day.Month(), day.Day()+1, 0, 0, 0, 0, time.UTC).UnixMilli()
			end := stamp
			if boundary < end {
				end = boundary
			}
			s.Event.Days[day.Format("2006-01-02")] += end - start
			start = end
		}
	}
	s.At = stamp
	s.Position = p.PositionMS
	s.Playing = p.Playing
	s.Event.UpdatedAt = stamp
	if err := atomicJSON(filepath.Join(h.directory, "active.json"), s); err != nil {
		return err
	}
	h.state = s
	return atomicJSON(h.eventPath(s.Event.ID), s.Event)
}
func (h *listeningHistory) sync(ctx context.Context, servers []string, token string) error {
	entries, err := os.ReadDir(filepath.Join(h.directory, "outbox"))
	if err != nil {
		return err
	}
	events := []listeningEvent{}
	h.mu.Lock()
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, e := os.ReadFile(filepath.Join(h.directory, "outbox", entry.Name()))
		if e != nil {
			h.mu.Unlock()
			return e
		}
		var event listeningEvent
		if e = json.Unmarshal(data, &event); e != nil {
			h.mu.Unlock()
			return e
		}
		events = append(events, event)
		if len(events) == 100 {
			break
		}
	}
	h.mu.Unlock()
	if len(events) == 0 {
		return nil
	}
	body, err := json.Marshal(map[string]any{"events": events})
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	for _, server := range servers {
		request, err := http.NewRequestWithContext(ctx, "POST", server+"/v1/listens", bytes.NewReader(body))
		if err != nil {
			return err
		}
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Content-Type", "application/json")
		response, err := client.Do(request)
		if err != nil {
			continue
		}
		var ack struct {
			OK bool `json:"ok"`
		}
		decodeErr := json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&ack)
		response.Body.Close()
		if response.StatusCode != 200 || decodeErr != nil || !ack.OK {
			continue
		}
		h.mu.Lock()
		for _, sent := range events {
			path := h.eventPath(sent.ID)
			data, e := os.ReadFile(path)
			if e != nil {
				continue
			}
			var current listeningEvent
			if json.Unmarshal(data, &current) == nil && current.UpdatedAt == sent.UpdatedAt && current.ListenedMS == sent.ListenedMS {
				if e = os.Remove(path); e != nil {
					h.mu.Unlock()
					return e
				}
			}
		}
		h.mu.Unlock()
		return nil
	}
	return fmt.Errorf("listening history sync unavailable; queue retained")
}
