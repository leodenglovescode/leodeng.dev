import unittest
from unittest.mock import patch
import daily_ai as ai


class DailyAiTests(unittest.TestCase):
    @patch.dict("os.environ", {"DAILY_AI_GPU_LAYERS": "40"})
    def test_gpu_offload_is_bounded(self):
        self.assertEqual(ai.inference_options()["num_gpu"], 40)
        with patch.dict("os.environ", {"DAILY_AI_GPU_LAYERS": "-1"}):
            with self.assertRaises(ValueError):
                ai.inference_options()

    def test_local_only_ollama(self):
        self.assertEqual(ai.ollama_base("http://127.0.0.1:11434"), "http://127.0.0.1:11434")
        for value in ["https://evil.example", "http://192.168.1.1:11434", "http://localhost:11434/other", "http://secret@localhost:11434"]:
            with self.assertRaises(ValueError):
                ai.ollama_base(value)

    def test_archive_is_deterministic_and_sources_are_not_generated(self):
        context = {"pages": {}, "posts": [{"path": "/blog/first", "text": "Published text"}, {"path": "/blog/second", "text": "Another post"}]}
        first = ai.prompt_for("archive", context, "2026-10-22", {})
        self.assertEqual(first, ai.prompt_for("archive", context, "2026-10-22", {}))
        self.assertEqual(first[1], ["/blog/second"])

    def test_metrics_remain_bounded_and_exclude_new_fields(self):
        result = ai.public_metrics("/api/tokens", {"seen": True, "today": {"tokens": 100}, "daily": ["x"] * 10000, "private": "not included"})
        self.assertNotIn("private", result)
        self.assertNotIn("daily", result)
        self.assertIn("not a bill", result["costNote"])

    def test_revision_change_cancels_lease(self):
        lease = {"day": "2026-10-22", "revision": 4}
        self.assertTrue(ai.same_lease({**lease, "enabled": True}, lease))
        self.assertFalse(ai.same_lease({**lease, "enabled": False}, lease))
        self.assertFalse(ai.same_lease({**lease, "enabled": True, "revision": 5}, lease))
        self.assertFalse(ai.same_lease({**lease, "enabled": True, "publishedDay": lease["day"]}, lease))

    def test_kill_switch_terminates_inference_process(self):
        class Pipe:
            def poll(self, seconds): return False
            def close(self): pass

        class Process:
            alive = True
            terminated = False
            def start(self): pass
            def is_alive(self): return self.alive
            def terminate(self): self.terminated = True; self.alive = False
            def join(self, timeout=None): pass

        process = Process()
        context = unittest.mock.Mock()
        context.Pipe.return_value = (Pipe(), Pipe())
        context.Process.return_value = process
        with patch.object(ai.mp, 'get_context', return_value=context):
            with self.assertRaises(RuntimeError):
                ai.generate_answer('http://127.0.0.1:11434', 'test', 'Fixed prompt',
                                   lambda: {"enabled": False}, {"day": "2026-10-22", "revision": 1})
        self.assertTrue(process.terminated)

    @patch.dict("os.environ", {"DAILY_AI_TOKEN": "test", "DAILY_AI_MODEL": "qwen-local:27b"})
    def test_disabled_publisher_never_loads_model(self):
        with patch.object(ai, "http_json", return_value={"enabled": False}) as http:
            ai.run()
            self.assertEqual(http.call_count, 1)

    @patch.dict("os.environ", {"DAILY_AI_TOKEN": "test", "DAILY_AI_MODEL": "qwen-local:27b"})
    def test_failure_unloads_and_does_not_publish_partial_batch(self):
        lease = {"day": "2026-10-22", "revision": 1, "enabled": True}
        calls = []

        def http(url, body=None, **kwargs):
            calls.append((url, body))
            if url.endswith("/api/internal/daily-ai"):
                return lease
            if url.endswith("/daily-ai-context.json"):
                return {"version": 1, "pages": {}}
            return {}

        with patch.object(ai, "http_json", side_effect=http), patch.object(ai, "generate_answer", side_effect=RuntimeError("test cancellation")):
            with self.assertRaises(RuntimeError):
                ai.run()
        self.assertTrue(any(url.endswith("/api/generate") and body["keep_alive"] == 0 for url, body in calls))
        self.assertFalse(any(url.endswith("/api/internal/daily-ai") and body is not None for url, body in calls))


if __name__ == "__main__":
    unittest.main()
