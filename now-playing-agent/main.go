package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

var version = "dev"

type configuration struct {
	server           string
	tokenFile        string
	interval         time.Duration
	playingInterval  time.Duration
	heartbeat        time.Duration
	includeArtwork   bool
	historyDirectory string
	historyServers   string
	historyTokenFile string
}

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.LUTC)
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	var err error
	switch os.Args[1] {
	case "run":
		err = run(os.Args[2:], false)
	case "once":
		err = run(os.Args[2:], true)
	case "clear":
		err = clear(os.Args[2:])
	case "status":
		err = status(os.Args[2:])
	case "version", "--version", "-version":
		fmt.Println(version)
	case "help", "--help", "-h":
		usage()
	default:
		usage()
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `Usage: now-playing-agent <command> [options]

Commands:
  run      watch Apple Music and publish playback changes
  once     publish or clear once, then exit
  clear    clear the public now-playing state
  status   show local Apple Music state and configuration
  version  print the build version`)
}

func parseConfiguration(name string, args []string) (configuration, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return configuration{}, fmt.Errorf("find home directory: %w", err)
	}
	stateDirectory := filepath.Join(home, "Library", "Application Support", "dev.leodeng.now-playing-agent")
	defaults := configuration{
		server:           environmentOr("NOW_PLAYING_SERVER", "https://leodeng.dev"),
		tokenFile:        filepath.Join(stateDirectory, "token"),
		interval:         5 * time.Second,
		playingInterval:  2 * time.Second,
		heartbeat:        5 * time.Second,
		includeArtwork:   false,
		historyDirectory: filepath.Join(stateDirectory, "listening-history"),
		historyServers:   environmentOr("LISTENING_SERVERS", "http://100.64.0.2:8791,http://192.168.3.61:8791"),
		historyTokenFile: filepath.Join(stateDirectory, "history-token"),
	}

	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	flags.StringVar(&defaults.server, "server", defaults.server, "website origin")
	flags.StringVar(&defaults.tokenFile, "token-file", defaults.tokenFile, "bearer-token file")
	flags.DurationVar(&defaults.interval, "interval", defaults.interval, "idle poll interval")
	flags.DurationVar(&defaults.playingInterval, "playing-interval", defaults.playingInterval, "poll interval while playing")
	flags.DurationVar(&defaults.heartbeat, "heartbeat", defaults.heartbeat, "metadata heartbeat interval while playing")
	flags.StringVar(&defaults.historyServers, "history-servers", defaults.historyServers, "comma-separated SuperServer origins; empty disables history")
	flags.StringVar(&defaults.historyDirectory, "history-directory", defaults.historyDirectory, "durable local listening queue")
	flags.StringVar(&defaults.historyTokenFile, "history-token-file", defaults.historyTokenFile, "separate SuperServer history token")
	flags.BoolVar(&defaults.includeArtwork, "artwork", defaults.includeArtwork, "publish album artwork")
	if err := flags.Parse(args); err != nil {
		return configuration{}, err
	}
	if defaults.interval < 2*time.Second || defaults.playingInterval < 2*time.Second {
		return configuration{}, fmt.Errorf("poll intervals must be at least two seconds")
	}
	if defaults.heartbeat < defaults.playingInterval {
		return configuration{}, fmt.Errorf("heartbeat must be at least the playing poll interval")
	}
	return defaults, nil
}

func run(args []string, once bool) error {
	config, err := parseConfiguration("run", args)
	if err != nil {
		return err
	}
	token, err := readToken(config.tokenFile)
	if err != nil {
		return err
	}
	client, err := newAPIClient(config.server, token)
	if err != nil {
		return err
	}
	var history *listeningHistory
	if config.historyServers != "" {
		history, err = openListeningHistory(config.historyDirectory)
		if err != nil {
			return err
		}
		defer history.lock.Close()
	}
	worker := &agent{history: history, music: newAppleMusic(), api: client, includeArtwork: config.includeArtwork, heartbeat: config.heartbeat}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if history != nil && !once {
		servers := strings.Split(config.historyServers, ",")
		for i, server := range servers {
			u, e := url.Parse(strings.TrimSpace(server))
			if e != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || !((u.Scheme == "http" && (u.Host == "100.64.0.2:8791" || u.Host == "192.168.3.61:8791" || u.Host == "127.0.0.1:8791")) || u.Scheme == "https") {
				return fmt.Errorf("invalid history server origin")
			}
			servers[i] = strings.TrimRight(u.String(), "/")
		}
		go func() {
			timer := time.NewTicker(time.Minute)
			defer timer.Stop()
			for {
				key, e := readToken(config.historyTokenFile)
				if e == nil {
					if e = history.sync(ctx, servers, key); e != nil {
						log.Print(e)
					}
				} else {
					log.Print("history sync token unavailable; recording locally")
				}
				select {
				case <-ctx.Done():
					return
				case <-timer.C:
				}
			}
		}()
	}

	if err := worker.sync(ctx); err != nil {
		if once {
			return err
		}
		log.Printf("sync failed: %v", err)
	}
	if once {
		// The first update goes out before artwork extraction. One-shot mode
		// still needs to attach a successfully uploaded cover before exiting.
		if worker.artworkKey != "" && worker.artworkKey != worker.lastArtworkKey {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Second):
				return worker.sync(ctx)
			}
		}
		return nil
	}

	timer := time.NewTimer(worker.nextPollDelay(config.interval, config.playingInterval))
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			clearContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := client.Clear(clearContext); err != nil {
				log.Printf("final clear failed: %v", err)
			}
			return nil
		case <-timer.C:
			if err := worker.sync(ctx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("sync failed: %v", err)
			}
			timer.Reset(worker.nextPollDelay(config.interval, config.playingInterval))
		}
	}
}

func clear(args []string) error {
	config, err := parseConfiguration("clear", args)
	if err != nil {
		return err
	}
	token, err := readToken(config.tokenFile)
	if err != nil {
		return err
	}
	client, err := newAPIClient(config.server, token)
	if err != nil {
		return err
	}
	if err := client.Clear(context.Background()); err != nil {
		return err
	}
	fmt.Println("cleared now-playing state")
	return nil
}

func status(args []string) error {
	config, err := parseConfiguration("status", args)
	if err != nil {
		return err
	}
	fmt.Printf("server:     %s\n", config.server)
	fmt.Printf("token file: %s\n", config.tokenFile)
	if _, err := readToken(config.tokenFile); err != nil {
		fmt.Printf("token:      invalid (%v)\n", err)
	} else {
		fmt.Println("token:      configured")
	}
	current, err := newAppleMusic().NowPlaying(context.Background())
	if err != nil {
		return err
	}
	if !current.Playing {
		fmt.Println("Music:      not playing")
		return nil
	}
	fmt.Printf("Music:      %s by %s\n", current.Title, current.Artist)
	fmt.Printf("album:      %s\n", current.Album)
	fmt.Printf("position:   %s / %s\n", formatPosition(current.PositionMS), formatPosition(current.DurationMS))
	fmt.Printf("track key:  %s\n", current.TrackKey)
	return nil
}

func readToken(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("read token file %s: %w", path, err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return "", fmt.Errorf("token file %s must not be readable by group or others", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read token file %s: %w", path, err)
	}
	token := strings.TrimSpace(string(data))
	if len(token) < 32 {
		return "", fmt.Errorf("token file %s is empty or too short", path)
	}
	return token, nil
}

func environmentOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
