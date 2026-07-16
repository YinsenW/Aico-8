import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildOfficialProbeCapture,
  collectOfficialProbeArtifacts,
  isPrivateOfficialCapturePath,
  parseProbeEvents,
  validateOfficialProbeArtifactFiles,
  validateOfficialProbeCapture,
} from './official-probe-capture.mjs'

const digest = 'a'.repeat(64)
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('parses only ordered p8probe records from mixed official output', () => {
  assert.deepEqual(parseProbeEvents('boot\np8probe|alpha|1\nnoise p8probe|beta|x|y\n'), [
    ['alpha', '1'],
    ['beta', 'x|y'],
  ])
})

test('copies declared PNG/WAV/CSV artifacts into a hashed immutable capture bundle', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aico8-official-artifacts-'))
  const working = path.join(temporary, 'working')
  const artifactRoot = path.join(temporary, 'capture.artifacts')
  fs.mkdirSync(path.join(working, 'nested'), { recursive: true })
  fs.writeFileSync(path.join(working, 'screen.png'), Buffer.from([1, 2, 3]))
  fs.writeFileSync(path.join(working, 'nested/audio.wav'), Buffer.from([4, 5]))
  fs.writeFileSync(path.join(working, 'status.csv'), 'update,stat46\n1,-1\n')
  const collected = collectOfficialProbeArtifacts(
    working,
    ['screen.png', 'nested/audio.wav', 'status.csv'],
    artifactRoot,
  )
  assert.deepEqual(collected.errors, [])
  assert.deepEqual(collected.attachments.map(({ mediaType, bytes, relativePath }) => ({
    mediaType,
    bytes,
    relativePath,
  })), [
    { mediaType: 'image/png', bytes: 3, relativePath: 'capture.artifacts/screen.png' },
    { mediaType: 'audio/wav', bytes: 2, relativePath: 'capture.artifacts/nested/audio.wav' },
    { mediaType: 'text/csv', bytes: 19, relativePath: 'capture.artifacts/status.csv' },
  ])
  const capturePath = path.join(temporary, 'capture.json')
  const capture = buildOfficialProbeCapture({
    probe: 'artifact_probe',
    runtimeVersion: '0.2.7',
    runtimeSha256: digest,
    cartSha256: digest,
    command: ['pico8', '-x', 'artifact_probe.p8'],
    returncode: 0,
    output: '',
    attachments: collected.attachments,
  })
  assert.deepEqual(validateOfficialProbeCapture(capture), [])
  assert.deepEqual(validateOfficialProbeArtifactFiles(capture, capturePath), [])
  fs.writeFileSync(path.join(artifactRoot, 'screen.png'), Buffer.from([9]))
  assert.deepEqual(validateOfficialProbeArtifactFiles(capture, capturePath), [
    'attachment size or digest mismatch: capture.artifacts/screen.png',
  ])
})

test('rejects missing, unsafe, duplicated, and unsupported artifacts', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aico8-official-artifact-errors-'))
  fs.writeFileSync(path.join(temporary, 'note.txt'), 'no')
  const collected = collectOfficialProbeArtifacts(
    temporary,
    ['../escape.png', 'missing.wav', 'note.txt', 'missing.wav'],
    path.join(temporary, 'bundle.artifacts'),
  )
  assert.deepEqual(collected.attachments, [])
  assert.deepEqual(collected.errors, [
    'artifact path is unsafe: ../escape.png',
    'declared artifact was not produced as a regular file: missing.wav',
    'artifact type must be .png, .wav, or .csv: note.txt',
    'artifact path is duplicated: missing.wav',
  ])
})

test('builds a provenance-bound licensed official capture', () => {
  const capture = buildOfficialProbeCapture({
    probe: 'curved_raster',
    runtimeVersion: '0.2.7',
    runtimeSha256: digest,
    cartSha256: digest,
    command: ['pico8', '-x', 'curved_raster.p8'],
    returncode: 0,
    output: 'p8probe|edge|8,0,8',
    capturedAt: '2026-07-16T00:00:00.000Z',
  })
  assert.deepEqual(validateOfficialProbeCapture(capture, [['edge', '8,0,8']]), [])
})

