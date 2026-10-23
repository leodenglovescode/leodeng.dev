import sqlite3
import unittest
from unittest.mock import Mock
import listening_musicbrainz as m

A='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
B='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

def response(artist,album,song,ids):
    return {'count':1,'recordings':[{'title':song,'artist-credit':[{'artist':{'name':artist}}],
        'releases':[{'release-group':{'id':value,'title':album,'primary-type':'Album'}} for value in ids]}]}

class AlbumMatchingTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');m.schema(self.db)
    def tearDown(self):self.db.close()
    def test_multiple_songs_intersect_membership_instead_of_first_name_match(self):
        client=Mock()
        client.search.side_effect=lambda artist,album,track:response(artist,album,track,[B,A] if track=='Shared Song' else [A])
        match=m.identify_album(self.db,'Example Band','Same Title',['Shared Song','Unique Song'],client,1000)
        self.assertEqual(match['releaseGroupId'],A)
        self.assertEqual(set(match['matchedTracks']),{'Shared Song','Unique Song'})
        self.assertEqual(client.search.call_count,2)
        m.identify_album(self.db,'Example Band','Same Title',['Unique Song','Shared Song'],client,1100)
        self.assertEqual(client.search.call_count,2,'validated matches are cached regardless of sample ordering')
    def test_wrong_album_song_absence_and_ambiguity_never_return_a_cover_identity(self):
        for ids in ([],[A,B]):
            client=Mock();client.search.return_value=response('Other Band','Self Titled','Only Song',ids)
            match=m.identify_album(self.db,'Other Band','Self Titled',['Only Song'],client,2000+len(ids)*100000)
            self.assertIsNone(match)
        client=Mock();client.search.return_value=response('Other Band','Wrong Album','Only Song',[A])
        self.assertIsNone(m.identify_album(self.db,'Other Band','Expected Album',['Only Song'],client,1000))
    def test_song_search_compares_titles_artists_and_ignores_truncated_results(self):
        data=response('Band','Album','Track',[A])
        self.assertEqual(m.candidate_groups(data,'Other Artist','Album','Track'),{})
        self.assertEqual(m.candidate_groups(data,'Band','Album','Different Song'),{})
        with self.assertRaises(ValueError):m.candidate_groups(dict(data,count=101),'Band','Album','Track')
        self.assertEqual(m.normalized("Say It Ain't So"),m.normalized('Say It Ain’t So'))
        self.assertEqual(m.track_title('Go Away (feat. Best Coast)'),'Go Away')
        self.assertEqual(m.album_identity('The Dark Side of the Moon (50th Anniversary) [Remastered]'),('The Dark Side of the Moon',''))
        self.assertNotEqual(m.track_title('Track (Live)'),m.track_title('Track'))
    def test_weezer_regression_is_resolved_from_songs_without_an_album_exception(self):
        blue='c7b245c9-8099-32ea-af95-893acedde2cf';green='923d5ba6-7eee-3bce-bcb2-c913b2bd69d4'
        client=Mock()
        def search(artist,album,track):
            data=response(artist,album,track,[blue] if track=="Say It Ain't So" else [green])
            group=data['recordings'][0]['releases'][0]['release-group'];group['disambiguation']='Blue Album' if track=="Say It Ain't So" else 'Green Album'
            return data
        client.search.side_effect=search
        self.assertEqual(m.identify_album(self.db,'Weezer','Weezer (Deluxe Edition)',["Say It Ain't So"],client,1000)['releaseGroupId'],blue)
        self.assertEqual(m.identify_album(self.db,'Weezer','Weezer (Green Album)',['Hash Pipe'],client,1000)['releaseGroupId'],green)
        self.assertIsNone(m.identify_album(self.db,'Weezer','Weezer (Green Album)',["Say It Ain't So"],client,1000))
    def test_original_and_anniversary_groups_require_matching_tracks_then_exact_album_label(self):
        client=Mock()
        data=response('Band','Album','Track',[B,A])
        data['recordings'][0]['releases'][0]['release-group']['title']='Album (30th Anniversary Super Deluxe)'
        client.search.return_value=data
        self.assertEqual(m.identify_album(self.db,'Band','Album',['Track'],client,1000)['releaseGroupId'],A)

    def test_unavailable_catalog_does_not_block_stats_or_create_verified_identity(self):
        album={'name':'Album','artist':'Band','sampleTracks':['Track']}
        value={'ranges':{'all':{'albums':[album]}}}
        client=Mock();client.search.side_effect=OSError('offline')
        m.enrich_album_artwork(self.db,[value],client,1000)
        self.assertNotIn('catalogMatch',album)

if __name__=='__main__':unittest.main()
