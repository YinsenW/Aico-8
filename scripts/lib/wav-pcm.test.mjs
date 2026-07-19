import assert from 'node:assert/strict'
import test from 'node:test'

import { encodeWavePcm16 } from './wav-pcm.mjs'

test('encodes canonical mono PCM16 WAV bytes', () => {
  const wav = encodeWavePcm16(22050, Int16Array.from([-32768, 0, 32767]))
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt32LE(4), 42)
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.readUInt16LE(20), 1)
  assert.equal(wav.readUInt16LE(22), 1)
  assert.equal(wav.readUInt32LE(24), 22050)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.equal(wav.readUInt32LE(40), 6)
  assert.deepEqual([...wav.subarray(44)], [0, 128, 0, 0, 255, 127])
})

test('rejects invalid or unaligned PCM metadata', () => {
  assert.throws(() => encodeWavePcm16(0, []), /sampleRate/)
  assert.throws(() => encodeWavePcm16(22050, [1], 2), /channel-aligned/)
})
