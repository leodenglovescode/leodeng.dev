export function legacyMediaKey(pathname) {
  const match = pathname.match(/^\/_assets\/media\/([a-f0-9]{64}\.jpg)$/)
  if (match) return `legacy/images/${match[1]}`
  const playing = pathname.match(/^\/_assets\/playing\/([a-f0-9]{64}\.(?:jpg|png))$/)
  return playing ? `now-playing/artwork/${playing[1]}` : null
}
