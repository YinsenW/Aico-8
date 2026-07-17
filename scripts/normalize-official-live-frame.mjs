#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import { normalizePico8LiveFramePng } from './lib/live-frame-normalization.mjs'

const args = process.argv.slice(2)
const value = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const input = value('--input')
const output = value('--output')
if (!input || !output) {
  process.stderr.write('Usage: node scripts/normalize-official-live-frame.mjs --input <exact-canvas.png> --output <normalized.png>\n')
  process.exit(2)
}

const inputPath = path.resolve(input)
const outputPath = path.resolve(output)
if (inputPath === outputPath) throw new Error('Live-frame input and output paths must differ')
const inputStat = fs.lstatSync(inputPath, { throwIfNoEntry: false })
if (!inputStat?.isFile() || inputStat.isSymbolicLink()) {
  throw new Error('Live-frame input must be a regular non-symlink PNG')
}
if (fs.existsSync(outputPath)) throw new Error('Normalized live-frame output already exists')

const normalized = normalizePico8LiveFramePng(fs.readFileSync(inputPath))
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, normalized.png, { flag: 'wx' })
process.stdout.write(`${JSON.stringify({
  inputDimensions: normalized.inputDimensions,
  outputDimensions: normalized.outputDimensions,
  scale: normalized.scale,
  marker: normalized.marker,
})}\n`)
