// The on-demand advisor end-to-end runner (scripts/advisor-e2e.mjs), as data.
// Nothing here launches `claude`: the runner's checks are pure over what a
// live run left on disk, so each one is exercised on a hand-made run here,
// and the real case.yaml and the committed smoke results stand in for the
// harness's own files.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CASE,
  CHANGE,
  casePrompt,
  costEstimate,
  graderFields,
  leakedPaths,
  loggerModule,
  parseArgs,
  probeChecks,
  readEvents,
  redactResults,
  scrub
} from '../../scripts/advisor-e2e.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SMOKE = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'evals', 'smoke-2026-09-04.json'), 'utf8'))

test('advisor-e2e: the prompt is the Spec Range case\'s execution.prompt, dedented and whole', () => {
  const prompt = casePrompt(readFileSync(join(ROOT, 'evals', CASE, 'case.yaml'), 'utf8'))
  assert.ok(prompt.startsWith(`The OpenSpec change "${CHANGE}" in this workspace`), prompt.slice(0, 80))
  assert.ok(prompt.endsWith('advisor.md by hand.\n'), prompt.slice(-80))
  assert.ok(prompt.includes(`interlock advisor "${CHANGE}" --brief --json`))
  assert.ok(prompt.includes('subagent_type "interlock:advisor"'))
  assert.ok(!/max_turns|timeout_seconds|allowed_tools/.test(prompt), 'the block ends where execution: carries on')
  assert.throws(() => casePrompt('name: x\n'), /no `prompt: \|` block/)
})

test('advisor-e2e: the logger names each event as a string literal and writes a per-session file', () => {
  const mod = loggerModule('/scratch/events')
  for (const event of ['agent.spawn', 'tool.call', 'turn.complete']) assert.ok(mod.includes(`on('${event}', `), event)
  assert.match(mod, /'\/events-' \+ Date\.now\(\) \+ '\.jsonl'/)
  assert.match(mod, /export function register\(on\)/)
  assert.ok(!/\bimport\b/.test(mod), 'the logger imports nothing')
})

test('advisor-e2e: argument errors are refused before anything runs', () => {
  assert.throws(() => parseArgs(['run', '--out', '/x']), /setup or verify/)
  assert.throws(() => parseArgs(['verify']), /--out/)
  assert.throws(() => parseArgs(['verify', '--out', '/x', '--only', 'both']), /--only/)
  assert.deepEqual(parseArgs(['verify', '--out', '/x', '--only', 'eval', '--write-fixtures']), { command: 'verify', writeFixtures: true, out: '/x', only: 'eval' })
})

