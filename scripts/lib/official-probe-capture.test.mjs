import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOfficialProbeCapture,
  isPrivateOfficialCapturePath,
  parseProbeEvents,
  validateOfficialProbeCapture,
} from './official-probe-capture.mjs'

const digest = 'a'.repeat(64)

test('parses only ordered p8probe records from mixed official output', () => {
  assert.deepEqual(parseProbeEvents('boot\np8probe|alpha|1\nnoise p8probe|beta|x|y\n'), [
    ['alpha', '1'],
    ['beta', 'x|y'],
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
