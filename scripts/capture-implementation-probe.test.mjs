import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { validateOfficialProbeArtifactFiles } from './lib/official-probe-capture.mjs'
import { validateImplementationProbeCapture } from './lib/official-probe-comparison.mjs'
import { decodePngRgba } from './lib/png-rgba.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const probes = [
  'p8scii',
  'numeric_memory',
  'language',
  'raster_state',
  'advanced_raster',
]

const temporalProbes = [
  ['scheduler_30', 'scheduler_30_six_host_ticks', 6],
  ['scheduler_60', 'scheduler_60_six_host_ticks', 6],
]

const buttonTraceProbes = [
  ['input_30', 'btnp_30'],
  ['input_60', 'btnp_60'],
]

for (const probe of probes) {
  test(`production Wasm emits a deterministic source-bound ${probe} candidate`, () => {
    const expected = JSON.parse(fs.readFileSync(
      path.join(repository, `tests/conformance/expected/${probe}.json`),
      'utf8',
    ))
    const directory = path.join(
      repository,
      'captures/official',
      `public-wasm-${probe}-${process.pid}-${Date.now()}`,
    )
    try {
      const outputs = ['candidate-a.json', 'candidate-b.json'].map((name) => path.join(directory, name))
      const captures = outputs.map((output) => {
        const result = spawnSync('corepack', [
          'pnpm', 'exec', 'tsx', 'scripts/capture-implementation-probe.ts',
          '--cart', `tests/conformance/probes/${probe}.p8`, '--output', output,
        ], { cwd: repository, encoding: 'utf8' })
        assert.equal(result.status, 0, result.stderr)
        return JSON.parse(fs.readFileSync(output, 'utf8'))
      })
      assert.deepEqual(validateImplementationProbeCapture(captures[0]), [])
      assert.deepEqual(validateOfficialProbeArtifactFiles(captures[0], outputs[0]), [])
      assert.equal(captures[0].authority, 'implementation-candidate-not-official-conformance')
      assert.equal(captures[0].backend, 'aico8-production-wasm')
      assert.equal(captures[0].cartSha256, captures[1].cartSha256)
      assert.equal(captures[0].runtimeSha256, captures[1].runtimeSha256)
      assert.deepEqual(captures[0].events, captures[1].events)
      assert.deepEqual(captures[0].events, expected.events)
      assert.deepEqual(captures[0].attachments, [])
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('generic candidate capture can bind an exact 128-square framebuffer artifact', () => {
  const directory = path.join(
    repository,
    'captures/official',
    `public-wasm-p8scii-full-${process.pid}-${Date.now()}`,
  )
  const output = path.join(directory, 'candidate.json')
  try {
    const result = spawnSync('corepack', [
      'pnpm', 'exec', 'tsx', 'scripts/capture-implementation-probe.ts',
      '--cart', 'tests/conformance/probes/p8scii_full.p8',
      '--output', output,
      '--framebuffer-artifact', 'p8scii_full.png',
    ], { cwd: repository, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const capture = JSON.parse(fs.readFileSync(output, 'utf8'))
    assert.deepEqual(validateImplementationProbeCapture(capture), [])
    assert.deepEqual(validateOfficialProbeArtifactFiles(capture, output), [])
    assert.equal(capture.events.length, 17)
    assert.equal(capture.events.at(-1)[1], '240-glyphs')
    assert.equal(capture.attachments.length, 1)
    assert.equal(capture.attachments[0].sourceRelativePath, 'p8scii_full.png')
    const png = decodePngRgba(fs.readFileSync(path.join(
      path.dirname(output), capture.attachments[0].relativePath)))
    assert.deepEqual([png.width, png.height], [128, 128])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('generic candidate capture can bind deterministic mono PCM', () => {
  const directory = path.join(
    repository,
    'captures/official',
    `public-wasm-audio-web-${process.pid}-${Date.now()}`,
  )
  const output = path.join(directory, 'candidate.json')
  try {
    const result = spawnSync('corepack', [
      'pnpm', 'exec', 'tsx', 'scripts/capture-implementation-probe.ts',
      '--cart', 'tests/conformance/probes/audio_web.p8',
      '--output', output,
      '--host-ticks', '150',
      '--audio-artifact', 'audio_web.wav',
    ], { cwd: repository, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const capture = JSON.parse(fs.readFileSync(output, 'utf8'))
    assert.equal(capture.events.length, 151)
    assert.equal(capture.attachments.length, 1)
    assert.equal(capture.attachments[0].mediaType, 'audio/wav')
    const wav = fs.readFileSync(path.join(
      path.dirname(output), capture.attachments[0].relativePath))
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
    assert.equal(wav.readUInt32LE(24), 22050)
    assert.equal(wav.readUInt16LE(22), 1)
    assert.equal(wav.readUInt16LE(34), 16)
    assert.ok(wav.readUInt32LE(40) > 0)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

for (const [probe, expectedName, hostTicks] of temporalProbes) {
  test(`production Wasm emits a deterministic ${probe} host-tick candidate`, () => {
    const expected = JSON.parse(fs.readFileSync(path.join(
      repository, `tests/conformance/expected/${expectedName}.json`), 'utf8'))
    const directory = path.join(
      repository, 'captures/official',
      `public-wasm-${probe}-${process.pid}-${Date.now()}`,
    )
    const output = path.join(directory, 'candidate.json')
    try {
      const result = spawnSync('corepack', [
        'pnpm', 'exec', 'tsx', 'scripts/capture-implementation-probe.ts',
        '--cart', `tests/conformance/probes/${probe}.p8`,
        '--output', output,
        '--host-ticks', String(hostTicks),
      ], { cwd: repository, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      const capture = JSON.parse(fs.readFileSync(output, 'utf8'))
      assert.deepEqual(validateImplementationProbeCapture(capture), [])
      assert.deepEqual(capture.events, expected.events)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}

for (const [probe, trace] of buttonTraceProbes) {
  test(`production Wasm emits the official ${probe} button-trace events deterministically`, () => {
    const expected = JSON.parse(fs.readFileSync(path.join(
      repository, `tests/conformance/expected/${probe}.json`), 'utf8'))
    const directory = path.join(
      repository, 'captures/official',
      `public-wasm-${probe}-${process.pid}-${Date.now()}`,
    )
    try {
      const outputs = ['candidate-a.json', 'candidate-b.json'].map((name) => path.join(directory, name))
      const captures = outputs.map((output) => {
        const result = spawnSync('corepack', [
          'pnpm', 'exec', 'tsx', 'scripts/capture-implementation-probe.ts',
          '--cart', `tests/conformance/probes/${probe}.p8`,
          '--output', output,
          '--button-trace', `tests/conformance/input_traces/${trace}.json`,
        ], { cwd: repository, encoding: 'utf8' })
        assert.equal(result.status, 0, result.stderr)
        return JSON.parse(fs.readFileSync(output, 'utf8'))
      })
      assert.deepEqual(validateImplementationProbeCapture(captures[0]), [])
      assert.deepEqual(captures[0].events, expected.events)
      assert.deepEqual(captures[1].events, expected.events)
      assert.equal(captures[0].cartSha256, captures[1].cartSha256)
      assert.equal(captures[0].runtimeSha256, captures[1].runtimeSha256)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('production Wasm preserves an official-compatible cartdata slot across runtime instances', () => {
  const directory = path.join(
    repository,
    'captures/official',
    `public-wasm-persistence-${process.pid}-${Date.now()}`,
  )
  const writeOutput = path.join(directory, 'write.json')
  const readOutput = path.join(directory, 'read.json')
  const persistence = path.join(directory, 'slot.bin')
  const capture = (...arguments_) => spawnSync('corepack', [
    'pnpm', 'exec', 'tsx', 'scripts/capture-implementation-probe.ts', ...arguments_,
  ], { cwd: repository, encoding: 'utf8' })
  try {
    const write = capture(
      '--cart', 'tests/conformance/probes/persistence_write.p8',
      '--output', writeOutput,
      '--persistence-output', persistence,
    )
    assert.equal(write.status, 0, write.stderr)
    const read = capture(
      '--cart', 'tests/conformance/probes/persistence_read.p8',
      '--output', readOutput,
      '--persistence', persistence,
    )
    assert.equal(read.status, 0, read.stderr)

    const writeCapture = JSON.parse(fs.readFileSync(writeOutput, 'utf8'))
    const readCapture = JSON.parse(fs.readFileSync(readOutput, 'utf8'))
    const writeExpected = JSON.parse(fs.readFileSync(path.join(
      repository, 'tests/conformance/expected/persistence_write_clean_home.json'), 'utf8'))
    const readExpected = JSON.parse(fs.readFileSync(path.join(
      repository, 'tests/conformance/expected/persistence_read_after_write.json'), 'utf8'))
    assert.deepEqual(validateImplementationProbeCapture(writeCapture), [])
    assert.deepEqual(validateImplementationProbeCapture(readCapture), [])
    assert.deepEqual(writeCapture.events, writeExpected.events)
    assert.deepEqual(readCapture.events, readExpected.events)
    assert.equal(writeCapture.runtimeSha256, readCapture.runtimeSha256)

    const bytes = fs.readFileSync(persistence)
    assert.equal(bytes.length, 256)
    assert.deepEqual([...bytes.subarray(0, 4)], [0x00, 0x80, 0x7b, 0x00])
    assert.deepEqual([...bytes.subarray(252, 256)], [0x00, 0xc0, 0xfd, 0xff])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
