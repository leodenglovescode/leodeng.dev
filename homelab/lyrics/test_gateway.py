import email.message
import importlib.util
import io
import json
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('gateway.py'))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
TOKEN = 'gateway-test-placeholder-not-a-real-token'
QUERY = 'track_name=Song&artist_name=Artist&duration=180'


class Response(io.BytesIO):
    status = 200
    def __init__(self, data):
        super().__init__(data)
        self.headers = email.message.Message()
        self.headers['Content-Type'] = 'application/json'


class Opener:
    def __init__(self, value=None):
        self.value = value or {'duration': 180, 'syncedLyrics': '[00:01]Example', 'instrumental': False}
        self.calls = []
    def open(self, request, **kwargs):
        self.calls.append(request)
        if isinstance(self.value, Exception):
            raise self.value
        return Response(json.dumps(self.value).encode())


class GatewayTests(unittest.TestCase):
    def test_query_validation_and_canonicalization(self):
        self.assertEqual(g.query_params(QUERY), g.query_params('duration=180.0&artist_name=Artist&track_name=%20Song%20'))
        for query in ['', QUERY + '&url=http://example.test', QUERY + '&duration=181', QUERY.replace('180', 'nan'), QUERY.replace('180', '-1'), QUERY.replace('Song', '%00'), QUERY.replace('Song', 'x' * 301)]:
            with self.assertRaises(ValueError):
                g.query_params(query)

    def test_upstream_is_fixed_private_ip_and_exact_read_only_path(self):
        for url in ['http://example.test/api/get', 'http://169.254.169.254/api/get', 'http://8.8.8.8/api/get', 'http://127.0.0.1/api/search', 'http://user:password@127.0.0.1/api/get', 'http://127.0.0.1/api/get?url=anything']:
            with self.assertRaises(ValueError):
                g.upstream_url(url)
        self.assertEqual(g.upstream_url('http://127.0.0.1:3300/api/get'), 'http://127.0.0.1:3300/api/get')

    def test_authorization_is_required_and_duplicate_headers_are_rejected(self):
        gateway = g.Gateway('http://127.0.0.1:3300/api/get', TOKEN)
        headers = email.message.Message()
        self.assertFalse(gateway.authorized(headers))
        headers['Authorization'] = 'Bearer ' + TOKEN
        self.assertTrue(gateway.authorized(headers))
        headers['Authorization'] = 'Bearer ' + TOKEN
        self.assertFalse(gateway.authorized(headers))

    def test_cache_hit_skips_upstream_and_credentials_never_reach_database_server(self):
        opener = Opener({'duration': 180, 'syncedLyrics': '[00:01]Example', 'private': 'discarded'})
        gateway = g.Gateway('http://127.0.0.1:3300/api/get', TOKEN, opener)
        first = gateway.lookup(QUERY)
        self.assertEqual(gateway.lookup(QUERY), first)
        self.assertEqual(len(opener.calls), 1)
        self.assertEqual(set(json.loads(first[1])), {'duration', 'syncedLyrics', 'instrumental'})
        self.assertIsNone(opener.calls[0].get_header('Authorization'))
        self.assertIsNone(opener.calls[0].get_header('Cookie'))

    def test_oversized_response_and_network_error_fail_without_details(self):
        for value in [{'duration': 180, 'syncedLyrics': 'x' * 300000}, OSError('private network detail')]:
            gateway = g.Gateway('http://127.0.0.1:3300/api/get', TOKEN, Opener(value))
            status, body = gateway.lookup(QUERY)
            self.assertEqual(status, 503)
            self.assertNotIn(b'private', body)

    def test_negative_lookups_are_cached(self):
        opener = Opener(urllib.error.HTTPError('http://127.0.0.1', 404, 'Missing', {}, None))
        gateway = g.Gateway('http://127.0.0.1:3300/api/get', TOKEN, opener)
        self.assertEqual(gateway.lookup(QUERY)[0], 404)
        self.assertEqual(gateway.lookup(QUERY)[0], 404)
        self.assertEqual(len(opener.calls), 1)

    def test_cache_byte_budget_is_enforced(self):
        opener = Opener({'duration': 180, 'syncedLyrics': 'a' * 95000})
        gateway = g.Gateway('http://127.0.0.1:3300/api/get', TOKEN, opener)
        clock = [0]
        with patch.object(g.time, 'monotonic', lambda: clock[0]):
            gateway.refilled = 0
            for i in range(200):
                clock[0] += 3
                self.assertEqual(gateway.lookup(QUERY + str(i))[0], 200)
        self.assertLessEqual(gateway.cache_bytes, g.MAX_CACHE)
        self.assertLessEqual(len(gateway.cache), 128)

    def test_rate_and_concurrent_load_limits(self):
        gateway = g.Gateway('http://127.0.0.1:3300/api/get', TOKEN, Opener())
        for i in range(8):
            self.assertEqual(gateway.lookup(QUERY + str(i))[0], 200)
        self.assertEqual(gateway.lookup(QUERY + 'new')[0], 429)
        self.assertEqual(gateway.lookup(QUERY + '0')[0], 200)
        gateway.tokens = 8
        for _ in range(4):
            self.assertTrue(gateway.loads.acquire(False))
        self.assertEqual(gateway.lookup(QUERY + 'blocked')[0], 503)
        for _ in range(4):
            gateway.loads.release()


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.opener = Opener()
        self.server = g.Server(('127.0.0.1', 0), g.Gateway('http://127.0.0.1:3300/api/get', TOKEN, self.opener))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:' + str(self.server.server_port)
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
    def request(self, path, auth=True, method='GET'):
        req = urllib.request.Request(self.base + path, headers={'Authorization': 'Bearer ' + TOKEN} if auth else {}, method=method)
        try:
            return urllib.request.urlopen(req, timeout=3)
        except urllib.error.HTTPError as error:
            return error
    def test_only_authenticated_valid_get_reaches_upstream(self):
        for path, auth, method, status in [('/api/get?' + QUERY, False, 'GET', 403), ('/api/search?q=anything', True, 'GET', 404), ('/api/publish', True, 'POST', 405), ('/api/get?' + QUERY + '&url=evil', True, 'GET', 400), ('/api/get?' + QUERY, True, 'GET', 200)]:
            with self.request(path, auth, method) as response:
                self.assertEqual(response.code, status)
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(len(self.opener.calls), 1)


if __name__ == '__main__':
    unittest.main()
