import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const OFFICIAL_PROBE_CAPTURE_SCHEMA_VERSION = 3
export const LEGACY_OFFICIAL_PROBE_CAPTURE_SCHEMA_VERSION = 2
export const OFFICIAL_ORACLE = 'authorized-official-pico8'
export const LEGACY_OFFICIAL_ORACLE = 'licensed-official-pico8'
export const OFFICIAL_ORACLE_CHANNELS = Object.freeze({
  desktop: 'desktop-licensed',
  education: 'education-web-authorized',
})
export const OFFICIAL_EDUCATION_PAGE_URL = 'https://www.pico-8-edu.com/'
export const OFFICIAL_EDUCATION_LOAD_METHODS = Object.freeze([
  'local-cart-file-selection',
  'official-drag-drop-data-path',
])
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

function normalizedArtifactPath(value) {
  if (typeof value !== 'string' || value.trim() === '' || path.isAbsolute(value)) return undefined
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'))
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) return undefined
  return normalized
}

function artifactMediaType(relativePath) {
  const extension = path.extname(relativePath).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.wav') return 'audio/wav'
  if (extension === '.csv') return 'text/csv'
  return undefined
}

export function collectOfficialProbeArtifacts(workingDirectory, specifications, artifactRoot) {
  const attachments = []
  const errors = []
  const seen = new Set()
  const workingRoot = path.resolve(workingDirectory)
  for (const specification of specifications) {
    const relativePath = normalizedArtifactPath(specification)
    if (!relativePath) {
      errors.push(`artifact path is unsafe: ${specification}`)
      continue
    }
    if (seen.has(relativePath)) {
      errors.push(`artifact path is duplicated: ${relativePath}`)
      continue
    }
    seen.add(relativePath)
    const mediaType = artifactMediaType(relativePath)
    if (!mediaType) {
      errors.push(`artifact type must be .png, .wav, or .csv: ${relativePath}`)
      continue
    }
    const source = path.resolve(workingRoot, relativePath)
    if (!source.startsWith(`${workingRoot}${path.sep}`)) {
      errors.push(`artifact path escapes the isolated capture directory: ${relativePath}`)
      continue
    }
    const stat = fs.lstatSync(source, { throwIfNoEntry: false })
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      errors.push(`declared artifact was not produced as a regular file: ${relativePath}`)
      continue
    }
    const destination = path.resolve(artifactRoot, relativePath)
    if (!destination.startsWith(`${path.resolve(artifactRoot)}${path.sep}`)) {
      errors.push(`artifact destination escapes its capture directory: ${relativePath}`)
      continue
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
    attachments.push({
      sourceRelativePath: relativePath,
      relativePath: path.posix.join(path.basename(artifactRoot), relativePath),
      mediaType,
      bytes: stat.size,
      sha256: sha256File(source),
    })
  }
  return { attachments, errors }
}

export function validateOfficialProbeArtifactFiles(capture, capturePath) {
  const errors = []
  for (const attachment of capture.attachments ?? []) {
    const relativePath = normalizedArtifactPath(attachment.relativePath)
    if (!relativePath) {
      errors.push('attachment relativePath must stay below the capture directory')
      continue
    }
    const captureDirectory = path.dirname(path.resolve(capturePath))
    const file = path.resolve(captureDirectory, relativePath)
    if (!file.startsWith(`${captureDirectory}${path.sep}`)) {
      errors.push(`attachment escapes capture directory: ${relativePath}`)
      continue
    }
    const stat = fs.lstatSync(file, { throwIfNoEntry: false })
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      errors.push(`attachment is missing or not a regular file: ${relativePath}`)
      continue
    }
    if (stat.size !== attachment.bytes || sha256File(file) !== attachment.sha256) {
      errors.push(`attachment size or digest mismatch: ${relativePath}`)
    }
  }
  return errors
}

