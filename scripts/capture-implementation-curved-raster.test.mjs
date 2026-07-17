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
const expected = JSON.parse(fs.readFileSync(
  path.join(repository, 'tests/conformance/expected/curved_raster.json'),
  'utf8',
))

function runCapture(output, cart = 'tests/conformance/probes/curved_raster.p8', extra = []) {
  const result = spawnSync('corepack', [
    'pnpm', 'exec', 'tsx', 'scripts/capture-implementation-curved-raster.ts',
    '--cart', cart,
    '--output', output,
    ...extra,
  ], { cwd: repository, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(fs.readFileSync(output, 'utf8'))
}

test('production Wasm emits a deterministic source-bound curved-raster candidate', () => {
  const directory = path.join(
    repository,
    'captures/official',
    `public-wasm-candidate-${process.pid}-${Date.now()}`,
  )
  try {
    const firstPath = path.join(directory, 'candidate-a.json')
    const secondPath = path.join(directory, 'candidate-b.json')
    const first = runCapture(firstPath)
    const second = runCapture(secondPath)
    assert.deepEqual(validateImplementationProbeCapture(first), [])
    assert.deepEqual(validateOfficialProbeArtifactFiles(first, firstPath), [])
    assert.equal(first.authority, 'implementation-candidate-not-official-conformance')
    assert.equal(first.backend, 'aico8-production-wasm')
    assert.equal(first.cartSha256, second.cartSha256)
    assert.equal(first.runtimeSha256, second.runtimeSha256)
    assert.deepEqual(first.events, second.events)
    assert.equal(first.attachments[0].sha256, second.attachments[0].sha256)
    assert.deepEqual(first.events, expected.events)
    assert.equal(first.attachments.length, 1)
    assert.equal(first.attachments[0].sourceRelativePath, 'curved_raster.png')
    const png = decodePngRgba(fs.readFileSync(
      path.join(path.dirname(firstPath), first.attachments[0].relativePath),
    ))
    assert.equal(png.width, 128)
    assert.equal(png.height, 128)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('visual-only capture accepts the Education-safe empty gfx terminator', () => {
  const directory = path.join(
    repository,
    'captures/official',
    `public-wasm-live-candidate-${process.pid}-${Date.now()}`,
  )
  try {
    const output = path.join(directory, 'candidate.json')
    const capture = runCapture(
      output,
      'tests/conformance/probes/curved_raster_live.p8',
      ['--visual-only'],
    )
    assert.deepEqual(capture.events, [])
    assert.equal(capture.attachments[0].sourceRelativePath, 'curved_raster.png')
    assert.deepEqual(validateImplementationProbeCapture(capture), [])
    assert.deepEqual(validateOfficialProbeArtifactFiles(capture, output), [])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
