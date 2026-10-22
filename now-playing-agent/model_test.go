package main

import (
	"strings"
	"testing"
)

func TestNormalizePlayback(t *testing.T) {
	value, err := normalizePlayback(playback{
		Playing:      true,
		Title:        " Dreams ",
		Artist:       " Fleetwood Mac ",
		Album:        " Rumours ",
		DurationMS:   257800,
		PositionMS:   42100,
		PersistentID: "ABC123",
	})
	if err != nil {
		t.Fatal(err)
	}
	if value.TrackKey != "music:persistent:ABC123" {
		t.Fatalf("unexpected track key: %s", value.TrackKey)
	}
	if value.Title != "Dreams" || value.Artist != "Fleetwood Mac" || value.Album != "Rumours" {
		t.Fatalf("metadata was not normalized: %#v", value)
	}
}

func TestNormalizePlaybackFallbackKeyIsStable(t *testing.T) {
	input := playback{Playing: true, Title: "Song", Artist: "Artist", DurationMS: 1000}
	first, err := normalizePlayback(input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := normalizePlayback(input)
	if err != nil {
		t.Fatal(err)
	}
	if first.TrackKey != second.TrackKey || !strings.HasPrefix(first.TrackKey, "music:metadata:") {
		t.Fatalf("fallback key is not stable: %q / %q", first.TrackKey, second.TrackKey)
	}
}

func TestDetectArtworkType(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{name: "jpeg", data: []byte{0xff, 0xd8, 0xff, 0x00}, want: "image/jpeg"},
		{name: "png", data: []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, want: "image/png"},
		{name: "webp", data: []byte("RIFFxxxxWEBP"), want: "image/webp"},
		{name: "unknown", data: []byte("nope"), want: ""},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := detectArtworkType(test.data); got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}
