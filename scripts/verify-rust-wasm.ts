import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

type KernelExports = {
  aico8_spike_reset(seed: number): void
  aico8_spike_step(buttons: number): void
  aico8_spike_checkpoint_word(index: number): number
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const trace = fs.readFileSync(
  path.join(root, 'tests/conformance/input_traces/kernel_spike.txt'),
  'utf8',
)
let seed = 0
const buttons: number[] = []
let expected = ''
for (const rawLine of trace.split(/\r?\n/)) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue
  const [key, value] = line.split(/\s+/, 2)
  if (key === 'seed') seed = Number.parseInt(value, 16)
  else if (key === 'buttons') buttons.push(Number.parseInt(value, 10))
  else if (key === 'expected') expected = value
  else throw new Error(`Unknown trace key: ${key}`)
}

const wasmDirectory = path.join(root, 'target/rust-spike')
const wasmPath = path.join(wasmDirectory, 'aico8_kernel_spike.wasm')
fs.mkdirSync(wasmDirectory, { recursive: true })
const build = spawnSync('rustc', [
  '--edition=2024',
  '--target',
  'wasm32-unknown-unknown',
  '--crate-name',
  'aico8_kernel_spike',
  '--crate-type',
  'cdylib',
  '-C',
  'opt-level=s',
  '-C',
  'panic=abort',
  '-o',
  wasmPath,
  path.join(root, 'runtime/kernel-rs/src/lib.rs'),
], { cwd: root, encoding: 'utf8' })
if (build.status !== 0) {
  process.stderr.write(build.stderr)
  throw new Error(`Rust Wasm build failed with status ${build.status ?? 'signal'}`)
}
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {})
const kernel = instance.exports as unknown as KernelExports
kernel.aico8_spike_reset(seed)
for (const button of buttons) kernel.aico8_spike_step(button)

const bytes = Buffer.alloc(32)
for (let index = 0; index < 8; index += 1) {
  bytes.writeUInt32LE(kernel.aico8_spike_checkpoint_word(index) >>> 0, index * 4)
}
const actual = bytes.toString('hex')
if (actual !== expected) {
  throw new Error(`Rust Wasm checkpoint mismatch: expected ${expected}, received ${actual}`)
}
process.stdout.write(`Rust native/Wasm checkpoint: ${actual}\n`)
