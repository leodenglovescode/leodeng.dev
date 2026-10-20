import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('monkeytype', Path(__file__).with_name('monkeytype.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
PROFILE = {'name': 'leodeng', 'uid': 'owner', 'typingStats': {'completedTests': 401, 'timeTyping': 7000},
           'personalBests': {'time': {'60': [
               {'wpm': 100, 'acc': 99, 'language': 'english', 'difficulty': 'normal'},
               {'wpm': 500, 'acc': 99, 'language': 'english', 'difficulty': 'normal', 'lazyMode': True}]}}}
RESULT = {'uid': 'owner', 'wpm': 100, 'acc': 98, 'timestamp': 1800000000000,
          'mode': 'time', 'mode2': 60, 'language': 'english', 'tags': ['private'], '_id': 'private'}


class CollectorTests(unittest.TestCase):
    def test_sanitizing_and_account_verification(self):
        data = m.snapshot(PROFILE, [RESULT])
        self.assertEqual(data['profile']['bests'][0]['wpm'], 100)
        self.assertNotIn('private', json.dumps(data))
        self.assertNotIn('owner', json.dumps(data))
        with self.assertRaises(ValueError):
            m.snapshot(PROFILE, [dict(RESULT, uid='someone-else')])
        with self.assertRaises(ValueError):
            m.snapshot(dict(PROFILE, name='someone-else'), [])

    def test_hourly_fetch_and_retry_pending_push_without_refetch(self):
        calls = []
        fail_push = True

        def transport(url, headers, payload=None):
            calls.append(url)
            if url.endswith('/profile'):
                self.assertEqual(headers['Authorization'], 'ApeKey secret')
                return {'data': PROFILE}
            if '/results?' in url:
                return {'data': [RESULT]}
            self.assertEqual(headers['Authorization'], 'Bearer push-secret')
            self.assertNotIn('owner', json.dumps(payload))
            if fail_push:
                raise ValueError('HTTP 503')
            return {'ok': True}

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            with self.assertRaises(ValueError):
                m.collect(path, 'secret', 'push-secret', 10000, transport)
            self.assertNotIn('secret', path.read_text())
            fail_push = False
            m.collect(path, 'secret', 'push-secret', 10060, transport)
            self.assertEqual(len(calls), 4)
            m.collect(path, 'secret', 'push-secret', 10061, transport)
            self.assertEqual(len(calls), 4)
            m.collect(path, 'secret', 'push-secret', 13600, transport)
            self.assertEqual(len(calls), 7)

    def test_failed_api_attempt_reserves_hour(self):
        calls = []

        def fail(url, headers, payload=None):
            calls.append(url)
            raise ValueError('HTTP 429')

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            with self.assertRaises(ValueError):
                m.collect(path, 'secret', 'push-secret', 10000, fail)
            m.collect(path, 'secret', 'push-secret', 10060, fail)
            self.assertEqual(len(calls), 1)
            with self.assertRaises(ValueError):
                m.collect(path, 'secret', 'push-secret', 13600, fail)
            self.assertEqual(len(calls), 2)


if __name__ == '__main__':
    unittest.main()
