import { lookupLyrics } from '../../lib/lyricsProxy.js'

export function onRequest({ request }) { return lookupLyrics(request) }
