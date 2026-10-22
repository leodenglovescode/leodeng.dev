package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type publisher interface {
	Publish(context.Context, publishPayload) error
	Clear(context.Context) error
	UploadArtwork(context.Context, artwork) (string, error)
}

type apiClient struct {
	baseURL string
	token   string
	client  *http.Client
}

type responseError struct {
	StatusCode int
	Message    string
}

func (err *responseError) Error() string {
	if err.Message == "" {
		return fmt.Sprintf("server returned HTTP %d", err.StatusCode)
	}
	return fmt.Sprintf("server returned HTTP %d: %s", err.StatusCode, err.Message)
}

func newAPIClient(server, token string) (*apiClient, error) {
	server = strings.TrimRight(strings.TrimSpace(server), "/")
	parsed, err := url.Parse(server)
	if err != nil || parsed.Host == "" {
		return nil, fmt.Errorf("invalid server URL")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname())) {
		return nil, fmt.Errorf("server must use HTTPS unless it is localhost")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("server URL cannot contain a query or fragment")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return nil, fmt.Errorf("server URL cannot contain a path")
	}
	if strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("token is empty")
	}
	return &apiClient{
		baseURL: server,
		token:   strings.TrimSpace(token),
		client: &http.Client{
			Timeout: 12 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func (client *apiClient) Publish(ctx context.Context, payload publishPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode playback: %w", err)
	}
	request, err := client.request(ctx, http.MethodPost, "/api/internal/now-playing", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.ContentLength = int64(len(body))
	return client.send(request, http.StatusOK)
}

func (client *apiClient) Clear(ctx context.Context) error {
	request, err := client.request(ctx, http.MethodDelete, "/api/internal/now-playing", nil)
	if err != nil {
		return err
	}
	return client.send(request, http.StatusNoContent)
}

func (client *apiClient) UploadArtwork(ctx context.Context, value artwork) (string, error) {
	digest := sha256.Sum256(value.Bytes)
	hash := hex.EncodeToString(digest[:])
	request, err := client.request(
		ctx,
		http.MethodPut,
		"/api/internal/now-playing/artwork/"+hash,
		bytes.NewReader(value.Bytes),
	)
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", value.ContentType)
	request.ContentLength = int64(len(value.Bytes))

	response, err := client.client.Do(request)
	if err != nil {
		return "", fmt.Errorf("upload artwork: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated {
		return "", decodeResponseError(response)
	}
	var result struct {
		ArtworkKey string `json:"artworkKey"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&result); err != nil {
		return "", fmt.Errorf("decode artwork response: %w", err)
	}
	if result.ArtworkKey == "" {
		return "", fmt.Errorf("artwork response did not include a key")
	}
	return result.ArtworkKey, nil
}

func (client *apiClient) request(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, method, client.baseURL+path, body)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+client.token)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "leodeng-now-playing-agent/"+version)
	return request, nil
}

func (client *apiClient) send(request *http.Request, wantedStatus int) error {
	response, err := client.client.Do(request)
	if err != nil {
		return fmt.Errorf("send %s: %w", request.Method, err)
	}
	defer response.Body.Close()
	if response.StatusCode != wantedStatus {
		return decodeResponseError(response)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 8192))
	return nil
}

func decodeResponseError(response *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
	var payload struct {
		Error string `json:"error"`
	}
	message := strings.TrimSpace(string(body))
	if json.Unmarshal(body, &payload) == nil && payload.Error != "" {
		message = payload.Error
	}
	return &responseError{StatusCode: response.StatusCode, Message: message}
}
