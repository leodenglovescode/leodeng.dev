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
            {'message': {}, 'done': True, 'done_reason': 'stop', 'eval_count': 40, 'eval_duration': 2000000000, 'prompt_eval_count': 30},
        ]
        response = io.BytesIO(b''.join(json.dumps(frame).encode() + b'\n' for frame in frames))
        pipe = Mock()
        opener = Mock()
        opener.open.return_value = response
        with patch.object(live.urllib.request, 'build_opener', return_value=opener):
            live.stream_child(pipe, 'http://127.0.0.1:11434', 'qwen3.8:27b', 'A fixed prompt')
        self.assertEqual(pipe.send.call_args_list[0].args[0]['channel'], 'thinking')
        events = [call.args[0] for call in pipe.send.call_args_list]
        self.assertEqual(events[1], {'type': 'phase', 'phase': 'answering'})
        self.assertEqual(events[2]['text'], 'The answer. 中文')
        self.assertEqual(events[-1]['type'], 'done')
        self.assertEqual(events[-1]['stats']['tokens'], 40)
        self.assertEqual(events[-1]['stats']['evalDurationNs'], 2000000000)
        body = json.loads(opener.open.call_args.args[0].data)
        self.assertTrue(body['stream'])
        self.assertTrue(body['think'])
        self.assertEqual(body['options']['num_gpu'], 40)
        self.assertNotIn('tools', body)

    def test_thinking_exhaustion_reserves_an_answer_only_pass_and_combines_real_metrics(self):
        first = [{'message': {'thinking': 'Still thinking...'}, 'done': False},
                 {'message': {}, 'done': True, 'done_reason': 'length', 'eval_count': 2048,
                  'eval_duration': 100000000000, 'prompt_eval_count': 100}]
        second = [{'message': {'content': 'A complete answer.'}, 'done': False},
                  {'message': {}, 'done': True, 'done_reason': 'stop', 'eval_count': 100,
                   'eval_duration': 5000000000, 'prompt_eval_count': 100}]
        opener = Mock()
        opener.open.side_effect = [io.BytesIO(b''.join(json.dumps(frame).encode() + b'\n' for frame in frames)) for frames in [first, second]]
        pipe = Mock()
        with patch.object(live.urllib.request, 'build_opener', return_value=opener):
            live.stream_child(pipe, 'http://127.0.0.1:11434', 'test', 'fixed')
        requests = [json.loads(call.args[0].data) for call in opener.open.call_args_list]
        self.assertTrue(requests[0]['think'])
        self.assertFalse(requests[1]['think'])
        self.assertEqual(requests[1]['options']['num_predict'], 512)
        events = [call.args[0] for call in pipe.send.call_args_list]
        self.assertEqual(events[1], {'type': 'phase', 'phase': 'answering'})
        self.assertEqual(events[-1]['type'], 'done')
        self.assertEqual(events[-1]['stats']['tokens'], 2148)
        self.assertEqual(events[-1]['stats']['evalDurationNs'], 105000000000)
        self.assertEqual(events[-1]['stats']['passes'], 2)

    def test_both_passes_empty_produce_a_specific_safe_error(self):
        opener = Mock()
        opener.open.side_effect = [io.BytesIO(b'{"message":{},"done":true}\n') for _ in range(2)]
        pipe = Mock()
        with patch.object(live.urllib.request, 'build_opener', return_value=opener):
            live.stream_child(pipe, 'http://127.0.0.1:11434', 'test', 'fixed')
        self.assertEqual(pipe.send.call_args_list[-1].args[0], {'type': 'error', 'code': 'empty_answer'})

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
