import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  sha256File,
  validateOfficialProbeArtifactFiles,
  validateOfficialProbeCapture,
} from './official-probe-capture.mjs'
import { decodePngRgba } from './png-rgba.mjs'

export const IMPLEMENTATION_CAPTURE_SCHEMA = 'aico8.implementation-probe-capture.v1'
export const OFFICIAL_COMPARISON_SCHEMA = 'aico8.official-probe-comparison.v1'
export const IMPLEMENTATION_AUTHORITY = 'implementation-candidate-not-official-conformance'

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.trim() === '' || path.isAbsolute(value)) return undefined
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'))
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) return undefined
  return normalized
}

function validDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function validEvents(events) {
  return Array.isArray(events) && events.every((event) =>
    Array.isArray(event) && event.length === 2
    && event.every((value) => typeof value === 'string'))
}

function validAttachments(attachments) {
  return Array.isArray(attachments) && attachments.every((attachment) =>
    safeRelativePath(attachment?.relativePath)
    && safeRelativePath(attachment?.sourceRelativePath)
    && ['image/png', 'audio/wav', 'text/csv'].includes(attachment.mediaType)
    && Number.isSafeInteger(attachment.bytes) && attachment.bytes >= 0
    && validDigest(attachment.sha256))
}

export function buildImplementationProbeCapture({
  probe,
  cartSha256,
  backend,
  revision,
  runtimeSha256,
  command,
  events,
  attachments,
  capturedAt = new Date().toISOString(),
}) {
  return {
    schemaVersion: IMPLEMENTATION_CAPTURE_SCHEMA,
    authority: IMPLEMENTATION_AUTHORITY,
    status: 'captured',
    probe,
    cartSha256,
    backend,
    revision,
    runtimeSha256,
    command,
    capturedAt,
    events,
    attachments,
  }
}

export function validateImplementationProbeCapture(capture) {
  const errors = []
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
    return ['candidate capture must be an object']
  }
  if (capture.schemaVersion !== IMPLEMENTATION_CAPTURE_SCHEMA) {
    errors.push(`candidate schemaVersion must be ${IMPLEMENTATION_CAPTURE_SCHEMA}`)
  }
  if (capture.authority !== IMPLEMENTATION_AUTHORITY) {
    errors.push('candidate authority must explicitly deny official conformance')
  }
  if (capture.status !== 'captured') errors.push('candidate capture status must be captured')
  for (const field of ['probe', 'backend', 'revision', 'capturedAt']) {
    if (typeof capture[field] !== 'string' || capture[field].trim() === '') {
      errors.push(`candidate ${field} must be a non-empty string`)
    }
  }
  if (!validDigest(capture.cartSha256)) errors.push('candidate cartSha256 must be a lowercase SHA-256 digest')
  if (!validDigest(capture.runtimeSha256)) errors.push('candidate runtimeSha256 must be a lowercase SHA-256 digest')
  if (!Array.isArray(capture.command) || capture.command.length === 0
      || capture.command.some((part) => typeof part !== 'string' || part === '')) {
    errors.push('candidate command must be a non-empty string array')
  }
  if (!validEvents(capture.events)) errors.push('candidate events must be ordered [name,value] string pairs')
  if (!validAttachments(capture.attachments)) {
    errors.push('candidate attachments must be safe hashed PNG/WAV/CSV metadata records')
  }
  return errors
}

function resolveAttachment(capturePath, attachment) {
  const captureDirectory = path.dirname(path.resolve(capturePath))
  const relativePath = safeRelativePath(attachment.relativePath)
  if (!relativePath) throw new Error('attachment relativePath is unsafe')
  const resolved = path.resolve(captureDirectory, relativePath)
  if (!resolved.startsWith(`${captureDirectory}${path.sep}`)) {
    throw new Error(`attachment escapes capture directory: ${relativePath}`)
  }
  return resolved
}

function attachmentIndex(capture) {
  const index = new Map()
  for (const attachment of capture.attachments) {
    if (index.has(attachment.sourceRelativePath)) {
      throw new Error(`duplicate sourceRelativePath: ${attachment.sourceRelativePath}`)
    }
    index.set(attachment.sourceRelativePath, attachment)
  }
  return index
}

function firstByteMismatch(left, right) {
  const common = Math.min(left.length, right.length)
  for (let index = 0; index < common; index += 1) {
    if (left[index] !== right[index]) return index
  }
  return left.length === right.length ? undefined : common
}