test('checked-in capture plans match the files emitted by raster and audio probes', () => {
  const matrix = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, 'tests/conformance/matrix.json'),
    'utf8',
  ))
  const curved = matrix.areas.find(({ id }) => id === 'curved_raster')
  assert.deepEqual(curved.artifacts, ['curved_raster.png'])
  assert.match(curved.capture_command, /--artifact curved_raster\.png(?:\s|$)/)
  const curvedProbe = fs.readFileSync(
    path.join(repositoryRoot, 'tests/conformance/probes/curved_raster.p8'),
    'utf8',
  )
  assert.match(curvedProbe, /extcmd\("set_filename","curved_raster"\)/)
  assert.match(curvedProbe, /extcmd\("screen",1,1\)/)

  const audio = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, 'tests/conformance/audio_capture_manifest.json'),
    'utf8',
  ))
  const runtimeCapture = audio.captures.find(({ id }) => id === 'runtime_pcm_and_status')
  assert.deepEqual(runtimeCapture.artifact_arguments, runtimeCapture.outputs)
  for (const artifact of runtimeCapture.artifact_arguments) {
    assert.match(runtimeCapture.capture_command, new RegExp(`--artifact ${artifact.replace('.', '\\.')}($|\\s)`))
  }
  const audioProbe = fs.readFileSync(
    path.join(repositoryRoot, 'tests/conformance/probes/audio_status.p8'),
    'utf8',
  )
  assert.match(audioProbe, /local status_file="audio_status\.csv"/)
  assert.match(audioProbe, /extcmd\("set_filename","p8_audio_runtime"\)/)
  assert.match(audioProbe, /extcmd\("audio_end",1\)/)
})

test('public CLI smoke exercises isolation, artifact copying, and capture validation end to end', () => {
  if (process.platform === 'win32') return
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aico8-official-cli-'))
  const runtime = path.join(temporary, 'pico8')
  const cart = path.join(temporary, 'probe.p8')
  fs.writeFileSync(runtime, [
    '#!/bin/sh',
    "printf 'p8probe|edge|ok\\n'",
    "printf 'update,stat46\\n1,-1\\n' > status.csv",
    '',
  ].join('\n'))
  fs.chmodSync(runtime, 0o755)
  fs.writeFileSync(cart, 'pico-8 cartridge\nversion 43\n__lua__\n')
  const captureDirectory = path.join(
    repositoryRoot,
    'captures/official',
    `public-cli-smoke-${process.pid}-${Date.now()}`,
  )
  const output = path.join(captureDirectory, 'probe.json')
  try {
    const result = spawnSync(process.execPath, [
      path.join(repositoryRoot, 'scripts/capture-official-probe.mjs'),
      '--licensed-official-runtime',
      '--runtime', runtime,
      '--runtime-version', 'synthetic-cli-smoke',
      '--cart', cart,
      '--output', output,
      '--artifact', 'status.csv',
    ], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    const capture = JSON.parse(fs.readFileSync(output, 'utf8'))
    assert.equal(capture.status, 'captured')
    assert.deepEqual(capture.events, [['edge', 'ok']])
    assert.deepEqual(capture.attachments.map(({ sourceRelativePath, mediaType }) => ({
      sourceRelativePath,
      mediaType,
    })), [{ sourceRelativePath: 'status.csv', mediaType: 'text/csv' }])
    assert.deepEqual(validateOfficialProbeCapture(capture), [])
    assert.deepEqual(validateOfficialProbeArtifactFiles(capture, output), [])
  } finally {
    fs.rmSync(captureDirectory, { recursive: true, force: true })
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('rejects unlicensed, failed, tampered, and public capture records', () => {
  const capture = buildOfficialProbeCapture({
    probe: 'curved_raster',
    runtimeVersion: '0.2.7',
    runtimeSha256: digest,
    cartSha256: digest,
    command: ['pico8', '-x', 'curved_raster.p8'],
    returncode: 0,
    output: 'p8probe|edge|ok',
  })
  capture.licensedRuntimeDeclaration = false
  capture.returncode = 1
  capture.cartSha256 = 'not-a-digest'
  assert.deepEqual(validateOfficialProbeCapture(capture, [['edge', 'different']]), [
    'capture must explicitly declare a licensed official PICO-8 oracle',
    'cartSha256 must be a lowercase SHA-256 digest',
    'official runtime did not exit successfully',
    'captured events do not match the declared expectation',
  ])
  assert.equal(isPrivateOfficialCapturePath('/repo', '/repo/captures/official/run/result.json'), true)
  assert.equal(isPrivateOfficialCapturePath('/repo', '/repo/governance/evidence/result.json'), false)
})
