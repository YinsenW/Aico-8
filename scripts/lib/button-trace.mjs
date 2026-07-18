const TRACE_RATES = new Set([30, 60])

export function validateButtonTrace(value) {
  const errors = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['$ must be an object']
  const required = ['name', 'tick_rate', 'update_count', 'meaning', 'spans']
  const allowed = new Set(required)
  for (const key of required) if (!(key in value)) errors.push(`$.${key} is required`)
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`$.${key} is not allowed`)
  if (typeof value.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(value.name)) {
    errors.push('$.name must be a valid trace name')
  }
  if (!TRACE_RATES.has(value.tick_rate)) errors.push('$.tick_rate must equal 30 or 60')
  if (!Number.isSafeInteger(value.update_count) || value.update_count < 1 || value.update_count > 1_000_000) {
    errors.push('$.update_count must be an integer from 1 through 1000000')
  }
  if (typeof value.meaning !== 'string' || value.meaning.length === 0) {
    errors.push('$.meaning must be a non-empty string')
  }
  if (!Array.isArray(value.spans) || value.spans.length === 0) {
    errors.push('$.spans must be a non-empty array')
    return errors
  }
  let expectedFrom = 1
  for (const [index, span] of value.spans.entries()) {
    const path = `$.spans[${index}]`
    if (!span || typeof span !== 'object' || Array.isArray(span)) {
      errors.push(`${path} must be an object`)
      continue
    }
    const keys = ['from_update', 'through_update', 'player_0_mask']
    const spanAllowed = new Set(keys)
    for (const key of keys) if (!(key in span)) errors.push(`${path}.${key} is required`)
    for (const key of Object.keys(span)) if (!spanAllowed.has(key)) errors.push(`${path}.${key} is not allowed`)
    if (!Number.isSafeInteger(span.from_update) || span.from_update !== expectedFrom) {
      errors.push(`${path}.from_update must continue exact coverage at update ${expectedFrom}`)
    }
    if (!Number.isSafeInteger(span.through_update) || span.through_update < span.from_update) {
      errors.push(`${path}.through_update must be an integer at or after from_update`)
    }
    if (!Number.isSafeInteger(span.player_0_mask) || span.player_0_mask < 0 || span.player_0_mask > 0x3f) {
      errors.push(`${path}.player_0_mask must be an integer from 0 through 63`)
    }
    if (Number.isSafeInteger(span.through_update)) expectedFrom = span.through_update + 1
  }
  if (Number.isSafeInteger(value.update_count) && expectedFrom !== value.update_count + 1) {
    errors.push(`$.spans must cover exactly updates 1 through ${value.update_count}`)
  }
  return errors
}

export function expandButtonTraceHostMasks(value) {
  const errors = validateButtonTrace(value)
  if (errors.length > 0) throw new TypeError(`Invalid button trace:\n${errors.join('\n')}`)
  const updates = []
  for (const span of value.spans) {
    for (let update = span.from_update; update <= span.through_update; update += 1) {
      updates.push(span.player_0_mask)
    }
  }
  const hostTicksPerUpdate = value.tick_rate === 30 ? 2 : 1
  return updates.flatMap((mask) => Array(hostTicksPerUpdate).fill(mask))
}
