import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildOfficialProbeCapture } from './official-probe-capture.mjs'
import {
  buildImplementationProbeCapture,
  compareOfficialProbeCaptures,
  IMPLEMENTATION_AUTHORITY,
  sha256Bytes,
  validateImplementationProbeCapture,
} from './official-probe-comparison.mjs'
import { decodePngRgba, encodePngRgba } from './png-rgba.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const digestA = 'a'.repeat(64)
const digestB = 'b'.repeat(64)

function waveChunk(id, data) {
  const result = Buffer.alloc(8 + data.length + (data.length & 1))
  result.write(id, 0, 4, 'ascii')
  result.writeUInt32LE(data.length, 4)
  data.copy(result, 8)
  return result
}

function pcmWave(samples, { junk = false } = {}) {
  const format = Buffer.alloc(16)
  format.writeUInt16LE(1, 0)
  format.writeUInt16LE(1, 2)
  format.writeUInt32LE(22050, 4)
  format.writeUInt32LE(44100, 8)
  format.writeUInt16LE(2, 12)
  format.writeUInt16LE(16, 14)
  const pcm = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2))
  const chunks = [waveChunk('fmt ', format)]
  if (junk) chunks.push(waveChunk('JUNK', Buffer.from([1, 2, 3])))
  chunks.push(waveChunk('data', pcm))
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 4, 'ascii')
  header.writeUInt32LE(body.length + 4, 4)
  header.write('WAVE', 8, 4, 'ascii')
  return Buffer.concat([header, body])
}

function writeAttachment(directory, bundle, sourceRelativePath, mediaType, bytes) {
  const relativePath = path.posix.join(bundle, sourceRelativePath)
  const file = path.join(directory, relativePath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, bytes)
  return {
    sourceRelativePath,
    relativePath,
    mediaType,
    bytes: bytes.length,
    sha256: sha256Bytes(bytes),
  }
}

