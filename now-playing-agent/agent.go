package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"
)

type agent struct {
	history         *listeningHistory
	music           musicSource
	api             publisher
	includeArtwork  bool
	trackKey        string
	artworkKey      string
	artworkDone     bool
	publicationSet  bool
	playing         bool
	observedPlaying bool
	heartbeat       time.Duration
	now             func() time.Time
	lastPublished   playback
	lastPublishedAt time.Time
	lastArtworkKey  string
}

func (agent *agent) clock() time.Time {
	if agent.now != nil {
		return agent.now()
	}
	return time.Now()
}

func (agent *agent) heartbeatInterval() time.Duration {
	if agent.heartbeat > 0 {
		return agent.heartbeat
	}
	return 5 * time.Second
}

func (agent *agent) nextPollDelay(idle, playing time.Duration) time.Duration {
	if !agent.observedPlaying {
		return idle
	}
	// Wake at the heartbeat deadline instead of rounding five seconds up to six.
	remaining := agent.heartbeatInterval() - agent.clock().Sub(agent.lastPublishedAt)
	if remaining > 0 && remaining < playing {
		return remaining
	}
	return playing
}

func (agent *agent) shouldPublish(current playback, observedAt time.Time) bool {
	last := agent.lastPublished
	if !agent.publicationSet || !agent.playing || current.TrackKey != last.TrackKey ||
		current.Title != last.Title || current.Artist != last.Artist || current.Album != last.Album ||
		current.DurationMS != last.DurationMS || agent.artworkKey != agent.lastArtworkKey {
		return true
	}
	elapsed := observedAt.Sub(agent.lastPublishedAt)
	if elapsed >= agent.heartbeatInterval() {
		return true
	}
	expected := last.PositionMS + elapsed.Milliseconds()
	if expected > current.DurationMS {
		expected = current.DurationMS
	}
	// Ignore small Apple Music sampling differences; larger jumps are seeks.
	difference := current.PositionMS - expected
	return difference > 1000 || difference < -1000
}

func (agent *agent) sync(ctx context.Context) error {
	current, err := agent.music.NowPlaying(ctx)
	if err != nil {
		return err
	}
	observedAt := agent.clock()
	if agent.history != nil {
		if err := agent.history.Observe(current, observedAt); err != nil {
			log.Printf("listening history persistence failed: %v", err)
		}
	}
	agent.observedPlaying = current.Playing
	if !current.Playing {
		if agent.publicationSet && !agent.playing {
			return nil
		}
		if err := agent.api.Clear(ctx); err != nil {
			return fmt.Errorf("clear playback: %w", err)
		}
		agent.trackKey = ""
		agent.artworkKey = ""
		agent.artworkDone = false
		agent.publicationSet = true
		agent.playing = false
		log.Print("cleared now-playing state")
		return nil
	}

	if current.TrackKey != agent.trackKey {
		agent.trackKey = current.TrackKey
		agent.artworkKey = ""
		agent.artworkDone = !agent.includeArtwork
	}

	// Publish playback before reading/converting artwork, which can be slow.
	if agent.shouldPublish(current, observedAt) {
		if err := agent.api.Publish(ctx, payloadFor(current, agent.artworkKey)); err != nil {
			return fmt.Errorf("publish playback: %w", err)
		}
		agent.publicationSet = true
		agent.playing = true
		agent.lastPublished = current
		agent.lastPublishedAt = observedAt
		agent.lastArtworkKey = agent.artworkKey
		log.Printf("published %q by %s at %s", current.Title, current.Artist, formatPosition(current.PositionMS))
	}

	if !agent.artworkDone {
		value, artworkErr := agent.music.Artwork(ctx)
		if artworkErr != nil {
			log.Printf("artwork unavailable, will retry: %v", artworkErr)
		} else if value == nil {
			agent.artworkDone = true
		} else {
			confirmation, confirmationErr := agent.music.NowPlaying(ctx)
			if confirmationErr != nil {
				log.Printf("could not confirm artwork track, will retry: %v", confirmationErr)
			} else if !confirmation.Playing || confirmation.TrackKey != current.TrackKey {
				agent.trackKey = ""
				log.Print("track changed while reading artwork, retrying on next poll")
				return nil
			} else {
				key, uploadErr := agent.api.UploadArtwork(ctx, *value)
				if uploadErr != nil {
					var response *responseError
					if errors.As(uploadErr, &response) && response.StatusCode == http.StatusTooManyRequests {
						log.Print("artwork rate limited, will retry on next poll")
					} else {
						log.Printf("artwork upload failed, will retry: %v", uploadErr)
					}
				} else {
					agent.artworkKey = key
					agent.artworkDone = true
				}
			}
		}
	}

	return nil
}

func formatPosition(milliseconds int64) string {
	totalSeconds := milliseconds / 1000
	return fmt.Sprintf("%d:%02d", totalSeconds/60, totalSeconds%60)
}
