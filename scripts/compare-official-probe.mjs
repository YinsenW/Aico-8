#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isPrivateOfficialCapturePath } from './lib/official-probe-capture.mjs'
import { compareOfficialProbeCaptures } from './lib/official-probe-comparison.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const officialPath = value('--official')
const candidatePath = value('--candidate')
const outputPath = value('--output')
if (!officialPath || !candidatePath || !outputPath) {
  process.stderr.write('Usage: node scripts/compare-official-probe.mjs '
    + '--official <official.json> --candidate <candidate.json> '
    + '--output <captures/official/...comparison.json>\n')
  process.exit(2)
}
if (!isPrivateOfficialCapturePath(root, officialPath)
    || !isPrivateOfficialCapturePath(root, candidatePath)
    || !isPrivateOfficialCapturePath(root, outputPath)) {
  throw new Error('Official, candidate, and comparison files must stay below ignored captures/official')
}
const resolvedOutput = path.resolve(outputPath)
if (fs.existsSync(resolvedOutput)) throw new Error('Official comparison output already exists; reports are immutable')
const official = JSON.parse(fs.readFileSync(officialPath, 'utf8'))
const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'))
const report = compareOfficialProbeCaptures({
  official,
  officialPath,
  candidate,
  candidatePath,
})
fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true })
fs.writeFileSync(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`)
if (report.status !== 'matched') {
  process.stderr.write(`Official comparison mismatch: ${report.probe}\n`)
  process.exit(1)
}
process.stdout.write(`Official comparison matched: ${report.probe}\n`)
