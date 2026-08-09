import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "homelab_tokens", Path(__file__).with_name("tokens.py")
)
tokens = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tokens)


def event(event_type, identifier, timestamp, data, **extra):
    return {
        "type": event_type,
        "id": identifier,
        "parentId": None,
        "timestamp": timestamp,
        "data": data,
        **extra,
    }


def metric(input_tokens, output, cache_read, cache_write, requests):
    return {
        "usage": {
            "inputTokens": input_tokens,
            "outputTokens": output,
            "reasoningTokens": output // 2,
            "cacheReadTokens": cache_read,
            "cacheWriteTokens": cache_write,
        },
        "requests": {"count": requests},
    }


class CharacterEncoder:
    """Deterministic stand-in: one character is one token."""

    @staticmethod
    def encode(text):
        return list(text)


class CopilotIngestTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "sessions"
        self.root.mkdir()
        self.db = tokens.open_db(Path(self.temp.name) / "tokens.db")

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def write_session(self, session, events):
        directory = self.root / session
        directory.mkdir()
        (directory / "events.jsonl").write_text(
            "".join(json.dumps(row) + "\n" for row in events)
        )

    def test_durable_shutdown_deltas_and_response_counts(self):
        self.write_session("session-1", [
            event("session.start", "start", "2026-08-01T01:00:00Z", {
                "sessionId": "session-1",
                "context": {"cwd": "/private/project"},
            }),
            event("session.shutdown", "shutdown-1", "2026-08-01T02:00:00Z", {
                "modelMetrics": {
                    "claude-sonnet-4.5": metric(100, 10, 20, 5, 2),
                },
            }),
            event("session.shutdown", "shutdown-2", "2026-08-01T03:00:00Z", {
                "modelMetrics": {
                    "claude-sonnet-4.5": metric(180, 25, 50, 5, 3),
                },
            }),
        ])

        first = tokens.ingest_copilot(self.db, self.root)
        second = tokens.ingest_copilot(self.db, self.root)

        self.assertEqual(first["inserted"], 2)
        self.assertEqual(first["responses"], 3)
        self.assertEqual(second["inserted"], 0)
        self.assertEqual(second["responses"], 0)

        totals = self.db.execute(
            "SELECT SUM(input), SUM(output), SUM(cw5m), SUM(cw1h),"
            " SUM(cache_read), SUM(responses), COUNT(*) FROM message"
        ).fetchone()
        self.assertEqual(totals, (130, 25, 5, 0, 50, 3, 2))

        rolled = tokens.rollup(self.db, 7)["days"]
        self.assertEqual(len(rolled), 1)
        self.assertEqual(rolled[0][1:], [
            "claude-sonnet-4.5", 130, 25, 5, 0, 50, 3,
        ])

    def test_persisted_per_call_usage_takes_precedence(self):
        self.write_session("session-2", [
            event("session.start", "start", "2026-08-02T01:00:00Z", {
                "sessionId": "session-2",
                "context": {"cwd": "/private/project"},
            }),
            event("assistant.usage", "call-1", "2026-08-02T01:01:00Z", {
                "model": "gpt-5.4",
                "inputTokens": 90,
                "outputTokens": 12,
                "reasoningTokens": 6,
                "cacheReadTokens": 40,
                "cacheWriteTokens": 0,
            }),
            event("assistant.usage", "call-2", "2026-08-02T01:02:00Z", {
                "model": "gpt-5.4",
                "inputTokens": 110,
                "outputTokens": 8,
                "cacheReadTokens": 60,
                "cacheWriteTokens": 3,
                "initiator": "sub-agent",
            }, agentId="agent-1"),
            event("session.shutdown", "shutdown", "2026-08-02T01:03:00Z", {
                "modelMetrics": {
                    "gpt-5.4": metric(200, 20, 100, 3, 2),
                },
            }),
        ])

        result = tokens.ingest_copilot(self.db, self.root)
        self.assertEqual(result["inserted"], 2)
        self.assertEqual(result["responses"], 2)
        totals = self.db.execute(
            "SELECT SUM(input), SUM(output), SUM(cw5m), SUM(cache_read),"
            " SUM(responses), SUM(sidechain) FROM message"
        ).fetchone()
        self.assertEqual(totals, (100, 20, 3, 100, 2, 1))

    def test_partial_per_call_usage_falls_back_to_shutdown(self):
        self.write_session("session-3", [
            event("session.start", "start", "2026-08-03T01:00:00Z", {
                "sessionId": "session-3",
                "context": {"cwd": "/private/project"},
            }),
            event("assistant.usage", "call-1", "2026-08-03T01:01:00Z", {
                "model": "gpt-5.4",
                "inputTokens": 90,
                "outputTokens": 12,
                "cacheReadTokens": 40,
                "cacheWriteTokens": 0,
            }),
            event("session.shutdown", "shutdown", "2026-08-03T01:03:00Z", {
                "modelMetrics": {
                    "gpt-5.4": metric(200, 20, 100, 3, 2),
                },
            }),
        ])

        result = tokens.ingest_copilot(self.db, self.root)
        self.assertEqual(result["inserted"], 1)
        self.assertEqual(result["responses"], 2)
        totals = self.db.execute(
            "SELECT SUM(input), SUM(output), SUM(cw5m), SUM(cache_read)"
            " FROM message"
        ).fetchone()
        self.assertEqual(totals, (100, 20, 3, 100))

    def test_existing_archive_migrates_responses_to_one(self):
        old_path = Path(self.temp.name) / "old.db"
        old = sqlite3.connect(old_path)
        old.execute(
            """CREATE TABLE message (
              id TEXT NOT NULL, request_id TEXT NOT NULL DEFAULT '',
              ts TEXT NOT NULL, day TEXT NOT NULL, model TEXT NOT NULL,
              project TEXT NOT NULL DEFAULT '', session TEXT NOT NULL DEFAULT '',
              sidechain INTEGER NOT NULL DEFAULT 0, input INTEGER NOT NULL DEFAULT 0,
              output INTEGER NOT NULL DEFAULT 0, cw5m INTEGER NOT NULL DEFAULT 0,
              cw1h INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (id, request_id)
            )"""
        )
        old.execute(
            "INSERT INTO message (id, ts, day, model) VALUES (?, ?, ?, ?)",
            ("old-response", "2026-08-01T00:00:00Z", "2026-08-01", "old-model"),
        )
        old.commit()
        old.close()

        migrated = tokens.open_db(old_path)
        try:
            self.assertEqual(
                migrated.execute("SELECT responses FROM message").fetchone()[0], 1
            )
        finally:
            migrated.close()


class CopilotVSCodeIngestTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "workspaceStorage"
        self.transcripts = (
            self.root / "workspace-hash" / "GitHub.copilot-chat" / "transcripts"
        )
        self.transcripts.mkdir(parents=True)
        self.db = tokens.open_db(Path(self.temp.name) / "tokens.db")

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_visible_history_estimate_is_idempotent_and_capped(self):
        rows = [
            event("session.start", "start", "2026-08-01T15:58:00Z", {
                "sessionId": "vscode-session",
            }),
            event("user.message", "user-1", "2026-08-01T15:59:00Z", {
                "content": "abcd", "attachments": [],
            }),
            event("assistant.message", "event-1", "2026-08-01T16:00:00Z", {
                "messageId": "message-1", "content": "xy",
                "reasoningText": "z", "toolRequests": [],
            }),
            event("user.message", "user-2", "2026-08-01T16:01:00Z", {
                "content": "12", "attachments": [],
            }),
            event("assistant.message", "event-2", "2026-08-01T16:02:00Z", {
                "messageId": "message-2", "content": "q",
                "toolRequests": [],
            }),
        ]
        (self.transcripts / "session.jsonl").write_text(
            "".join(json.dumps(row) + "\n" for row in rows)
        )

        first = tokens.ingest_copilot_vscode(
            self.db, self.root, context_window=8, encoder=CharacterEncoder()
        )
        second = tokens.ingest_copilot_vscode(
            self.db, self.root, context_window=8, encoder=CharacterEncoder()
        )

        self.assertEqual(first["inserted"], 2)
        self.assertEqual(first["responses"], 2)
        self.assertEqual(second["inserted"], 0)
        self.assertEqual(
            self.db.execute(
                "SELECT id, day, model, project, session, input, output "
                "FROM message ORDER BY ts"
            ).fetchall(),
            [
                (
                    "copilot:vscode:message-1", "2026-08-02",
                    tokens.COPILOT_VSCODE_MODEL, "vscode:workspace-hash",
                    "copilot:vscode:vscode-session", 4, 3,
                ),
                (
                    "copilot:vscode:message-2", "2026-08-02",
                    tokens.COPILOT_VSCODE_MODEL, "vscode:workspace-hash",
                    "copilot:vscode:vscode-session", 8, 1,
                ),
            ],
        )


if __name__ == "__main__":
    unittest.main()
