import { artworkQuery, artworkCacheKey, isRankedArtwork, lookupMusicArtwork, validArtwork } from '../../../lib/musicArtwork.js'
import { musicSchema } from '../../../lib/musicStats.js'
export async function onRequest({ request, env }) {
  const reply = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':status===200?'public, max-age=3600':'no-store','X-Content-Type-Options':'nosniff'}})
  if (request.method !== 'GET') return reply({ error:'Method not allowed' },405)
  let query
  try { query=artworkQuery(request.url) } catch { return reply({ error:'Invalid query' },400) }
  if (!env.MEDIA) return reply({ artwork:null },503)
  const key=await artworkCacheKey(query)
  try {
    const object=await env.MEDIA.get(key)
    if (object && object.size<=8192) {
      const cached=JSON.parse(await object.text())
      if (Number.isFinite(cached.expiresAt) && cached.expiresAt>Date.now() && (cached.artwork===null || validArtwork(cached.artwork))) return reply({artwork:cached.artwork})
    }
    if (new URL(request.url).searchParams.get('cached') === '1') return reply({ artwork:null, pending:true },202)
    // Only resolve items already present in the public rankings. This cannot
    // be used as an arbitrary search proxy or to fetch caller-supplied URLs.
    let summary
    const live=await env.MEDIA.get('stats/music-live.json')
    if (live && live.size<=100000) summary=JSON.parse(await live.text())
    if (!summary && env.HOMELAB_DB) {
      await musicSchema(env.HOMELAB_DB)
      const row=await env.HOMELAB_DB.prepare('SELECT payload, received_at FROM music_summary WHERE id=1').first()
      if (row) summary=JSON.parse(row.payload)
    }
    if (!isRankedArtwork(summary,query)) return reply({ artwork:null },404)
    const artwork=await lookupMusicArtwork(query)
    // Cache successful matches for a month, genuine misses for one day.
    // HTTP errors are not cached as misses, so a rate limit can recover.
    await env.MEDIA.put(key,JSON.stringify({artwork,expiresAt:Date.now()+(artwork?30:1)*86400000}),{httpMetadata:{contentType:'application/json',cacheControl:'no-store'}})
    return reply({artwork})
  } catch { return reply({artwork:null},503) }
}
