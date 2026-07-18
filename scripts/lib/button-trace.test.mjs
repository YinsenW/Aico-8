import assert from 'node:assert/strict'
import test from 'node:test'

import { expandButtonTraceHostMasks, validateButtonTrace } from './button-trace.mjs'

const trace = (tickRate = 30) => ({
  name: 'test_trace',
  tick_rate: tickRate,
  update_count: 3,
  meaning: 'press, release, press',
  spans: [
    { from_update: 1, through_update: 1, player_0_mask: 1 },
    { from_update: 2, through_update: 2, player_0_mask: 0 },
    { from_update: 3, through_update: 3, player_0_mask: 1 },
  ],
})

test('expands every logical mask to the declared 30/60 Hz host cadence', () => {
  assert.deepEqual(expandButtonTraceHostMasks(trace(30)), [1, 1, 0, 0, 1, 1])
  assert.deepEqual(expandButtonTraceHostMasks(trace(60)), [1, 0, 1])
})

test('rejects gaps, overlap, invalid masks, unknown fields, and trailing coverage', () => {
  const mutations = [
    (value) => { value.spans[1].from_update = 3 },
    (value) => { value.spans[1].from_update = 1 },
    (value) => { value.spans[0].player_0_mask = 64 },
    (value) => { value.spans[0].unknown = true },
    (value) => { value.update_count = 4 },
  ]
  for (const mutate of mutations) {
    const value = structuredClone(trace())
    mutate(value)
    assert.notEqual(validateButtonTrace(value).length, 0)
  }
})
