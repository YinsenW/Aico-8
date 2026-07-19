import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { extractP8ProbeCart } from './p8-probe-cart.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('loads public probe SFX and music text into canonical ROM addresses', () => {
  const cart = fs.readFileSync(path.join(repository, 'tests/conformance/probes/audio_web.p8'))
  const { source, rom } = extractP8ProbeCart(cart, 'Audio probe')
  assert.match(source.toString('utf8'), /music\(0\)/)
  assert.equal(rom.length, 0x8000)
  assert.deepEqual([...rom.subarray(0x3100, 0x3104)], [0, 0x40, 0x40, 0x40])
  assert.deepEqual([...rom.subarray(0x3200, 0x3204)], [0x18, 0x0e, 0x18, 0x0e])
  assert.deepEqual([...rom.subarray(0x3240, 0x3244)], [0, 8, 0, 0])
})

test('source-only probe parsing remains byte-stable', () => {
  const cart = fs.readFileSync(path.join(repository, 'tests/conformance/probes/p8scii_full.p8'))
  const { source, rom } = extractP8ProbeCart(cart)
  assert.match(source.toString('utf8'), /240-glyphs/)
  for (let address = 0; address < rom.length; address += 1) {
    const relative = address - 0x3200
    const isDefaultSfxSpeed = relative >= 0 && relative < 64 * 68
      && relative % 68 === 65
    assert.equal(rom[address], isDefaultSfxSpeed ? 16 : 0)
  }
})
