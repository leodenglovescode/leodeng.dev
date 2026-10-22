package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientPublishesClearsAndUploadsArtwork(t *testing.T) {
	const token = "0123456789abcdef0123456789abcdef"
	artBytes := []byte{0xff, 0xd8, 0xff, 0x01}
	digest := sha256.Sum256(artBytes)
	artHash := hex.EncodeToString(digest[:])

	var publishCount int
	var clearCount int
	var uploadCount int
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+token {
			http.Error(response, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case request.Method == http.MethodPost && request.URL.Path == "/api/internal/now-playing":
			publishCount++
			var payload publishPayload
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Errorf("decode publish: %v", err)
			}
			if payload.Title != "Dreams" {
				t.Errorf("unexpected title: %q", payload.Title)
			}
			response.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(response, `{"ok":true}`)
		case request.Method == http.MethodDelete && request.URL.Path == "/api/internal/now-playing":
			clearCount++
			response.WriteHeader(http.StatusNoContent)
		case request.Method == http.MethodPut && request.URL.Path == "/api/internal/now-playing/artwork/"+artHash:
			uploadCount++
			if request.Header.Get("Content-Type") != "image/jpeg" {
				t.Errorf("unexpected content type: %q", request.Header.Get("Content-Type"))
			}
			response.Header().Set("Content-Type", "application/json")
			response.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(response, `{"artworkKey":"now-playing/artwork/`+artHash+`.jpg"}`)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client, err := newAPIClient(server.URL, token)
	if err != nil {
		t.Fatal(err)
	}
	client.client = server.Client()
	if err := client.Publish(context.Background(), publishPayload{TrackKey: "key", Title: "Dreams", Artist: "Fleetwood Mac", DurationMS: 1000}); err != nil {
		t.Fatal(err)
	}
	key, err := client.UploadArtwork(context.Background(), artwork{Bytes: artBytes, ContentType: "image/jpeg"})
	if err != nil {
		t.Fatal(err)
	}
	if key != "now-playing/artwork/"+artHash+".jpg" {
		t.Fatalf("unexpected artwork key: %q", key)
	}
	if err := client.Clear(context.Background()); err != nil {
		t.Fatal(err)
	}
	if publishCount != 1 || uploadCount != 1 || clearCount != 1 {
		t.Fatalf("unexpected request counts: publish=%d upload=%d clear=%d", publishCount, uploadCount, clearCount)
	}
}

func TestClientRefusesPlainHTTPOutsideLoopback(t *testing.T) {
	if _, err := newAPIClient("http://example.com", "0123456789abcdef0123456789abcdef"); err == nil {
		t.Fatal("expected insecure server URL to be rejected")
	}
	if _, err := newAPIClient("https://example.com/prefix", "0123456789abcdef0123456789abcdef"); err == nil {
		t.Fatal("expected a server URL with a path to be rejected")
	}
}