function fixture(directory, { mismatch = false } = {}) {
  fs.mkdirSync(directory, { recursive: true })
  const officialPath = path.join(directory, 'official.json')
  const candidatePath = path.join(directory, 'candidate.json')
  const officialPixels = Buffer.from([10, 20, 30, 255, 40, 50, 60, 255])
  const candidatePixels = Buffer.from(officialPixels)
  if (mismatch) candidatePixels[5] = 51
  const officialArtifacts = [
    writeAttachment(directory, 'official.artifacts', 'screen.png', 'image/png',
      encodePngRgba(2, 1, officialPixels, { compressionLevel: 1 })),
    writeAttachment(directory, 'official.artifacts', 'audio.wav', 'audio/wav',
      pcmWave([0, 1024, -1024], { junk: true })),
    writeAttachment(directory, 'official.artifacts', 'status.csv', 'text/csv',
      Buffer.from('update,stat46\r\n1,-1\r\n')),
  ]
  const candidateArtifacts = [
    writeAttachment(directory, 'candidate.artifacts', 'screen.png', 'image/png',
      encodePngRgba(2, 1, candidatePixels, { compressionLevel: 9 })),
    writeAttachment(directory, 'candidate.artifacts', 'audio.wav', 'audio/wav',
      pcmWave(mismatch ? [0, 1025, -1024] : [0, 1024, -1024])),
    writeAttachment(directory, 'candidate.artifacts', 'status.csv', 'text/csv',
      Buffer.from(mismatch ? 'update,stat46\n1,0\n' : 'update,stat46\n1,-1\n')),
  ]
  const official = buildOfficialProbeCapture({
    probe: 'synthetic_probe',
    runtimeVersion: '0.2.7',
    runtimeSha256: digestB,
    cartSha256: digestA,
    command: ['pico8', '-x', 'synthetic_probe.p8'],
    returncode: 0,
    output: 'p8probe|edge|ok\n',
    attachments: officialArtifacts,
    capturedAt: '2026-07-16T00:00:00.000Z',
  })
  official.status = 'captured'
  official.validationErrors = []
  const candidate = buildImplementationProbeCapture({
    probe: 'synthetic_probe',
    cartSha256: digestA,
    backend: 'aico8-native-test',
    revision: digestB,
    runtimeSha256: digestB,
    command: ['aico8-test', '--probe', 'synthetic_probe'],
    events: [['edge', mismatch ? 'different' : 'ok']],
    attachments: candidateArtifacts,
    capturedAt: '2026-07-16T00:00:00.000Z',
  })
  fs.writeFileSync(officialPath, `${JSON.stringify(official, null, 2)}\n`)
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`)
  return { official, officialPath, candidate, candidatePath }
}

test('PNG evidence decoder round-trips exact RGBA pixels', () => {
  const rgba = Buffer.from([1, 2, 3, 4, 250, 240, 230, 220])
  const decoded = decodePngRgba(encodePngRgba(2, 1, rgba))
  assert.equal(decoded.width, 2)
  assert.equal(decoded.height, 1)
  assert.deepEqual(decoded.rgba, rgba)
})

test('matches decoded pixels, PCM samples, and CSV cells despite container differences', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aico8-official-compare-match-'))
  try {
    const inputs = fixture(directory)
    const report = compareOfficialProbeCaptures(inputs)
    assert.equal(report.status, 'matched')
    assert.deepEqual(report.validationErrors, [])
    assert.deepEqual(report.events, { matches: true, count: 1 })
    assert.deepEqual(report.attachments.map(({ sourceRelativePath, matches }) => ({
      sourceRelativePath,
      matches,
    })), [
      { sourceRelativePath: 'audio.wav', matches: true },
      { sourceRelativePath: 'screen.png', matches: true },
      { sourceRelativePath: 'status.csv', matches: true },
    ])
    assert.notEqual(
      report.attachments.find(({ sourceRelativePath }) => sourceRelativePath === 'screen.png').officialSha256,
      report.attachments.find(({ sourceRelativePath }) => sourceRelativePath === 'screen.png').candidateSha256,
      'different PNG compression must not create a pixel mismatch',
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('reports the first event, pixel, PCM frame, and CSV row mismatch', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aico8-official-compare-diff-'))
  try {
    const report = compareOfficialProbeCaptures(fixture(directory, { mismatch: true }))
    assert.equal(report.status, 'mismatch')
    assert.equal(report.events.firstMismatchIndex, 0)
    const byName = Object.fromEntries(report.attachments.map((attachment) => [attachment.sourceRelativePath, attachment]))
    assert.equal(byName['screen.png'].firstMismatchPixel, 1)
    assert.equal(byName['screen.png'].firstMismatchChannel, 'g')
    assert.equal(byName['audio.wav'].firstMismatchFrame, 1)
    assert.equal(byName['status.csv'].firstMismatchRow, 1)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('candidate records deny official authority and reject tampered artifacts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aico8-official-compare-reject-'))
  try {
    const inputs = fixture(directory)
    inputs.candidate.authority = 'licensed-official-pico8'
    fs.writeFileSync(inputs.candidatePath, `${JSON.stringify(inputs.candidate, null, 2)}\n`)
    fs.writeFileSync(path.join(directory, inputs.candidate.attachments[0].relativePath), 'tampered')
    assert.deepEqual(validateImplementationProbeCapture(inputs.candidate), [
      'candidate authority must explicitly deny official conformance',
    ])
    const report = compareOfficialProbeCaptures(inputs)
    assert.ok(report.validationErrors.includes('candidate: candidate authority must explicitly deny official conformance'))
    assert.ok(report.validationErrors.some((error) => error.includes('attachment size or digest mismatch')))
    assert.equal(report.status, 'mismatch')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('comparison CLI writes an immutable private matched report', () => {
  const directory = path.join(
    repositoryRoot,
    'captures/official',
    `public-comparison-smoke-${process.pid}-${Date.now()}`,
  )
  try {
    const inputs = fixture(directory)
    const output = path.join(directory, 'comparison.json')
    const result = spawnSync(process.execPath, [
      path.join(repositoryRoot, 'scripts/compare-official-probe.mjs'),
      '--official', inputs.officialPath,
      '--candidate', inputs.candidatePath,
      '--output', output,
    ], { cwd: repositoryRoot, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).status, 'matched')
    const repeated = spawnSync(process.execPath, [
      path.join(repositoryRoot, 'scripts/compare-official-probe.mjs'),
      '--official', inputs.officialPath,
      '--candidate', inputs.candidatePath,
      '--output', output,
    ], { cwd: repositoryRoot, encoding: 'utf8' })
    assert.notEqual(repeated.status, 0)
    assert.match(repeated.stderr, /already exists/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('implementation authority constant remains explicitly non-official', () => {
  assert.equal(IMPLEMENTATION_AUTHORITY, 'implementation-candidate-not-official-conformance')
})
