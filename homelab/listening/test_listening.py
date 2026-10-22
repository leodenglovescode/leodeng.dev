import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('listening',Path(__file__).with_name('listening.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ListeningTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.db=m.connect(str(Path(self.tmp.name)/'history.db'))
        start=int(dt.datetime(2026,10,20,12,tzinfo=dt.timezone.utc).timestamp()*1000)
        self.event=dict(id='a'*32,title='Song',artist='Artist',album='Album',durationMs=180000,startedAt=start,updatedAt=start+40000,listenedMs=40000,days={'2026-10-20':40000})
    def tearDown(self):self.db.close();self.tmp.cleanup()
    def test_dedup_backfill_and_ranges(self):
        for _ in range(3):m.ingest(self.db,[self.event])
        result=m.aggregate(self.db,dt.date(2026,10,21))
        self.assertEqual(result['ranges']['7']['plays'],1)
        self.assertEqual(result['ranges']['all']['listenedMs'],40000)
        self.assertEqual(result['ranges']['all']['artists'][0]['name'],'Artist')
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
    def test_daily_publication_once_and_retry_after_failure(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):return b'{"ok":true}'
        with patch.dict(m.os.environ,{'HOMELAB_TOKEN':'test-token'}),patch.object(m.urllib.request,'build_opener') as opener:
            opener.return_value.open.side_effect=OSError('offline')
            with self.assertRaises(OSError):m.publish(self.db)
            opener.return_value.open.side_effect=None;opener.return_value.open.return_value=Response()
            m.publish(self.db);m.publish(self.db)
            self.assertEqual(opener.return_value.open.call_count,2)
    def test_short_skip_not_counted_and_today_excluded(self):
        short=dict(self.event,updatedAt=self.event['startedAt']+10000,listenedMs=10000,days={'2026-10-20':10000})
        m.ingest(self.db,[short])
        self.assertEqual(m.aggregate(self.db,dt.date(2026,10,21))['ranges']['all']['plays'],0)
        self.assertEqual(m.aggregate(self.db,dt.date(2026,10,20))['ranges']['all']['listenedMs'],0)

if __name__=='__main__':unittest.main()
