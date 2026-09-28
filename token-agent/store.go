package main

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const maxLineBytes = 1024 * 1024

func ensurePrivateDir(path string) error {
	return os.MkdirAll(path, 0o700)
}

func loadEvents(path string) ([]UsageEvent, map[string]string, error) {
	events := make([]UsageEvent, 0)
	digests := make(map[string]string)
	err := scanJSONLines(path, func(line []byte) error {
		var event UsageEvent
		if err := json.Unmarshal(line, &event); err != nil {
			return err
		}
		if err := event.validate(); err != nil {
			return err
		}
		digest := eventDigest(event)
		if previous, ok := digests[event.EventKey]; ok && previous != digest {
			return fmt.Errorf("conflicting local event %s", event.EventKey)
		}
		if _, ok := digests[event.EventKey]; !ok {
			events = append(events, event)
			digests[event.EventKey] = digest
		}
		return nil
	})
	return events, digests, err
}

func loadStoredEvents(path string) (map[string]string, error) {
	digests := make(map[string]string)
	err := scanJSONLines(path, func(line []byte) error {
		var record storedEvent
		if err := json.Unmarshal(line, &record); err != nil {
			return err
		}
		if err := record.Event.validate(); err != nil {
			return err
		}
		digest := eventDigest(record.Event)
		if previous, ok := digests[record.Event.EventKey]; ok && previous != digest {
			return fmt.Errorf("conflicting hub event %s", record.Event.EventKey)
		}
		digests[record.Event.EventKey] = digest
		return nil
	})
	return digests, err
}

func loadKeys(path string) (map[string]struct{}, error) {
	keys := make(map[string]struct{})
	err := scanJSONLines(path, func(line []byte) error {
		key := strings.TrimSpace(string(line))
		if !keyPattern.MatchString(key) {
			return errors.New("invalid acknowledgement key")
		}
		keys[key] = struct{}{}
		return nil
	})
	return keys, err
}

func scanJSONLines(path string, visit func([]byte) error) error {
	handle, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer handle.Close()

	scanner := bufio.NewScanner(handle)
	scanner.Buffer(make([]byte, 64*1024), maxLineBytes)
	line := 0
	for scanner.Scan() {
		line++
		if len(strings.TrimSpace(scanner.Text())) == 0 {
			continue
		}
		if err := visit(scanner.Bytes()); err != nil {
			return fmt.Errorf("%s line %d: %w", path, line, err)
		}
	}
	return scanner.Err()
}

func appendEvents(path string, events []UsageEvent) error {
	return appendJSONLines(path, len(events), func(index int) any { return events[index] })
}

func appendStoredEvents(path string, events []storedEvent) error {
	return appendJSONLines(path, len(events), func(index int) any { return events[index] })
}

func appendJSONLines(path string, count int, value func(int) any) error {
	if count == 0 {
		return nil
	}
	if err := ensurePrivateDir(filepath.Dir(path)); err != nil {
		return err
	}
	handle, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(handle)
	for i := 0; i < count; i++ {
		if err := encoder.Encode(value(i)); err != nil {
			handle.Close()
			return err
		}
	}
	if err := handle.Sync(); err != nil {
		handle.Close()
		return err
	}
	return handle.Close()
}

func appendKeys(path string, events []UsageEvent) error {
	if len(events) == 0 {
		return nil
	}
	if err := ensurePrivateDir(filepath.Dir(path)); err != nil {
		return err
	}
	handle, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	for _, event := range events {
		if _, err := fmt.Fprintln(handle, event.EventKey); err != nil {
			handle.Close()
			return err
		}
	}
	if err := handle.Sync(); err != nil {
		handle.Close()
		return err
	}
	return handle.Close()
}

func loadOrCreateDeviceID(stateDir string) (string, error) {
	path := filepath.Join(stateDir, "device-id")
	data, err := os.ReadFile(path)
	if err == nil {
		id := strings.TrimSpace(string(data))
		if validDeviceID(id) {
			return id, nil
		}
		return "", errors.New("invalid device ID in state directory")
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err := ensurePrivateDir(stateDir); err != nil {
		return "", err
	}
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	id := hex.EncodeToString(random)
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, []byte(id+"\n"), 0o600); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, path); err != nil {
		return "", err
	}
	return id, nil
}

func validDeviceID(value string) bool {
	if len(value) != 32 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
