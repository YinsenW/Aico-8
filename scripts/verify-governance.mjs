import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectPath = path.join(root, 'governance/project.json')
const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'))
const dimensions = new Map(project.quality_gate.dimensions.map((name) => [name, []]))

function record(dimension, name, passed, detail = '') {
  dimensions.get(dimension).push({ name, passed: Boolean(passed), detail })
}

function absolute(relative) {
  return path.join(root, relative)
}

function exists(relative) {
  return fs.existsSync(absolute(relative))
}

function text(relative) {
  return fs.readFileSync(absolute(relative), 'utf8')
}

function lineCount(relative) {
  return text(relative).split(/\r?\n/).length
}

function sourceFiles(relative = '') {
  const directory = absolute(relative)
  const ignored = new Set(['.git', 'node_modules', 'build', 'dist', 'private', 'pico8_carts', 'workspaces'])
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return []
    const child = path.join(relative, entry.name)
    return entry.isDirectory() ? sourceFiles(child) : [child]
  })
}

function unique(items) {
  return new Set(items).size === items.length
}

function mapById(items) {
  return new Map(items.map((item) => [item.id, item]))
}

function allLocalLinksResolve(relative) {
  const source = text(relative)
  const links = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1])
  return links.every((target) => {
    const clean = target.replace(/^<|>$/g, '').split('#')[0]
    if (!clean || /^(https?:|mailto:)/.test(clean)) return true
    return fs.existsSync(path.resolve(path.dirname(absolute(relative)), clean))
  })
}

const requirements = mapById(project.requirements)
const exits = mapById(project.exits)
const openItems = mapById(project.open_items)
const tests = mapById(project.test_catalog)
const contractItems = [
  ...project.contracts.apis,
  ...project.contracts.jobs,
  ...project.contracts.data,
]
const contracts = mapById(contractItems)
const statuses = new Set(['planned', 'in_progress', 'verified', 'blocked', 'deprecated'])
const navigationPaths = project.navigation.map((document) => document.path)
const coreDocuments = [
  'AGENTS.md',
  'docs/GOVERNANCE.md',
  'docs/PRODUCT.md',
  'docs/ARCHITECTURE.md',
  'docs/CONTRACTS.md',
  'docs/DEVELOPMENT.md',
]
const roadmap = text('ROADMAP.md')
const workPackageIds = [...roadmap.matchAll(/\bWP-M\d+-\d+\b/g)].map((match) => match[0])
const roadmapExitIds = [...roadmap.matchAll(/\bEXIT-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g)].map((match) => match[0])
const roadmapStages = Array.from({ length: 10 }, (_, stage) => {
  const section = roadmap.match(new RegExp(`## M${stage} [^\\n]*([\\s\\S]*?)(?=\\n## M\\d|$)`))?.[1] ?? ''
  return { stage, section }
})

// Navigation and resource lifecycle: ten independently reported checks.
record('navigation_lifecycle', 'bounded default navigation', project.navigation.length <= 7)
record('navigation_lifecycle', 'all navigation resources exist', navigationPaths.every(exists))
record('navigation_lifecycle', 'navigation document IDs are unique', unique(project.navigation.map((item) => item.id)))
record('navigation_lifecycle', 'all concept owners exist', Object.values(project.concept_owners).every(exists))
record('navigation_lifecycle', 'core local links resolve', [...coreDocuments, 'README.md', 'ROADMAP.md'].every(allLocalLinksResolve))
const lifecycleClasses = new Set(project.resource_classes.map((item) => item.class))
record('navigation_lifecycle', 'current lifecycle class declared', lifecycleClasses.has('authoritative_current'))
record('navigation_lifecycle', 'research lifecycle class declared', lifecycleClasses.has('research_evidence'))
record('navigation_lifecycle', 'generated evidence lifecycle declared', lifecycleClasses.has('executable_generated_evidence'))
record('navigation_lifecycle', 'current focus requirement exists', requirements.has(project.current_focus.requirement_id))
record('navigation_lifecycle', 'current focus exits exist', project.current_focus.exit_ids.every((id) => exits.has(id)))
record('navigation_lifecycle', 'execution plan has an explicit owner',
  project.concept_owners.execution_plan === 'ROADMAP.md' && exists('ROADMAP.md'))

// Cross-document contract consistency.
record('cross_document_consistency', 'requirement IDs are unique and valid',
  project.$schema === './schema.json' && exists('governance/schema.json') &&
  unique(project.requirements.map((item) => item.id)) && project.requirements.every((item) => /^REQ-[A-Z0-9-]+$/.test(item.id)))
record('cross_document_consistency', 'exit IDs are unique and valid',
  unique(project.exits.map((item) => item.id)) && project.exits.every((item) => /^EXIT-[A-Z0-9-]+$/.test(item.id)))
