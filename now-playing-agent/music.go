package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const metadataScript = `
function safeString(read) {
  try {
    var value = read();
    if (value === null || value === undefined) return "";
    return String(value);
  } catch (_) {
    return "";
  }
}

function run() {
  var music = Application("Music");
  try {
    if (!music.running()) return JSON.stringify({ playing: false });
    if (String(music.playerState()) !== "playing") {
      return JSON.stringify({ playing: false });
    }

    var track = music.currentTrack();
    return JSON.stringify({
      playing: true,
      title: safeString(function () { return track.name(); }),
      artist: safeString(function () { return track.artist(); }),
      album: safeString(function () { return track.album(); }),
      durationSeconds: Number(track.duration()),
      positionSeconds: Number(music.playerPosition()),
      persistentID: safeString(function () { return track.persistentID(); }),
      databaseID: safeString(function () { return track.databaseID(); })
    });
  } catch (error) {
    throw new Error("Could not read Apple Music: " + error.message);
  }
}
`

const artworkScript = `
on run
  set outputPath to system attribute "NOW_PLAYING_ARTWORK_PATH"
  tell application "Music"
    if player state is not playing then return "not-playing"
    set artworkList to artworks of current track
    if (count of artworkList) is 0 then return "none"
    set artworkData to data of item 1 of artworkList
  end tell

  set outputFile to open for access (POSIX file outputPath) with write permission
  try
    set eof outputFile to 0
    write artworkData to outputFile starting at 0
    close access outputFile
  on error errorText number errorNumber
    try
      close access outputFile
    end try
    error errorText number errorNumber
  end try
  return "ok"
end run
`

type musicSource interface {
	NowPlaying(context.Context) (playback, error)
	Artwork(context.Context) (*artwork, error)
}

type appleMusic struct {
	osascriptPath string
	sipsPath      string
}

func newAppleMusic() *appleMusic {
	return &appleMusic{
		osascriptPath: "/usr/bin/osascript",
		sipsPath:      "/usr/bin/sips",
	}
}

func (music *appleMusic) NowPlaying(parent context.Context) (playback, error) {
	ctx, cancel := context.WithTimeout(parent, 6*time.Second)
	defer cancel()

	command := exec.CommandContext(ctx, music.osascriptPath, "-l", "JavaScript", "-e", metadataScript)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return playback{}, fmt.Errorf("timed out reading Apple Music")
		}
		return playback{}, commandError("read Apple Music", err, stderr.String())
	}

	var raw struct {
		Playing         bool    `json:"playing"`
		Title           string  `json:"title"`
		Artist          string  `json:"artist"`
		Album           string  `json:"album"`
		DurationSeconds float64 `json:"durationSeconds"`
		PositionSeconds float64 `json:"positionSeconds"`
		PersistentID    string  `json:"persistentID"`
		DatabaseID      string  `json:"databaseID"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &raw); err != nil {
		return playback{}, fmt.Errorf("decode Apple Music metadata: %w", err)
	}
	return normalizePlayback(playback{
		Playing:      raw.Playing,
		Title:        raw.Title,
		Artist:       raw.Artist,
		Album:        raw.Album,
		DurationMS:   secondsToMilliseconds(raw.DurationSeconds),
		PositionMS:   secondsToMilliseconds(raw.PositionSeconds),
		PersistentID: raw.PersistentID,
		DatabaseID:   raw.DatabaseID,
	})
}

func (music *appleMusic) Artwork(parent context.Context) (*artwork, error) {
	temporary, err := os.MkdirTemp("", "now-playing-artwork-")
	if err != nil {
		return nil, fmt.Errorf("create artwork workspace: %w", err)
	}
	defer os.RemoveAll(temporary)

	rawPath := filepath.Join(temporary, "artwork.raw")
	ctx, cancel := context.WithTimeout(parent, 12*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, music.osascriptPath, "-e", artworkScript)
	command.Env = append(os.Environ(), "NOW_PLAYING_ARTWORK_PATH="+rawPath)
	output, err := command.CombinedOutput()
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("timed out reading Apple Music artwork")
		}
		return nil, commandError("read Apple Music artwork", err, string(output))
	}
	switch strings.TrimSpace(string(output)) {
	case "none", "not-playing":
		return nil, nil
	case "ok":
	default:
		return nil, fmt.Errorf("unexpected artwork response: %q", strings.TrimSpace(string(output)))
	}

	if info, err := os.Stat(rawPath); err != nil {
		return nil, fmt.Errorf("inspect Apple Music artwork: %w", err)
	} else if info.Size() < 1 || info.Size() > 20*1024*1024 {
		return nil, fmt.Errorf("Apple Music artwork has an invalid size")
	}

	for _, attempt := range []struct {
		size    string
		quality string
	}{
		{size: "600", quality: "85"},
		{size: "400", quality: "65"},
	} {
		convertedPath := filepath.Join(temporary, "artwork-"+attempt.size+".jpg")
		convert := exec.CommandContext(
			ctx,
			music.sipsPath,
			"-s", "format", "jpeg",
			"-s", "formatOptions", attempt.quality,
			"-Z", attempt.size,
			rawPath,
			"--out", convertedPath,
		)
		if conversionOutput, conversionErr := convert.CombinedOutput(); conversionErr == nil {
			data, readErr := readArtworkFile(convertedPath)
			if readErr == nil {
				return &artwork{Bytes: data, ContentType: "image/jpeg"}, nil
			}
		} else if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("timed out converting Apple Music artwork")
		} else {
			_ = conversionOutput
		}
	}

	raw, err := readArtworkFile(rawPath)
	if err != nil {
		return nil, fmt.Errorf("convert Apple Music artwork: %w", err)
	}
	contentType := detectArtworkType(raw)
	if contentType == "" {
		return nil, fmt.Errorf("Apple Music returned an unsupported artwork format")
	}
	return &artwork{Bytes: raw, ContentType: contentType}, nil
}

func readArtworkFile(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() < 1 || info.Size() > maximumArtworkBytes {
		return nil, fmt.Errorf("artwork is larger than %d bytes", maximumArtworkBytes)
	}
	return os.ReadFile(path)
}

func detectArtworkType(data []byte) string {
	switch {
	case len(data) >= 3 && bytes.Equal(data[:3], []byte{0xff, 0xd8, 0xff}):
		return "image/jpeg"
	case len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}):
		return "image/png"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp"
	default:
		return ""
	}
}

func commandError(action string, err error, output string) error {
	message := strings.TrimSpace(output)
	if message == "" {
		return fmt.Errorf("%s: %w", action, err)
	}
	return fmt.Errorf("%s: %w: %s", action, err, message)
}