export function validateOfficialProbeCapture(capture, expectedEvents) {
  const errors = []
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
    return ['capture must be an object']
  }
  const legacyDesktop = capture.schemaVersion === LEGACY_OFFICIAL_PROBE_CAPTURE_SCHEMA_VERSION
    && capture.oracle === LEGACY_OFFICIAL_ORACLE
  const current = capture.schemaVersion === OFFICIAL_PROBE_CAPTURE_SCHEMA_VERSION
    && capture.oracle === OFFICIAL_ORACLE
  if (!legacyDesktop && !current) {
    errors.push(`schemaVersion/oracle must identify authorized official capture schema ${OFFICIAL_PROBE_CAPTURE_SCHEMA_VERSION}`)
  }
  const channel = legacyDesktop ? OFFICIAL_ORACLE_CHANNELS.desktop : capture.oracleChannel
  if (current && capture.authorizedOfficialRuntimeDeclaration !== true) {
    errors.push('capture must explicitly declare an authorized official PICO-8 runtime')
  }
  if (channel === OFFICIAL_ORACLE_CHANNELS.desktop) {
    if (capture.licensedRuntimeDeclaration !== true) {
      errors.push('desktop capture must explicitly declare a licensed official PICO-8 runtime')
    }
  } else if (channel === OFFICIAL_ORACLE_CHANNELS.education) {
    const provenance = capture.educationProvenance
    if (capture.authorizedEducationRuntimeDeclaration !== true
        || capture.operatorArtifactDeclaration !== true) {
      errors.push('Education capture requires official-runtime and operator-artifact declarations')
    }
    if (provenance?.officialPageUrl !== OFFICIAL_EDUCATION_PAGE_URL) {
      errors.push(`Education officialPageUrl must be ${OFFICIAL_EDUCATION_PAGE_URL}`)
    }
    let trustedAsset = false
    try {
      const url = new URL(provenance?.runtimeAssetUrl)
      trustedAsset = url.protocol === 'https:' && url.hostname === 'www.pico-8-edu.com'
        && url.pathname.startsWith('/play/')
        && path.posix.basename(url.pathname) === provenance?.runtimeAssetFilename
    } catch {}
    if (!trustedAsset) errors.push('Education runtime asset must use the official pico-8-edu.com/play/ origin')
    if (!OFFICIAL_EDUCATION_LOAD_METHODS.includes(provenance?.manualStep)) {
      errors.push('Education capture must record a bounded official cart-load method')
    }
    for (const field of ['runtimeAssetFilename', 'browserName', 'browserVersion', 'eventLogSha256']) {
      if (typeof provenance?.[field] !== 'string' || provenance[field].trim() === '') {
        errors.push(`Education ${field} must be a non-empty string`)
      }
    }
    if (typeof provenance?.eventLogSha256 === 'string'
        && !/^[a-f0-9]{64}$/.test(provenance.eventLogSha256)) {
      errors.push('Education eventLogSha256 must be a lowercase SHA-256 digest')
    }
  } else if (current) {
    errors.push('oracleChannel must identify a supported authorized official runtime')
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
  if (capture.returncode !== 0) errors.push('official capture workflow did not complete successfully')
  if (!Array.isArray(capture.events) || capture.events.some((event) =>
    !Array.isArray(event) || event.length !== 2
    || event.some((value) => typeof value !== 'string'))) {
    errors.push('events must be ordered [name,value] string pairs')
  }
  if (expectedEvents !== undefined
      && JSON.stringify(capture.events) !== JSON.stringify(expectedEvents)) {
    errors.push('captured events do not match the declared expectation')
  }
  if (!Array.isArray(capture.attachments) || capture.attachments.some((attachment) => {
    const relativePath = normalizedArtifactPath(attachment?.relativePath)
    const sourceRelativePath = normalizedArtifactPath(attachment?.sourceRelativePath)
    return !relativePath || !sourceRelativePath
      || !['image/png', 'audio/wav', 'text/csv'].includes(attachment.mediaType)
      || !Number.isSafeInteger(attachment.bytes) || attachment.bytes < 0
      || typeof attachment.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(attachment.sha256)
  })) {
    errors.push('attachments must be safe hashed PNG/WAV/CSV metadata records')
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
  attachments = [],
  capturedAt = new Date().toISOString(),
  hostPlatform = process.platform,
  hostArchitecture = process.arch,
}) {
  const capture = {
    schemaVersion: OFFICIAL_PROBE_CAPTURE_SCHEMA_VERSION,
    oracle: OFFICIAL_ORACLE,
    oracleChannel: OFFICIAL_ORACLE_CHANNELS.desktop,
    authorizedOfficialRuntimeDeclaration: true,
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
    attachments,
  }
  return capture
}

export function buildOfficialEducationProbeCapture({
  probe,
  runtimeVersion,
  runtimeSha256,
  runtimeAssetUrl,
  runtimeAssetFilename,
  cartSha256,
  browserName,
  browserVersion,
  loadMethod = 'local-cart-file-selection',
  eventLogSha256,
  output,
  attachments = [],
  capturedAt = new Date().toISOString(),
  hostPlatform = process.platform,
  hostArchitecture = process.arch,
}) {
  return {
    schemaVersion: OFFICIAL_PROBE_CAPTURE_SCHEMA_VERSION,
    oracle: OFFICIAL_ORACLE,
    oracleChannel: OFFICIAL_ORACLE_CHANNELS.education,
    authorizedOfficialRuntimeDeclaration: true,
    authorizedEducationRuntimeDeclaration: true,
    operatorArtifactDeclaration: true,
    probe,
    runtimeVersion,
    runtimeSha256,
    cartSha256,
    hostPlatform,
    hostArchitecture,
    capturedAt,
    command: ['education-web', 'load-local-cart', probe],
    returncode: 0,
    events: parseProbeEvents(output),
    attachments,
    educationProvenance: {
      officialPageUrl: OFFICIAL_EDUCATION_PAGE_URL,
      runtimeAssetUrl,
      runtimeAssetFilename,
      browserName,
      browserVersion,
      manualStep: loadMethod,
      eventLogSha256,
    },
  }
}
