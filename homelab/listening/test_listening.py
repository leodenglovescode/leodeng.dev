import datetime as dt
import errno
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec=importlib.util.spec_from_file_location('listening',Path(__file__).with_name('listening.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ListeningTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.db=m.connect(str(Path(self.tmp.name)/'history.db'))
        start=int(dt.datetime(2026,10,20,12,tzinfo=dt.timezone.utc).timestamp()*1000)
        self.event=dict(id='a'*32,title='Song',artist='Artist',album='Album',durationMs=180000,startedAt=start,updatedAt=start+40000,listenedMs=40000,days={'2026-10-20':40000})
    def tearDown(self):self.db.close();self.tmp.cleanup()
    def test_late_interface_is_retried_without_rebinding_healthy_listener(self):
        private, lan = '192.0.2.2', '192.0.2.61'
        private_server, lan_server = Mock(), Mock()
        servers, unavailable = {}, set()
        with patch.object(m, 'ThreadingHTTPServer') as factory, patch.object(m.threading, 'Thread') as thread:
            factory.side_effect = [OSError(errno.EADDRNOTAVAIL, 'Interface not ready'), lan_server, private_server]
            with self.assertLogs(level='WARNING'):
                m.bind_listeners([private, lan], 8791, object, servers, unavailable)
            self.assertEqual(servers, {lan: lan_server})
            self.assertEqual(unavailable, {private})
            with self.assertLogs(level='WARNING'):
                m.bind_listeners([private, lan], 8791, object, servers, unavailable)
            self.assertEqual(servers, {lan: lan_server, private: private_server})
            self.assertFalse(unavailable)
            m.bind_listeners([private, lan], 8791, object, servers, unavailable)
            self.assertEqual(factory.call_count, 3)
            self.assertEqual(thread.return_value.start.call_count, 2)
            lan_server.shutdown.assert_not_called()

    def test_no_interfaces_at_boot_keeps_retrying_without_wildcard_binding(self):
        servers, unavailable = {}, set()
        with patch.object(m, 'ThreadingHTTPServer') as factory, patch.object(m.threading, 'Thread'):
            factory.side_effect = OSError(errno.EADDRNOTAVAIL, 'Interface not ready')
            with self.assertLogs(level='WARNING'):
                m.bind_listeners(['private-address'], 8791, object, servers, unavailable)
            self.assertFalse(servers)
            self.assertEqual(unavailable, {'private-address'})
            recovered = Mock()
            factory.side_effect = None
            factory.return_value = recovered
            with self.assertLogs(level='WARNING'):
                m.bind_listeners(['private-address'], 8791, object, servers, unavailable)
            self.assertEqual(servers, {'private-address': recovered})
            self.assertFalse(unavailable)
            self.assertEqual([call.args[0] for call in factory.call_args_list], [('private-address', 8791)] * 2)

    def test_dedup_backfill_and_ranges(self):
        for _ in range(3):m.ingest(self.db,[self.event])
        result=m.aggregate(self.db,dt.date(2026,10,21))
        self.assertEqual(result['ranges']['7']['plays'],1)
        self.assertEqual(result['ranges']['all']['listenedMs'],40000)
        self.assertEqual(result['ranges']['all']['artists'][0]['name'],'Artist')
        self.assertEqual(result['ranges']['all']['albums'][0]['sampleTracks'],['Song'])
        newer=dict(self.event,updatedAt=self.event['updatedAt']+10000,listenedMs=50000,days={'2026-10-20':50000})
        m.ingest(self.db,[newer]);m.ingest(self.db,[self.event])
        self.assertEqual(m.aggregate(self.db,dt.date(2026,10,21))['ranges']['all']['listenedMs'],50000)
        later=m.aggregate(self.db,dt.date(2026,11,21))
        self.assertEqual(later['ranges']['7']['plays'],0)
        self.assertEqual(later['ranges']['all']['plays'],1)
    def test_invalid_batch_rolls_back_and_does_not_publish_raw_ids(self):
        m.ingest(self.db,[self.event])
        bad=dict(self.event,id='b'*32,listenedMs=90000)
        with self.assertRaises(ValueError):m.ingest(self.db,[bad])
        result=m.aggregate(self.db,dt.date(2026,10,21))
        self.assertNotIn(self.event['id'],json.dumps(result))
        with self.assertRaises(ValueError):m.ingest(self.db,[dict(self.event,artist='Other')])
        self.assertEqual(self.db.execute('SELECT count(*) FROM listens').fetchone()[0],1)
    def test_unchanged_publication_skipped_and_retry_after_failure(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):return b'{"ok":true}'
        with patch.dict(m.os.environ,{'HOMELAB_TOKEN':'test-token'}),patch('listening_musicbrainz.enrich_album_artwork'),patch.object(m.urllib.request,'build_opener') as opener:
            opener.return_value.open.side_effect=OSError('offline')
            with self.assertRaises(OSError):m.publish(self.db)
            opener.return_value.open.side_effect=None;opener.return_value.open.return_value=Response()
            m.publish(self.db);m.publish(self.db)
            self.assertEqual(opener.return_value.open.call_count,2)
            m.ingest(self.db,[self.event])
            m.publish(self.db)
            self.assertEqual(opener.return_value.open.call_count,2,'changed summaries still respect the minute throttle')
            self.db.execute('UPDATE live_publication SET sent_at=sent_at-60')
            m.publish(self.db)
            self.assertEqual(opener.return_value.open.call_count,3,'changed history publishes after the throttle')
    def test_live_includes_today_and_recent_period_bounds(self):
        m.ingest(self.db,[self.event])
        result=m.aggregate(self.db,dt.date(2026,10,20),include_today=True)
        self.assertEqual(result['through'],'2026-10-20')
        self.assertEqual(result['ranges']['7']['plays'],1)
        self.assertEqual(result['daily'][-1]['day'],'2026-10-20')
        self.assertEqual(result['daily'][-1]['listenedMs'],40000)
        self.assertEqual(m.aggregate(self.db,dt.date(2026,10,27),include_today=True)['ranges']['7']['plays'],0)

    def test_short_skip_not_counted_and_today_excluded(self):
        short=dict(self.event,updatedAt=self.event['startedAt']+10000,listenedMs=10000,days={'2026-10-20':10000})
        m.ingest(self.db,[short])
        self.assertEqual(m.aggregate(self.db,dt.date(2026,10,21))['ranges']['all']['plays'],0)
        self.assertEqual(m.aggregate(self.db,dt.date(2026,10,20))['ranges']['all']['listenedMs'],0)

if __name__=='__main__':unittest.main()
