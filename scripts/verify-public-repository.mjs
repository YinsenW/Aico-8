import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  })
}

function requireCondition(condition, message) {
  if (!condition) failures.push(message)
}

const forbiddenPaths = [
  /(^|\/)(private|pico8_carts|workspaces)(\/|$)/i,
  /(^|\/)tests\/remakes\/dust_bunny\//i,
  /(^|\/)research\/dust_bunny/i,
  /(^|\/)research\/representative_cart_plan\.md$/i,
  /z8lua_(local_)?corpus_syntax_report\.json$/i,
  /dust_bunny_(memory|vm)_test\.cpp$/i,
]

const originRefs = git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/'])
  .split(/\r?\n/)
  .filter((ref) => ref && ref !== 'refs/remotes/origin/HEAD')
const publicRefs = ['HEAD', ...originRefs]
const objects = git(['rev-list', '--objects', ...publicRefs])
  .split(/\r?\n/)
  .filter(Boolean)
const historicalPaths = objects
  .map((line) => line.slice(line.indexOf(' ') + 1))
  .filter((value, index) => objects[index].includes(' '))

for (const file of historicalPaths) {
  requireCondition(!forbiddenPaths.some((pattern) => pattern.test(file)),
    `forbidden path remains in reachable history: ${file}`)
}

const patchHistory = git([
  'log',
  '--format=',
  '-p',
  '--no-ext-diff',
  '--no-textconv',
  ...publicRefs,
])
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
]
for (const pattern of secretPatterns) {
  requireCondition(!pattern.test(patchHistory), `possible secret detected by ${pattern}`)
}

const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')
const packageManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const thirdPartyNotice = fs.readFileSync(path.join(root, 'runtime/third_party/THIRD_PARTY_NOTICES.md'), 'utf8')
requireCondition(license.includes('Apache License') && license.includes('Version 2.0, January 2004'),
  'LICENSE is not Apache-2.0 text')
requireCondition(packageManifest.license === 'Apache-2.0', 'package.json license is not Apache-2.0')
requireCondition(thirdPartyNotice.length > 0, 'third-party notice is missing or empty')

if (process.env.GITHUB_ACTIONS === 'true') {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  requireCondition(event.repository?.visibility === 'public' && event.repository?.private === false,
    'GitHub Actions repository is not public')
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Public repository gate: PASS (${objects.length} reachable objects audited)\n`)
  if (process.env.GITHUB_ACTIONS !== 'true') {
    process.stdout.write('GitHub visibility check is deferred to the public-history CI job.\n')
  }
}
