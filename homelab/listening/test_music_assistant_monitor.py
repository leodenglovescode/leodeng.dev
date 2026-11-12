import copy
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import MagicMock

import music_assistant_monitor as m


def player(identity, **extra):
    return dict(player_id=identity, name="Leo's "+identity, available=True, enabled=True,
                playback_state='playing', elapsed_time=0,
                current_media=dict(uri='library://track/1', title='Song', artist='Artist', album='Album', duration=180), **extra)


class FakeHTTP:
    def __init__(self):
        self.players = [player('Mac', private=True), player('Speaker')]
        self.requests = []
        self.queues = []
        self.fail = False

    def rpc(self, url, token, command, args=None):
        if self.fail:
            raise m.MonitorError('Unavailable')
        return copy.deepcopy(self.players if command == 'players/all' else self.queues)

    def request(self, url, token='', body=None, method='POST', **kwargs):
        self.requests.append((url, token, body, method))
        if method == 'GET':
            return b'\x89PNG\r\n\x1a\nexample'
        if method == 'PUT':
            digest = url.rsplit('/', 1)[-1]
            return json.dumps({'artworkKey': 'now-playing/artwork/'+digest+'.png'}).encode()
        sources = json.loads(body)['sources']
        return json.dumps({'ok': True, 'preferredSources': [source['sourceId'] for source in sources if source.get('playing')]}).encode()


