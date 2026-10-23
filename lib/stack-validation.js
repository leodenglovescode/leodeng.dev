export const STACK_PATH = 'src/content/stack.json'
export const STACK_ICON_NAMES = ['desktop', 'laptop', 'phone', 'watch', 'mic', 'camera', 'layers', 'code', 'cpu', 'database', 'globe', 'cloud', 'music', 'headphones']

export function validateStack(data) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value)
  const text = (value, required = false) => object(value) && typeof value.en === 'string' && typeof value.zh === 'string'
    && value.en.length <= 4000 && value.zh.length <= 4000 && (!required || value.en.trim())
  if (!object(data)) throw new Error('Expected stack content.')
  for (const section of ['hardware', 'software']) {
    if (!Array.isArray(data[section]) || data[section].length > 100) throw new Error(`Invalid ${section} list.`)
    for (const item of data[section]) {
      if (!object(item) || !text(item.name, true) || !text(item.description) || !STACK_ICON_NAMES.includes(item.icon)) {
        throw new Error('Each entry needs an English name, bilingual text fields and a valid icon.')
      }
      if (section === 'hardware' && item.group != null && !['computers', 'gear'].includes(item.group)) throw new Error('Choose a valid device display group.')
      if (section === 'hardware' && (typeof item.model !== 'string' || !item.model.trim() || item.model.length > 500)) throw new Error('Each device needs a model.')
      if (!Array.isArray(item.rows) || item.rows.length > 100 || item.rows.some(row => !object(row) || !text(row.label, true) || !text(row.value, true))) {
        throw new Error('Each detail needs an English label and value. Chinese fields are optional.')
      }
      if (section === 'software' && (!Array.isArray(item.tags) || item.tags.length > 100 || item.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 200))) {
        throw new Error('Software tags must be nonempty text.')
      }
    }
  }
  return data
}
