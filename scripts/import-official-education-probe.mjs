#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildOfficialEducationProbeCapture,
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

const runtimeVersion = value('--runtime-version')
const runtimeAsset = value('--runtime-asset')
const runtimeAssetUrl = value('--runtime-asset-url')
const browserName = value('--browser-name')
const browserVersion = value('--browser-version')
const loadMethod = value('--load-method') ?? 'local-cart-file-selection'
const cart = value('--cart')
const sourceDirectory = value('--source-dir')
const eventLog = value('--event-log')
const output = value('--output')
const artifacts = values('--artifact')
const authorized = args.includes('--authorized-official-education-runtime')
const declared = args.includes('--operator-artifact-declaration')

if (!runtimeVersion || !runtimeAsset || !runtimeAssetUrl || !browserName || !browserVersion
    || !cart || !sourceDirectory || !eventLog || !output
    || !authorized || !declared) {
  process.stderr.write('Usage: node scripts/import-official-education-probe.mjs '
    + '--authorized-official-education-runtime --operator-artifact-declaration '
    + '--runtime-version <version> --runtime-asset <official-js> '
    + '--runtime-asset-url <https://www.pico-8-edu.com/play/...js> '
    + '--browser-name <name> --browser-version <version> --cart <probe.p8> '
    + '[--load-method local-cart-file-selection|official-drag-drop-data-path] '
    + '--source-dir <private-staging-dir> --event-log <relative-log.txt> '
    + '--output <captures/official/...json> --artifact <relative.png|relative.wav|relative.csv> [... ]\n')
  process.exit(2)
}
if (!isPrivateOfficialCapturePath(root, output)) {
  throw new Error('Official captures must be written below the ignored captures/official directory')
}

const runtimeAssetPath = path.resolve(runtimeAsset)
const cartPath = path.resolve(cart)
const workingRoot = path.resolve(sourceDirectory)
const eventLogPath = path.resolve(workingRoot, eventLog)
const outputPath = path.resolve(output)
const workingStat = fs.lstatSync(workingRoot, { throwIfNoEntry: false })
if (!workingStat?.isDirectory() || workingStat.isSymbolicLink()) {
  throw new Error('Private staging directory must be a regular non-symlink directory')
}
const normalizedEventLog = path.posix.normalize(eventLog.replaceAll('\\', '/'))
if (path.isAbsolute(eventLog) || normalizedEventLog === '..' || normalizedEventLog.startsWith('../')
    || !eventLogPath.startsWith(`${workingRoot}${path.sep}`)) {
  throw new Error('Event log must stay below the private staging directory')
}
for (const [label, file] of [['runtime asset', runtimeAssetPath], ['cart', cartPath], ['event log', eventLogPath]]) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`)
}
if (fs.existsSync(outputPath)) throw new Error('Official capture output already exists; captures are immutable')
const artifactRoot = path.join(
  path.dirname(outputPath),
  `${path.basename(outputPath, path.extname(outputPath))}.artifacts`,
)
if (fs.existsSync(artifactRoot)) throw new Error('Official capture artifact bundle already exists; captures are immutable')

const collected = collectOfficialProbeArtifacts(workingRoot, artifacts, artifactRoot)
const eventOutput = fs.readFileSync(eventLogPath, 'utf8')
const capture = buildOfficialEducationProbeCapture({
  probe: path.basename(cartPath, path.extname(cartPath)),
  runtimeVersion,
  runtimeSha256: sha256File(runtimeAssetPath),
  runtimeAssetUrl,
  runtimeAssetFilename: path.basename(runtimeAssetPath),
  cartSha256: sha256File(cartPath),
  browserName,
  browserVersion,
  loadMethod,
  eventLogSha256: sha256File(eventLogPath),
  output: eventOutput,
  attachments: collected.attachments,
  hostPlatform: os.platform(),
  hostArchitecture: os.arch(),
})
const errors = [
  ...validateOfficialProbeCapture(capture),
  ...validateOfficialProbeArtifactFiles(capture, outputPath),
  ...collected.errors,
]
capture.status = errors.length === 0 ? 'captured' : 'mismatch'
capture.validationErrors = errors
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(capture, null, 2)}\n`)
if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(`Official PICO-8 Education probe imported: ${capture.probe} (${capture.events.length} events)\n`)
