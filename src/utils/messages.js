const modules = import.meta.glob('../locales/*/*.json', {
  eager: true,
  import: 'default',
})

const messages = { en: {}, 'zh-CN': {} }

for (const [file, contents] of Object.entries(modules)) {
  const match = file.match(/\/locales\/(en|zh-CN)\/([^/]+)\.json$/)
  if (!match) continue
  messages[match[1]][match[2]] = contents
}

function lookup(object, key) {
  return key.split('.').reduce((value, part) => value?.[part], object)
}

export function message(locale, namespace, key) {
  const localeName = locale === 'zh' ? 'zh-CN' : 'en'
  return lookup(messages[localeName]?.[namespace], key)
    ?? lookup(messages.en?.[namespace], key)
    ?? key
}
