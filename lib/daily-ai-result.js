// Only fixed public error identifiers and bounded numeric metrics cross the relay.
export const LIVE_ERROR_CODES = ['empty_answer', 'stream_incomplete', 'output_limit', 'model_unavailable',
  'generation_timeout', 'runner_disconnected', 'runner_reconnected', 'generation_cancelled',
  'controls_changed', 'invalid_sources', 'inference_failed']

export function generationStats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { durationMs, tokens, evalDurationNs, promptTokens, passes, finishReason } = value
  const nullableInteger = (number, max) => number === null || Number.isSafeInteger(number) && number >= 0 && number <= max
  if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 650000
      || !nullableInteger(tokens, 100000) || !nullableInteger(evalDurationNs, 650e9)
      || !nullableInteger(promptTokens, 100000) || ![1, 2].includes(passes)
      || !['stop', 'length', 'unknown'].includes(finishReason)) return null
  return { durationMs, tokens, evalDurationNs, promptTokens, passes, finishReason,
    tokensPerSecond: tokens !== null && evalDurationNs > 0 ? tokens / (evalDurationNs / 1e9) : null }
}
