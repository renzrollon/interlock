// The three callers of the domain selection agree (spec: review/domain-review,
// "a run, the CLI and the merge evidence agree").
//
// Selection and assembly have three callers: `interlock domain-context`, the
// merge evidence's living list, and a ship run's review step. Each used to build
// its own inputs, so a cut could read one way in a run and another in the CLI,
// and a capability whose living spec cited an ungraphed file was selected by
// none. These cases drive all three over one repository and graph.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { gatherLivingList } from '../../lib/merge-evidence.mjs'
import { assessMergeConfidence } from '../../lib/merge-confidence.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'cli', 'interlock')
const PR28 = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'review-proof', 'pr28', 'domain-context.json'), 'utf8'))

/** A repository holding the PR #28 living texts and changed files, with a graph that links them and lacks one file. */
function pr28Repo({ ungraphed = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'interlock-domain-agree-'))
  const write = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  for (const [capability, text] of Object.entries(PR28.livingTexts)) write(`openspec/specs/${capability}/spec.md`, text)
  for (const p of PR28.changedPaths) write(p, 'export {}\n')
  const links = ungraphed ? PR28.links.filter(l => l.target !== `file:${ungraphed}`) : PR28.links
  const nodes = PR28.changedPaths.filter(p => p !== ungraphed).map(p => ({ id: `file:${p}`, type: 'file' }))
  write('.claude/graph/graph.json', JSON.stringify({ graph: { built_at: '2026-10-10T00:00:00Z' }, nodes, links }))
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  return root
}

