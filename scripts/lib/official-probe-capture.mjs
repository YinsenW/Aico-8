import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const OFFICIAL_PROBE_CAPTURE_SCHEMA_VERSION = 1
export const OFFICIAL_ORACLE = 'licensed-official-pico8'
const EVENT_PREFIX = 'p8probe|'

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function parseProbeEvents(output) {
  const events = []
  for (const line of String(output).split(/\r?\n/)) {
    const marker = line.indexOf(EVENT_PREFIX)
    if (marker < 0) continue
    const payload = line.slice(marker + EVENT_PREFIX.length)
    const separator = payload.indexOf('|')
    if (separator < 1) continue
    events.push([payload.slice(0, separator), payload.slice(separator + 1)])
  }
  return events
}

export function isPrivateOfficialCapturePath(root, output) {
  const captureRoot = path.resolve(root, 'captures/official')
  const resolved = path.resolve(output)
  return resolved.startsWith(`${captureRoot}${path.sep}`)
}

export function validateOfficialProbeCapture(capture, expectedEvents) {
  const errors = []
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
    return ['capture must be an object']
  }
  if (capture.schemaVersion !== OFFICIAL_PROBE_CAPTURE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${OFFICIAL_PROBE_CAPTURE_SCHEMA_VERSION}`)
  }
  if (capture.oracle !== OFFICIAL_ORACLE || capture.licensedRuntimeDeclaration !== true) {
    errors.push('capture must explicitly declare a licensed official PICO-8 oracle')
  }
  for (const field of ['probe', 'runtimeVersion', 'hostPlatform', 'hostArchitecture']) {
    if (typeof capture[field] !== 'string' || capture[field].trim() === '') {
      errors.push(`${field} must be a non-empty string`)
    }
  }
  for (const field of ['cartSha256', 'runtimeSha256']) {
    if (typeof capture[field] !== 'string' || !/^[a-f0-9]{64}$/.test(capture[field])) {
      errors.push(`${field} must be a lowercase SHA-256 digest`)
    }
  }
  if (capture.returncode !== 0) errors.push('official runtime did not exit successfully')
  if (!Array.isArray(capture.events) || capture.events.some((event) =>
    !Array.isArray(event) || event.length !== 2
    || event.some((value) => typeof value !== 'string'))) {
    errors.push('events must be ordered [name,value] string pairs')
  }
  if (expectedEvents !== undefined
      && JSON.stringify(capture.events) !== JSON.stringify(expectedEvents)) {
    errors.push('captured events do not match the declared expectation')
  }
  return errors
}

export function buildOfficialProbeCapture({
  probe,
  runtimeVersion,
  runtimeSha256,
  cartSha256,
  command,
  returncode,
  output,
  capturedAt = new Date().toISOString(),
  hostPlatform = process.platform,
  hostArchitecture = process.arch,
}) {
  const capture = {
    schemaVersion: OFFICIAL_PROBE_CAPTURE_SCHEMA_VERSION,
    oracle: OFFICIAL_ORACLE,
    licensedRuntimeDeclaration: true,
    probe,
    runtimeVersion,
    runtimeSha256,
    cartSha256,
    hostPlatform,
    hostArchitecture,
    capturedAt,
    command,
    returncode,
    events: parseProbeEvents(output),
  }
  return capture
}
