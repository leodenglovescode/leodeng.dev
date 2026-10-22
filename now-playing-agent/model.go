package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"strings"
)

const maximumArtworkBytes = 2 * 1024 * 1024

type playback struct {
	Playing      bool   `json:"playing"`
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	Album        string `json:"album"`
	DurationMS   int64  `json:"durationMs"`
	PositionMS   int64  `json:"positionMs"`
	PersistentID string `json:"persistentID"`
	DatabaseID   string `json:"databaseID"`
	TrackKey     string `json:"-"`
}

type publishPayload struct {
	TrackKey   string  `json:"trackKey"`
	Title      string  `json:"title"`
	Artist     string  `json:"artist"`
	Album      *string `json:"album"`
	DurationMS int64   `json:"durationMs"`
	PositionMS int64   `json:"positionMs"`
	ArtworkKey *string `json:"artworkKey"`
}

type artwork struct {
	Bytes       []byte
	ContentType string
}

func normalizePlayback(value playback) (playback, error) {
	if !value.Playing {
		return playback{Playing: false}, nil
	}

	value.Title = strings.TrimSpace(value.Title)
	value.Artist = strings.TrimSpace(value.Artist)
	value.Album = strings.TrimSpace(value.Album)
	value.PersistentID = cleanMusicID(value.PersistentID)
	value.DatabaseID = cleanMusicID(value.DatabaseID)
	if value.Title == "" {
		return playback{}, fmt.Errorf("Music returned a playing track without a title")
	}
	if value.Artist == "" {
		value.Artist = "Unknown Artist"
	}
	if value.DurationMS <= 0 || value.DurationMS > 24*60*60*1000 {
		return playback{}, fmt.Errorf("Music returned an invalid duration")
	}
	if value.PositionMS < 0 {
		value.PositionMS = 0
	}
	if value.PositionMS > value.DurationMS {
		value.PositionMS = value.DurationMS
	}

	switch {
	case value.PersistentID != "":
		value.TrackKey = "music:persistent:" + value.PersistentID
	case value.DatabaseID != "":
		value.TrackKey = "music:database:" + value.DatabaseID
	default:
		fallback := fmt.Sprintf("%s\x00%s\x00%s\x00%d", value.Title, value.Artist, value.Album, value.DurationMS)
		digest := sha256.Sum256([]byte(fallback))
		value.TrackKey = "music:metadata:" + hex.EncodeToString(digest[:])
	}
	return value, nil
}

func cleanMusicID(value string) string {
	value = strings.TrimSpace(value)
	if value == "missing value" || value == "null" || value == "undefined" {
		return ""
	}
	return value
}

func secondsToMilliseconds(value float64) int64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return int64(math.Round(value * 1000))
}

func payloadFor(value playback, artworkKey string) publishPayload {
	var album *string
	if value.Album != "" {
		albumValue := value.Album
		album = &albumValue
	}
	var art *string
	if artworkKey != "" {
		artValue := artworkKey
		art = &artValue
	}
	return publishPayload{
		TrackKey:   value.TrackKey,
		Title:      value.Title,
		Artist:     value.Artist,
		Album:      album,
		DurationMS: value.DurationMS,
		PositionMS: value.PositionMS,
		ArtworkKey: art,
	}
}
