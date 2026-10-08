// Only these recordings can be requested by the guest's audio bridge.
// MP3 copies provide browser playback; the original ALAC M4A files stay on R2.
export const recordings = Object.freeze({
  en: "https://media.leodeng.dev/voice/welcome-browser-845145767ca9.mp3",
  zh: "https://media.leodeng.dev/voice/welcome-chinese-browser-c48883aeaafa.mp3",
})

export const recordingDownloads = Object.freeze(Object.fromEntries(
  Object.entries(recordings).map(([language, url]) => [language, '/api/terminal-audio/' + url.split('/').at(-1)]),
))
