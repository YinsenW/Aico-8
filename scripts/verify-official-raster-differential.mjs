#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  validateOfficialProbeArtifactFiles,
  validateOfficialProbeCapture,
} from './lib/official-probe-capture.mjs'
import { compareOfficialProbeCaptures } from './lib/official-probe-comparison.mjs'
import { normalizePico8LiveFramePng } from './lib/live-frame-normalization.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const officialPath = path.join(
  root,
  'captures/official/0.2.7-education/curved_raster_live-v3.json',
)
const evidencePath = path.join(
  root,
  'governance/evidence/official-education-curved-raster-differential.json',
)
const cartPath = path.join(root, 'tests/conformance/probes/curved_raster_live.p8')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

assert.ok(fs.statSync(officialPath, { throwIfNoEntry: false })?.isFile(),
  'Private Education curved-raster live capture is unavailable')
const official = JSON.parse(fs.readFileSync(officialPath, 'utf8'))
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
assert.deepEqual(validateOfficialProbeCapture(official), [])
assert.deepEqual(validateOfficialProbeArtifactFiles(official, officialPath), [])
assert.equal(official.cartSha256, digest(fs.readFileSync(cartPath)), 'Live probe SHA changed')
assert.equal(
  digest(fs.readFileSync(officialPath)),
  evidence.visualDifferential.acceptedLiveCapture.officialCaptureSha256,
  'Private official capture no longer matches the public evidence digest',
)
assert.equal(official.attachments.length, 1)
const officialArtifact = path.resolve(path.dirname(officialPath), official.attachments[0].relativePath)
const normalized = normalizePico8LiveFramePng(fs.readFileSync(officialArtifact))
assert.deepEqual(normalized.inputDimensions, [128, 128])
assert.equal(digest(normalized.png), official.attachments[0].sha256)

const temporary = path.join(
  root,
  'captures/official',
  `private-raster-verify-${process.pid}-${Date.now()}`,
)
const candidatePath = path.join(temporary, 'candidate.json')
try {
  execFileSync('corepack', [
    'pnpm', 'exec', 'tsx', 'scripts/capture-implementation-curved-raster.ts',
    '--cart', 'tests/conformance/probes/curved_raster_live.p8',
    '--output', candidatePath,
    '--visual-only',
  ], { cwd: root, stdio: 'pipe' })
  const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'))
  const report = compareOfficialProbeCaptures({
    official,
    officialPath,
    candidate,
    candidatePath,
  })
  assert.equal(report.status, 'matched', JSON.stringify(report, null, 2))
  assert.deepEqual(report.validationErrors, [])
  assert.deepEqual(report.events, { matches: true, count: 0 })
  assert.equal(report.attachments.length, 1)
  assert.equal(report.attachments[0].matches, true)
  assert.equal(report.attachments[0].pixels, 128 * 128)
  process.stdout.write('Private official curved-raster live RGBA differential matched\n')
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
