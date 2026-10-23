import assert from 'node:assert/strict'
import test from 'node:test'
import { artworkQuery, artworkCacheKey, isRankedArtwork, albumArtworkContext, lookupMusicArtwork, validArtwork } from '../../lib/musicArtwork.js'
import { onRequest } from '../api/stats/music-artwork.js'
import { musicSummary } from '../../lib/musicStats.js'
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const query={kind:'albums',name:'Example Album',artist:'Example Artist'}
const context={sampleTracks:['Played Song'],catalogMatch:{releaseGroupId:id,matchedTracks:['Played Song']}}
const image={image:`https://coverartarchive.org/release-group/${id}/front-250`,source:`https://musicbrainz.org/release-group/${id}`,provider:'MusicBrainz / Cover Art Archive'}
const period={plays:1,listenedMs:40000,artists:[],tracks:[],albums:[{name:query.name,artist:query.artist,plays:1,listenedMs:40000,...context}]}
const summary={through:'2026-01-01',ranges:{'7':period,'30':period,all:period},daily:[]}
test('artwork queries are bounded and only existing rankings may be searched',async()=>{
 assert.deepEqual(artworkQuery('https://example.com?kind=albums&name=Example%20Album&artist=Example%20Artist&v=3'),query)
 for(const q of ['kind=tracks&name=x','kind=albums&name=x','kind=artists&name=x&url=https://evil.test','kind=artists&name=x&name=y','kind=albums&name=x&artist=y&track=untrusted'])assert.throws(()=>artworkQuery('https://example.com?'+q))
 assert.equal(isRankedArtwork(summary,query),true)
 assert.equal(isRankedArtwork(summary,{...query,artist:'Other'}),false)
 assert.equal(validArtwork(image),true)
 assert.equal(validArtwork({...image,image:'https://evil.test/image.jpg'}),false)
 assert.equal(validArtwork({...image,source:'javascript:alert(1)'}),false)
})
test('every album requires played-song verification, with no name-only or per-band fallback',async()=>{
 const fetcher=()=>{throw new Error('album name search must not run')}
 assert.equal(await lookupMusicArtwork(query,fetcher),null)
 assert.deepEqual(await lookupMusicArtwork(query,fetcher,context),image)
 assert.equal(await lookupMusicArtwork({kind:'albums',name:'Weezer (Deluxe Edition)',artist:'Weezer'},fetcher),null)
 assert.equal(await lookupMusicArtwork({kind:'albums',name:'Weezer (Green Album)',artist:'Weezer'},fetcher),null)
 assert.deepEqual(albumArtworkContext(summary,query),context)
 const conflict=structuredClone(summary)
 conflict.ranges['7']=structuredClone(period);conflict.ranges['7'].albums[0].catalogMatch.releaseGroupId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
 assert.equal(albumArtworkContext(conflict,query).catalogMatch,undefined)
 assert.notEqual(await artworkCacheKey(query,context),await artworkCacheKey(query,{...context,sampleTracks:['Another Song']}))
})
test('artist matching remains exact and safe',async()=>{
 const artist={kind:'artists',name:'Example Artist',artist:''}
 const row={strArtist:'Example Artist',idArtist:'123',strArtistThumb:'https://r2.theaudiodb.com/images/media/artist/thumb/test.jpg'}
 const run=rows=>lookupMusicArtwork(artist,async()=>Response.json({artists:rows}))
 assert.equal((await run([row])).source,'https://www.theaudiodb.com/artist/123')
 assert.equal(await run([{...row,strArtist:'Other'}]),null)
 assert.equal(await run([row,row]),null)
 assert.equal(await run([{...row,strArtistThumb:'https://evil.test/image.jpg'}]),null)
})
test('cached verified albums are served and missing evidence never triggers provider search',async()=>{
 const key=await artworkCacheKey(query,context)
 const bucket={async get(name){const body=name===key?JSON.stringify({artwork:image,expiresAt:Date.now()+100000}):JSON.stringify(summary);return{size:body.length,text:async()=>body}}}
 const request=new Request('https://example.com?kind=albums&name=Example%20Album&artist=Example%20Artist&v=3')
 const response=await onRequest({request,env:{MEDIA:bucket}})
 assert.equal(response.status,200);assert.deepEqual((await response.json()).artwork,image)
 const unverified=structuredClone(summary);for(const r of Object.values(unverified.ranges))delete r.albums[0].catalogMatch
 const fallback=await onRequest({request,env:{MEDIA:{async get(){const body=JSON.stringify(unverified);return{size:body.length,text:async()=>body}}}}})
 assert.equal(fallback.status,202);assert.equal((await fallback.json()).unverified,true)
})
test('public snapshots reject claimed identities without matching song evidence',()=>{
 const wrong=structuredClone(summary);wrong.ranges.all.albums[0].catalogMatch.matchedTracks=['Song Not Played']
 assert.throws(()=>musicSummary(wrong))
 assert.deepEqual(musicSummary(summary).ranges.all.albums[0].catalogMatch,context.catalogMatch)
})

test('a cached cover for another release group cannot override verified song evidence',async()=>{
 const wrongId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
 const wrong={...image,image:image.image.replace(id,wrongId),source:image.source.replace(id,wrongId)}
 const key=await artworkCacheKey(query,context);let writes=0
 const bucket={async get(name){const body=name===key?JSON.stringify({artwork:wrong,expiresAt:Date.now()+100000}):JSON.stringify(summary);return{size:body.length,text:async()=>body}},async put(){writes++}}
 const response=await onRequest({request:new Request('https://example.com?kind=albums&name=Example%20Album&artist=Example%20Artist&v=3'),env:{MEDIA:bucket}})
 assert.equal(response.status,200);assert.deepEqual((await response.json()).artwork,image);assert.equal(writes,1)
})
