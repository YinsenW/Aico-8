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

function runCapture(output) {
  const result = spawnSync('corepack', [
    'pnpm', 'exec', 'tsx', 'scripts/capture-implementation-curved-raster.ts',
    '--cart', 'tests/conformance/probes/curved_raster.p8',
    '--output', output,
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
    assert.ok(first.events.length >= 20)
    const png = decodePngRgba(fs.readFileSync(
      path.join(path.dirname(firstPath), first.attachments[0].relativePath),
    ))
    assert.equal(png.width, 128)
    assert.equal(png.height, 128)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