function comparePng(officialBytes, candidateBytes) {
  const official = decodePngRgba(officialBytes)
  const candidate = decodePngRgba(candidateBytes)
  if (official.width !== candidate.width || official.height !== candidate.height) {
    return {
      matches: false,
      officialDimensions: [official.width, official.height],
      candidateDimensions: [candidate.width, candidate.height],
      reason: 'dimensions differ',
    }
  }
  const mismatch = firstByteMismatch(official.rgba, candidate.rgba)
  return mismatch === undefined
    ? { matches: true, width: official.width, height: official.height, pixels: official.width * official.height }
    : {
        matches: false,
        width: official.width,
        height: official.height,
        firstMismatchPixel: Math.floor(mismatch / 4),
        firstMismatchChannel: ['r', 'g', 'b', 'a'][mismatch % 4],
        officialValue: official.rgba[mismatch],
        candidateValue: candidate.rgba[mismatch],
        reason: 'decoded RGBA pixels differ',
      }
}

function decodeWavePcm(bytes) {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF'
      || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('WAV RIFF/WAVE header is invalid')
  }
  let offset = 12
  let format
  let pcm
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + size
    if (end > bytes.length) throw new Error(`WAV ${id} chunk is truncated`)
    if (id === 'fmt ') {
      if (size < 16) throw new Error('WAV fmt chunk is too short')
      format = {
        format: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        byteRate: bytes.readUInt32LE(start + 8),
        blockAlign: bytes.readUInt16LE(start + 12),
        bitsPerSample: bytes.readUInt16LE(start + 14),
      }
    } else if (id === 'data') {
      pcm = Buffer.from(bytes.subarray(start, end))
    }
    offset = end + (size & 1)
  }
  if (!format || !pcm) throw new Error('WAV must contain fmt and data chunks')
  if (format.format !== 1 || ![8, 16, 24, 32].includes(format.bitsPerSample)) {
    throw new Error('WAV evidence must use integer PCM with 8, 16, 24, or 32 bits')
  }
  const expectedAlign = format.channels * (format.bitsPerSample / 8)
  if (format.channels === 0 || format.sampleRate === 0 || format.blockAlign !== expectedAlign
      || format.byteRate !== format.sampleRate * format.blockAlign
      || pcm.length % format.blockAlign !== 0) {
    throw new Error('WAV PCM format or data alignment is invalid')
  }
  return { ...format, pcm, sampleFrames: pcm.length / format.blockAlign }
}

function compareWave(officialBytes, candidateBytes) {
  const official = decodeWavePcm(officialBytes)
  const candidate = decodeWavePcm(candidateBytes)
  const fields = ['format', 'channels', 'sampleRate', 'bitsPerSample', 'blockAlign']
  const differingFields = fields.filter((field) => official[field] !== candidate[field])
  if (differingFields.length > 0) {
    return {
      matches: false,
      reason: 'PCM formats differ',
      differingFields,
      officialFormat: Object.fromEntries(fields.map((field) => [field, official[field]])),
      candidateFormat: Object.fromEntries(fields.map((field) => [field, candidate[field]])),
    }
  }
  const mismatch = firstByteMismatch(official.pcm, candidate.pcm)
  return mismatch === undefined
    ? { matches: true, sampleFrames: official.sampleFrames, ...Object.fromEntries(fields.map((field) => [field, official[field]])) }
    : {
        matches: false,
        reason: 'PCM sample bytes differ',
        officialSampleFrames: official.sampleFrames,
        candidateSampleFrames: candidate.sampleFrames,
        firstMismatchByte: mismatch,
        firstMismatchFrame: Math.floor(mismatch / official.blockAlign),
        officialValue: official.pcm[mismatch],
        candidateValue: candidate.pcm[mismatch],
      }
}

function csvRows(bytes) {
  const text = bytes.toString('utf8')
  if (text.includes('\0') || text.includes('"')) {
    throw new Error('CSV evidence must be unquoted UTF-8 numeric trace data')
  }
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (lines.length === 0 || lines.some((line) => line === '')) {
    throw new Error('CSV evidence must contain non-empty rows')
  }
  return lines.map((line) => line.split(','))
}

function compareCsv(officialBytes, candidateBytes) {
  const official = csvRows(officialBytes)
  const candidate = csvRows(candidateBytes)
  const rows = Math.max(official.length, candidate.length)
  for (let row = 0; row < rows; row += 1) {
    if (JSON.stringify(official[row]) !== JSON.stringify(candidate[row])) {
      return {
        matches: false,
        reason: 'CSV cells differ',
        firstMismatchRow: row,
        officialRow: official[row] ?? null,
        candidateRow: candidate[row] ?? null,
        officialRows: official.length,
        candidateRows: candidate.length,
      }
    }
  }
  return { matches: true, rows: official.length, columns: official[0].length }
}

