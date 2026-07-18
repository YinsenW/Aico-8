import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { validateOfficialProbeArtifactFiles } from './lib/official-probe-capture.mjs'
import { validateImplementationProbeCapture } from './lib/official-probe-comparison.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const probes = [
  'p8scii',
  'numeric_memory',
  'language',
  'raster_state',
  'advanced_raster',
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