record('cross_document_consistency', 'contract IDs are unique and valid',
  unique(contractItems.map((item) => item.id)) && contractItems.every((item) => /^(API|JOB|DATA)-[A-Z0-9-]+$/.test(item.id)))
record('cross_document_consistency', 'requirement contract references resolve',
  project.requirements.every((item) => item.contract_ids.every((id) => contracts.has(id))))
record('cross_document_consistency', 'PRD contains every requirement ID',
  project.requirements.every((item) => text(item.source).includes(item.id)))
record('cross_document_consistency', 'contract owner document contains every contract ID',
  contractItems.every((item) => text('docs/CONTRACTS.md').includes(item.id)))
record('cross_document_consistency', 'concept ownership is one-to-one',
  unique(Object.keys(project.concept_owners)) && unique(Object.values(project.concept_owners)))
const glossaryCorpus = coreDocuments.map(text).join('\n').toLowerCase()
record('cross_document_consistency', 'glossary IDs and terms are unique',
  unique(project.glossary.map((item) => item.id)) && unique(project.glossary.map((item) => item.term.toLowerCase())))
record('cross_document_consistency', 'canonical glossary terms occur in owner documents',
  project.glossary.every((item) => glossaryCorpus.includes(item.term.toLowerCase())))
record('cross_document_consistency', 'roadmap work-package IDs are unique and valid',
  workPackageIds.length >= 20 && unique(workPackageIds) && workPackageIds.every((id) => /^WP-M\d+-\d+$/.test(id)))
record('cross_document_consistency', 'roadmap names every product requirement',
  project.requirements.every((item) => roadmap.includes(item.id)))
const profiles = JSON.parse(text('specs/display-profiles.json')).profiles
const hd = profiles['hd-1024-square']
record('cross_document_consistency', 'display data matches architecture invariant',
  hd.logical_width === 128 && hd.logical_height === 128 && hd.output_width === 1024 &&
  hd.output_height === 1024 && hd.logical_scale === 8 && hd.output_tile_size === 64)

// Requirement -> Exit -> implementation/evidence/test/open-item closure.
record('traceability_acceptance', 'every requirement has resolvable exits',
  project.requirements.every((item) => item.exit_ids.length > 0 && item.exit_ids.every((id) => exits.has(id))))
record('traceability_acceptance', 'every exit has a valid requirement back-reference',
  project.exits.every((item) => requirements.has(item.requirement_id) && requirements.get(item.requirement_id).exit_ids.includes(item.id)))
record('traceability_acceptance', 'verified requirements have only verified exits',
  project.requirements.filter((item) => item.status === 'verified').every((item) => item.exit_ids.every((id) => exits.get(id).status === 'verified')))
record('traceability_acceptance', 'verified exits have implementation evidence and selectors',
  project.exits.filter((item) => item.status === 'verified').every((item) =>
    item.implementation.length > 0 && item.evidence.length > 0 && item.test_selectors.length > 0))
record('traceability_acceptance', 'active requirements retain explicit open work',
  project.requirements.filter((item) => item.status === 'in_progress' || item.status === 'planned')
    .every((item) => item.open_item_ids.length > 0 && item.open_item_ids.every((id) => openItems.has(id))))
record('traceability_acceptance', 'every unverified exit retains direct open work',
  project.exits.filter((item) => item.status !== 'verified')
    .every((item) => project.open_items.some((openItem) => openItem.exit_id === item.id)))
record('traceability_acceptance', 'open items link the same requirement and exit',
  project.open_items.every((item) => requirements.has(item.requirement_id) && exits.has(item.exit_id) &&
    exits.get(item.exit_id).requirement_id === item.requirement_id && requirements.get(item.requirement_id).open_item_ids.includes(item.id)))
record('traceability_acceptance', 'implementation paths exist',
  project.exits.every((item) => item.implementation.every(exists)))
record('traceability_acceptance', 'evidence paths exist',
  project.exits.every((item) => item.evidence.every(exists)))
record('traceability_acceptance', 'test selectors resolve and cover their exits',
  project.exits.every((item) => item.test_selectors.every((id) => tests.has(id) && tests.get(id).covers.includes(item.id))))
record('traceability_acceptance', 'statuses and graph nodes are non-orphaned',
  project.requirements.every((item) => statuses.has(item.status)) &&
  project.exits.every((item) => statuses.has(item.status)) &&
  project.test_catalog.every((item) => item.covers.every((id) => exits.has(id))))
record('traceability_acceptance', 'roadmap acceptance Exit references resolve',
  roadmapExitIds.length > 0 && roadmapExitIds.every((id) => exits.has(id)))

