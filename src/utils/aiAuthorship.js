// An absent value means no disclosure was selected, not a claim of human authorship.
export const AI_AUTHORSHIP_LABELS = Object.freeze({
  human: 'Entirely written by me',
  partial: 'Partly written with AI',
  full: 'Entirely written with AI',
})

export function usesAiWriting(value) {
  return value === 'partial' || value === 'full'
}

export function aiAuthorshipLabel(value) {
  return Object.hasOwn(AI_AUTHORSHIP_LABELS, value) ? AI_AUTHORSHIP_LABELS[value] : ''
}

export function aiAuthorshipFields(value, reason) {
  if (!aiAuthorshipLabel(value)) return []
  const explanation = usesAiWriting(value) ? String(reason || '').replace(/\s+/g, ' ').trim() : ''
  return [
    `aiAuthorship: "${value}"`,
    ...(explanation ? [`aiReason: ${JSON.stringify(explanation)}`] : []),
  ]
}