function scratchRun({ events = [], draft = true, advisor = '# Checkpoint advisor — x\n\ndrafted 2026-10-21T06:44:49Z from .claude/metrics/advisor-brief-x.md\n' } = {}) {
  const out = mkdtempSync(join(tmpdir(), 'advisor-e2e-'))
  const repo = join(out, 'repo')
  mkdirSync(join(repo, '.claude', 'metrics'), { recursive: true })
  mkdirSync(join(repo, 'openspec', 'changes', CHANGE), { recursive: true })
  if (draft) writeFileSync(join(repo, '.claude', 'metrics', `advisor-${CHANGE}-20261021-120000.json`), '{}')
  writeFileSync(join(repo, '.claude', 'metrics', `advisor-brief-${CHANGE}-20261021-115900.md`), '# brief')
  if (advisor !== null) writeFileSync(join(repo, 'openspec', 'changes', CHANGE, 'advisor.md'), advisor)
  mkdirSync(join(out, 'events'))
  writeFileSync(join(out, 'events', 'events-1.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n')
  return { out, repo }
}

const spawnOf = (subagentType, model = 'claude-opus-5-5') => ({ event: 'agent.spawn', input: { subagentType, prompt: 'p' }, resolved: { model, agentId: 'a1' } })

test('advisor-e2e: a run with one advisor spawn, a draft and advisor.md passes every probe check', () => {
  const { out, repo } = scratchRun({ events: [spawnOf('Explore'), spawnOf('interlock:advisor'), { event: 'turn.complete', input: {} }] })
  try {
    const checks = probeChecks({ events: readEvents(join(out, 'events')), repo })
    assert.deepEqual(checks.filter(c => !c.ok), [])
    assert.equal(checks.length, 4)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('advisor-e2e: each probe fact fails by name — no spawn, a non-string model, no draft, no advisor.md', () => {
  const failed = run => probeChecks(run).filter(c => !c.ok).map(c => c.name)
  assert.deepEqual(failed({ events: [], repo: '/nowhere' }), ['logger captured events'])

  const a = scratchRun({ events: [spawnOf('Explore')], draft: false, advisor: null })
  const b = scratchRun({ events: [spawnOf('interlock:advisor', null), spawnOf('interlock:advisor')] })
  try {
    assert.deepEqual(failed({ events: readEvents(join(a.out, 'events')), repo: a.repo }), [
      'exactly one interlock:advisor agent.spawn',
      'the advisor spawn resolved a string model',
      'a draft the spec meter reads as kind: draft',
      'advisor.md records a drafted consult'
    ])
    assert.deepEqual(failed({ events: readEvents(join(b.out, 'events')), repo: b.repo }), [
      'exactly one interlock:advisor agent.spawn',
      'the advisor spawn resolved a string model'
    ])
  } finally {
    rmSync(a.out, { recursive: true, force: true })
    rmSync(b.out, { recursive: true, force: true })
  }

  const c = scratchRun({ events: [spawnOf('interlock:advisor')], advisor: '# Checkpoint advisor — x\n\nrecorded 2026-10-21T06:44:49Z\n\ndid not run: agent spawn errored\n' })
  try {
    const md = probeChecks({ events: readEvents(join(c.out, 'events')), repo: c.repo }).find(x => x.name === 'advisor.md records a drafted consult')
    assert.equal(md.ok, false)
    assert.equal(md.detail, 'did not run: agent spawn errored', 'a consult the CLI wrote down as failed is named with its reason')
  } finally {
    rmSync(c.out, { recursive: true, force: true })
  }
})

test('advisor-e2e: the cost line scales one agent run to the Spec Range share of the full job', () => {
  const results = { costUsd: 0.9, cases: [{ name: CASE, arms: { with: [{}], without: [{}] } }] }
  const est = costEstimate({ results, evals: { runsPerCase: 3, fullRunCostUsd: 15 }, specRangeCases: 10 })
  assert.equal(est.trials, 2)
  assert.ok(Math.abs(est.perRun - 0.45) < 1e-9)
  assert.ok(Math.abs(est.share - 27) < 1e-9)
  assert.equal(est.fits, false)
  assert.equal(costEstimate({ results: { cases: [] }, evals: { runsPerCase: 3, fullRunCostUsd: 15 }, specRangeCases: 10 }), null)
})

test('advisor-e2e: grader fields list every key the harness wrote, by arm and grader', () => {
  const fields = graderFields(SMOKE)
  assert.ok(fields.name && fields.passed, JSON.stringify(Object.keys(fields)))
  assert.ok(fields.passed.every(g => g.startsWith('with:')))
})

test('advisor-e2e: redaction removes only the prompt text, trace pointers and excerpts, and runner paths, and leaves the scores', () => {
  const kase = { name: 'c', promptMarkdown: 'secret prompt', graders: [{ name: 'g', type: 'llm' }], arms: { with: [{ passed: true, tracePath: '/Users/x/t.jsonl', graders: [{ name: 'g', passed: false, explanation: 'judge votes: FAIL', evidence: '{"type":"system"}' }] }] } }
  const out = redactResults({ costUsd: 1, partial: false, suite: { root: '/private/s/plugin', plugins: [{ name: 'interlock', path: '/private/s/plugin' }] }, cases: [kase] })
  assert.equal(out.cases[0].promptMarkdown, undefined)
  assert.equal(out.cases[0].arms.with[0].tracePath, undefined)
  assert.deepEqual(out.suite, { plugins: [{ name: 'interlock' }] })
  assert.deepEqual(out.cases[0].graders, kase.graders)
  assert.deepEqual(out.cases[0].arms.with[0].graders, [{ name: 'g', passed: false, explanation: 'judge votes: FAIL' }])
  assert.equal(kase.arms.with[0].graders[0].evidence, '{"type":"system"}', 'the input is not mutated')
  assert.equal(kase.promptMarkdown, 'secret prompt', 'the input is not mutated')
  assert.deepEqual(redactResults(SMOKE).cases.map(c => c.name), SMOKE.cases.map(c => c.name))
})

test('advisor-e2e: a fixture that still names a home path is caught, and scrub replaces scratch paths', () => {
  assert.deepEqual(leakedPaths({ a: ['/Users/x/repo/f', 'ok'], b: { c: 'fine' }, d: '/private/tmp/e-1/out' }, ['/Users/x', '/private/']), ['/Users/x/repo/f', '/private/tmp/e-1/out'])
  assert.deepEqual(leakedPaths({ a: 'fine', b: '/repo/.claude/metrics/b.md' }, ['/Users/x', '/private/']), [])
  assert.deepEqual(scrub({ p: 'Read /s/run/repo/.claude/metrics/b.md', q: '/s/run/x' }, [['/s/run/repo', '/repo'], ['/s/run', '/scratch']]), { p: 'Read /repo/.claude/metrics/b.md', q: '/scratch/x' })
})
