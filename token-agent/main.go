package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
)

const version = "0.1.0"

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.LUTC)
	if err := run(os.Args[1:]); err != nil {
		if errors.Is(err, http.ErrServerClosed) {
			return
		}
		fmt.Fprintln(os.Stderr, "token-agent:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return usageError()
	}
	switch args[0] {
	case "collect", "sync", "run", "status":
		return runClientCommand(args[0], args[1:])
	case "hub":
		return runHubCommand(args[1:])
	case "version", "--version", "-version":
		fmt.Println(version)
		return nil
	case "help", "--help", "-h":
		printUsage()
		return nil
	default:
		return fmt.Errorf("unknown command %q\n\n%s", args[0], usageText)
	}
}

func runClientCommand(command string, args []string) error {
	config, err := defaultClientConfig()
	if err != nil {
		return err
	}
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	flags.StringVar(&config.Server, "server", config.Server, "token hub base URL")
	flags.StringVar(&config.TokenFile, "token-file", config.TokenFile, "file containing the ingest token")
	flags.StringVar(&config.StateDir, "state-dir", config.StateDir, "private local archive directory")
	flags.StringVar(&config.SessionsDir, "sessions-dir", config.SessionsDir, "Codex sessions directory")
	flags.IntVar(&config.BatchSize, "batch-size", config.BatchSize, "events per request")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}

	switch command {
	case "collect":
		added, found, err := collect(config)
		if err == nil {
			fmt.Printf("archived %d new Codex responses (%d discovered)\n", added, found)
		}
		return err
	case "sync":
		sent, pending, err := syncEvents(config)
		if err == nil {
			fmt.Printf("synced %d responses (%d pending)\n", sent, pending)
		}
		return err
	case "run":
		added, found, err := collect(config)
		if err != nil {
			return err
		}
		fmt.Printf("archived %d new Codex responses (%d discovered)\n", added, found)
		sent, pending, err := syncEvents(config)
		if err == nil {
			fmt.Printf("synced %d responses (%d pending)\n", sent, pending)
		}
		return err
	case "status":
		return clientStatus(config)
	}
	return nil
}

func runHubCommand(args []string) error {
	flags := flag.NewFlagSet("hub", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	listen := flags.String("listen", "100.64.0.2:9464", "Headscale address and port")
	inbox := flags.String("inbox", "/var/lib/token-agent/inbox.jsonl", "append-only hub archive")
	tokenFile := flags.String("token-file", "/etc/token-agent.token", "file containing the ingest token")
	token := flags.String("token", "", "ingest token (prefer --token-file)")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	return runHub(*listen, *inbox, *token, *tokenFile)
}

func usageError() error {
	return errors.New(usageText)
}

const usageText = `usage: token-agent <command> [options]

commands:
  run      collect local Codex usage, then sync it to the hub
  collect  archive local Codex usage without using the network
  sync     send archived, unacknowledged usage to the hub
  status   show archive and queue information
  hub      receive and deduplicate usage on the super server
  version  print the version`

func printUsage() {
	fmt.Println(usageText)
}
