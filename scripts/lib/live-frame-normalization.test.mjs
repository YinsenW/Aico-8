import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizePico8LiveFramePng } from './live-frame-normalization.mjs'
import { decodePngRgba, encodePngRgba } from './png-rgba.mjs'

const marker = [
  [255, 0, 77, 255],
  [255, 163, 0, 255],
  [255, 236, 39, 255],
  [0, 228, 54, 255],
]

function fixture(scale = 2) {
  const width = 128 * scale
  const rgba = Buffer.alloc(width * width * 4, 255)
  for (let y = 0; y < 128; y += 1) {
    for (let x = 0; x < 128; x += 1) {
      const color = x < 2 && y < 2 ? marker[y * 2 + x] : [29, 43, 83, 255]
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const offset = (((y * scale + sy) * width) + x * scale + sx) * 4
          Buffer.from(color).copy(rgba, offset)
        }
      }
    }
  }
  return { width, rgba, png: encodePngRgba(width, width, rgba) }
}

test('normalizes a uniform integer-scale live frame and preserves the origin marker', () => {
  const result = normalizePico8LiveFramePng(fixture(3).png)
  assert.deepEqual(result.inputDimensions, [384, 384])
  assert.deepEqual(result.outputDimensions, [128, 128])
  assert.equal(result.scale, 3)
  assert.deepEqual(result.marker, marker)
  const decoded = decodePngRgba(result.png)
  assert.equal(decoded.width, 128)
  assert.equal(decoded.height, 128)
})

test('rejects lossy or contaminated live-frame evidence', () => {
  assert.throws(() => normalizePico8LiveFramePng(Buffer.from([0xff, 0xd8, 0xff])), /PNG signature/)
  const nonUniform = fixture(2)
  nonUniform.rgba[4] ^= 1
  assert.throws(
    () => normalizePico8LiveFramePng(encodePngRgba(nonUniform.width, nonUniform.width, nonUniform.rgba)),
    /not a uniform nearest-neighbour block/,
  )
  const wrongMarker = fixture(1)
  wrongMarker.rgba[0] = 0
  assert.throws(
    () => normalizePico8LiveFramePng(encodePngRgba(wrongMarker.width, wrongMarker.width, wrongMarker.rgba)),
    /origin marker mismatch/,
  )
})
