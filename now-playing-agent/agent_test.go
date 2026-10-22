package main

import (
	"context"
	"testing"
	"time"
)

type fakeMusic struct {
	current playback
	art     *artwork
}

func (music *fakeMusic) NowPlaying(context.Context) (playback, error) {
	return music.current, nil
}

func (music *fakeMusic) Artwork(context.Context) (*artwork, error) {
	return music.art, nil
}

type fakePublisher struct {
	published []publishPayload
	clears    int
	uploads   int
}

func (publisher *fakePublisher) Publish(_ context.Context, payload publishPayload) error {
	publisher.published = append(publisher.published, payload)
	return nil
}

func (publisher *fakePublisher) Clear(context.Context) error {
	publisher.clears++
	return nil
}

func (publisher *fakePublisher) UploadArtwork(context.Context, artwork) (string, error) {
	publisher.uploads++
	return "now-playing/artwork/abc.jpg", nil
}

func TestAgentPublishesArtworkOnceAndClearsOnce(t *testing.T) {
	music := &fakeMusic{
		current: playback{
			Playing: true, TrackKey: "track", Title: "Dreams", Artist: "Fleetwood Mac",
			Album: "Rumours", DurationMS: 257800, PositionMS: 42100,
		},
		art: &artwork{Bytes: []byte("image"), ContentType: "image/jpeg"},
	}
	api := &fakePublisher{}
	worker := &agent{music: music, api: api, includeArtwork: true}

	if err := worker.sync(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := worker.sync(context.Background()); err != nil {
		t.Fatal(err)
	}
	if api.uploads != 1 || len(api.published) != 2 {
		t.Fatalf("unexpected playing calls: uploads=%d publishes=%d", api.uploads, len(api.published))
	}
	if api.published[0].ArtworkKey != nil || api.published[1].ArtworkKey == nil {
		t.Fatal("artwork key was not included")
	}

	music.current = playback{Playing: false}
	if err := worker.sync(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := worker.sync(context.Background()); err != nil {
		t.Fatal(err)
	}
	if api.clears != 1 {
		t.Fatalf("expected one clear, got %d", api.clears)
	}
}

func TestAdaptiveChecksPublishChangesAndFiveSecondHeartbeats(t *testing.T) {
	now := time.Unix(1800000000, 0)
	music := &fakeMusic{current: playback{Playing: true, TrackKey: "one", Title: "Song", Artist: "Artist", DurationMS: 60000}}
	api := &fakePublisher{}
	worker := &agent{music: music, api: api, now: func() time.Time { return now }}
	sync := func() {
		t.Helper()
		if err := worker.sync(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	sync()
	if delay := worker.nextPollDelay(5*time.Second, 2*time.Second); delay != 2*time.Second {
		t.Fatal(delay)
	}
	for _, elapsed := range []int64{2, 4} {
		now = time.Unix(1800000000+elapsed, 0)
		music.current.PositionMS = elapsed * 1000
		sync()
	}
	if len(api.published) != 1 {
		t.Fatal("ordinary checks published redundant metadata")
	}
	if delay := worker.nextPollDelay(5*time.Second, 2*time.Second); delay != time.Second {
		t.Fatal("heartbeat deadline was rounded up", delay)
	}
	now = now.Add(time.Second)
	music.current.PositionMS = 5000
	sync()
	if len(api.published) != 2 {
		t.Fatal("missing five-second heartbeat")
	}
	now = now.Add(2 * time.Second)
	music.current.PositionMS = 30000
	sync()
	if len(api.published) != 3 {
		t.Fatal("forward seek was not published")
	}
	now = now.Add(2 * time.Second)
	music.current.PositionMS = 1000
	sync()
	if len(api.published) != 4 {
		t.Fatal("backward seek was not published")
	}
	now = now.Add(2 * time.Second)
	music.current.TrackKey = "two"
	sync()
	if len(api.published) != 5 {
		t.Fatal("new track was not published")
	}
	music.current.Playing = false
	sync()
	sync()
	if api.clears != 1 {
		t.Fatal("pause must clear exactly once")
	}
	if delay := worker.nextPollDelay(5*time.Second, 2*time.Second); delay != 5*time.Second {
		t.Fatal("idle interval", delay)
	}
	music.current.Playing = true
	sync()
	if len(api.published) != 6 {
		t.Fatal("resume must publish immediately")
	}
}

func TestAdaptiveConfiguration(t *testing.T) {
	config, err := parseConfiguration("test", nil)
	if err != nil {
		t.Fatal(err)
	}
	if config.interval != 5*time.Second || config.playingInterval != 2*time.Second || config.heartbeat != 5*time.Second {
		t.Fatalf("wrong defaults: %+v", config)
	}
	if _, err := parseConfiguration("test", []string{"--playing-interval=1s"}); err == nil {
		t.Fatal("accepted too-fast polling")
	}
	if _, err := parseConfiguration("test", []string{"--heartbeat=1s"}); err == nil {
		t.Fatal("accepted too-fast heartbeat")
	}
}