// Support for a new agent that has no conversation history.
const agentEntry = text('AGENTS.md')
const development = text('docs/DEVELOPMENT.md')
const workflow = text('.github/workflows/ci.yml')
const repositorySources = sourceFiles()
record('development_support', 'entry links governance status and owner documents',
  ['governance/project.json', 'docs/PRODUCT.md', 'docs/ARCHITECTURE.md', 'docs/CONTRACTS.md', 'docs/DEVELOPMENT.md']
    .every((needle) => agentEntry.includes(needle)))
record('development_support', 'entry routes agents through the execution plan', agentEntry.includes('ROADMAP.md'))
record('development_support', 'bootstrap procedure is explicit', /Bootstrap/i.test(development))
record('development_support', 'recovery procedure is explicit', /Recovery after interruption/i.test(development))
record('development_support', 'diagnosis procedure is explicit', /Diagnosis/i.test(development))
record('development_support', 'handoff procedure is explicit', /Handoff and PR closure/i.test(development))
record('development_support', 'all selector commands are documented',
  project.test_catalog.every((item) => development.includes(item.command)))
record('development_support', 'false completion is explicitly forbidden', agentEntry.includes('Implementation is not completion'))
record('development_support', 'private fixture and rights safety are explicit',
  /private fixtures/i.test(development) && /rights gate/i.test(agentEntry))
record('development_support', 'CI contains every declared public job',
  project.test_catalog.filter((item) => item.availability === 'public' && item.ci_job)
    .every((item) => workflow.includes(`${item.ci_job}:`)))
record('development_support', 'language and HD mutation boundaries are explicit',
  agentEntry.includes('TypeScript owns') && agentEntry.includes('C++ compatibility kernel') && agentEntry.includes('may not mutate'))
record('development_support', 'Python stays in research and test boundaries',
  repositorySources.filter((item) => item.endsWith('.py'))
    .every((item) => item.startsWith('tools/') || item.startsWith('tests/')))
record('development_support', 'C++ stays inside the compatibility kernel',
  repositorySources.filter((item) => /\.(cc|cpp|cxx)$/.test(item))
    .every((item) => item.startsWith('runtime/core/') || item === 'runtime/kernel-rs/src/z8lua_bridge.cpp'))
record('development_support', 'every roadmap stage has bounded work and acceptance',
  roadmapStages.every(({ stage, section }) =>
    (section.match(new RegExp(`WP-M${stage}-\\d+`, 'g')) ?? []).length >= 2 && section.includes('Acceptance:')))

// Documentation leanness and maintainability.
record('lean_maintainability', 'default entry set stays at seven or fewer', project.navigation.length <= 7)
record('lean_maintainability', 'AGENTS line budget', lineCount('AGENTS.md') <= 160)
record('lean_maintainability', 'README line budget', lineCount('README.md') <= 140)
record('lean_maintainability', 'ROADMAP line budget', lineCount('ROADMAP.md') <= 90)
record('lean_maintainability', 'core document budgets',
  project.navigation.every((item) => lineCount(item.path) <= item.max_lines))
const obsoleteResearchFiles = fs.existsSync(absolute('docs/research'))
  ? fs.readdirSync(absolute('docs/research')).filter((name) => name.endsWith('.md'))
  : []
record('lean_maintainability', 'maintained references are not split across docs/research', obsoleteResearchFiles.length === 0)
record('lean_maintainability', 'one owner per concept', unique(Object.values(project.concept_owners)))
record('lean_maintainability', 'research is absent from default navigation',
  navigationPaths.every((item) => !item.startsWith('research/')))
record('lean_maintainability', 'roadmap does not duplicate checkbox status', !/- \[[ xX]\]/.test(text('ROADMAP.md')))
record('lean_maintainability', 'combined navigation context remains bounded',
  project.navigation.reduce((total, item) => total + lineCount(item.path), 0) <= 1800)
record('lean_maintainability', 'vendored runtime is excluded from language ownership statistics',
  text('.gitattributes').includes('runtime/third_party/z8lua/**') &&
  text('.gitattributes').includes('linguist-vendored'))

let failed = false
for (const [dimension, checks] of dimensions) {
  const passed = checks.filter((check) => check.passed).length
  const score = (passed / checks.length) * 10
  const ok = score >= project.quality_gate.minimum_dimension_score
  failed ||= !ok
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${dimension}: ${score.toFixed(1)}/10 (${passed}/${checks.length})\n`)
  for (const check of checks.filter((item) => !item.passed)) {
    process.stdout.write(`  - ${check.name}${check.detail ? `: ${check.detail}` : ''}\n`)
  }
}

if (failed) {
  process.stderr.write(`Governance gate requires every dimension >= ${project.quality_gate.minimum_dimension_score.toFixed(1)}/10.\n`)
  process.exitCode = 1
} else {
  process.stdout.write('Aico 8 governance gate: PASS\n')
}