function cli(root, args) {
  const r = spawnSync(process.execPath, [BIN, ...args, '--root', root, '--json'], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

const order = capabilities => capabilities.map(c => [c.capability, c.via])

test('the CLI verb and the merge evidence select the same capabilities, in the same order, by the same rule', () => {
  const root = pr28Repo({ ungraphed: 'lib/settle-meter.mjs' })
  try {
    const verb = cli(root, ['domain-context', '--changed', PR28.changedPaths.join(',')])
    const { living } = gatherLivingList(root, { changedPaths: PR28.changedPaths })
    assert.ok(living, 'the living list was built')
    const fromEvidence = [...new Set(living.requirements.map(r => r.capability))]
    assert.deepEqual(
      fromEvidence,
      verb.capabilities.map(c => c.capability).filter(c => fromEvidence.includes(c)),
      'the living list takes capabilities in the verb\'s order'
    )
    assert.equal(verb.capabilities[0].capability, 'hooks/settle-meter')
    assert.ok(verb.ungraphed.files.some(f => f.path === 'lib/settle-meter.mjs' && f.citedBy.includes('hooks/settle-meter')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a cut gives the living checklist no no-graph flag: the cut is omitted requirements, not a missing graph', () => {
  const root = pr28Repo()
  try {
    const verb = cli(root, ['domain-context', '--changed', PR28.changedPaths.join(',')])
    assert.match(verb.partial, /maxDomainSpecChars/)
    const { living } = gatherLivingList(root, { changedPaths: PR28.changedPaths })
    assert.equal(living.partial, null, 'the cut never lands on selection.partial')
    assert.ok(living.omitted.length > 0, 'the cut requirements are named as omitted')
    const handoff = { requirementsChecked: living.requirementsRequired, requirementsUnconfirmed: 0 }
    const signal = assessMergeConfidence({ living, handoff }).signals.find(s => s.id === 'conformance.living')
    assert.ok(!signal.flags.includes('no-graph'), JSON.stringify(signal.flags))
    assert.ok(signal.flags.includes('requirements-omitted'), JSON.stringify(signal.flags))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the run selects alike: its review step records the verb\'s capabilities and order', async () => {
  // The run's selection is `gatherDomain` in lib/run.mjs, reached through the
  // review step; test/spine/run.test.mjs drives that step over real repositories.
  // Here the two callers above are held to the same inputs builder the run calls.
  const { citedSelectionInputs, selectDomainCapabilities } = await import('../../lib/prompts/domain-context.mjs')
  const root = pr28Repo({ ungraphed: 'lib/settle-meter.mjs' })
  try {
    const verb = cli(root, ['domain-context', '--changed', PR28.changedPaths.join(',')])
    const graph = JSON.parse(readFileSync(join(root, '.claude/graph/graph.json'), 'utf8'))
    const edges = graph.links.filter(l => l.relation === 'implements_spec')
    const inputs = citedSelectionInputs({
      graph: { nodes: graph.nodes, builtAt: graph.graph.built_at },
      changedPaths: PR28.changedPaths,
      capabilities: Object.keys(PR28.livingTexts),
      readLiving: c => PR28.livingTexts[c] ?? null
    })
    const selection = selectDomainCapabilities({ changedPaths: PR28.changedPaths, edges, declared: [], ...inputs })
    assert.deepEqual(order(selection.capabilities), order(verb.capabilities))
    assert.deepEqual(selection.ungraphed.files, verb.ungraphed.files)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- one batched read of the living specs at a base (review fixes on PR #29, M3 and M10) ---

/** pr28Repo, committed, with the git readers cli/interlock hands the merge evidence. */
function committedPr28(ungraphed) {
  const root = pr28Repo({ ungraphed })
  const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' }
  spawnSync('git', ['add', '-A'], { cwd: root, env })
  spawnSync('git', ['commit', '-q', '-m', 'base'], { cwd: root, env })
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
  const gitText = (r, args, { input, encoding = 'utf8' } = {}) => {
    const out = spawnSync('git', args, { cwd: r, input, encoding: encoding === 'buffer' ? undefined : encoding })
    if (out.status !== 0) throw new Error(String(out.stderr).trim())
    return out.stdout
  }
  const readAtRef = (r, ref, path) => {
    const out = spawnSync('git', ['show', `${ref}:${path}`], { cwd: r, encoding: 'utf8' })
    return out.status === 0 ? { text: out.stdout } : { absent: true }
  }
  return { root, sha, gitText, readAtRef }
}

test('at a base, the CLI verb and the merge evidence select alike from one batched read of the base\'s specs', () => {
  const { root, sha, gitText, readAtRef } = committedPr28('lib/settle-meter.mjs')
  try {
    // A living spec removed after the base is still in force at it.
    rmSync(join(root, 'openspec', 'specs', 'hooks', 'settle-meter'), { recursive: true, force: true })
    const verb = cli(root, ['domain-context', '--changed', PR28.changedPaths.join(','), '--base', sha])
    assert.equal(verb.citedUnread, null)
    assert.ok(verb.ungraphed.files.some(f => f.path === 'lib/settle-meter.mjs' && f.citedBy.includes('hooks/settle-meter')))
    const { living, notes } = gatherLivingList(root, { changedPaths: PR28.changedPaths, base: sha, deps: { readAtRef, gitText } })
    assert.deepEqual(notes, [])
    const fromEvidence = [...new Set(living.requirements.map(r => r.capability))]
    assert.deepEqual(fromEvidence, verb.capabilities.map(c => c.capability).filter(c => fromEvidence.includes(c)))
    assert.ok(fromEvidence.includes('hooks/settle-meter'), 'selected from the base, not the edited working tree')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the merge evidence notes a batched read that failed, and still builds the list from what the graph links', () => {
  const { root, sha, readAtRef } = committedPr28('lib/settle-meter.mjs')
  try {
    const gitText = () => {
      throw new Error(`fatal: Not a valid object name ${sha}`)
    }
    const { living, notes } = gatherLivingList(root, { changedPaths: PR28.changedPaths, base: sha, deps: { readAtRef, gitText } })
    assert.ok(living, 'the list is still built')
    const note = notes.find(n => n.what === 'the living specs the domain selection scans for citations')
    assert.ok(note, JSON.stringify(notes))
    assert.match(note.reason, /could not be listed \(fatal: Not a valid object name/)
    assert.match(note.reason, /matched only against the living specs that were read/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
