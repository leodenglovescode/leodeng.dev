import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('content_export',Path(__file__).with_name('export.py'))
backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)

class ExportTests(unittest.TestCase):
    def payload(self):
        post={'path':'src/posts/a.md','raw':'---\ntitle: 中文\n---\nHello\n','revision':'11111111-1111-4111-8111-111111111111','updated_at':'2026-10-23T00:00:00Z','deleted':0}
        shelf={'path':'src/content/shelf.json','raw':'{"items":[]}','revision':'22222222-2222-4222-8222-222222222222','updated_at':post['updated_at'],'deleted':0}
        return {'version':1,'exportedAt':post['updated_at'],'files':[post,shelf],'revisions':[dict(post),dict(shelf)]}
    def test_markdown_revisions_and_deletion_survive(self):
        with tempfile.TemporaryDirectory() as directory:
            data=self.payload();first=backup.save_export(data,directory)
            self.assertEqual((Path(directory)/'latest/posts/a.md').read_text(),data['files'][0]['raw'])
            self.assertEqual(backup.save_export(data,directory),first.resolve())
            data['files'][0]['deleted']=1
            data['files'][0]['revision']='33333333-3333-4333-8333-333333333333'
            data['revisions'].append(dict(data['files'][0]))
            second=backup.save_export(data,directory)
            self.assertFalse((Path(directory)/'latest/posts/a.md').exists())
            self.assertTrue((first/'posts/a.md').exists())
            self.assertTrue((Path(directory)/'revisions/11111111-1111-4111-8111-111111111111/posts/a.md').exists())
            self.assertNotEqual(first,second)
            self.assertEqual(json.loads((second/'sha256.json').read_text()).keys(),{'shelf.json'})
    def test_bad_export_does_not_replace_valid_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            data=self.payload();first=backup.save_export(data,directory)
            data['files'][0]['path']='src/posts/../../secret.md'
            with self.assertRaises(ValueError):backup.save_export(data,directory)
            self.assertEqual((Path(directory)/'latest').resolve(),first.resolve())
            data=self.payload();data['revisions'][0]['revision']='../evil'
            with self.assertRaises(ValueError):backup.save_export(data,directory)
            with self.assertRaises(ValueError):backup.save_export({'version':1,'files':[],'revisions':[]},directory)

if __name__=='__main__':unittest.main()
