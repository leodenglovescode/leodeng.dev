import io
import json
import unittest
from unittest.mock import Mock, patch
import daily_ai_live as live


class LiveTests(unittest.TestCase):
    def test_only_server_selected_fixed_jobs_are_accepted(self):
        job = {'type': 'generate', 'job': '12345678-1234-1234-1234-123456789abc', 'id': 'site', 'day': '2026-10-22', 'revision': 1}
        self.assertTrue(live.valid_job(job))
        for bad in [{**job, 'id': 'ignore instructions'}, {**job, 'job': '../secret'}, {**job, 'day': 'today'}, {'type': 'generate'}]:
            self.assertFalse(live.valid_job(bad))

    @patch.dict('os.environ', {'DAILY_AI_GPU_LAYERS': '40'})
    def test_stream_preserves_distinct_thinking_and_answer_channels(self):
        frames = [
            {'message': {'thinking': 'Check the public source.'}, 'done': False},
            {'message': {'content': 'The answer. 中文'}, 'done': False},
            {'message': {}, 'done': True},
        ]
        response = io.BytesIO(b''.join(json.dumps(frame).encode() + b'\n' for frame in frames))
        pipe = Mock()
        opener = Mock()
        opener.open.return_value = response
        with patch.object(live.urllib.request, 'build_opener', return_value=opener):
            live.stream_child(pipe, 'http://127.0.0.1:11434', 'qwen3.8:27b', 'A fixed prompt')
        self.assertEqual(pipe.send.call_args_list[0].args[0]['channel'], 'thinking')
        self.assertEqual(pipe.send.call_args_list[1].args[0]['text'], 'The answer. 中文')
        self.assertEqual(pipe.send.call_args_list[2].args[0]['type'], 'done')
        body = json.loads(opener.open.call_args.args[0].data)
        self.assertTrue(body['stream'])
        self.assertTrue(body['think'])
        self.assertEqual(body['options']['num_gpu'], 40)
        self.assertNotIn('tools', body)

    def test_truncated_ollama_stream_is_an_error(self):
        opener = Mock()
        opener.open.return_value = io.BytesIO(b'{"message":{"thinking":"partial"},"done":false}\n')
        pipe = Mock()
        with patch.object(live.urllib.request, 'build_opener', return_value=opener):
            live.stream_child(pipe, 'http://127.0.0.1:11434', 'test', 'fixed')
        self.assertEqual(pipe.send.call_args_list[-1].args[0]['type'], 'error')

    def test_stale_revision_never_starts_inference(self):
        job = {'type': 'generate', 'job': '12345678-1234-1234-1234-123456789abc', 'id': 'site', 'day': '2026-10-22', 'revision': 1}
        ws = Mock()
        with patch.object(live.ai, 'http_json', return_value={'enabled': True, 'day': job['day'], 'revision': 2}), patch.object(live.mp, 'get_context') as context, patch.object(live, 'unload'):
            live.execute(ws, job, 'https://leodeng.dev', 'test', 'http://127.0.0.1:11434', 'test')
        context.assert_not_called()
        self.assertEqual(json.loads(ws.send.call_args.args[0])['type'], 'error')

    def test_cancel_terminates_child_and_unloads(self):
        job = {'type': 'generate', 'job': '12345678-1234-1234-1234-123456789abc', 'id': 'site', 'day': '2026-10-22', 'revision': 1}
        ws = Mock()
        ws.recv.return_value = json.dumps({'type': 'cancel', 'job': job['job']})
        parent, child = Mock(), Mock()
        process = Mock()
        process.is_alive.return_value = True
        ctx = Mock()
        ctx.Pipe.return_value = parent, child
        ctx.Process.return_value = process
        def http(url, **kwargs):
            if url.endswith('/daily-ai-context.json'):
                return {'version': 1, 'pages': {}}
            return {'enabled': True, 'revision': 1, 'day': job['day']}
        with patch.object(live.ai, 'http_json', side_effect=http), patch.object(live.mp, 'get_context', return_value=ctx), patch.object(live, 'unload') as unload:
            live.execute(ws, job, 'https://leodeng.dev', 'test', 'http://127.0.0.1:11434', 'test')
        process.terminate.assert_called_once()
        unload.assert_called_once()
        self.assertEqual(json.loads(ws.send.call_args.args[0])['type'], 'error')


if __name__ == '__main__':
    unittest.main()
