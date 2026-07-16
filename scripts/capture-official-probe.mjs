#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildOfficialProbeCapture,
  collectOfficialProbeArtifacts,
  isPrivateOfficialCapturePath,
  sha256File,
  validateOfficialProbeArtifactFiles,
  validateOfficialProbeCapture,
} from './lib/official-probe-capture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const values = (name) => args.flatMap((argument, index) =>
  argument === name && args[index + 1] !== undefined ? [args[index + 1]] : [])
const runtime = value('--runtime')
const runtimeVersion = value('--runtime-version')
const cart = value('--cart')
const output = value('--output')
const expected = value('--expected')
const artifacts = values('--artifact')
const licensed = args.includes('--licensed-official-runtime')

if (!runtime || !runtimeVersion || !cart || !output || !licensed) {
  process.stderr.write('Usage: node scripts/capture-official-probe.mjs '
    + '--licensed-official-runtime --runtime <pico8> --runtime-version <version> '
    + '--cart <probe.p8> --output <captures/official/...json> [--expected <expected.json>] '
    + '[--artifact <relative.png|relative.wav> ...]\n')
  process.exit(2)
}
if (!isPrivateOfficialCapturePath(root, output)) {
  throw new Error('Official captures must be written below the ignored captures/official directory')
}
const runtimePath = path.resolve(runtime)
const cartPath = path.resolve(cart)
const outputPath = path.resolve(output)
if (fs.existsSync(outputPath)) throw new Error('Official capture output already exists; captures are immutable')
const artifactRoot = path.join(
  path.dirname(outputPath),
  `${path.basename(outputPath, path.extname(outputPath))}.artifacts`,
)
if (fs.existsSync(artifactRoot)) throw new Error('Official capture artifact bundle already exists; captures are immutable')
if (!fs.statSync(runtimePath).isFile() || !fs.statSync(cartPath).isFile()) {
  throw new Error('Runtime and cart must both be regular files')
}
if (!/^pico-?8(?:\.exe)?$/i.test(path.basename(runtimePath))) {
  throw new Error('Runtime executable name must identify PICO-8; independent emulators are not accepted')
}

const command = [runtimePath, '-x', cartPath]
const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'aico8-official-probe-'))
process.on('exit', () => fs.rmSync(workingDirectory, { recursive: true, force: true }))
const result = spawnSync(command[0], command.slice(1), {
  cwd: workingDirectory,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  timeout: 120_000,
})
const combinedOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`
const collected = collectOfficialProbeArtifacts(workingDirectory, artifacts, artifactRoot)
const capture = buildOfficialProbeCapture({
  probe: path.basename(cartPath, path.extname(cartPath)),
  runtimeVersion,
  runtimeSha256: sha256File(runtimePath),
  cartSha256: sha256File(cartPath),
  command,
  returncode: result.status ?? 1,
  output: combinedOutput,
  attachments: collected.attachments,
  hostPlatform: os.platform(),
  hostArchitecture: os.arch(),
})
let expectedEvents
if (expected) expectedEvents = JSON.parse(fs.readFileSync(expected, 'utf8')).events
const errors = [
  ...validateOfficialProbeCapture(capture, expectedEvents),
  ...validateOfficialProbeArtifactFiles(capture, outputPath),
  ...collected.errors,
]
capture.status = errors.length === 0 ? 'captured' : 'mismatch'
capture.validationErrors = errors
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(capture, null, 2)}\n`)
fs.rmSync(workingDirectory, { recursive: true, force: true })
if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(`Official PICO-8 probe captured: ${capture.probe} (${capture.events.length} events)\n`)
