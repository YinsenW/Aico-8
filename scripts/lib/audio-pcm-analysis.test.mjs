import assert from 'node:assert/strict'
import test from 'node:test'

import { comparePcmSummaries, summarizePcm16 } from './audio-pcm-analysis.mjs'

test('summarizes a bounded PCM window without including its warmup prefix', () => {
  const samples = Int16Array.from([30000, 30000, -10, 10, -20, 20])
  const summary = summarizePcm16(samples, { sampleRate: 8, startSample: 2, sampleCount: 4 })
  assert.deepEqual(summary, {
    sampleRate: 8,
    startSample: 2,
    sampleCount: 4,
    zeroCrossings: 3,
    estimatedFrequencyHz: 3,
    peak: 20,
    rms: Math.sqrt(250),
  })
})

test('compares named pitch and level tolerances fail-closed', () => {
  const official = { sampleRate: 22050, zeroCrossings: 71,
    estimatedFrequencyHz: 260.925, peak: 12094, rms: 6971.96 }
  const candidate = { sampleRate: 22050, zeroCrossings: 71,
    estimatedFrequencyHz: 260.925, peak: 12285, rms: 7097.28 }
  const tolerances = { zeroCrossings: 1, frequencyRelative: 0.01,
    peakRelative: 0.03, rmsRelative: 0.03 }
  assert.equal(comparePcmSummaries(official, candidate, tolerances).matches, true)
  assert.equal(comparePcmSummaries(official, { ...candidate, peak: 15000 }, tolerances).matches, false)
})
