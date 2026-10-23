import assert from 'node:assert/strict'
import test from 'node:test'
import { artworkQuery, artworkCacheKey, isRankedArtwork, lookupMusicArtwork, validArtwork } from '../../lib/musicArtwork.js'
import { onRequest } from '../api/stats/music-artwork.js'
const query={kind:'albums',name:'Example Album',artist:'Example Artist'}
const image={image:'https://r2.theaudiodb.com/images/media/album/thumb/test.jpg/small',source:'https://www.theaudiodb.com/album/123',provider:'TheAudioDB'}
const summary={ranges:{all:{albums:[{name:'Example Album',artist:'Example Artist'}]}}}
test('artwork queries are bounded and only existing rankings may be searched',async()=>{
 assert.deepEqual(artworkQuery('https://example.com?kind=albums&name=Example%20Album&artist=Example%20Artist'),query)
 for(const q of ['kind=tracks&name=x','kind=albums&name=x','kind=artists&name=x&url=https://evil.test','kind=artists&name=x&name=y'])assert.throws(()=>artworkQuery('https://example.com?'+q))
 assert.equal(isRankedArtwork(summary,query),true)
 assert.equal(isRankedArtwork(summary,{...query,artist:'Other'}),false)
 assert.equal(await artworkCacheKey(query),await artworkCacheKey({...query,name:'example album'}))
 assert.equal(validArtwork(image),true)
 assert.equal(validArtwork({...image,image:'https://evil.test/image.jpg'}),false)
 assert.equal(validArtwork({...image,source:'javascript:alert(1)'}),false)
})
test('provider matching requires the exact album and artist and refuses ambiguous editions',async()=>{
 const row={strArtist:'Example Artist',strAlbum:'Example Album',idAlbum:'123',strAlbumThumb:'https://r2.theaudiodb.com/images/media/album/thumb/test.jpg'}
 const run=rows=>lookupMusicArtwork(query,async(url,options)=>{assert.equal(new URL(url).hostname,'www.theaudiodb.com');assert.equal(options.redirect,'manual');return Response.json({album:rows})})
 assert.deepEqual(await run([row]),image)
 assert.equal(await run([{...row,strArtist:'Other'}]),null)
 assert.equal(await run([row,row]),null)
 assert.equal(await run([{...row,strAlbumThumb:'https://evil.test/file.jpg'}]),null)
 await assert.rejects(lookupMusicArtwork(query,async()=>Response.json({}, {status:429})))
})
test('cached metadata is served without upstream calls and unknown titles cannot trigger searches',async()=>{
 const key=await artworkCacheKey(query)
 const bucket={async get(name){const body=name===key?JSON.stringify({artwork:image,expiresAt:Date.now()+100000}):JSON.stringify(summary);return{size:body.length,text:async()=>body}}}
 const request=new Request('https://example.com/api/stats/music-artwork?kind=albums&name=Example%20Album&artist=Example%20Artist')
 const response=await onRequest({request,env:{MEDIA:bucket}})
 assert.equal(response.status,200);assert.deepEqual((await response.json()).artwork,image)
 const unknown=await onRequest({request:new Request('https://example.com?kind=artists&name=Unknown'),env:{MEDIA:{async get(){return null}}}})
 assert.equal(unknown.status,404)
 assert.equal((await onRequest({request:new Request('https://example.com',{method:'POST'}),env:{}})).status,405)
})

test('cache-only probes never call the provider on a cold entry',async()=>{
 const response=await onRequest({request:new Request('https://example.com?kind=artists&name=Weezer&cached=1'),env:{MEDIA:{async get(){return null}}}})
 assert.equal(response.status,202)
 assert.equal(response.headers.get('cache-control'),'no-store')
 assert.deepEqual(await response.json(),{artwork:null,pending:true})
})

test('edition labels can use the original cover while colored album identities are preserved',async()=>{
 const row={strArtist:'Example Artist',strAlbum:'Example Album',idAlbum:'123',strAlbumThumb:'https://r2.theaudiodb.com/images/media/album/thumb/test.jpg'}
 const deluxe=await lookupMusicArtwork({...query,name:'Example Album (Deluxe Edition)'},async url=>{
  assert.equal(new URL(url).searchParams.get('a'),'Example Album')
  return Response.json({album:[row]})
 })
 assert.deepEqual(deluxe,image)
 assert.equal(await lookupMusicArtwork({...query,name:'Example Album (Green Album)'},async()=>Response.json({album:[row]})),null)
})

test('self-titled Weezer records use distinct verified catalog IDs without name search',async()=>{
 let searches=0
 const fetcher=async()=>{searches++;throw new Error('name search must not run')}
 const blue=await lookupMusicArtwork({kind:'albums',artist:'Weezer',name:'Weezer (Deluxe Edition)'},fetcher)
 const green=await lookupMusicArtwork({kind:'albums',artist:'Weezer',name:'Weezer (Green Album)'},fetcher)
 assert.match(blue.image,/c7b245c9-8099-32ea-af95-893acedde2cf/)
 assert.match(green.image,/923d5ba6-7eee-3bce-bcb2-c913b2bd69d4/)
 assert.notEqual(blue.image,green.image)
 assert.equal(validArtwork(blue),true);assert.equal(validArtwork(green),true)
 assert.equal(validArtwork({...blue,source:green.source}),false)
 assert.equal(validArtwork({...blue,image:blue.image.replace('https://','https://user:password@')}),false)
 assert.equal(await lookupMusicArtwork({kind:'albums',artist:'Weezer',name:'Weezer'},fetcher),null)
 assert.equal(searches,0)
 assert.notEqual(await artworkCacheKey({kind:'albums',name:'Weezer (Deluxe Edition)',artist:'Weezer'}),await artworkCacheKey({kind:'albums',name:'Weezer (Green Album)',artist:'Weezer'}))
 assert.match(await artworkCacheKey(query),/^stats\/artwork\/v2\//)
})