function compareAttachment(mediaType, officialBytes, candidateBytes) {
  if (mediaType === 'image/png') return comparePng(officialBytes, candidateBytes)
  if (mediaType === 'audio/wav') return compareWave(officialBytes, candidateBytes)
  if (mediaType === 'text/csv') return compareCsv(officialBytes, candidateBytes)
  throw new Error(`unsupported comparison media type: ${mediaType}`)
}

function compareEvents(official, candidate) {
  const count = Math.max(official.length, candidate.length)
  for (let index = 0; index < count; index += 1) {
    if (JSON.stringify(official[index]) !== JSON.stringify(candidate[index])) {
      return {
        matches: false,
        officialCount: official.length,
        candidateCount: candidate.length,
        firstMismatchIndex: index,
        officialEvent: official[index] ?? null,
        candidateEvent: candidate[index] ?? null,
      }
    }
  }
  return { matches: true, count: official.length }
}

export function compareOfficialProbeCaptures({ official, officialPath, candidate, candidatePath }) {
  const validationErrors = [
    ...validateOfficialProbeCapture(official).map((error) => `official: ${error}`),
    ...validateOfficialProbeArtifactFiles(official, officialPath).map((error) => `official: ${error}`),
    ...validateImplementationProbeCapture(candidate).map((error) => `candidate: ${error}`),
    ...validateOfficialProbeArtifactFiles(candidate, candidatePath).map((error) => `candidate: ${error}`),
  ]
  if (official.status !== 'captured') validationErrors.push('official: capture status must be captured')
  if (official.probe !== candidate.probe) validationErrors.push('probe identities differ')
  if (official.cartSha256 !== candidate.cartSha256) validationErrors.push('source cart SHA-256 identities differ')
  const report = {
    schemaVersion: OFFICIAL_COMPARISON_SCHEMA,
    oracle: 'licensed-official-pico8-versus-aico8-candidate',
    officialCaptureSha256: sha256File(officialPath),
    candidateCaptureSha256: sha256File(candidatePath),
    probe: official.probe,
    cartSha256: official.cartSha256,
    candidateBackend: candidate.backend,
    candidateRevision: candidate.revision,
    candidateRuntimeSha256: candidate.runtimeSha256,
    validationErrors,
    events: { matches: false, reason: 'comparison not run because validation failed' },
    attachments: [],
    status: 'mismatch',
  }
  if (validationErrors.length > 0) return report
  report.events = compareEvents(official.events, candidate.events)
  let officialAttachments
  let candidateAttachments
  try {
    officialAttachments = attachmentIndex(official)
    candidateAttachments = attachmentIndex(candidate)
  } catch (error) {
    report.validationErrors.push(error.message)
    return report
  }
  const names = [...new Set([...officialAttachments.keys(), ...candidateAttachments.keys()])].sort()
  for (const name of names) {
    const officialAttachment = officialAttachments.get(name)
    const candidateAttachment = candidateAttachments.get(name)
    if (!officialAttachment || !candidateAttachment) {
      report.attachments.push({
        sourceRelativePath: name,
        matches: false,
        reason: officialAttachment ? 'candidate attachment is missing' : 'candidate has an undeclared extra attachment',
      })
      continue
    }
    if (officialAttachment.mediaType !== candidateAttachment.mediaType) {
      report.attachments.push({
        sourceRelativePath: name,
        matches: false,
        reason: 'media types differ',
        officialMediaType: officialAttachment.mediaType,
        candidateMediaType: candidateAttachment.mediaType,
      })
      continue
    }
    try {
      const comparison = compareAttachment(
        officialAttachment.mediaType,
        fs.readFileSync(resolveAttachment(officialPath, officialAttachment)),
        fs.readFileSync(resolveAttachment(candidatePath, candidateAttachment)),
      )
      report.attachments.push({
        sourceRelativePath: name,
        mediaType: officialAttachment.mediaType,
        officialSha256: officialAttachment.sha256,
        candidateSha256: candidateAttachment.sha256,
        ...comparison,
      })
    } catch (error) {
      report.attachments.push({
        sourceRelativePath: name,
        mediaType: officialAttachment.mediaType,
        matches: false,
        reason: error.message,
      })
    }
  }
  report.status = report.events.matches && report.attachments.every(({ matches }) => matches)
    ? 'matched'
    : 'mismatch'
  return report
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