class MonitorTests(unittest.TestCase):
    def test_lan_rpc_bypasses_proxy_while_website_uses_configured_proxy(self):
        http = m.HTTP()
        http.opener, http.direct_opener = MagicMock(), MagicMock()
        for opener in (http.opener, http.direct_opener):
            opener.open.return_value.__enter__.return_value.read.return_value = b'[]'
        self.assertEqual(http.rpc('http://192.168.3.15:8095', 'token', 'players/all'), [])
        http.direct_opener.open.assert_called_once()
        http.opener.open.assert_not_called()
        http.request('https://example.test/api/internal/now-playing', 'token', b'{}')
        http.opener.open.assert_called_once()

    def monitor(self, http, **kwargs):
        return m.Monitor('http://192.168.3.15:8095', 'ma-token', 'https://example.test', 'website-token', http=http, **kwargs)

    def test_devices_private_clients_groups_aliases_and_clock(self):
        p = player('Mac', private=True)
        p['current_media']['elapsed_time'] = 5
        p['current_media']['elapsed_time_last_updated'] = 100
        leader = player('Group')
        child = player('Child', synced_to='Group')
        result = m.streams([p, child, leader], {'Mac': 'mac:home'}, now=102)
        self.assertEqual(len(result), 2)
        mac = next(source for source in result if source['deviceId'] == 'mac:home')
        self.assertEqual(mac['positionMs'], 7000)
        self.assertEqual(mac['sourceLabel'], "Leo's Mac")
        self.assertNotIn('library://', json.dumps(result))
        self.assertEqual(len(m.streams([p, child, leader], allowed={'Mac'})), 1)
        p['current_media']['duration'] = None
        self.assertEqual(m.streams([p]), [])

    def test_two_devices_one_batched_heartbeat_and_scoped_stop(self):
        http = FakeHTTP()
        monitor = self.monitor(http)
        monitor.step(now=0)
        self.assertEqual(len(http.requests), 1)
        self.assertEqual(len(json.loads(http.requests[0][2])['sources']), 2)
        for now in [2, 4, 6, 8]:
            for p in http.players:
                p['elapsed_time'] = now
            monitor.step(now=now)
        self.assertEqual(len(http.requests), 1, 'ordinary progress must not write every poll')
        for p in http.players:
            p['elapsed_time'] = 10
        monitor.step(now=10)
        self.assertEqual(len(http.requests), 2)
        http.players[0]['playback_state'] = 'paused'
        http.players[1]['elapsed_time'] = 12
        monitor.step(now=12)
        batch = json.loads(http.requests[-1][2])['sources']
        self.assertEqual(len(batch), 1)
        self.assertFalse(batch[0]['playing'])
        http.fail = True
        with self.assertRaises(m.MonitorError):
            monitor.step(now=14)
        self.assertEqual(len(http.requests), 3, 'unavailable MA must not clear another device')

    def test_one_device_change_does_not_renew_other_devices(self):
        http = FakeHTTP()
        monitor = self.monitor(http)
        monitor.step(now=0)
        for p in http.players:
            p['elapsed_time'] = 4
        http.players[0]['current_media']['title'] = 'New song'
        monitor.step(now=4)
        self.assertEqual(len(json.loads(http.requests[-1][2])['sources']), 1)
        for p in http.players:
            p['elapsed_time'] = 6
        monitor.step(now=6)
        self.assertEqual(len(http.requests), 2)
        for p in http.players:
            p['elapsed_time'] = 10
        monitor.step(now=10)
        self.assertEqual(len(json.loads(http.requests[-1][2])['sources']), 1)

    def test_missing_transport_metadata_uses_only_matching_active_queue(self):
        http = FakeHTTP()
        http.players = [player('Mac', active_source='queue-1')]
        http.players[0]['current_media'] = {'uri': 'http://private-stream'}
        http.queues = [{'queue_id': 'queue-1', 'active': True, 'state': 'playing', 'elapsed_time': 20,
            'current_item': {'name': 'Artist - Song', 'duration': 180, 'media_item': {
                'uri': 'library://track/1', 'name': 'Song', 'artists': [{'name': 'Artist'}], 'album': {'name': 'Album'}}}}]
        sources = self.monitor(http).snapshot()
        self.assertEqual(sources[0]['title'], 'Song')
        self.assertEqual(sources[0]['artist'], 'Artist')
        self.assertEqual(sources[0]['positionMs'], 20000)
        http.players[0]['active_source'] = 'external'
        self.assertEqual(self.monitor(http).snapshot(), [], 'must not borrow a queue for a different native source')

    def test_cover_credentials_and_metadata_first(self):
        http = FakeHTTP()
        http.players[0]['current_media']['image_url'] = 'https://art.example.test/cover'
        monitor = self.monitor(http)
        monitor.step(now=0)
        self.assertEqual(http.requests[0][0], 'https://example.test/api/internal/now-playing')
        self.assertEqual(http.requests[1][1], '', 'MA token sent to external image host')
        self.assertEqual(http.requests[2][1], 'website-token')
        http.players[0]['elapsed_time'] = 2
        http.players[1]['elapsed_time'] = 2
        monitor.step(now=2)
        self.assertTrue(json.loads(http.requests[-1][2])['sources'][0]['artworkKey'].endswith('.png'))
        image = m.streams([player('Mac')])[0]
        image['_image'] = '/artwork'
        self.monitor(http).cover(image)
        self.assertEqual(http.requests[-2][1], 'ma-token')

    def test_history_is_durable_per_device_and_does_not_credit_outages(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory)/'history.db')
            history = m.History(path)
            sources = m.streams([player('Mac'), player('Speaker')])
            preferred = {source['sourceId'] for source in sources}
            stamp = round(time.time()*1000)-60000
            for elapsed in (0, 10000, 20000, 30000):
                for source in sources:
                    source['positionMs'] = elapsed
                history.observe(sources, preferred, stamp+elapsed)
            self.assertEqual(history.db.execute('SELECT count(*) FROM listens').fetchone()[0], 2)
            self.assertEqual(sum(json.loads(row[0])['listenedMs'] for row in history.db.execute('SELECT payload FROM listens')), 60000)
            history.db.close()
            history = m.History(path)
            for source in sources:
                source['positionMs'] = 50000
            history.observe(sources, preferred, stamp+50000)
            self.assertEqual(history.db.execute('SELECT count(*) FROM listens').fetchone()[0], 2, 'restart must resume the existing sessions')
            self.assertEqual(sum(json.loads(row[0])['listenedMs'] for row in history.db.execute('SELECT payload FROM listens')), 60000)
            # A higher-priority direct report owns one physical device.
            history.observe(sources, {sources[1]['sourceId']}, stamp+52000)
            self.assertNotIn(sources[0]['sourceId'], history.active)
            history.db.close()


if __name__ == '__main__':
    unittest.main()
