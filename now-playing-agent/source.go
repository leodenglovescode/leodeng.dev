package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var sourcePattern = regexp.MustCompile(`^mac:[a-zA-Z0-9._:-]{1,100}$`)
var devicePattern = regexp.MustCompile(`^[a-zA-Z0-9._:-]{1,128}$`)

func localSourceID(explicit string) (string, error) {
	if explicit != "" {
		if !sourcePattern.MatchString(explicit) {
			return "", fmt.Errorf("invalid Mac source ID")
		}
		return explicit, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	directory := filepath.Join(home, "Library", "Application Support", "dev.leodeng.now-playing-agent")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	path := filepath.Join(directory, "source-id")
	if data, err := os.ReadFile(path); err == nil {
		id := strings.TrimSpace(string(data))
		if !sourcePattern.MatchString(id) {
			return "", fmt.Errorf("invalid saved Mac source ID")
		}
		return id, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	id := "mac:" + hex.EncodeToString(bytes)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if os.IsExist(err) {
		return localSourceID("")
	}
	if err != nil {
		return "", err
	}
	_, writeErr := file.WriteString(id + "\n")
	closeErr := file.Close()
	if writeErr != nil {
		return "", writeErr
	}
	return id, closeErr
}

func (client *apiClient) configureSource(config configuration) error {
	id, err := localSourceID(config.sourceID)
	if err != nil {
		return err
	}
	device := config.deviceID
	if device == "" {
		device = id
	}
	label := strings.TrimSpace(config.deviceName)
	if !devicePattern.MatchString(device) || label == "" || len(label) > 64 || strings.ContainsAny(label, "\r\n\t") {
		return fmt.Errorf("invalid device identity or label")
	}
	client.sourceID, client.deviceID, client.sourceLabel = id, device, label
	return nil
}
