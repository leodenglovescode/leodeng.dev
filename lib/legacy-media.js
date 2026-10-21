export function legacyMediaKey(pathname) {
  const gallery = pathname.match(/^\/_assets\/gallery\/(gallery-[a-f0-9-]{36}-(?:legacy-thumb|legacy-full|full)\.(?:jpg|jpeg|png))$/)
  if (gallery) return gallery[1]
  const match = pathname.match(/^\/_assets\/media\/([a-f0-9]{64}\.jpg)$/)
  if (match) return `legacy/images/${match[1]}`
  const playing = pathname.match(/^\/_assets\/playing\/([a-f0-9]{64}\.(?:jpg|png))$/)
  return playing ? `now-playing/artwork/${playing[1]}` : null
}
