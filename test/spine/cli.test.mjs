// The CLI is the only path from the dynamic-workflow runtime into lib/: that
// runtime cannot import a module, so a policy that is not reachable as a
// subcommand is a policy the model will improvise. Everything in lib/ is
// already covered at module level; what is NOT covered by those tests is the
// wiring — a mistyped flag name, a `process.exit` that never fires, a `--json`
// that emits something unparseable. So these tests execute the real binary in a
// child process and assert on stdout, stderr and the exit status.
//
// Exit status is the load-bearing assertion. The workflow branches on it, so a
// gate that prints "HALT" and exits 0 is worse than one that crashes.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, rmSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIMITS, MERGE_BANDS } from '../../lib/limits.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'interlock')

let dir

/**
 * Run the real binary. Never throws on a non-zero exit — that is the assertion.
 *
 * `cwd` is pinned to the per-test temp dir on purpose. The CLI's `--root`
 * defaults to `.`, so a subcommand invoked without an explicit `--root` — and
 * plenty here are, because the flag is not what they are testing — resolves its
 * root from the child's cwd. Left unpinned that is the repository itself, and
 * every `wave-state create` in this file appends to the developer's live
 * `.claude/ship/runs/`. The suite would then be writing into the corpus that
 * `interlock report` reads, which is both a measurement defect and a way for a
 * test to pass on accumulated state it never wrote.
 */
function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd === undefined ? dir : opts.cwd,
    encoding: 'utf8',
    input: opts.input === undefined ? '' : opts.input,
    // Push configuration is environment-only (design D2), so the tests that
    // exercise it set it here. An `env` of `{INTERLOCK_NTFY_TOPIC: ''}` is how
    // a test asserts the UNSET path regardless of what the developer running
    // the suite happens to have exported.
    env: opts.env ? { ...process.env, ...opts.env } : process.env
  })
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** Run and parse --json, asserting the exit code first so a failure reads well. */
function runJson(args, expectedCode = 0) {
  const r = run([...args, '--json'])
  assert.equal(r.code, expectedCode, `expected exit ${expectedCode}, got ${r.code}: ${r.stderr}`)
  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(r.stdout)
  }, `--json did not emit parseable JSON for: ${args.join(' ')}\n${r.stdout}`)
  return parsed
}

function file(name, contents) {
  const p = join(dir, name)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, typeof contents === 'string' ? contents : JSON.stringify(contents))
  return p
}

/**
 * A task result claiming success. `record-batch` rejects the report of a task
 * that claims ok:true without a valid handoff, so the packet is part of the
 * fixture, not an optional extra.
 */
const okTask = id => ({
  id,
  ok: true,
  handoff: {
    schema: 'interlock.wave-handoff/1',
    taskId: id,
    status: 'ok',
    summary: `did ${id}`,
    evidence: [`src/${id}.ts:1-10`],
    next: `the next wave can build on ${id}`,
    blocker: null
  }
})

// --- fixtures -------------------------------------------------------------

const FINDINGS = [
  { dimension: 'typescript', severity: 'blocker', title: 'unchecked null deref', file: 'src/a.ts' },
  { dimension: 'typescript', severity: 'warning', title: 'missing return type', file: 'src/a.ts' },
  { dimension: 'qa', severity: 'suggestion', title: 'add an empty-case test', file: 'src/b.ts' }
]

const CLEAN_FINDINGS = [
  { dimension: 'qa', severity: 'suggestion', title: 'add an empty-case test', file: 'src/b.ts' }
]

// Two implementation tasks per group on purpose: a group holding one task is
// folded onto the wave before it, so a one-task group 2 would leave this
// fixture with a single implementation wave and no inter-wave boundary for the
// wave-state tests below to walk across.
const CLASSIFIED = {
  tasks: [
    { id: '1.1', group: 1, description: 'sessions table', tier: 3, model: 'opus', isTestTask: false },
    { id: '1.2', group: 1, description: 'login route', tier: 2, model: 'sonnet', isTestTask: false },
    { id: '2.1', group: 2, description: 'middleware', tier: 3, model: 'sonnet', isTestTask: false },
    { id: '2.2', group: 2, description: 'logout route', tier: 2, model: 'sonnet', isTestTask: false },
    { id: '3.1', group: 3, description: 'session tests', tier: 2, model: 'sonnet', isTestTask: true }
  ]
}

const PROFILE = {
  version: 1,
  unit: { command: 'npm test', timeout_ms: 120000 },
  coverage: { enabled: false },
  e2e: { enabled: false }
}

let paths

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'interlock-cli-'))

  paths = {
    findings: file('findings.json', FINDINGS),
    cleanFindings: file('clean-findings.json', CLEAN_FINDINGS),
    // The not-real verdicts cite evidence: a refutation without one does not
    // dismiss, and these fixtures exist to exercise resolution, not that gate.
    verdicts: file('verdicts.json', [
      { findingTitle: 'unchecked null deref', isReal: true, refinedSeverity: 'blocker', qualityScore: 9 },
      { findingTitle: 'unchecked null deref', isReal: true, qualityScore: 8 },
      { findingTitle: 'missing return type', isReal: false, qualityScore: 3, evidence: 'src/a.ts:12' },
      { findingTitle: 'add an empty-case test', isReal: false, qualityScore: 2, evidence: 'src/b.ts:5' }
    ]),
    classified: file('classified.json', CLASSIFIED),
    profile: file('profile.json', PROFILE),
    redTypecheck: file('results-red-tc.json', [
      { kind: 'typecheck', exitCode: 2 },
      { kind: 'unit', exitCode: 0, total: 10, passed: 10, failed: 0 }
    ]),
    greenResults: file('results-green.json', [
      { kind: 'typecheck', exitCode: 0 },
      { kind: 'unit', exitCode: 0, total: 10, passed: 10, failed: 0 }
    ]),
    redUnit: file('results-red-unit.json', [
      {
        kind: 'unit',
        exitCode: 1,
        total: 10,
        passed: 8,
        failed: 2,
        failures: [
          'AssertionError: expected 1 to equal 2 at src/a.test.ts:12:3',
          'AssertionError: expected 1 to equal 2 at src/b.test.ts:44:1'
        ]
      }
    ]),
    unitResult: file('unit-result.json', {
      exitCode: 1,
      total: 10,
      passed: 8,
      failed: 2,
      failures: ['AssertionError: expected 1 to equal 2 at src/a.test.ts:12:3']
    }),
    failures: file('failures.json', [
      'AssertionError: expected 1 to equal 2 at src/a.test.ts:12:3',
      'AssertionError: expected 1 to equal 2 at src/b.test.ts:44:1',
      'TypeError: x is not a function at src/c.ts:9:1'
    ])
  }

  // A repo root with one OpenSpec change, for risk / ledger / metrics.
  const change = join(dir, 'repo', 'openspec', 'changes', 'add-auth')
  mkdirSync(join(change, 'specs', 'auth'), { recursive: true })
  writeFileSync(
    join(change, 'proposal.md'),
    '# Add user authentication\n\nSession tokens and a login endpoint, plus a database migration.\n'
  )
  writeFileSync(join(change, 'design.md'), '# Design\nOpaque session token in the cookie.\n')
  writeFileSync(join(change, 'tasks.md'), '- [ ] 1.1 sessions table\n- [ ] 1.2 login route\n')
  writeFileSync(join(change, 'specs', 'auth', 'spec.md'), '## ADDED Requirements\n')
  paths.root = join(dir, 'repo')
  paths.change = change
})

after(() => {
  rmSync(dir, { recursive: true, force: true })
})

// --- usage, help, unknown commands ---------------------------------------

test('--help and a bare invocation print USAGE and exit 0', () => {
  for (const args of [[], ['--help'], ['-h']]) {
    const r = run(args)
    assert.equal(r.code, 0, `exit for "${args.join(' ')}"`)
    assert.match(r.stdout, /^interlock — deterministic decisions/)
    assert.match(r.stdout, /Exit codes:/)
  }
})

test('USAGE documents every subcommand this file exercises', () => {
  const { stdout } = run(['--help'])
  for (const name of [
    'interlock limits',
    'interlock remediate',
    'interlock review',
    'interlock risk',
    'interlock ledger',
    'interlock verify plan',
    'interlock verify judge',
    'interlock verify unit',
    'interlock verify cluster',
    'interlock verify repair',
    'interlock wave-state create',
    'interlock wave-state next',
    'interlock wave-state record-batch',
    'interlock wave-state record-verify',
    'interlock wave-state replan',
    'interlock tasks tick',
    'interlock tasks coverage',
    'interlock merge-confidence',
    'interlock verify baseline',
    'interlock verify coverage',
    'interlock domain-context',
    'interlock spec-audit'
  ]) {
    assert.ok(stdout.includes(name), `USAGE is missing "${name}"`)
  }
})

test('an unknown command names itself and exits non-zero', () => {
  const r = run(['definitely-not-a-command'])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /Unknown command: definitely-not-a-command/)
  assert.doesNotMatch(r.stderr, /at .*\n\s+at /) // not a stack trace
})

test('an unknown subcommand names the ones that exist', () => {
  const verify = run(['verify', 'wat'])
  assert.notEqual(verify.code, 0)
  assert.match(verify.stderr, /unknown verify subcommand: wat/)
  assert.match(verify.stderr, /plan\|judge\|unit\|spill\|cluster\|repair/)

  const wave = run(['wave-state', 'wat'])
  assert.notEqual(wave.code, 0)
  assert.match(wave.stderr, /unknown wave-state subcommand: wat/)
  assert.match(wave.stderr, /create\|next\|record-batch/)
})

test('a missing required flag is an actionable message, not a stack trace', () => {
  for (const args of [
    ['remediate'],
    ['review', '--findings', paths.findings],
    ['verify', 'judge', '--results', paths.greenResults],
    ['wave-state', 'next']
  ]) {
    const r = run(args)
    assert.notEqual(r.code, 0, `"${args.join(' ')}" should fail`)
    assert.match(r.stderr, /^interlock: --[a-z-]+ .*is required/m, `message for "${args.join(' ')}"`)
    assert.doesNotMatch(r.stderr, /\n\s+at /) // no stack frames
  }
})

test('only one input per invocation may be read from stdin', () => {
  const r = run(['review', '--findings', '-', '--verdicts', '-'], { input: '[]' })
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /only one input per invocation may be "-"/)
})

// --- limits ---------------------------------------------------------------

test('limits prints the caps and emits them as JSON', () => {
  const text = run(['limits'])
  assert.equal(text.code, 0)
  assert.match(text.stdout, /remediation rounds/)
  assert.match(text.stdout, /runtime ceilings: 16 concurrent/)

  const out = runJson(['limits'])
  assert.equal(out.limits.remediationRounds, 2)
  assert.equal(out.limits.maxParallel, 8)
  assert.equal(out.runtime.maxConcurrentAgents, 16)
  // The lane-cap table and the solo envelope are their own top-level groups, not
  // entries of the iteration-count limits — the JSON surface the spec requires.
  assert.deepEqual(out.laneCaps.byTier, { 1: 8, 2: 8, 3: 6, 4: 4, 5: 8 })
  assert.equal(out.laneCaps.cohesionMaxTier, 3)
  assert.equal(out.solo.maxTasks, 20)
  assert.equal(out.limits.maxTasksPerAgent, undefined, 'the scalar lane cap is gone, not aliased')
})

// --- waves --mode ---------------------------------------------------------

test('waves --mode solo plans one lane, and both modes together are rejected', () => {
  const solo = runJson(['waves', '--classified', paths.classified, '--mode', 'solo'])
  assert.equal(solo.mode, 'solo')
  assert.equal(solo.modeSource, 'flag')
  assert.equal(solo.laneCount, 1, 'a solo plan is one lane holding the whole change')

  const both = run(['waves', '--classified', paths.classified, '--mode', 'solo', '--mode', 'waves'])
  assert.equal(both.code, 1, both.stdout)
  assert.match(both.stderr, /contradictory mode overrides \(solo and waves\)/)
})

// --- remediate ------------------------------------------------------------

test('remediate plans a fix round and exits 0', () => {
  const plan = runJson(['remediate', '--findings', paths.findings, '--round', '1'])
  assert.equal(plan.round, 1)
  assert.equal(plan.halt, false)
  assert.equal(plan.counts.fixing, 2)
  assert.equal(plan.fix.byFile.length, 1)
  assert.equal(plan.fix.byFile[0].file, 'src/a.ts')
})

test('the remediate verdict round exits 1 when blockers survive', () => {
  const r = run(['remediate', '--findings', paths.findings, '--round', '3'])
  assert.equal(r.code, 1, r.stderr)
  assert.match(r.stdout, /REMEDIATION VERDICT after 2 round\(s\) — 1 blocker\(s\) unresolved/)
  assert.match(r.stdout, /HALT:/)

  const plan = runJson(['remediate', '--findings', paths.findings, '--round', '3'], 1)
  assert.equal(plan.halt, true)
  assert.equal(plan.isFinalRound, true)
})

test('the remediate verdict round exits 0 when no blocker survives', () => {
  const plan = runJson(['remediate', '--findings', paths.cleanFindings, '--round', '3'], 0)
  assert.equal(plan.halt, false)
  assert.equal(plan.isFinalRound, true)
})

test('remediate rejects a round past the cap with a message naming the cap', () => {
  const r = run(['remediate', '--findings', paths.findings, '--round', '9'])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /exceeds the cap/)
  assert.doesNotMatch(r.stderr, /\n\s+at /)
})

// --- review ---------------------------------------------------------------

test('review resolves findings against verdicts and exits 0', () => {
  const out = runJson(['review', '--findings', paths.findings, '--verdicts', paths.verdicts])
  assert.equal(out.counts.raised, 3)
  assert.equal(out.counts.dismissed, 2)
  assert.equal(out.counts.surviving, 1)
  assert.equal(out.surviving[0].title, 'unchecked null deref')
})

test('review --metrics writes the counts and reports the path', () => {
  const root = join(dir, 'metrics-root')
  mkdirSync(root, { recursive: true })
  const out = runJson([
    'review', '--findings', paths.findings, '--verdicts', paths.verdicts,
    '--metrics', 'add-auth', '--root', root
  ])
  assert.equal(out.metrics.written, true)
  assert.match(out.metrics.path, /\.claude\/metrics\/review-add-auth-.*\.json$/)
})

test('review --metrics still exits 0 when the metrics directory is unwritable', () => {
  const root = join(dir, 'readonly-root')
  mkdirSync(root, { recursive: true })
  chmodSync(root, 0o500)
  try {
    const r = run([
      'review', '--findings', paths.findings, '--verdicts', paths.verdicts,
      '--metrics', 'add-auth', '--root', root
    ])
    // The review itself succeeded, so the exit code must be untouched by
    // bookkeeping — and the reason must still be visible.
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /REVIEW — 1 of 3 finding\(s\) survived/)
    assert.match(r.stderr, /metrics not written:/)

    const out = runJson([
      'review', '--findings', paths.findings, '--verdicts', paths.verdicts,
      '--metrics', 'add-auth', '--root', root
    ])
    assert.equal(out.metrics.written, false)
    assert.ok(out.metrics.reason, 'a failed metrics write must carry a reason')
  } finally {
    chmodSync(root, 0o700)
  }
})

test('review --metrics without a change name is an actionable error', () => {
  const r = run(['review', '--findings', paths.findings, '--verdicts', paths.verdicts, '--metrics'])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /--metrics requires a change name/)
})

// --- gate --metrics -------------------------------------------------------
//
// `review-artifacts` reaches a verdict through `gate`, never through `review`,
// so without this flag that whole path is permanently unobservable: the report's
// review-finding indicators read "unobserved" no matter how many gates ran.

test('gate --metrics writes the counts that produced the verdict, and the report recognizes them', () => {
  const root = join(dir, 'gate-metrics-root')
  mkdirSync(root, { recursive: true })

  // The blocker is dismissed, so this gate passes — and a passing gate must
  // record as readily as a blocking one.
  const out = runJson([
    'gate', '--findings', paths.findings,
    '--dismissed', 'unchecked null deref',
    '--metrics', 'add-auth', '--root', root
  ])
  assert.equal(out.passed, true)
  assert.equal(out.metrics.written, true)
  assert.match(out.metrics.path, /\.claude\/metrics\/review-add-auth-.*\.json$/)

  // The four counts are the ones the verdict rests on, not a re-reading of the
  // findings file: one dismissal removed, nothing scored away by the band.
  const record = JSON.parse(readFileSync(out.metrics.path, 'utf8'))
  assert.equal(record.change, 'add-auth')
  assert.deepEqual(record.counts, {
    raised: 3,
    dismissed: 1,
    droppedByQuality: 0,
    surviving: 2
  })

  // The whole point of emitting: the report's classifier must count it.
  const report = runJson(['report', '--root', root])
  assert.equal(report.coverage.metrics.recognized, 1, JSON.stringify(report.coverage.metrics))
  assert.deepEqual(report.coverage.metrics.unrecognized, [])
})

test('a passing gate with nothing raised still records zero as an observed count', () => {
  const root = join(dir, 'gate-metrics-zero')
  mkdirSync(root, { recursive: true })
  const out = runJson([
    'gate', '--findings', file('no-findings.json', []), '--metrics', 'add-auth', '--root', root
  ])
  assert.equal(out.passed, true)
  assert.equal(out.metrics.written, true)
  const record = JSON.parse(readFileSync(out.metrics.path, 'utf8'))
  assert.deepEqual(record.counts, { raised: 0, dismissed: 0, droppedByQuality: 0, surviving: 0 })
})

test('gate --metrics leaves a blocking verdict and its exit 1 untouched when the write fails', { skip: isRoot() }, () => {
  const root = join(dir, 'gate-metrics-readonly')
  mkdirSync(root, { recursive: true })
  chmodSync(root, 0o500)
  try {
    const r = run(['gate', '--findings', paths.findings, '--metrics', 'add-auth', '--root', root])
    assert.equal(r.code, 1, 'bookkeeping must not rescue a blocked gate')
    assert.match(r.stdout, /GATE BLOCKED/)
    assert.match(r.stderr, /metrics not written:/)

    const out = run([
      'gate', '--findings', paths.findings, '--metrics', 'add-auth', '--root', root, '--json'
    ])
    assert.equal(out.code, 1)
    const parsed = JSON.parse(out.stdout)
    assert.equal(parsed.passed, false, 'the verdict must survive a failed write')
    assert.equal(parsed.blockers.length, 1)
    assert.equal(parsed.metrics.written, false)
    assert.ok(parsed.metrics.reason, 'a failed metrics write must carry a reason')
  } finally {
    chmodSync(root, 0o700)
  }
})

test('gate --metrics without a change name is an actionable error', () => {
  const r = run(['gate', '--findings', paths.findings, '--metrics'])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /--metrics requires a change name/)
  assert.doesNotMatch(r.stderr, /\n\s+at /)
})

test('gate without --metrics writes nothing and never infers a change name', () => {
  const root = join(dir, 'gate-metrics-absent')
  mkdirSync(root, { recursive: true })
  const out = runJson(['gate', '--findings', paths.findings, '--root', root], 1)
  assert.equal(out.passed, false)
  assert.ok(!('metrics' in out), 'an unasked-for write must not even report itself')
  assert.equal(
    existsSync(join(root, '.claude', 'metrics')),
    false,
    'no change name means no record, never a record under a guessed name'
  )
})

test('gate --json carries the blocker count the spec skill feeds to the autonomy record', () => {
  // The review-artifacts and spec skills read these keys by name: `passed` as
  // the verdict, `blockers` and `malformed` as what to report, and
  // `autonomyOutcome.blockers` as the `<n>` for `interlock autonomy record`.
  // A rename here is a skill reading a field that is no longer printed.
  const root = join(dir, 'gate-autonomy-outcome')
  mkdirSync(root, { recursive: true })

  const out = runJson(['gate', '--findings', paths.findings, '--root', root], 1)
  for (const key of ['passed', 'blockers', 'malformed', 'autonomyOutcome']) {
    assert.ok(key in out, `gate --json no longer prints ${key}, which a skill reads by name`)
  }
  assert.equal(out.passed, false)
  assert.equal(out.autonomyOutcome.blockers, out.blockers.length)
  assert.equal(out.autonomyOutcome.blockers, out.counts.blocker)

  const clean = runJson(['gate', '--findings', paths.cleanFindings, '--root', root], 0)
  assert.equal(clean.passed, true)
  assert.equal(clean.autonomyOutcome.blockers, 0)
})

// --- verify ---------------------------------------------------------------

test('verify plan uses the profile commands verbatim and never invents one', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'npx tsc --noEmit'
  ])
  assert.equal(plan.hasProfile, true)
  const byKind = Object.fromEntries(plan.steps.map(s => [s.kind, s.command]))
  assert.equal(byKind.unit, 'npm test')
  assert.equal(byKind.typecheck, 'npx tsc --noEmit')
  assert.ok(plan.skipped.some(s => s.kind === 'e2e'))
})

test('verify plan --no-profile reports hasProfile:false rather than guessing', () => {
  const plan = runJson(['verify', 'plan', '--no-profile'])
  assert.equal(plan.hasProfile, false)
  assert.ok(plan.steps.every(s => s.kind !== 'unit'), 'no unit command may be invented')
  assert.ok(plan.banners.some(b => /NO TEST PROFILE/.test(b)))
})

test('verify plan --context inter-wave --changed docs skips every step', () => {
  const plan = runJson([
    'verify', 'plan', '--no-profile', '--context', 'inter-wave',
    '--changed', 'docs/foo.md', 'README.md'
  ])
  assert.deepEqual(plan.steps, [])
  assert.ok(plan.skipped.every(s => s.reason === 'docs-only-changes'))
})

test('verify plan --context inter-wave omits e2e and coverage', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--context', 'inter-wave',
    '--typecheck-command', 'npx tsc --noEmit'
  ])
  assert.ok(plan.steps.some(s => s.kind === 'unit'))
  assert.ok(plan.steps.every(s => s.kind !== 'e2e'))
  assert.ok(plan.steps.every(s => s.kind !== 'coverage'))
})

// The inter-wave budget is derived from the profile's unit.timeout_ms and
// floored at the published constant (spec: verify). `budgetSource` says which
// of the two the number came from, so a reader of the plan is never left
// guessing why it is what it is.

const profileWithTimeout = (name, timeout_ms) =>
  file(name, { ...PROFILE, unit: { command: 'npm test', timeout_ms } })

test('verify plan --context inter-wave plans against the budget its profile derives', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--context', 'inter-wave',
    '--elapsed-ms', '160000', '--typecheck-command', 'npx tsc --noEmit'
  ])
  assert.equal(plan.budgetMs, LIMITS.interWaveVerifications * 120000)
  assert.equal(plan.budgetSource, 'profile')
  assert.ok(plan.steps.some(s => s.kind === 'unit'), '160s into the checks, the suite still runs')
})

test('verify plan --context inter-wave never lets a profile lower the published budget', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', profileWithTimeout('profile-timeout-1.json', 1),
    '--context', 'inter-wave', '--elapsed-ms', String(LIMITS.interWaveVerifyBudgetMs),
    '--typecheck-command', 'npx tsc --noEmit'
  ])
  assert.equal(plan.budgetMs, LIMITS.interWaveVerifyBudgetMs)
  assert.equal(plan.budgetSource, 'published')
  assert.deepEqual(plan.steps.map(s => s.kind), ['typecheck'], 'only typecheck remains')
  assert.ok(plan.steps.every(s => s.kind !== 'unit'))
})

test('verify plan --budget-ms is used as given, whatever the profile holds', () => {
  for (const [name, timeout] of [['profile-timeout-120k.json', 120000], ['profile-timeout-one.json', 1]]) {
    const plan = runJson([
      'verify', 'plan', '--profile', profileWithTimeout(name, timeout),
      '--context', 'inter-wave', '--budget-ms', '5000'
    ])
    assert.equal(plan.budgetMs, 5000, `a profile with timeout_ms ${timeout} moved an explicit budget`)
    assert.equal(plan.budgetSource, 'flag')
  }
})

test('verify plan with no --context derives nothing and reports the published budget', () => {
  const plan = runJson(['verify', 'plan', '--profile', paths.profile])
  assert.equal(plan.budgetMs, LIMITS.interWaveVerifyBudgetMs)
  assert.equal(plan.budgetSource, 'published')
})

test('verify plan without --profile or --no-profile says which it wanted', () => {
  const r = run(['verify', 'plan'])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /--profile <file\|-> \(or --no-profile\) is required/)
})

test('verify judge exits 0 on a green run', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'npx tsc --noEmit'
  ])
  const planFile = file('vplan.json', plan)
  const verdict = runJson(
    ['verify', 'judge', '--plan', planFile, '--results', paths.greenResults], 0
  )
  assert.equal(verdict.halt, false)
  assert.equal(verdict.context, 'final')
})

test('verify judge exits 1 on a red unit suite in either context', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'npx tsc --noEmit'
  ])
  const planFile = file('vplan-unit.json', plan)
  for (const context of ['final', 'inter-wave']) {
    const r = run(['verify', 'judge', '--plan', planFile, '--results', paths.redUnit, '--context', context])
    assert.equal(r.code, 1, `${context} must halt on a red unit suite`)
    assert.match(r.stdout, /VERIFY HALT/)
  }
})

test('--context is load-bearing: a red typecheck halts inter-wave but not final', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'npx tsc --noEmit'
  ])
  const planFile = file('vplan-tc.json', plan)

  const interWave = run([
    'verify', 'judge', '--plan', planFile, '--results', paths.redTypecheck, '--context', 'inter-wave'
  ])
  assert.equal(interWave.code, 1, 'inter-wave must halt on a red typecheck')
  assert.match(interWave.stdout, /VERIFY HALT \[inter-wave\] — typecheck failed/)

  const final = run([
    'verify', 'judge', '--plan', planFile, '--results', paths.redTypecheck, '--context', 'final'
  ])
  assert.equal(final.code, 0, 'final must NOT halt on a red typecheck')
  assert.match(final.stdout, /VERIFY OK \[final\]/)
  assert.match(final.stdout, /TYPECHECK FAILED \(non-blocking at the final gate\)/)

  // And the default is the permissive-documented one.
  const dflt = runJson(['verify', 'judge', '--plan', planFile, '--results', paths.redTypecheck], 0)
  assert.equal(dflt.context, 'final')
  assert.deepEqual(dflt.haltingKinds, ['unit'])
})

test('verify judge rejects an unknown context instead of picking a default', () => {
  const planFile = file('vplan-ctx.json', runJson([
    'verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'tsc'
  ]))
  const r = run(['verify', 'judge', '--plan', planFile, '--results', paths.greenResults, '--context', 'nope'])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /--context must be one of inter-wave\|final \(got "nope"\)/)
})

test('verify judge rejects a --plan that did not come from verify plan', () => {
  const bogus = file('bogus-plan.json', { steps: 'not an array' })
  const r = run(['verify', 'judge', '--plan', bogus, '--results', paths.greenResults])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /--plan must be the JSON output of `interlock verify plan --json`/)
})

// --- verify judge trajectory wiring (add-ship-run-inspectability) ----------

test('verify judge appends a verify-judgement event when --state carries a runId, without suite stdout', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'npx tsc --noEmit'
  ])
  const planFile = file('vplan-log.json', plan)

  const wavePlan = runJson(['waves', '--classified', paths.classified])
  const state = runJson(['wave-state', 'create', '--plan', file('plan-vlog.json', wavePlan), '--root', dir])
  const stateFile = file('state-vlog.json', state)

  const resultsWithSecrets = [
    {
      kind: 'unit',
      exitCode: 1,
      total: 10,
      passed: 8,
      failed: 2,
      failures: ['SECRET-STDOUT-LINE'],
      locator: '.claude/ship/spill/x/1-unit.log'
    }
  ]
  const resultsFile = file('results-vlog.json', resultsWithSecrets)

  const r = run([
    'verify', 'judge', '--plan', planFile, '--results', resultsFile,
    '--context', 'final', '--state', stateFile, '--root', dir
  ])
  assert.equal(r.code, 1)

  const logPath = join(dir, '.claude', 'ship', 'runs', `${state.runId}.jsonl`)
  const raw = readFileSync(logPath, 'utf8')
  const events = raw.split('\n').filter(Boolean).map(l => JSON.parse(l))
  const judgement = events.find(e => e.type === 'verify-judgement')
  assert.ok(judgement, 'expected a verify-judgement event')
  assert.equal(judgement.runId, state.runId)
  assert.equal(judgement.context, 'final')
  assert.equal(judgement.halt, true)
  assert.deepEqual(judgement.spill, ['.claude/ship/spill/x/1-unit.log'])
  assert.doesNotMatch(raw, /SECRET-STDOUT-LINE/, 'suite failure text leaked onto the trajectory line')
})

test('verify judge appends a verify-judgement event from --run-id directly', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'npx tsc --noEmit'
  ])
  const planFile = file('vplan-runid.json', plan)

  const r = run([
    'verify', 'judge', '--plan', planFile, '--results', paths.greenResults,
    '--run-id', 'manual-run-1', '--change', 'add-widget', '--root', dir
  ])
  assert.equal(r.code, 0)

  const logPath = join(dir, '.claude', 'ship', 'runs', 'manual-run-1.jsonl')
  const events = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  assert.deepEqual(events.map(e => e.type), ['verify-judgement', 'cli-exit'])
  assert.equal(events[0].change, 'add-widget')
  assert.equal(events[0].halt, false)
  assert.equal(events[1].command, 'verify judge')
  assert.equal(events[1].exitCode, 0)
})

test('verify judge without --state or --run-id logs nothing and still exits normally', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'npx tsc --noEmit'
  ])
  const planFile = file('vplan-nolog.json', plan)
  const nologRoot = join(dir, 'nolog-root')
  mkdirSync(nologRoot, { recursive: true })

  const r = run([
    'verify', 'judge', '--plan', planFile, '--results', paths.greenResults, '--root', nologRoot
  ])
  assert.equal(r.code, 0)
  assert.equal(existsSync(join(nologRoot, '.claude', 'ship', 'runs')), false)
})

// The fatality these two have always had, pinned so a future edit cannot
// quietly demote either to a warning. `lib/run.mjs` now halts the live run on
// the same failure; that is one rule for `.claude/ship/runs`, and this is the
// half of it that predates the rule.
test('wave-state and verify judge exit non-zero when their trajectory append fails', () => {
  // A regular file where the trajectory DIRECTORY goes: every append fails for
  // any uid, so this holds when the suite runs as root — no chmod, no skip.
  const blocked = join(dir, 'blocked-trajectory-root')
  mkdirSync(join(blocked, '.claude', 'ship'), { recursive: true })
  writeFileSync(join(blocked, '.claude', 'ship', 'runs'), 'not a directory\n')

  const wavePlan = runJson(['waves', '--classified', paths.classified])
  const created = run([
    'wave-state', 'create', '--plan', file('plan-blocked.json', wavePlan), '--root', blocked
  ])
  assert.equal(created.code, 1, 'a wave-state mutation nobody could record is not a success')

  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'npx tsc --noEmit'
  ])
  const judged = run([
    'verify', 'judge', '--plan', file('vplan-blocked.json', plan), '--results', paths.greenResults,
    '--run-id', 'blocked-run-1', '--change', 'add-widget', '--root', blocked
  ])
  assert.equal(judged.code, 1, 'a green verdict nobody could record is still not a clean exit')
})

test('verify spill writes bytes to disk and prints locator, preview, hash', () => {
  const inputFile = join(dir, 'raw-suite-output.txt')
  writeFileSync(inputFile, 'x'.repeat(10_000))
  const result = runJson([
    'verify', 'spill', '--run-id', 'spill-run-1', '--kind', 'unit', '--input', inputFile, '--root', dir
  ])
  assert.equal(result.bytes, 10_000)
  assert.equal(result.truncated, true)
  assert.equal(result.locator, '.claude/ship/spill/spill-run-1/1-unit.log')
  assert.equal(readFileSync(join(dir, result.locator), 'utf8'), 'x'.repeat(10_000))
  assert.match(result.sha256, /^[0-9a-f]{64}$/)
})

test('verify spill requires --run-id and --kind', () => {
  const inputFile = file('spill-input.txt', 'hello')
  const noRunId = run(['verify', 'spill', '--kind', 'unit', '--input', inputFile, '--root', dir])
  assert.notEqual(noRunId.code, 0)
  assert.match(noRunId.stderr, /--run-id is required/)

  const noKind = run(['verify', 'spill', '--run-id', 'x', '--input', inputFile, '--root', dir])
  assert.notEqual(noKind.code, 0)
  assert.match(noKind.stderr, /--kind is required/)
})

test('verify judge rejects a result field that pastes spilled bytes instead of a preview', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'npx tsc --noEmit'
  ])
  const planFile = file('vplan-oversized.json', plan)
  const oversized = [
    { kind: 'unit', exitCode: 1, total: 1, passed: 0, failed: 1, cliStdout: 'y'.repeat(5000) }
  ]
  const r = run(['verify', 'judge', '--plan', planFile, '--results', file('oversized.json', oversized)])
  assert.equal(r.code, 1)
  assert.match(r.stdout, /oversized result field\(s\)/)
  assert.match(r.stdout, /unit\.cliStdout/)
  assert.match(r.stdout, /verify spill/)
})

test('verify judge rejects an oversized failures[] entry the same way', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'npx tsc --noEmit'
  ])
  const planFile = file('vplan-oversized-fail.json', plan)
  const oversized = [
    { kind: 'unit', exitCode: 1, total: 1, passed: 0, failed: 1, failures: ['z'.repeat(5000)] }
  ]
  const r = run(['verify', 'judge', '--plan', planFile, '--results', file('oversized-fail.json', oversized)])
  assert.equal(r.code, 1)
  assert.match(r.stdout, /oversized result field\(s\)/)
  assert.match(r.stdout, /failures\[0\]/)
})

test('verify judge accepts a preview-sized field the same shape would have produced', () => {
  const plan = runJson([
    'verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'npx tsc --noEmit'
  ])
  const planFile = file('vplan-preview-ok.json', plan)
  const withPreview = [
    { kind: 'unit', exitCode: 0, total: 10, passed: 10, failed: 0, cliStdout: 'ok'.repeat(100) }
  ]
  const r = runJson(['verify', 'judge', '--plan', planFile, '--results', file('preview-ok.json', withPreview)], 0)
  assert.equal(r.halt, false)
})

test('verify unit rejects an oversized field before judging', () => {
  const oversized = file('unit-oversized.json', { exitCode: 1, detail: 'd'.repeat(5000) })
  const r = run(['verify', 'unit', '--result', oversized])
  assert.equal(r.code, 1)
  assert.match(r.stdout, /oversized result field\(s\)/)
})

test('verify unit judges one result on its own and exits 1 when red', () => {
  const out = runJson(['verify', 'unit', '--result', paths.unitResult], 1)
  assert.equal(out.halt, true)
  assert.equal(out.status, 'red')
  assert.equal(out.clusters.length, 1)

  const green = file('unit-green.json', { exitCode: 0, total: 10, passed: 10, failed: 0 })
  const ok = runJson(['verify', 'unit', '--result', green], 0)
  assert.equal(ok.halt, false)
  assert.equal(ok.status, 'green')
})

test('verify cluster groups failures by root-cause signature', () => {
  const clusters = runJson(['verify', 'cluster', '--failures', paths.failures])
  assert.equal(clusters.length, 2)
  assert.equal(clusters[0].count, 2, 'the biggest cluster comes first')
  assert.match(clusters[0].signature, /expected 1 to equal 2/)
})

test('verify repair exits 1 only once the root-cause budget is spent', () => {
  const withBudget = file('repair-open.json', {
    iterationsUsed: 1,
    halt: true,
    clusters: [{ signature: 'assertion', count: 2 }]
  })
  const open = runJson(['verify', 'repair', '--state', withBudget], 0)
  assert.equal(open.action, 'repair')
  assert.equal(open.iterationsLeft, 4)

  const spent = file('repair-spent.json', {
    iterationsUsed: 5,
    halt: true,
    clusters: [{ signature: 'assertion', count: 2 }]
  })
  const out = runJson(['verify', 'repair', '--state', spent], 1)
  assert.equal(out.action, 'halt')
  assert.match(out.reason, /repair budget exhausted/)
})

// --- risk -----------------------------------------------------------------

test('risk classifies from the change artifacts plus the changed paths', () => {
  const out = runJson([
    'risk', 'add-auth', '--root', paths.root, '--paths', 'src/auth/session.ts,src/api/login.ts'
  ])
  assert.equal(out.change, 'add-auth')
  assert.equal(out.riskClass, 'high')
  assert.equal(out.continuityAllowed, false)
  assert.ok(out.artifactNames.includes('proposal.md'), 'artifact text must be read from disk')
  assert.ok(out.signals.some(s => s.signal === 'auth-session-permissions-tenancy'))
})

test('risk exits 0 even when it refuses continuity — the class is the signal', () => {
  const r = run(['risk', 'add-auth', '--root', paths.root, '--paths', 'src/auth/session.ts'])
  assert.equal(r.code, 0, 'risk must never gate by exit status')
  assert.match(r.stdout, /RISK HIGH — continuity NOT allowed/)
})

test('risk fails closed to high when there is nothing to classify', () => {
  const emptyRoot = join(dir, 'empty-repo')
  mkdirSync(join(emptyRoot, 'openspec', 'changes'), { recursive: true })
  // No change to resolve, but paths were supplied: classify from those alone.
  const out = runJson(['risk', '--root', emptyRoot, '--paths', 'src/lib/thing.ts'])
  assert.equal(out.change, null)
  assert.equal(out.riskClass, 'medium', 'unmatched source paths floor at medium, never low')

  // Nothing at all to go on is a resolution error, not a silent "low".
  const r = run(['risk', '--root', emptyRoot])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /no changes found/)
})

// --- ledger ---------------------------------------------------------------

test('a missing ledger exits 1 and says MISSING, not "empty"', () => {
  // An absent ledger used to exit 0 as "none recorded", which reads as
  // "nothing needs a human" — the one conclusion an absent file cannot
  // support, and the audit's likeliest failure.
  const r = run(['ledger', 'add-auth', '--root', paths.root])
  assert.equal(r.code, 1, r.stderr)
  assert.match(r.stdout, /DECISIONS MISSING/)
  const out = runJson(['ledger', 'add-auth', '--root', paths.root], 1)
  assert.equal(out.missing, true)
  assert.equal(out.exists, false)
  assert.equal(out.blocking, true)
})

test('a present-but-empty ledger is reported distinguishably from a missing one', () => {
  writeFileSync(
    join(paths.change, 'decisions.md'),
    '# Decisions — add-auth\n\n| id | question | class | resolution | evidence |\n|----|----|----|----|----|\n'
  )
  const out = runJson(['ledger', 'add-auth', '--root', paths.root], 0)
  assert.equal(out.missing, false)
  assert.equal(out.exists, true)
  assert.equal(out.total, 0)
  assert.equal(out.blocking, false)
  rmSync(join(paths.change, 'decisions.md'))
})

test('ledger exits 1 on a needs_human row and on an unsubstantiated agent_resolved row', () => {
  writeFileSync(
    join(paths.change, 'decisions.md'),
    [
      '# Decisions — add-auth',
      '',
      '| id | question | class | resolution | evidence |',
      '|----|----|----|----|----|',
      '| D1 | redis or postgres? | agent_resolved | postgres, already running | design.md:12 |',
      '| D2 | expire refresh tokens? | needs_human | — | — |',
      '| D3 | SameSite policy | agent_resolved | — | — |',
      ''
    ].join('\n')
  )
  // D1 is a well-formed agent_resolved row, so design.md has to record it by
  // id — otherwise the reference audit would make this test about the wrong
  // failure. D3 is the unsubstantiated one, and it is the point here.
  writeFileSync(join(paths.change, 'design.md'), '# Design\n\nD1: postgres, already running.\n')
  const r = run(['ledger', 'add-auth', '--root', paths.root])
  assert.equal(r.code, 1, 'a needs_human row must block')
  assert.match(r.stdout, /DECISIONS BLOCKING/)
  assert.match(r.stdout, /\[needs_human\] D2/)
  assert.match(r.stdout, /\[invalid\] D3/)

  const out = runJson(['ledger', 'add-auth', '--root', paths.root], 1)
  assert.equal(out.blocking, true)
  assert.equal(out.needsHuman, 1)
  assert.equal(out.invalid, 1, 'invalid is a count; the rows live under invalidRows')
  assert.equal(out.invalidRows.length, 1)
})

test('a fully resolved ledger exits 0 when design.md records the decision by id', () => {
  writeFileSync(
    join(paths.change, 'decisions.md'),
    [
      '# Decisions — add-auth',
      '',
      '| id | question | class | resolution | evidence |',
      '|----|----|----|----|----|',
      '| D1 | redis or postgres? | agent_resolved | postgres, already running | design.md:12 |',
      ''
    ].join('\n')
  )
  writeFileSync(join(paths.change, 'design.md'), '# Design\n\nD1: postgres, which is already running.\n')
  const out = runJson(['ledger', 'add-auth', '--root', paths.root], 0)
  assert.equal(out.blocking, false)
  assert.equal(out.agentResolved, 1)
})

test('an agent_resolved row whose id design.md never mentions exits 1', () => {
  // shared/DECISION-LEDGER.md has always said the assumption must appear in
  // design.md, referenced by id. Nothing checked it until now.
  writeFileSync(
    join(paths.change, 'decisions.md'),
    [
      '# Decisions — add-auth',
      '',
      '| id | question | class | resolution | evidence |',
      '|----|----|----|----|----|',
      '| D9 | session store? | agent_resolved | postgres | design.md:12 |',
      ''
    ].join('\n')
  )
  writeFileSync(join(paths.change, 'design.md'), '# Design\n\nNothing is assumed here.\n')
  const r = run(['ledger', 'add-auth', '--root', paths.root])
  assert.equal(r.code, 1)
  assert.match(r.stdout, /\[invalid\] D9/)
  assert.match(r.stdout, /design\.md/)
})

test('ledger names the candidates when the change does not resolve', () => {
  const r = run(['ledger', 'no-such-change', '--root', paths.root])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /change "no-such-change" not found/)
  assert.match(r.stderr, /candidates: add-auth/)
})

// --- wave-state -----------------------------------------------------------

test('a run state round-trips through the CLI as JSON', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const planFile = file('plan.json', plan)

  const state0 = runJson(['wave-state', 'create', '--plan', planFile])
  assert.equal(state0.cursor.waveIndex, 0)
  assert.equal(state0.waves.length, 3)

  const step = runJson(['wave-state', 'next', '--state', file('run0.json', state0)])
  assert.equal(step.action, 'run-batch')
  assert.equal(step.wave, 1)
  // `tasks` is the current batch, which holds LANES: [[task], [task]].
  assert.deepEqual(step.tasks.flat().map(t => t.id), ['1.1', '1.2'])
  // The clamp is applied by the planner, so it survives into the state.
  assert.deepEqual(step.tasks.flat().map(t => t.model), ['sonnet', 'sonnet'])

  const batch = file('batch1.json', { tasks: [okTask('1.1'), okTask('1.2')] })
  const state1 = runJson([
    'wave-state', 'record-batch', '--state', file('run0b.json', state0), '--result', batch
  ])
  assert.deepEqual(state1.completed, ['1.1', '1.2'])

  const afterBatch = runJson(['wave-state', 'next', '--state', file('run1.json', state1)])
  assert.equal(afterBatch.action, 'verify', 'a following wave means an inter-wave check')

  const state2 = runJson([
    'wave-state', 'record-verify',
    '--state', file('run1b.json', state1),
    '--result', file('verify-ok.json', { ok: true })
  ])
  const afterVerify = runJson(['wave-state', 'next', '--state', file('run2.json', state2)])
  assert.equal(afterVerify.action, 'run-batch')
  assert.equal(afterVerify.wave, 2)
})

test('wave-state carries the mode from the plan into the state and echoes it on next', () => {
  // A waves plan reports mode waves; a solo plan reports mode solo. The step the
  // host reads has to name it, or a solo run briefs its one agent as an ordinary
  // lane. `create` carries it off the plan; `next` echoes it.
  const wavesPlan = runJson(['waves', '--classified', paths.classified])
  const wavesState = runJson(['wave-state', 'create', '--plan', file('mode-waves-plan.json', wavesPlan)])
  assert.equal(wavesState.mode, 'waves')
  const wavesStep = runJson(['wave-state', 'next', '--state', file('mode-waves-state.json', wavesState)])
  assert.equal(wavesStep.mode, 'waves')

  const soloPlan = runJson(['waves', '--classified', paths.classified, '--mode', 'solo'])
  const soloState = runJson(['wave-state', 'create', '--plan', file('mode-solo-plan.json', soloPlan)])
  assert.equal(soloState.mode, 'solo')
  assert.deepEqual(soloState.laneCaps, { 1: 8, 2: 8, 3: 6, 4: 4, 5: 8 })
  const soloStep = runJson(['wave-state', 'next', '--state', file('mode-solo-state.json', soloState)])
  assert.equal(soloStep.mode, 'solo')
})

test('create → record-batch produces a JSONL with contiguous seq and a reconstructable walk', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const planFile = file('plan-traj.json', plan)

  const state0 = runJson(['wave-state', 'create', '--plan', planFile, '--change', 'add-widget', '--root', dir])
  const runId = state0.runId
  assert.ok(runId, 'createRunState must stamp a runId onto the state')

  runJson(['wave-state', 'next', '--state', file('traj-run0.json', state0), '--change', 'add-widget', '--root', dir])

  const batch = file('traj-batch.json', { tasks: [okTask('1.1'), okTask('1.2')] })
  runJson([
    'wave-state', 'record-batch',
    '--state', file('traj-run0b.json', state0),
    '--result', batch,
    '--change', 'add-widget',
    '--root', dir
  ])

  const logPath = join(dir, '.claude', 'ship', 'runs', `${runId}.jsonl`)
  const events = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))

  // Contiguous seq from 1, no gaps, every event tagged with the same runId.
  assert.deepEqual(events.map(e => e.seq), events.map((_, i) => i + 1))
  for (const e of events) {
    assert.equal(e.runId, runId)
    assert.equal(e.change, 'add-widget')
  }

  // Every wave-state mutation logs both halves — the action it took and the
  // CLI exit that produced it — so a reader can replay the walk in order.
  const kinds = events.map(e => e.type)
  assert.deepEqual(kinds, [
    'wave-action', 'cli-exit', // create
    'wave-action', 'cli-exit', // next
    'agent-spawn', // next's run-batch step: one cohesion lane, one agent
    'wave-action', 'cli-exit' // record-batch
  ])

  const waveActions = events.filter(e => e.type === 'wave-action')
  assert.deepEqual(waveActions.map(e => e.source), ['create', 'next', 'record-batch'])
  assert.deepEqual(waveActions.map(e => e.action), ['run-batch', 'run-batch', 'verify'])

  // The two pathless tier≤3 tasks of group 1 pack into ONE cohesion lane, so one
  // agent runs both — one spawn, labelled for the lane's anchor task plus its
  // followers (`1.1+1`). Both task outcomes still record through record-batch.
  const spawns = events.filter(e => e.type === 'agent-spawn')
  assert.deepEqual(spawns.map(e => e.taskId), ['1.1'])
  assert.deepEqual(spawns.map(e => e.label), ['1.1+1'])
  assert.deepEqual(spawns.map(e => e.kind), ['implementer'])

  const exits = events.filter(e => e.type === 'cli-exit')
  assert.deepEqual(exits.map(e => e.command), ['wave-state create', 'wave-state next', 'wave-state record-batch'])
  assert.deepEqual(exits.map(e => e.exitCode), [0, 0, 0])
})

test('a cli-exit written by a load-bearing command carries its own measured duration', () => {
  // What this asserts is that the field is FILLED, by a real measurement, in the
  // one process that can honestly take it. What it deliberately does not assert
  // is a magnitude: this is the CLI's self-time — parse, act, append — observed
  // between agent turns, not the wall clock of the turn that ran it.
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-dur.json', plan), '--change', 'add-widget', '--root', dir])
  runJson(['wave-state', 'next', '--state', file('dur-run0.json', state0), '--root', dir])

  const logPath = join(dir, '.claude', 'ship', 'runs', `${state0.runId}.jsonl`)
  const exits = readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
    .filter(e => e.type === 'cli-exit')

  assert.ok(exits.length >= 2, 'create and next each log an exit')
  for (const e of exits) {
    assert.equal(typeof e.durationMs, 'number', `${e.command} recorded no duration`)
    assert.ok(Number.isInteger(e.durationMs) && e.durationMs >= 0, `${e.command}: ${e.durationMs}`)
  }
})

test('a cli-exit appended from a composed event keeps an unmeasured duration absent', () => {
  // `run-log append` is the path with nothing to time: whoever composed the
  // event did not measure the command, and the writer must say so rather than
  // report an instantaneous one.
  const event = file('unmeasured-exit.json', {
    runId: 'run-unmeasured',
    change: 'add-widget',
    type: 'cli-exit',
    command: 'wave-state next',
    exitCode: 0
  })
  runJson(['run-log', 'append', '--event', event, '--root', dir])

  const logPath = join(dir, '.claude', 'ship', 'runs', 'run-unmeasured.jsonl')
  const record = JSON.parse(readFileSync(logPath, 'utf8').split('\n').filter(Boolean)[0])
  assert.equal(record.durationMs, null)
  assert.notEqual(record.durationMs, 0)

  const shown = run(['run-log', 'show', 'run-unmeasured', '--root', dir])
  assert.equal(shown.code, 0)
  assert.match(shown.stdout, /durationMs=unknown/)
})

// --- the change name travels on the state ----------------------------------
//
// The name is named ONCE, at create. Every later invocation reads it off the
// frozen state, because a flag that must be repeated at eleven prompt-embedded
// call sites is a flag that gets dropped — and it was, in both hosts.

// --- evidence audit at record-batch ---------------------------------------
//
// `record-batch` is the only moment the working tree still matches what the
// implementer just claimed, so it is where the observed changed-path set is
// read. `--root` here is a temporary directory that is not a repository, which
// is exactly the case that must degrade rather than fail: git exits non-zero,
// the audit falls back to the task's own report, and the batch records normally.

test('a git failure falls back to the reported path set and records the batch anyway', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-audit.json', plan), '--root', dir])

  const reported = {
    tasks: [
      { ...okTask('1.1'), filesChanged: ['src/1.1.ts'] },
      { ...okTask('1.2'), filesChanged: ['src/other.ts'] }
    ]
  }
  const r = run([
    'wave-state', 'record-batch',
    '--state', file('audit-run0.json', state0),
    '--result', file('audit-batch.json', reported),
    '--root', dir,
    '--json'
  ])
  assert.equal(r.code, 0, `the audit must not fail the batch: ${r.stderr}`)
  const state1 = JSON.parse(r.stdout)

  assert.deepEqual(state1.completed, ['1.1', '1.2'], 'both tasks still succeeded')
  assert.equal(state1.failures.length, 0)
  assert.equal(state1.halt, null)

  // okTask cites `src/<id>.ts:1-10`, so 1.1 matches its own report and 1.2 does
  // not. Both verdicts must say the set was self-reported, never observed.
  for (const id of ['1.1', '1.2']) {
    const audit = state1.evidenceAudits[id]
    assert.ok(audit, `no verdict stored for ${id}`)
    assert.ok(
      audit.source === 'reported' || audit.verdict === 'not-audited',
      `${id} must not claim an observed path set: ${JSON.stringify(audit)}`
    )
  }
  assert.equal(state1.evidenceAudits['1.1'].verdict, 'confirmed')
  assert.equal(state1.evidenceAudits['1.2'].verdict, 'unconfirmed')
  assert.deepEqual(state1.reportedPaths['1.2'], ['src/other.ts'])
})

test('formatRunState shows the verdicts a halt reader would ask about', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-audit-text.json', plan), '--root', dir])
  const r = run([
    'wave-state', 'record-batch',
    '--state', file('audit-text-run0.json', state0),
    '--result', file('audit-text-batch.json', {
      tasks: [
        { ...okTask('1.1'), filesChanged: ['src/1.1.ts'] },
        { ...okTask('1.2'), filesChanged: ['src/other.ts'] }
      ]
    }),
    '--root', dir
  ])
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /evidence audit: 1 confirmed, 1 unconfirmed, 0 not audited/)
  assert.match(r.stdout, /recorded only — never gates the run/)
  assert.match(r.stdout, /unconfirmed 1\.2 \[reported\]/)
})

test('a mutation invoked without --change still names its events from the state', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson([
    'wave-state', 'create', '--plan', file('plan-carry.json', plan),
    '--change', 'add-widget-export', '--root', dir
  ])
  const runId = state0.runId

  // No --change here, nor below: this is the caller the fix exists for.
  runJson(['wave-state', 'next', '--state', file('carry-run0.json', state0), '--root', dir])
  runJson([
    'wave-state', 'record-batch',
    '--state', file('carry-run0b.json', state0),
    '--result', file('carry-batch.json', { tasks: [okTask('1.1'), okTask('1.2')] }),
    '--root', dir
  ])

  const events = readFileSync(join(dir, '.claude', 'ship', 'runs', `${runId}.jsonl`), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l))
  const named = events.filter(e => e.type === 'wave-action' || e.type === 'cli-exit')
  assert.ok(named.length >= 6, `expected create+next+record events, got ${named.length}`)
  for (const e of named) {
    assert.equal(e.change, 'add-widget-export', `${e.type} (${e.source || e.command}) lost the change name`)
  }
})

test('agent-spawn events take the change name from the state too', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson([
    'wave-state', 'create', '--plan', file('plan-carry-spawn.json', plan),
    '--change', 'add-widget-export', '--root', dir
  ])
  runJson(['wave-state', 'next', '--state', file('carry-spawn-run0.json', state0), '--root', dir])

  const events = readFileSync(join(dir, '.claude', 'ship', 'runs', `${state0.runId}.jsonl`), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l))
  const spawns = events.filter(e => e.type === 'agent-spawn')
  assert.equal(spawns.length, 1, 'group 1 is one cohesion lane, so one agent — one spawn')
  for (const e of spawns) assert.equal(e.change, 'add-widget-export')
})

test('the state wins over a per-invocation --change that disagrees with it', () => {
  // design.md decision 2: one mislabeled invocation must not relabel part of a
  // trajectory. A log whose lines disagree about which change they belong to is
  // worse than a uniformly unnamed one, because it looks correct.
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson([
    'wave-state', 'create', '--plan', file('plan-disagree.json', plan),
    '--change', 'add-widget-export', '--root', dir
  ])
  runJson([
    'wave-state', 'next', '--state', file('disagree-run0.json', state0),
    '--change', 'some-other-change', '--root', dir
  ])

  const events = readFileSync(join(dir, '.claude', 'ship', 'runs', `${state0.runId}.jsonl`), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l))
  for (const e of events) assert.equal(e.change, 'add-widget-export')
})

test('a state with no name and no flag records the placeholder and the append succeeds', () => {
  // A state.json written before the name was carried on state. Losing a
  // trajectory label must never lose the run.
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-legacy.json', plan), '--root', dir])
  const legacy = { ...state0 }
  delete legacy.change

  const step = runJson(['wave-state', 'next', '--state', file('legacy-run0.json', legacy), '--root', dir])
  assert.equal(step.action, 'run-batch')

  const events = readFileSync(join(dir, '.claude', 'ship', 'runs', `${state0.runId}.jsonl`), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l))
  assert.ok(events.length > 0, 'the append must succeed even with no name available')
  for (const e of events) assert.equal(e.change, 'unnamed')
})

test('a legacy state with no name falls back to the per-invocation --change', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-fallback.json', plan), '--root', dir])
  const legacy = { ...state0 }
  delete legacy.change

  runJson([
    'wave-state', 'next', '--state', file('fallback-run0.json', legacy),
    '--change', 'add-widget-export', '--root', dir
  ])

  // Only the `next` invocation's events: `create` above ran with no name at all,
  // so its lines are legitimately the placeholder.
  const events = readFileSync(join(dir, '.claude', 'ship', 'runs', `${state0.runId}.jsonl`), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(e => e.source === 'next' || e.command === 'wave-state next' || e.type === 'agent-spawn')
  assert.ok(events.length >= 2, `expected the next invocation's events, got ${events.length}`)
  for (const e of events) assert.equal(e.change, 'add-widget-export')
})

test('wave-entry next logs remainingBatches spawns; mid-wave record-batch does not duplicate them', () => {
  // Three path-disjoint tier-4 tasks at maxParallel 2: a two-lane batch, then a
  // one-lane batch. The first batch holds two lanes, so it does not fuse, and
  // the later batch stays a later batch. The property under test is that
  // wave-entry logs every remaining lane once.
  const classified = file('classified-serial.json', {
    tasks: [
      { id: '1.1', group: 1, description: 'auth a', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/a.ts'] },
      { id: '1.2', group: 1, description: 'auth b', tier: 4, model: 'haiku', isTestTask: false, paths: ['src/b.ts'] },
      { id: '1.3', group: 1, description: 'auth c', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/c.ts'] }
    ]
  })
  const plan = runJson(['waves', '--classified', classified, '--max-parallel', '2'])
  assert.equal(plan.waves[0].batches.length, 2, 'two lanes, then the deferred third')

  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-serial.json', plan), '--max-parallel', '2', '--change', 'add-widget', '--root', dir])
  const runId = state0.runId
  const first = runJson(['wave-state', 'next', '--state', file('serial-run0.json', state0), '--change', 'add-widget', '--root', dir])
  assert.equal(first.remainingBatches.length, 2)
  assert.deepEqual(
    first.remainingBatches.map(b => b.map(l => l.map(t => t.id))),
    [[['1.1'], ['1.2']], [['1.3']]]
  )

  const afterNext = readFileSync(join(dir, '.claude', 'ship', 'runs', `${runId}.jsonl`), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l))
  assert.deepEqual(
    afterNext.filter(e => e.type === 'agent-spawn').map(e => e.taskId),
    ['1.1', '1.2', '1.3'],
    'wave-entry next must spawn every remaining batch, not only tasks[]'
  )
  assert.deepEqual(
    afterNext.filter(e => e.type === 'agent-spawn').map(e => e.model),
    ['sonnet', 'haiku', 'sonnet']
  )

  const written = join(dir, 'serial-written.json')
  runJson([
    'wave-state', 'record-batch',
    '--state', file('serial-run0b.json', state0),
    '--result', file('serial-batch0.json', { tasks: [okTask('1.1'), okTask('1.2')] }),
    '--write-state', written,
    '--change', 'add-widget',
    '--root', dir
  ])
  const afterRecord = readFileSync(join(dir, '.claude', 'ship', 'runs', `${runId}.jsonl`), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l))
  assert.deepEqual(
    afterRecord.filter(e => e.type === 'agent-spawn').map(e => e.taskId),
    ['1.1', '1.2', '1.3'],
    'mid-wave record-batch --write-state must not duplicate later-batch spawns'
  )
})

test('spawns are counted per lane, not per task', () => {
  // The scenario from the lanes delta spec: a wave holding one 3-task lane and
  // one 1-task lane logs TWO agent-spawns, not four. Counting per task would
  // report a fold that never happened.
  const classified = file('classified-lanes.json', {
    tasks: [
      { id: '1.1', group: 1, description: 'auth a', tier: 2, model: 'sonnet', isTestTask: false, paths: ['src/auth.ts'] },
      { id: '1.2', group: 1, description: 'auth b', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/auth.ts'] },
      { id: '1.3', group: 1, description: 'auth c', tier: 2, model: 'sonnet', isTestTask: false, paths: ['src/auth.ts'] },
      { id: '1.4', group: 1, description: 'billing', tier: 1, model: 'haiku', isTestTask: false, paths: ['src/billing.ts'] }
    ]
  })
  const plan = runJson(['waves', '--classified', classified])
  assert.deepEqual(
    plan.waves[0].batches.map(b => b.map(l => l.map(t => t.id))),
    [[['1.1', '1.2', '1.3'], ['1.4']]],
    'one lane of three, one lane of one, both in the same batch'
  )

  const state0 = runJson([
    'wave-state', 'create', '--plan', file('plan-lanes.json', plan),
    '--change', 'add-widget', '--root', dir
  ])
  runJson([
    'wave-state', 'next', '--state', file('lanes-run0.json', state0),
    '--change', 'add-widget', '--root', dir
  ])

  const events = readFileSync(join(dir, '.claude', 'ship', 'runs', `${state0.runId}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
  const spawns = events.filter(e => e.type === 'agent-spawn')
  assert.equal(spawns.length, 2, `four tasks, two agents; got ${spawns.length} spawns`)
  assert.deepEqual(spawns.map(e => e.label), ['1.1+2', '1.4'])
  assert.deepEqual(
    spawns.map(e => e.model),
    ['opus', 'haiku'],
    'a multi-task lane at the opus floor and its single-task neighbour record the model dispatch uses'
  )
})

test('interlock waves prints a chain line for serial single-lane batches', () => {
  const classified = file('classified-chain.json', {
    tasks: [
      { id: '1.1', group: 1, description: 'a', tier: 2, model: 'sonnet', isTestTask: false, paths: ['src/a.ts'] },
      { id: '2.1', group: 2, description: 'b', tier: 2, model: 'sonnet', isTestTask: false, paths: ['src/b.ts'] }
    ]
  })
  const r = run(['waves', '--classified', classified])
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /chain 1\.1 → 2\.1/)
})

test('record-batch --write-state writes the new state and stdout is the next step', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-ws.json', plan)])
  const batch = file('ws-batch.json', { tasks: [okTask('1.1'), okTask('1.2')] })
  const outState = join(dir, 'ws-written.json')

  const step = runJson([
    'wave-state', 'record-batch',
    '--state', file('ws-run0.json', state0),
    '--result', batch,
    '--write-state', outState
  ])
  assert.equal(step.action, 'verify', 'a following wave means an inter-wave check')
  assert.equal(step.completed, undefined, 'stdout is the step, not the state')

  const written = JSON.parse(readFileSync(outState, 'utf8'))
  assert.deepEqual(written.completed, ['1.1', '1.2'])
  assert.equal(written.cursor.phase, 'verify')
})

test('record-batch --write-state reports the per-task outcomes it just recorded', () => {
  // What was recorded is more than the claim — an invalid packet leaves a task
  // that claimed success done with its report rejected — and a caller that
  // receives only the next action has no way to learn which. Without this field
  // a host ticks and tallies from the claim, which is how a task ships
  // unimplemented behind a `- [x]`.
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-ro.json', plan)])
  const bad = {
    ...okTask('1.2').handoff,
    status: 'done' // outside ok|blocked|partial — the live defect's shape
  }
  const batch = file('ro-batch.json', {
    tasks: [okTask('1.1'), { id: '1.2', ok: true, handoff: bad }]
  })

  const step = runJson([
    'wave-state', 'record-batch',
    '--state', file('ro-run0.json', state0),
    '--result', batch,
    '--write-state', join(dir, 'ro-written.json')
  ])

  assert.deepEqual(
    step.recorded.map(o => [o.id, o.outcome]),
    [['1.1', 'ok'], ['1.2', 'ok']],
    'one entry per task in the batch; a task that claimed success is recorded as done'
  )
  assert.equal(step.recorded[0].reason, undefined, 'a succeeded task owes no reason')
  assert.equal(step.recorded[0].reportRejected, undefined, 'and a validated report rejects nothing')
  assert.equal(step.recorded[1].outcome, 'ok')
  assert.equal(step.recorded[1].reason, undefined, 'a rejected report is not a failure')
  assert.match(step.recorded[1].reportRejected, /status/)
  assert.ok(
    step.recorded[1].reportRejected.length < 400,
    'the reason is an adjudication string, not a transcript — it is copied through an agent'
  )

  // Additive: every field the step already emitted still means what it meant.
  assert.equal(step.action, 'verify', 'a following wave means an inter-wave check')
  assert.equal(step.completed, undefined, 'stdout is still the step, not the state')
  assert.equal(step.wave, 1)
  assert.equal(step.waveIndex, 0)
})

test('record-batch reports a task the batch never accounted for as not-attempted', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-rn.json', plan)])
  // Wave 1 holds 1.1 and 1.2; the result reports only 1.1.
  const step = runJson([
    'wave-state', 'record-batch',
    '--state', file('rn-run0.json', state0),
    '--result', file('rn-batch.json', { tasks: [okTask('1.1')] }),
    '--write-state', join(dir, 'rn-written.json')
  ])
  assert.deepEqual(
    step.recorded.map(o => [o.id, o.outcome]),
    [['1.1', 'ok'], ['1.2', 'not-attempted']],
    'not-attempted is distinct from failed: it is ticked nowhere and counted nowhere'
  )
})

test('record-verify --write-state stdout is the next step after a green check', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-wv.json', plan)])
  const afterBatch = runJson([
    'wave-state', 'record-batch',
    '--state', file('wv-run0.json', state0),
    '--result', file('wv-batch.json', { tasks: [okTask('1.1'), okTask('1.2')] })
  ])
  const outState = join(dir, 'wv-written.json')

  const step = runJson([
    'wave-state', 'record-verify',
    '--state', file('wv-run1.json', afterBatch),
    '--result', file('wv-ok.json', { ok: true }),
    '--write-state', outState
  ])
  assert.equal(step.action, 'run-batch')
  assert.equal(step.wave, 2)

  const written = JSON.parse(readFileSync(outState, 'utf8'))
  assert.equal(written.cursor.waveIndex, 1)
})

test('replan --write-state writes the new state and stdout is the next step', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state = runJson(['wave-state', 'create', '--plan', file('plan-wr.json', plan)])
  const groups = file('wr-groups.json', [
    { group: 2, tasks: [{ id: '2.1', description: 'revised' }, { id: '2.2', description: 'new' }] }
  ])
  const outState = join(dir, 'wr-written.json')

  const step = runJson([
    'wave-state', 'replan',
    '--state', file('wr-run0.json', state),
    '--groups', groups,
    '--write-state', outState
  ])
  assert.equal(typeof step.action, 'string')
  assert.equal(step.replansUsed, undefined, 'stdout is the step, not the state')

  const written = JSON.parse(readFileSync(outState, 'utf8'))
  assert.equal(written.replansUsed, 1)
  const wave2 = written.waves.find(w => w.group === 2)
  assert.equal(wave2.taskCount, 2)
})

test('record-batch --write-state that halts still writes state and stdout is halt', () => {
  const plan = runJson(['waves', '--classified', file('c3-ws.json', {
    tasks: [
      { id: '1.1', group: 1, description: 'a', tier: 2, model: 'sonnet', isTestTask: false },
      { id: '1.2', group: 1, description: 'b', tier: 2, model: 'sonnet', isTestTask: false },
      { id: '1.3', group: 1, description: 'c', tier: 2, model: 'sonnet', isTestTask: false }
    ]
  })])
  const state = runJson(['wave-state', 'create', '--plan', file('plan-halt-ws.json', plan)])
  const allFail = file('all-fail-ws.json', {
    tasks: [
      { id: '1.1', ok: false, error: 'x' },
      { id: '1.2', ok: false, error: 'y' },
      { id: '1.3', ok: false, error: 'z' }
    ]
  })
  const outState = join(dir, 'halt-written.json')

  const step = runJson([
    'wave-state', 'record-batch',
    '--state', file('halt-run0.json', state),
    '--result', allFail,
    '--write-state', outState
  ], 1)
  assert.equal(step.action, 'halt')

  const written = JSON.parse(readFileSync(outState, 'utf8'))
  assert.ok(written.halt)
})

test('wave-state accepts a state on stdin', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state = runJson(['wave-state', 'create', '--plan', file('plan-stdin.json', plan)])
  const r = run(['wave-state', 'next', '--state', '-', '--json'], { input: JSON.stringify(state) })
  assert.equal(r.code, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).action, 'run-batch')
})

test('a recorded result that halts the run exits 1, and so does every later next', () => {
  const plan = runJson(['waves', '--classified', file('c3.json', {
    tasks: [
      { id: '1.1', group: 1, description: 'a', tier: 2, model: 'sonnet', isTestTask: false },
      { id: '1.2', group: 1, description: 'b', tier: 2, model: 'sonnet', isTestTask: false },
      { id: '1.3', group: 1, description: 'c', tier: 2, model: 'sonnet', isTestTask: false }
    ]
  })])
  const state = runJson(['wave-state', 'create', '--plan', file('plan3.json', plan)])
  const allFail = file('all-fail.json', {
    tasks: [
      { id: '1.1', ok: false, error: 'x' },
      { id: '1.2', ok: false, error: 'y' },
      { id: '1.3', ok: false, error: 'z' }
    ]
  })

  const halted = runJson(
    ['wave-state', 'record-batch', '--state', file('r0.json', state), '--result', allFail], 1
  )
  assert.ok(halted.halt, 'more than 2 task failures halts the run')
  assert.match(halted.halt.reason, /task failures accumulated/)

  const step = runJson(['wave-state', 'next', '--state', file('rhalt.json', halted)], 1)
  assert.equal(step.action, 'halt')
})

test('wave-state replan revises an unexecuted group', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state = runJson(['wave-state', 'create', '--plan', file('plan-rp.json', plan)])
  const groups = file('groups.json', [
    { group: 2, tasks: [{ id: '2.1', description: 'revised' }, { id: '2.2', description: 'new' }] }
  ])
  const next = runJson([
    'wave-state', 'replan', '--state', file('rp0.json', state), '--groups', groups
  ])
  assert.equal(next.replansUsed, 1)
  const wave2 = next.waves.find(w => w.group === 2)
  assert.equal(wave2.taskCount, 2)
})

test('wave-state replan rejects anything that is not a revision array', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state = runJson(['wave-state', 'create', '--plan', file('plan-rp2.json', plan)])
  const r = run([
    'wave-state', 'replan',
    '--state', file('rp1.json', state),
    '--groups', file('bad-groups.json', { group: 2 })
  ])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /--groups must be a JSON array of \{ group, tasks \} revisions/)
})

// --- regression guard for the commands that already existed ---------------

test('the pre-existing gating commands still exit 1 when they block', () => {
  const blocking = run(['gate', '--findings', paths.findings])
  assert.equal(blocking.code, 1, 'a surviving blocker must still block the gate')

  const clean = run(['gate', '--findings', paths.cleanFindings])
  assert.equal(clean.code, 0)

  const notReady = run(['validate', 'add-auth', '--root', paths.root])
  assert.equal(notReady.code, 0, 'the fixture change is complete')
})

test('validate --change selects one change when several are active', () => {
  // Skills and ship agents follow `interlock validate --change <name>`. If the
  // CLI only reads positional[1], a nameless validate against 15 changes is
  // exactly the halt that drops a name the caller did pass.
  const root = join(dir, 'multi-validate')
  for (const name of ['alpha', 'beta']) {
    const change = join(root, 'openspec', 'changes', name)
    mkdirSync(change, { recursive: true })
    writeFileSync(join(change, 'proposal.md'), `# ${name}\n\nwhy\n`)
    writeFileSync(join(change, 'design.md'), '# Design\nhow\n')
    writeFileSync(join(change, 'tasks.md'), '- [ ] 1. do it\n')
  }

  const nameless = run(['validate', '--json', '--root', root])
  assert.notEqual(nameless.code, 0, 'several changes and no name must not auto-pick')
  const namelessBody = nameless.stdout + nameless.stderr
  assert.match(namelessBody, /multiple active changes/)

  const flagged = runJson(['validate', '--change', 'beta', '--root', root], 0)
  assert.equal(flagged.change, 'beta')
  assert.equal(flagged.ready, true)
  assert.equal(flagged.tasks.done, 0, '0/N checkboxes is ready — that is what ship implements')
})

test('validate --json on a change with no checkbox tasks exits 1, not ready, and says why', () => {
  // The spec and review-artifacts skills read `ready` as the verdict and
  // `problems` as the list to fix, by name. The exit code stays the verdict.
  const root = join(dir, 'validate-no-checkbox')
  const change = join(root, 'openspec', 'changes', 'gamma')
  mkdirSync(change, { recursive: true })
  writeFileSync(join(change, 'proposal.md'), '# gamma\n\nwhy\n')
  writeFileSync(join(change, 'design.md'), '# Design\nhow\n')
  writeFileSync(join(change, 'tasks.md'), '# Tasks\n\nNothing to tick yet.\n')

  const out = runJson(['validate', '--change', 'gamma', '--root', root], 1)
  for (const key of ['ready', 'problems']) {
    assert.ok(key in out, `validate --json no longer prints ${key}, which a skill reads by name`)
  }
  assert.equal(out.ready, false)
  assert.ok(
    out.problems.some(p => /no checkbox task lines/.test(p)),
    `problems must name the missing checkboxes: ${JSON.stringify(out.problems)}`
  )
})

// --- ready: the gate that can skip a human --------------------------------
//
// Every assertion here is about failing closed. This is the one command whose
// bug would mean a change reaching `ship` that a person never looked at.

function readyRepo(name = 'add-thing', over = {}) {
  const base = `openspec/changes/${name}`
  file(`${base}/proposal.md`, over.proposal ?? '# Add thing\n\nWhy: because.\n')
  file(
    `${base}/design.md`,
    over.design ?? '# Design\n\nD1: use the existing helper rather than adding one.\n'
  )
  file(`${base}/tasks.md`, over.tasks ?? '# Tasks\n\n- [ ] 1. Add the thing to docs/guide.md\n')
  file(
    `${base}/decisions.md`,
    over.decisions ??
      '# Decisions — ' + name + '\n\n| id | question | class | resolution | evidence |\n' +
        '|----|----|----|----|----|\n| D1 | reuse helper? | agent_resolved | Reuse lib/x.ts | design.md |\n'
  )
  if (over.profile !== false) file('.claude/testing/profile.json', { version: 1, unit: { command: 'npm test' } })
  return name
}

test('ready passes a clean, low-risk change and exits 0', () => {
  const name = readyRepo('ready-clean')
  const findings = file('findings-clean.json', [
    {
      dimension: 'qa',
      findings: [
        {
          severity: 'warning',
          file: 'docs/guide.md',
          title: 'wording',
          description: 'could be clearer',
          qualityScore: 4
        }
      ]
    }
  ])
  const out = runJson(['ready', name, '--root', dir, '--findings', findings], 0)
  assert.equal(out.ready, true)
})

test('ready derives the blocker count from the findings, and says so', () => {
  const name = readyRepo('ready-derived')
  const findings = file('findings-blocker.json', [
    {
      dimension: 'qa',
      findings: [
        {
          severity: 'blocker',
          file: 'docs/guide.md',
          title: 'unimplementable as written',
          description: 'the task names no file',
          qualityScore: 4
        }
      ]
    }
  ])
  const r = run(['ready', name, '--root', dir, '--findings', findings])
  assert.equal(r.code, 1)
  assert.match(r.stdout, /REVIEW_BLOCKERS/)
  assert.match(r.stdout, /1 artifact-review blocker/)
})

test('ready warns on the deprecated --review and refuses to pass on it alone', () => {
  const name = readyRepo('ready-deprecated')
  const review = file('review-dep.json', { blockers: 0, warnings: 0 })
  const r = run(['ready', name, '--root', dir, '--review', review])
  assert.equal(r.code, 1, 'a count written by the gated agent is not a review result')
  assert.match(r.stderr, /--review is deprecated/)
  assert.match(r.stdout, /REVIEW_SELF_REPORTED/)
})

test('ready fails closed on an unreadable findings file rather than dying in the parser', () => {
  const name = readyRepo('ready-badjson')
  const findings = join(dir, 'findings-bad.json')
  writeFileSync(findings, '{ not json at all')
  const r = run(['ready', name, '--root', dir, '--findings', findings])
  assert.equal(r.code, 1)
  assert.match(r.stdout, /REVIEW_NOT_RUN/)
})

test('ready exits 1 when the artifact review was never run', () => {
  // The most likely way this gate gets silently defeated: an omitted review
  // reading as a review with zero blockers.
  const name = readyRepo('ready-noreview')
  const r = run(['ready', name, '--root', dir])
  assert.equal(r.code, 1)
  assert.match(r.stdout, /REVIEW_NOT_RUN/)
})

test('ready exits 1 on a needs_human row', () => {
  const name = readyRepo('ready-human', {
    decisions:
      '# Decisions — ready-human\n\n| id | question | class | resolution | evidence |\n' +
      '|----|----|----|----|----|\n| D1 | Pin zod version? | needs_human | — | — |\n'
  })
  const findings = file('findings-h.json', [])
  const r = run(['ready', name, '--root', dir, '--findings', findings])
  assert.equal(r.code, 1)
})

test('ready exits 1 when the ledger is missing entirely', () => {
  const name = 'ready-noledger'
  file(`openspec/changes/${name}/proposal.md`, '# X\n\nwhy\n')
  file(`openspec/changes/${name}/design.md`, '# D\n\nhow\n')
  file(`openspec/changes/${name}/tasks.md`, '# T\n\n- [ ] 1. do it\n')
  const review = file('review-nl.json', { blockers: 0 })
  const r = run(['ready', name, '--root', dir, '--review', review])
  assert.equal(r.code, 1)
})

test('ready exits 1 on a high-risk path even when everything else is clean', () => {
  const name = readyRepo('ready-risky')
  const review = file('review-r.json', { blockers: 0 })
  const r = run(['ready', name, '--root', dir, '--review', review, '--paths', 'src/auth/session.ts'])
  assert.equal(r.code, 1)
  assert.match(r.stdout, /RISK_CLASS_BLOCKED/)
})

test('ready exits 1 for a change name that does not exist', () => {
  const r = run(['ready', 'no-such-change-at-all', '--root', dir])
  assert.equal(r.code, 1)
  assert.doesNotMatch(r.stderr + r.stdout, /at Object\.|at Module\./, 'no stack trace')
})

// --- outcomes: recorded, never fatal --------------------------------------

test('outcomes append writes one record and list reads it back', () => {
  const record = file('outcome-1.json', {
    change: 'add-thing',
    mode: 'checkpoint',
    riskClass: 'medium',
    ready: true,
    decisionsHuman: 1
  })
  const appended = runJson(['outcomes', 'append', '--record', record, '--root', dir], 0)
  assert.equal(appended.written, true)
  const listed = runJson(['outcomes', 'list', '--root', dir], 0)
  assert.ok(listed.records.length >= 1)
  assert.equal(listed.records[0].mode, 'checkpoint')
})

test('outcomes append refuses an unrecognized mode without failing the run', () => {
  // A guessed mode poisons the very comparison the corpus exists for, but
  // losing a corpus line must never fail the run that produced it.
  const record = file('outcome-bad.json', { change: 'x', mode: 'whatever' })
  const r = run(['outcomes', 'append', '--record', record, '--root', dir, '--json'])
  assert.equal(r.code, 0)
  assert.equal(JSON.parse(r.stdout).written, false)
})

// --- outcomes: the observed half comes from the receipt, never the record ---

/** A root holding one run whose trajectory carries a receipt. */
function rootWithReceipt(runId, receipt) {
  const root = mkdtempSync(join(tmpdir(), 'sf-cli-provenance-'))
  const event = join(root, 'event.json')
  const write = obj => {
    writeFileSync(event, JSON.stringify(obj))
    return event
  }
  run(['run-log', 'append', '--event', write({ type: 'run-start', runId, change: 'add-widget', mode: 'continue' }), '--root', root])
  if (receipt) {
    run(['run-log', 'append', '--event', write({ type: 'run-receipt', runId, change: 'add-widget', ...receipt }), '--root', root])
  }
  const state = join(root, 'state.json')
  writeFileSync(state, JSON.stringify({ runId, change: 'add-widget' }))
  return { root, state, record: obj => write(obj) && event }
}

test('outcomes append derives the observed half from the run receipt', () => {
  const { root, state, record } = rootWithReceipt('run-observed-1', {
    halted: true,
    haltReason: 'unit suite is red',
    remediationRounds: 2,
    reviewBlockers: 1,
    waves: [{ wave: 1, ok: 1, failed: 1, notAttempted: ['2.1'] }],
    commit: 'deadbee'
  })
  try {
    const appended = runJson([
      'outcomes', 'append',
      '--record', record({ change: 'add-widget', mode: 'continue', reported: { unitGreen: false } }),
      '--state', state,
      '--root', root
    ])
    assert.equal(appended.written, true)
    assert.equal(appended.receipt, true)

    const listed = runJson(['outcomes', 'list', '--root', root])
    const line = listed.records[0]
    assert.equal(line.schema, 'interlock.outcome/2')
    assert.equal(line.observed.receipt, true)
    assert.equal(line.observed.ok, false, 'the receipt says the run halted')
    assert.equal(line.observed.remediationRounds, 2)
    assert.equal(line.observed.codeBlockersSurviving, 1)
    assert.equal(line.observed.commit, 'deadbee')
    assert.equal(line.reported.unitGreen, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a procedure edit that reinvites correction still cannot reach the corpus', () => {
  // The regression test for the actual failure mode. The closing prompt used
  // to say "Correct any field that does not match what actually happened";
  // this is the record file such an agent composes, and none of it lands.
  // Enforcement must not depend on the procedure's wording.
  const { root, state, record } = rootWithReceipt('run-contained-1', {
    halted: true,
    haltReason: 'verification halted',
    remediationRounds: 3,
    reviewBlockers: 2,
    commit: 'c0ffee1'
  })
  try {
    const r = run([
      'outcomes', 'append',
      '--record', record({
        change: 'add-widget',
        mode: 'continue',
        // Every route an obliging agent might take.
        observed: { receipt: true, ok: true, remediationRounds: 0, codeBlockersSurviving: 0, commit: 'faked01' },
        reported: { unitGreen: true, remediationRounds: 0, halted: false },
        ship: { ok: true, codeBlockersSurviving: 0 }
      }),
      '--state', state,
      '--root', root,
      '--json'
    ])
    assert.equal(r.code, 0, 'a refusal is never fatal')
    const out = JSON.parse(r.stdout)
    assert.equal(out.written, true, 'the line is still written, with the run\'s own values')
    assert.equal(out.observedRefused, true)
    assert.match(r.stderr, /refused/i, 'the refusal is reported, not silent')

    const line = runJson(['outcomes', 'list', '--root', root]).records[0]
    assert.equal(line.observed.ok, false, 'the run halted, whatever the agent supplied')
    assert.equal(line.observed.remediationRounds, 3)
    assert.equal(line.observed.codeBlockersSurviving, 2)
    assert.equal(line.observed.commit, 'c0ffee1')
    assert.equal(line.reported.remediationRounds, undefined)
    assert.equal(line.reported.halted, undefined)
    assert.doesNotMatch(JSON.stringify(line), /faked01/)
    // The one value the agent legitimately owns still lands.
    assert.equal(line.reported.unitGreen, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a run with no receipt records the absence rather than the record file', () => {
  const { root, state, record } = rootWithReceipt('run-no-receipt-1', null)
  try {
    const appended = runJson([
      'outcomes', 'append',
      '--record', record({
        change: 'add-widget',
        mode: 'continue',
        ship: { ok: true, remediationRounds: 0, codeBlockersSurviving: 0 }
      }),
      '--state', state,
      '--root', root
    ])
    assert.equal(appended.written, true)
    assert.equal(appended.receipt, false)

    const line = runJson(['outcomes', 'list', '--root', root]).records[0]
    assert.equal(line.observed.receipt, false, 'the absence is the record')
    assert.equal(line.observed.ok, null, 'not "the run was fine"')
    assert.equal(line.observed.remediationRounds, null, 'not "it used none"')
    assert.equal(line.observed.codeBlockersSurviving, null, 'not "zero blockers"')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('outcomes list is empty and calm before anything is recorded', () => {
  const empty = mkdtempSync(join(tmpdir(), 'sf-cli-outcomes-'))
  try {
    const out = runJson(['outcomes', 'list', '--root', empty], 0)
    assert.equal(out.exists, false)
    assert.deepEqual(out.records, [])
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

// --- run-log session query (add-ship-run-inspectability §5) ---------------

test('run-log list / show / query read a fixture trajectory with a halt and a spilled verify judgement', () => {
  const rlRoot = join(dir, 'run-log-root')
  mkdirSync(rlRoot, { recursive: true })

  const events = [
    { type: 'run-start', runId: 'run-fixture-1', change: 'add-widget', mode: 'checkpoint' },
    { type: 'wave-action', runId: 'run-fixture-1', change: 'add-widget', action: 'run-batch', source: 'create' },
    { type: 'cli-exit', runId: 'run-fixture-1', change: 'add-widget', command: 'wave-state create', exitCode: 0 },
    {
      type: 'agent-spawn',
      runId: 'run-fixture-1',
      change: 'add-widget',
      label: '1.1',
      model: 'sonnet',
      kind: 'implementer',
      taskId: '1.1'
    },
    {
      type: 'verify-judgement',
      runId: 'run-fixture-1',
      change: 'add-widget',
      context: 'final',
      halt: true,
      reason: 'unit suite is red (2 failing, 1 root-cause cluster(s))',
      unitStatus: 'red',
      spill: ['.claude/ship/spill/run-fixture-1/1-unit.log']
    },
    { type: 'run-halt', runId: 'run-fixture-1', change: 'add-widget', reason: 'unit suite is red' }
  ]
  for (const event of events) {
    const r = run(['run-log', 'append', '--event', file('rl-event.json', event), '--root', rlRoot])
    assert.equal(r.code, 0)
  }

  // A second, unrelated, non-halted run for a different change — list/filter
  // must tell the two apart.
  run([
    'run-log', 'append',
    '--event', file('rl-event-2.json', { type: 'run-start', runId: 'run-fixture-2', change: 'other-change', mode: 'continue' }),
    '--root', rlRoot
  ])
  run([
    'run-log', 'append',
    '--event', file('rl-event-3.json', { type: 'run-complete', runId: 'run-fixture-2', change: 'other-change', leftoverTaskIds: [] }),
    '--root', rlRoot
  ])

  // list
  const listAll = runJson(['run-log', 'list', '--root', rlRoot])
  assert.equal(listAll.runs.length, 2)
  const fixture1 = listAll.runs.find(r => r.runId === 'run-fixture-1')
  const fixture2 = listAll.runs.find(r => r.runId === 'run-fixture-2')
  assert.equal(fixture1.halted, true)
  assert.equal(fixture1.change, 'add-widget')
  assert.equal(fixture1.events, 6)
  assert.equal(fixture2.halted, false)
  assert.equal(fixture2.complete, true)

  const listFiltered = runJson(['run-log', 'list', '--change', 'add-widget', '--root', rlRoot])
  assert.deepEqual(listFiltered.runs.map(r => r.runId), ['run-fixture-1'])

  // show
  const shown = runJson(['run-log', 'show', 'run-fixture-1', '--root', rlRoot])
  assert.equal(shown.exists, true)
  assert.equal(shown.records.length, 6)
  assert.deepEqual(shown.records.map(r => r.seq), [1, 2, 3, 4, 5, 6])
  assert.equal(shown.skipped.length, 0)

  // query --type
  const onlyJudgements = runJson(['run-log', 'query', '--run', 'run-fixture-1', '--type', 'verify-judgement', '--root', rlRoot])
  assert.equal(onlyJudgements.records.length, 1)
  assert.equal(onlyJudgements.records[0].type, 'verify-judgement')
  assert.deepEqual(onlyJudgements.records[0].spill, ['.claude/ship/spill/run-fixture-1/1-unit.log'])

  // query --halted
  const haltRelated = runJson(['run-log', 'query', '--run', 'run-fixture-1', '--halted', '--root', rlRoot])
  assert.deepEqual(haltRelated.records.map(r => r.type), ['verify-judgement', 'run-halt'])

  // show on an unknown run is empty, not an error
  const missing = runJson(['run-log', 'show', 'no-such-run', '--root', rlRoot])
  assert.equal(missing.exists, false)
  assert.deepEqual(missing.records, [])
})

test('run-log show tolerates a torn final line and reports the skipped line', () => {
  const rlRoot = join(dir, 'run-log-torn')
  mkdirSync(rlRoot, { recursive: true })
  run(['run-log', 'append', '--event', file('rl-torn-1.json', { type: 'run-start', runId: 'torn-run', change: 'x', mode: 'checkpoint' }), '--root', rlRoot])
  const logPath = join(rlRoot, '.claude', 'ship', 'runs', 'torn-run.jsonl')
  writeFileSync(logPath, readFileSync(logPath, 'utf8') + '{"schema":"interlock.ship-run/1","type":"wave-')

  const shown = runJson(['run-log', 'show', 'torn-run', '--root', rlRoot])
  assert.equal(shown.records.length, 1)
  assert.equal(shown.skipped.length, 1)
  assert.equal(shown.skipped[0].line, 2)
})

test('run-log check exits 0 on a reconstructable run and 1 on a broken one', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const rlRoot = join(dir, 'run-log-check-root')
  mkdirSync(rlRoot, { recursive: true })
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-check.json', plan), '--root', rlRoot])
  const runId = state0.runId

  const beforeStart = run(['run-log', 'check', '--run-id', runId, '--root', rlRoot])
  // create alone has no run-start or closing event yet — ship.js only appends
  // run-start from the plan-waves step, a level above wave-state itself.
  assert.equal(beforeStart.code, 1)
  assert.match(beforeStart.stdout, /missing a run-start/)

  const start = file('rl-start.json', { type: 'run-start', runId, change: 'unnamed', mode: 'checkpoint' })
  run(['run-log', 'append', '--event', start, '--root', rlRoot])
  const ok = run(['run-log', 'check', '--run-id', runId, '--root', rlRoot])
  assert.equal(ok.code, 1)
  assert.match(ok.stdout, /missing a run-halt or run-complete/)

  const complete = file('rl-close.json', { type: 'run-complete', runId, change: 'unnamed', leftoverTaskIds: [] })
  run(['run-log', 'append', '--event', complete, '--root', rlRoot])
  const nowOk = run(['run-log', 'check', '--run-id', runId, '--root', rlRoot])
  assert.equal(nowOk.code, 0)
  assert.match(nowOk.stdout, /RECONSTRUCTABLE/)

  const missing = run(['run-log', 'check', '--run-id', 'no-such-run', '--root', rlRoot])
  assert.equal(missing.code, 1)
  assert.match(missing.stdout, /no trajectory file found/)
})

test('run-log check reads runId from --state, same as verify judge', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const rlRoot = join(dir, 'run-log-check-state-root')
  mkdirSync(rlRoot, { recursive: true })
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-check2.json', plan), '--root', rlRoot])
  run(['run-log', 'append', '--event', file('rl-start2.json', { type: 'run-start', runId: state0.runId, mode: 'checkpoint' }), '--root', rlRoot])
  run(['run-log', 'append', '--event', file('rl-close2.json', { type: 'run-complete', runId: state0.runId, leftoverTaskIds: [] }), '--root', rlRoot])

  const r = run(['run-log', 'check', '--state', file('state-check.json', state0), '--root', rlRoot])
  assert.equal(r.code, 0)
})

test('run-log check requires --state or --run-id', () => {
  const r = run(['run-log', 'check', '--root', dir])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /requires --state.*or --run-id/)
})

test('the reconstructability gate: an unwritable ship dir turns wave-state and verify judge write failures into a halt, but never outcomes', { skip: isRoot() }, () => {
  const gateRoot = join(dir, 'gate-root')
  mkdirSync(gateRoot, { recursive: true })
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-gate.json', plan), '--root', gateRoot])

  // Lock the run's own trajectory file after the first (successful) create,
  // so the NEXT wave-state mutation's append to that same file fails to write
  // — a directory-level chmod would not do it, since appendFileSync only
  // needs write permission on the file it is already appending to.
  const logFile = join(gateRoot, '.claude', 'ship', 'runs', `${state0.runId}.jsonl`)
  chmodSync(logFile, 0o400)
  try {
    const step = run(['wave-state', 'next', '--state', file('state-gate.json', state0), '--root', gateRoot])
    assert.equal(step.code, 1, 'a trajectory write failure on wave-state must now halt, not just report')
    assert.match(step.stderr, /wave-action not recorded|cli-exit not recorded/)

    // Verify judge's own trajectory write fails the same way when it cannot
    // append — exercised directly against the locked directory.
    const vplan = runJson(['verify', 'plan', '--profile', paths.profile, '--typecheck-command', 'tsc'])
    const vr = run([
      'verify', 'judge',
      '--plan', file('plan-gate-v.json', vplan),
      '--results', paths.greenResults,
      '--run-id', state0.runId,
      '--root', gateRoot
    ])
    assert.equal(vr.code, 1, 'a trajectory write failure on verify judge must now halt too')

    // Outcomes lives in a completely different file (.claude/learning/), so
    // locking the trajectory does not touch it — it keeps writing normally,
    // which is the point: the two corpora have separate failure policies, and
    // gating one must never gate the other.
    const outcomeRecord = file('outcome-gate.json', { change: 'x', mode: 'checkpoint' })
    const oc = runJson(['outcomes', 'append', '--record', outcomeRecord, '--root', gateRoot])
    assert.equal(oc.written, true)
  } finally {
    chmodSync(logFile, 0o700)
  }
})

test('an unknown outcomes subcommand is an actionable error', () => {
  const r = run(['outcomes', 'frobnicate', '--root', dir])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /frobnicate/)
})

test('tasks tick flips matching checkboxes by id', () => {
  const root = join(dir, 'tick-repo')
  const change = join(root, 'openspec', 'changes', 'add-auth')
  mkdirSync(change, { recursive: true })
  writeFileSync(join(change, 'proposal.md'), '# P\nwhy\n')
  writeFileSync(join(change, 'design.md'), '# D\nhow\n')
  writeFileSync(join(change, 'tasks.md'), '- [ ] 1.1 scaffold\n- [ ] 1.2 wire\n')
  const out = runJson(['tasks', 'tick', '--change', 'add-auth', '--ids', '1.1', '--root', root], 0)
  assert.deepEqual(out.ticked, ['1.1'])
  assert.match(readFileSync(join(change, 'tasks.md'), 'utf8'), /- \[x\] 1\.1 scaffold/)
  assert.match(readFileSync(join(change, 'tasks.md'), 'utf8'), /- \[ \] 1\.2 wire/)
})

test('tasks coverage exits 1 when classified.json omits an unchecked task', () => {
  const root = join(dir, 'cover-repo')
  const change = join(root, 'openspec', 'changes', 'add-auth')
  mkdirSync(change, { recursive: true })
  writeFileSync(join(change, 'proposal.md'), '# P\nwhy\n')
  writeFileSync(join(change, 'design.md'), '# D\nhow\n')
  writeFileSync(join(change, 'tasks.md'), '- [ ] 1.1 scaffold\n- [ ] 1.2 wire\n')
  const classified = file('classified-short.json', { tasks: [{ id: '1.1', group: 1, description: 'scaffold', tier: 2, model: 'sonnet', isTestTask: false }] })
  const r = run(['tasks', 'coverage', '--change', 'add-auth', '--classified', classified, '--root', root, '--json'])
  assert.equal(r.code, 1)
  const out = JSON.parse(r.stdout)
  assert.equal(out.ok, false)
  assert.ok(out.omitted.some(t => String(t).includes('1.2')))
})

test('drift exits 0 even when it has findings', () => {
  // The load-bearing assertion for this subcommand. Every gate around it exits
  // non-zero when it blocks, so a future edit that "makes drift consistent"
  // would turn an advisory report into a merge blocker built on INFERRED edges.
  const root = mkdtempSync(join(tmpdir(), 'sf-cli-drift-'))
  try {
    const change = join(root, 'openspec', 'changes', 'add-auth')
    mkdirSync(change, { recursive: true })
    writeFileSync(join(change, 'proposal.md'), '# Proposal\nwhy\n')
    writeFileSync(join(change, 'design.md'), '# Design\nhow\n')
    writeFileSync(join(change, 'tasks.md'), '- [x] 1.1 all done\n')

    const r = run(['drift', '--root', root])
    assert.equal(r.code, 0, `drift must never block, got exit ${r.code}`)
    assert.match(r.stdout, /UNARCHIVED — 1 completed change/)
    assert.match(r.stdout, /openspec archive add-auth/)
    assert.match(r.stdout, /Nothing here blocks/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('drift --json reports both signals and stays exit 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'sf-cli-drift-json-'))
  try {
    const out = runJson(['drift', '--root', root], 0)
    assert.deepEqual(out.unarchived, [])
    // No graph in this fixture: the stale signal must say it was skipped and why,
    // rather than reporting an absent input as a clean one.
    assert.equal(out.stale.skipped, true)
    assert.match(out.stale.reason, /graph/i)
    assert.equal(out.hasFindings, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- plan fingerprint / reuse ---------------------------------------------
//
// Reuse never blocks: `plan reuse` exits 0 whether it matched or not, because
// not reusing is the normal first-run outcome and an error while checking is a
// reason to re-plan rather than a reason to stop. The caller branches on
// "reuse", and the summary reports "reason" either way.

test('plan fingerprint --write stores a fingerprint of every planning input', () => {
  const fp = runJson(['plan', 'fingerprint', 'add-auth', '--root', paths.root, '--write'])
  assert.equal(fp.ok, true)
  assert.equal(fp.written.written, true)
  assert.deepEqual(fp.inputs.map(i => i.path), [
    'proposal.md',
    'design.md',
    'tasks.md',
    'specs/auth/spec.md'
  ])
  assert.ok(existsSync(join(paths.root, '.claude', 'ship', 'plan-fingerprint.json')))
})

test('plan reuse reports no-plan on a first run and still exits 0', () => {
  const out = runJson(['plan', 'reuse', 'add-auth', '--root', paths.root])
  assert.equal(out.reuse, false)
  assert.equal(out.status, 'no-plan')
  assert.match(out.reason, /no stored plan/)
})

test('plan reuse matches a stored plan, narrows it, and writes the narrowed copy', () => {
  // Build a real plan for add-auth's two tasks, store it where ship keeps it,
  // fingerprint it, then tick one task and ask for reuse.
  const classified = file('classified-reuse.json', {
    tasks: [
      { id: '1.1', group: 1, description: 'sessions table', tier: 2, model: 'sonnet', isTestTask: false, paths: ['src/a.ts'] },
      { id: '1.2', group: 1, description: 'login route', tier: 2, model: 'sonnet', isTestTask: false, paths: ['src/a.ts'] }
    ]
  })
  const plan = runJson(['waves', '--classified', classified])
  mkdirSync(join(paths.root, '.claude', 'ship'), { recursive: true })
  writeFileSync(join(paths.root, '.claude', 'ship', 'plan.json'), JSON.stringify(plan))
  runJson(['plan', 'fingerprint', 'add-auth', '--root', paths.root, '--write'])

  const matched = runJson(['plan', 'reuse', 'add-auth', '--root', paths.root])
  assert.equal(matched.reuse, true)
  assert.equal(matched.status, 'match')
  assert.equal(matched.taskCount, 2)
  assert.ok(matched.narrowedPath, 'the narrowed plan is staged for wave-state create')
  const narrowed = JSON.parse(readFileSync(join(paths.root, matched.narrowedPath), 'utf8'))
  assert.deepEqual(
    narrowed.waves[0].batches.map(b => b.map(l => l.map(t => t.id))),
    [[['1.1', '1.2']]]
  )

  // Ticking a task keeps the match and drops the ticked task from the plan.
  writeFileSync(join(paths.change, 'tasks.md'), '- [x] 1.1 sessions table\n- [ ] 1.2 login route\n')
  const ticked = runJson(['plan', 'reuse', 'add-auth', '--root', paths.root])
  assert.equal(ticked.reuse, true, 'progress is not a change of plan')
  assert.deepEqual(ticked.droppedTaskIds, ['1.1'])
  assert.equal(ticked.taskCount, 1)

  // Every task complete is "no remaining work", never an empty run.
  writeFileSync(join(paths.change, 'tasks.md'), '- [x] 1.1 sessions table\n- [x] 1.2 login route\n')
  const done = runJson(['plan', 'reuse', 'add-auth', '--root', paths.root])
  assert.equal(done.reuse, true)
  assert.equal(done.noRemainingWork, true)
  assert.equal(done.narrowedPath, null, 'nothing is staged for a run with no work in it')

  // Editing an artifact invalidates, and the CLI names why.
  writeFileSync(join(paths.change, 'design.md'), '# Design\nA JWT after all.\n')
  const stale = runJson(['plan', 'reuse', 'add-auth', '--root', paths.root])
  assert.equal(stale.reuse, false)
  assert.equal(stale.status, 'inputs-changed')
})

test('plan rejects an unknown subcommand instead of guessing', () => {
  const r = run(['plan', 'sniff', '--root', paths.root])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /unknown plan subcommand: sniff/)
})

function isRoot() {
  return typeof process.getuid === 'function' && process.getuid() === 0
}

// --- paths: the two deterministic reads a host makes at close ---------------
//
// Neither may ever exit non-zero. A host calls these on its way out, and a read
// that failed the close would cost the run its receipt — the one record that
// explains what happened — over a set the receipt is perfectly able to record
// as unobserved.

function gitRepo(sub, files) {
  const root = join(dir, sub)
  mkdirSync(root, { recursive: true })
  const git = args =>
    spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid'
      }
    })
  git(['init', '-q', '-b', 'main'])
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'test'])
  return { root, sha: git(['rev-parse', 'HEAD']).stdout.trim() }
}

test('paths touched reads a real commit through the binary', () => {
  const repo = gitRepo('paths-repo', { 'lib/a.mjs': 'a\n', 'test/a.test.mjs': 'b\n' })
  const result = runJson(['paths', 'touched', '--commit', repo.sha, '--root', repo.root])
  assert.equal(result.observed, true)
  assert.deepEqual(result.paths.sort(), ['lib/a.mjs', 'test/a.test.mjs'])
})

test('every unobserved paths read exits 0 and names its reason', () => {
  const repo = gitRepo('paths-repo-2', { 'a.txt': 'a\n' })
  for (const args of [
    ['paths', 'touched', '--root', repo.root],
    ['paths', 'touched', '--commit', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '--root', repo.root],
    ['paths', 'touched', '--commit', '--not-an-object', '--root', repo.root],
    ['paths', 'predicted', '--root', repo.root],
    ['paths', 'predicted', '--plan', 'nowhere/plan.json', '--root', repo.root]
  ]) {
    const result = runJson(args, 0)
    assert.equal(result.observed, false, `${args.join(' ')} should be unobserved`)
    assert.equal(result.paths, null, 'an unobserved read is null, never an empty set')
    assert.ok(result.reason, 'and it carries its reason')
  }
})

test('paths predicted reports the union and whether every task predicted', () => {
  const root = join(dir, 'paths-plan')
  mkdirSync(join(root, '.claude', 'ship'), { recursive: true })
  const plan = tasks => JSON.stringify({ waves: [{ group: 1, batches: [[tasks]] }], testWave: null })

  writeFileSync(join(root, '.claude/ship/plan.json'), plan([{ id: '1.1', paths: ['lib/a.mjs'] }]))
  const complete = runJson(['paths', 'predicted', '--root', root])
  assert.equal(complete.observed, true)
  assert.deepEqual(complete.paths, ['lib/a.mjs'])
  assert.equal(complete.complete, true)

  writeFileSync(join(root, '.claude/ship/plan.json'), plan([{ id: '1.1', paths: ['lib/a.mjs'] }, { id: '1.2' }]))
  const partial = runJson(['paths', 'predicted', '--root', root])
  assert.equal(partial.complete, false, 'a task that declined to predict is not a task that predicted nothing')
  assert.match(partial.reason, /declared no paths/)
})

test('paths rejects an unknown subcommand instead of guessing', () => {
  const r = run(['paths', 'sniff'])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /unknown paths subcommand: sniff/)
})

// --- evals capture ----------------------------------------------------------

/** A reconstructable run under `root`, written through the CLI's own appender. */
function recordCapturableRun(root, runId) {
  const append = event => {
    const p = file(`${runId}-${event.type}-${Math.random().toString(36).slice(2)}.json`, { runId, change: 'add-widget', ...event })
    const r = run(['run-log', 'append', '--event', p, '--root', root, '--json'])
    assert.equal(r.code, 0)
  }
  append({ type: 'run-start', mode: 'checkpoint' })
  append({ type: 'wave-action', action: 'run-batch', wave: '1', source: 'next' })
  append({ type: 'cli-exit', command: 'interlock wave-state next', exitCode: 0 })
  append({ type: 'run-halt', reason: 'record-batch refused: status "done" is not one of ok, blocked, partial' })
}

test('evals capture emits a draft into the caller\'s directory and touches nothing else', () => {
  const root = join(dir, 'capture-ok')
  mkdirSync(join(root, 'evals'), { recursive: true })
  recordCapturableRun(root, 'run-cli-1')

  const result = runJson(['evals', 'capture', '--run', 'run-cli-1', '--out', 'drafts/case', '--root', root])
  assert.equal(result.ok, true)
  assert.ok(existsSync(join(root, 'drafts/case/case.yaml')))
  assert.ok(existsSync(join(root, 'drafts/case/graders/observed-value.md')))
  assert.match(result.provenance, /run-cli-1\.jsonl events/)
  assert.deepEqual(readdirSync(join(root, 'evals')), [], 'the suite is never written to')

  const grader = readFileSync(join(root, 'drafts/case/graders/observed-value.md'), 'utf8')
  assert.match(grader, /pattern: 'done'/, 'the pattern is the value the run named, quoted')
})

test('evals capture refuses an output inside the suite, an occupied one, and an unciteable run', () => {
  const root = join(dir, 'capture-refuse')
  mkdirSync(join(root, 'evals'), { recursive: true })
  recordCapturableRun(root, 'run-cli-2')
  mkdirSync(join(root, 'taken'), { recursive: true })
  writeFileSync(join(root, 'taken', 'case.yaml'), 'name: mine\n')

  const refusals = [
    [['evals', 'capture', '--run', 'run-cli-2', '--out', 'evals/new-case', '--root', root], /never writes into the suite/],
    [['evals', 'capture', '--run', 'run-cli-2', '--out', 'taken', '--root', root], /already holds a case/],
    [['evals', 'capture', '--run', 'run-never-happened', '--out', 'drafts/x', '--root', root], /not reconstructable/]
  ]
  for (const [args, expected] of refusals) {
    const r = run(args)
    assert.equal(r.code, 1, `${args.join(' ')} must exit non-zero`)
    assert.match(r.stdout + r.stderr, expected)
  }

  assert.deepEqual(readdirSync(join(root, 'evals')), [], 'no refusal creates anything under evals/')
  assert.equal(readFileSync(join(root, 'taken', 'case.yaml'), 'utf8'), 'name: mine\n', 'nor overwrites a case')
  assert.equal(existsSync(join(root, 'drafts')), false, 'nor leaves a directory behind')
})

test('evals capture requires both --run and --out, and names the subcommands it knows', () => {
  const missingRun = run(['evals', 'capture', '--out', 'drafts/x'])
  assert.notEqual(missingRun.code, 0)
  assert.match(missingRun.stderr, /requires --run/)

  const missingOut = run(['evals', 'capture', '--run', 'x'])
  assert.notEqual(missingOut.code, 0)
  assert.match(missingOut.stderr, /requires --out/)

  const unknown = run(['evals', 'sniff'])
  assert.notEqual(unknown.code, 0)
  assert.match(unknown.stderr, /unknown evals subcommand: sniff — expected triage\|capture/)
})

test('the new commands are in the usage text, with capture\'s refusal exit', () => {
  const r = run(['--help'])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /interlock evals capture --run <id> --out <dir>/)
  assert.match(r.stdout, /interlock paths touched --commit <sha>/)
  assert.match(r.stdout, /interlock paths predicted/)
  assert.match(r.stdout, /evals capture\s+the capture was refused/)
})

// --- interlock notify (design D1, D2) ---------------------------------------
//
// The relay runs in its own process for the same reason it does in
// `run.test.mjs`: `run()` here is `spawnSync`, which blocks this process's
// event loop for the whole child run, so an in-process server would never
// accept the connection.

/** A ntfy stand-in on loopback, in its own process. Answers with `status`. */
async function relay(status = 200) {
  const relayDir = mkdtempSync(join(tmpdir(), 'interlock-cli-relay-'))
  const log = join(relayDir, 'requests.jsonl')
  const script = `
    const { createServer } = require('node:http')
    const { appendFileSync } = require('node:fs')
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        appendFileSync(${JSON.stringify(log)},
          JSON.stringify({ url: req.url, method: req.method, headers: req.headers, body }) + '\\n')
        res.writeHead(${status})
        res.end('x')
      })
    })
    server.listen(0, '127.0.0.1', () => process.stdout.write(server.address().port + '\\n'))
  `
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
  // Three ways this can end, and only one of them used to settle the promise: a
  // spawn error, a child that exits before printing a port (a sandbox that
  // cannot bind loopback), and a child that neither prints nor exits. Without
  // the latter two the whole suite wedges instead of failing.
  const port = await new Promise((resolve, reject) => {
    let timer = null
    const settle = (fn, value) => {
      clearTimeout(timer)
      fn(value)
    }
    timer = setTimeout(() => settle(reject, new Error('relay did not report a port within 5s')), 5000)
    child.stdout.once('data', d => settle(resolve, Number(String(d).trim())))
    child.once('error', err => settle(reject, err))
    child.once('exit', code => settle(reject, new Error(`relay exited (${code}) before reporting a port`)))
  }).catch(err => {
    child.kill()
    rmSync(relayDir, { recursive: true, force: true })
    throw err
  })
  return {
    url: `http://127.0.0.1:${port}`,
    requests: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
        : [],
    close: () => {
      child.kill()
      rmSync(relayDir, { recursive: true, force: true })
    }
  }
}

/**
 * False, or the reason the relay tests cannot run here. A sandbox that denies
 * binding loopback is an environment fact, not a result: the tests that need
 * the relay skip and say so, and any other probe failure skips nothing, so
 * they still run and fail where the cause is anything else.
 */
function loopbackDenied() {
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      "require('node:net').createServer()" +
        ".on('error', e => process.exit(e.code === 'EPERM' || e.code === 'EACCES' ? 3 : 1))" +
        ".listen(0, '127.0.0.1', function () { this.close() })"
    ],
    { stdio: 'ignore' }
  )
  return probe.status === 3 ? 'this environment denies binding loopback (a sandbox) — rerun outside it' : false
}
const LOOPBACK_DENIED = loopbackDenied()

/** Read back a `Title` header — a headline travels RFC 2047 encoded. */
function decodeTitle(value) {
  const match = /^=\?UTF-8\?B\?(.*)\?=$/.exec(value || '')
  return match ? Buffer.from(match[1], 'base64').toString('utf8') : value
}

test('notify with no topic configured says so and exits 0 — an optional feature left off is not a failure', () => {
  const r = run(['notify', '--title', 'anything'], { env: { INTERLOCK_NTFY_TOPIC: '' } })
  assert.equal(r.code, 0, 'a skill or a driver calls this unconditionally; it must never halt a loop')
  assert.match(r.stdout, /^push: not configured — set INTERLOCK_NTFY_TOPIC$/m)
})

test('notify --json emits { sent, reason } whether or not a push was attempted', () => {
  const r = run(['notify', '--title', 'anything', '--json'], { env: { INTERLOCK_NTFY_TOPIC: '' } })
  assert.equal(r.code, 0)
  const parsed = JSON.parse(r.stdout)
  assert.equal(parsed.sent, false)
  assert.match(parsed.reason, /not configured/)
})

test('notify checkpoint posts the spec checkpoint title at default priority', { skip: LOOPBACK_DENIED }, async () => {
  const stub = await relay()
  try {
    const r = run(['notify', 'checkpoint', 'add-thing'], {
      env: { INTERLOCK_NTFY_TOPIC: 'secret-topic-abc', INTERLOCK_NTFY_URL: stub.url }
    })
    assert.equal(r.code, 0)
    assert.match(r.stdout, /^push: sent \(ntfy\)$/m)
    const posted = stub.requests()
    assert.equal(posted.length, 1)
    assert.equal(posted[0].url, '/secret-topic-abc')
    assert.equal(decodeTitle(posted[0].headers.title), 'SPEC CHECKPOINT — add-thing')
    assert.equal(posted[0].headers.priority, 'default')
    assert.ok(!r.stdout.includes('secret-topic-abc'), 'the topic is a capability and never printed')
  } finally {
    stub.close()
  }
})

test('a notify a person invoked directly exits 1 when the relay refused it', { skip: LOOPBACK_DENIED }, async () => {
  const broken = await relay(500)
  try {
    const r = run(['notify', '--title', 'a title', '--body', 'a body'], {
      env: { INTERLOCK_NTFY_TOPIC: 'secret-topic-abc', INTERLOCK_NTFY_URL: broken.url }
    })
    assert.equal(r.code, 1, 'a command that did not do its job exits non-zero — unlike the close, which is advisory')
    assert.match(r.stdout, /^push: failed — HTTP 500$/m)
    assert.ok(!r.stdout.includes('secret-topic-abc'))
  } finally {
    broken.close()
  }
})

test('notify refuses a form it cannot build a message from, rather than posting an empty one', () => {
  const r = run(['notify'], { env: { INTERLOCK_NTFY_TOPIC: 'secret-topic-abc' } })
  assert.equal(r.code, 1)
  assert.match(r.stderr, /--title/)
})

// --- waves: the red wave --------------------------------------------------

test('waves --red-wave runs a section first, and --tdd derives it from the classification', () => {
  // This subcommand has no change name and so no tasks.md — the red wave is
  // either named outright or derived from the classified input's own structure.
  // A run resolves it from the section heading instead.
  const tdd = file('classified-tdd.json', {
    tasks: [
      { id: '1.1', group: 1, description: 'red suite', tier: 2, model: 'sonnet', isTestTask: true },
      { id: '2.1', group: 2, description: 'impl a', tier: 2, model: 'sonnet', isTestTask: false, paths: ['src/a.ts'] },
      { id: '2.2', group: 2, description: 'impl b', tier: 2, model: 'sonnet', isTestTask: false, paths: ['src/b.ts'] }
    ]
  })

  const explicit = runJson(['waves', '--classified', tdd, '--red-wave', '1'])
  assert.equal(explicit.redWave, 1)
  assert.equal(explicit.testWave, null, 'the red suite does not also defer')
  assert.equal(explicit.waves[0].red, true)

  const derived = runJson(['waves', '--classified', tdd, '--tdd'])
  assert.equal(derived.redWave, 1, '--tdd finds the all-test first section')
  assert.deepEqual(derived.waves, explicit.waves, 'and plans it identically')

  // Default: no red wave at all, and the suite defers as it always did.
  const plain = runJson(['waves', '--classified', tdd])
  assert.equal(plain.redWave, null)
  assert.ok(plain.testWave, 'the trailing test wave is the default for a test task')

  // --no-tdd beats --red-wave: an explicit refusal is not overridden by an
  // explicit section, because only one of them can be what the operator meant.
  const refused = runJson(['waves', '--classified', tdd, '--red-wave', '1', '--no-tdd'])
  assert.equal(refused.redWave, null)
  assert.deepEqual(refused.waves, plain.waves)
})

test('waves --tdd on an ordinary change plans exactly as it would without the flag', () => {
  // The constraint the feature was built under, at the CLI boundary. The stock
  // fixture's first section is implementation work, so there is no failing
  // suite to run first and the flag must change nothing.
  const withFlag = runJson(['waves', '--classified', paths.classified, '--tdd'])
  const without = runJson(['waves', '--classified', paths.classified])
  assert.equal(withFlag.redWave, null)
  assert.deepEqual(withFlag, without, '--tdd must not invent a red wave that is not there')
})

test('waves rejects a non-numeric --red-wave and refuses both task-shape flags at once', () => {
  const bad = run(['waves', '--classified', paths.classified, '--red-wave', 'first'])
  assert.equal(bad.code, 1, bad.stdout)
  assert.match(bad.stderr, /--red-wave requires an integer section number/)

  const both = run(['waves', '--classified', paths.classified, '--tdd', '--no-tdd'])
  assert.equal(both.code, 1, both.stdout)
  assert.match(both.stderr, /contradictory task-shape flags/)
})

test('verify exec passes a check through untouched and records how long it ran', () => {
  // The inter-wave budget's clock. The command's output and exit code must be
  // exactly its own — the verify agent reads and spills them as before — and
  // the timing lands beside it, measured by the CLI around the command alone.
  const root = mkdtempSync(join(tmpdir(), 'interlock-exec-'))
  try {
    mkdirSync(join(root, 'pkg'))
    const ok = run(
      ['verify', 'exec', '--kind', 'unit', '--command', `node -e "process.stdout.write('suite out'); process.stderr.write('suite err')"`],
      { cwd: root }
    )
    assert.equal(ok.code, 0, ok.stderr)
    assert.equal(ok.stdout, 'suite out', 'nothing is added to the command\'s own output')
    assert.equal(ok.stderr, 'suite err')

    const red = run(['verify', 'exec', '--kind', 'lint', '--command', 'node -e "process.exit(3)"'], { cwd: root })
    assert.equal(red.code, 3, 'a red check exits as the check did')

    const inPkg = run(
      ['verify', 'exec', '--kind', 'typecheck', '--cwd', 'pkg', '--command', 'node -e "process.stdout.write(process.cwd())"'],
      { cwd: root }
    )
    assert.equal(inPkg.code, 0, inPkg.stderr)
    assert.ok(inPkg.stdout.endsWith(`${join('', 'pkg')}`), `ran in ${inPkg.stdout}, not in --cwd`)

    const lines = readFileSync(join(root, '.claude/ship/verify-timings.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    assert.deepEqual(
      lines.map(l => [l.kind, l.exitCode]),
      [['unit', 0], ['lint', 3], ['typecheck', 0]],
      'every run is recorded, red ones included, under the root rather than the --cwd'
    )
    for (const l of lines) assert.ok(Number.isInteger(l.durationMs) && l.durationMs >= 0, JSON.stringify(l))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verify exec refuses to run without a kind or a command', () => {
  const noKind = run(['verify', 'exec', '--command', 'true'])
  assert.notEqual(noKind.code, 0)
  assert.match(noKind.stderr, /--kind is required/)
  const noCommand = run(['verify', 'exec', '--kind', 'unit'])
  assert.notEqual(noCommand.code, 0)
  assert.match(noCommand.stderr, /--command is required/)
})

// --- drawing a plan and a run: --format board|mermaid -----------------------
//
// draw-wave-plan-and-handoff-graph-from-the-cli design D9. The fixture is a
// byte copy of one real halted run (see test/spine/draw-plan.test.mjs for its
// provenance), copied into scratch dirs here so the CLI reads it the way it
// reads a live run. Every drawing exits 0; only a usage error moves the code.

const DRAW_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ship', 'halted-run-6e9d0b02')
const DRAW_RUN_ID = '6e9d0b02-c70b-4d7a-9865-fa892722cecb'
const drawFixture = name => readFileSync(join(DRAW_FIXTURE, name), 'utf8')

test('waves --format draws a stored plan and its overlay at a chosen width', () => {
  const plan = file('draw/plan.json', drawFixture('plan.json'))
  const state = file('draw/state.json', drawFixture('state.json'))

  const board = run(['waves', '--plan', plan, '--state', state, '--format', 'board', '--columns', '80'])
  assert.equal(board.code, 0, board.stderr)
  const lines = board.stdout.trimEnd().split('\n')
  for (const line of lines) assert.ok([...line].length <= 80, line)
  assert.ok(lines[0].includes('cursor idx 1'), lines[0])
  assert.ok(lines.some(line => line.startsWith('│') && / ok /.test(line)), board.stdout)
  assert.ok(lines.some(line => line.startsWith('│') && / failed /.test(line)), board.stdout)

  const mermaid = run(['waves', '--plan', plan, '--state', state, '--format', 'mermaid'])
  assert.equal(mermaid.code, 0, mermaid.stderr)
  assert.equal(mermaid.stdout.split('\n')[0], 'flowchart LR')
})

test('waves refuses the flags that contradict each other, naming them', () => {
  const plan = file('draw/plan.json', drawFixture('plan.json'))
  const state = file('draw/state.json', drawFixture('state.json'))

  const json = run(['waves', '--plan', plan, '--format', 'board', '--json'])
  assert.notEqual(json.code, 0)
  assert.match(json.stderr, /--format/)
  assert.match(json.stderr, /--json/)

  const wat = run(['waves', '--plan', plan, '--format', 'wat'])
  assert.notEqual(wat.code, 0)
  assert.match(wat.stderr, /board/)
  assert.match(wat.stderr, /mermaid/)

  for (const args of [['--columns', '80'], ['--state', state]]) {
    const r = run(['waves', '--plan', plan, ...args])
    assert.notEqual(r.code, 0, args.join(' '))
    assert.match(r.stderr, /--format/)
  }

  const both = run(['waves', '--plan', plan, '--classified', paths.classified, '--format', 'board'])
  assert.notEqual(both.code, 0)
  assert.match(both.stderr, /--plan/)
  assert.match(both.stderr, /--classified/)
})

test('waves speaks a missing plan or state and exits 0', () => {
  const missingPlan = run(['waves', '--plan', 'missing.json', '--format', 'board'])
  assert.equal(missingPlan.code, 0, missingPlan.stderr)
  assert.equal(missingPlan.stdout, 'no plan at missing.json\n')

  const plan = file('draw/plan.json', drawFixture('plan.json'))
  const missingState = run(['waves', '--plan', plan, '--state', 'missing.json', '--format', 'board'])
  assert.equal(missingState.code, 0, missingState.stderr)
  const header = missingState.stdout.split('\n')[0]
  assert.ok(header.includes('plan only') && header.includes('no state at missing.json'), header)
})

test('waves without --format prints what it printed before', async () => {
  const { formatPlan, planWaves } = await import('../../lib/waves.mjs')
  const plan = file('draw/plan.json', drawFixture('plan.json'))
  const stored = run(['waves', '--plan', plan])
  assert.equal(stored.code, 0, stored.stderr)
  assert.equal(stored.stdout, formatPlan(JSON.parse(drawFixture('plan.json'))))

  const planned = run(['waves', '--classified', paths.classified])
  assert.equal(planned.code, 0, planned.stderr)
  assert.equal(planned.stdout, formatPlan(planWaves(CLASSIFIED)))
})

test('run-log show --format draws the run and keeps every exit code', async () => {
  const { formatRunLog, readRunLog } = await import('../../lib/run-log.mjs')
  const home = mkdtempSync(join(tmpdir(), 'interlock-cli-draw-run-'))
  try {
    mkdirSync(join(home, '.claude', 'ship', 'runs'), { recursive: true })
    writeFileSync(join(home, '.claude', 'ship', 'runs', `${DRAW_RUN_ID}.jsonl`), drawFixture('trajectory.jsonl'))
    writeFileSync(join(home, '.claude', 'ship', 'state.json'), drawFixture('state.json'))
    const at = ['--root', home, '--state-home', home]

    const board = run(['run-log', 'show', DRAW_RUN_ID, '--format', 'board', ...at])
    assert.equal(board.code, 0, board.stderr)
    const header = board.stdout.split('\n')[0]
    assert.ok(header.includes('state.json: this run') && header.includes('run.json: absent'), header)

    const mermaid = run(['run-log', 'show', DRAW_RUN_ID, '--format', 'mermaid', ...at])
    assert.equal(mermaid.code, 0, mermaid.stderr)
    assert.equal(mermaid.stdout.split('\n')[0], 'flowchart TD')

    const never = run(['run-log', 'show', 'never-recorded', '--format', 'board', ...at])
    assert.equal(never.code, 0, never.stderr)
    assert.equal(never.stdout, run(['run-log', 'show', 'never-recorded', ...at]).stdout)

    const plain = run(['run-log', 'show', DRAW_RUN_ID, ...at])
    assert.equal(plain.code, 0, plain.stderr)
    assert.equal(plain.stdout, formatRunLog(readRunLog(realpathSync(home), DRAW_RUN_ID)))

    const json = run(['run-log', 'show', DRAW_RUN_ID, '--format', 'board', '--json', ...at])
    assert.notEqual(json.code, 0)
    assert.match(json.stderr, /--format/)
    assert.match(json.stderr, /--json/)
    const wat = run(['run-log', 'show', DRAW_RUN_ID, '--format', 'wat', ...at])
    assert.notEqual(wat.code, 0)
    assert.match(wat.stderr, /board/)
    assert.match(wat.stderr, /mermaid/)
    const query = run(['run-log', 'query', '--run', DRAW_RUN_ID, '--format', 'board', ...at])
    assert.notEqual(query.code, 0)
    assert.match(query.stderr, /show/)

    const other = JSON.parse(drawFixture('state.json'))
    other.runId = 'ffffffff-0000-0000-0000-000000000000'
    writeFileSync(join(home, '.claude', 'ship', 'state.json'), JSON.stringify(other))
    const another = run(['run-log', 'show', DRAW_RUN_ID, '--format', 'board', ...at])
    assert.equal(another.code, 0, another.stderr)
    assert.ok(another.stdout.split('\n')[0].includes('state.json: another run'), another.stdout)
    assert.ok(!another.stdout.includes('↳'), another.stdout)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

// --- merge-confidence (spec: review/merge-confidence — command contract) ------
//
// The module is covered at its own level against one fixture per signal state.
// What only the binary can get wrong is the wiring: which flag reads which file,
// that an unreadable file dies before anything is printed, that the head commit
// and the scenario count come from the repository rather than the caller, and
// that the exit status follows the verdict — BLOCK is 1, HUMAN is 0, and
// --require-merge makes anything but MERGE a 1.

const CALLER_INPUT_SIGNALS = {
  'review.blockers': '--review',
  'review.warnings': '--review',
  'review.adversarial': '--review',
  'verify.suite': '--verify',
  'verify.e2e': '--verify',
  'verify.coverage': '--coverage',
  'ci.pipeline': '--pipeline',
  'diff.shape': '--base'
}

const SCENARIO_COUNT = 5

/** The one change's files: delta specs carrying SCENARIO_COUNT scenarios. */
function widgetChangeFiles() {
  const scenarios = Array.from(
    { length: SCENARIO_COUNT },
    (_, i) => `#### Scenario: case ${i + 1}\n\n- **GIVEN** a catalogue\n- **WHEN** it renders\n- **THEN** it lists case ${i + 1}\n`
  ).join('\n')
  return {
    'openspec/changes/add-widget-catalogue/proposal.md': '## Why\n\nList the widgets a shop sells in one catalogue view.\n',
    'openspec/changes/add-widget-catalogue/design.md': '## Decisions\n\nD1. The catalogue reads the existing widget store.\n',
    'openspec/changes/add-widget-catalogue/tasks.md': '- [ ] 1.1 Render the catalogue\n',
    'openspec/changes/add-widget-catalogue/decisions.md': [
      '# Decisions — add-widget-catalogue',
      '',
      '| id | question | class | resolution | evidence |',
      '|----|----|----|----|----|',
      '| D1 | Read the existing store or add one? | agent_resolved | read the existing store | design.md:3 |',
      ''
    ].join('\n'),
    'openspec/changes/add-widget-catalogue/specs/widgets/catalogue/spec.md':
      `## ADDED Requirements\n\n### Requirement: The catalogue lists widgets\n\nThe catalogue SHALL list every widget.\n\n${scenarios}`
  }
}

let mergeRepo = null
/** A git checkout holding the change and its source in one commit. */
function mergeConfidenceRepo() {
  if (mergeRepo) return mergeRepo
  mergeRepo = gitRepo('merge-confidence-repo', {
    ...widgetChangeFiles(),
    'src/widgets/catalogue.ts': 'export const catalogue = () => []\n'
  })
  return mergeRepo
}

/**
 * A checkout whose first commit holds only the change's artifacts and whose
 * second adds `headFiles`, so `--base <base>` has a real diff to read.
 */
function mergeBaseRepo(sub, headFiles, baseExtra = {}) {
  const repo = gitRepo(sub, { ...widgetChangeFiles(), ...baseExtra })
  for (const [rel, body] of Object.entries(headFiles)) {
    mkdirSync(dirname(join(repo.root, rel)), { recursive: true })
    writeFileSync(join(repo.root, rel), body)
  }
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid'
  }
  const git = args => spawnSync('git', args, { cwd: repo.root, encoding: 'utf8', env })
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'head'])
  return { root: repo.root, base: repo.sha, sha: git(['rev-parse', 'HEAD']).stdout.trim() }
}

const greenFixture = () =>
  JSON.parse(readFileSync(new URL('../fixtures/merge-confidence/all-observable-green.json', import.meta.url), 'utf8'))

const mergeArgs = (...extra) => [
  'merge-confidence',
  'add-widget-catalogue',
  '--root',
  mergeConfidenceRepo().root,
  ...extra,
  '--changed',
  'src/widgets/catalogue.ts'
]
const signalIn = (out, id) => out.signals.find(s => s.id === id)

test('merge-confidence --json carries the verdict, the score, the worst band, every signal, what drives it, the counts and the flags', () => {
  const out = runJson(mergeArgs())
  for (const key of ['verdict', 'score', 'worstBand', 'signals', 'driving', 'counts', 'flags']) {
    assert.ok(Object.prototype.hasOwnProperty.call(out, key), `--json is missing "${key}"`)
  }
  assert.equal(out.change, 'add-widget-catalogue')
  assert.ok(Number.isInteger(out.score))
})

test('merge-confidence with only changed paths reads HUMAN, every caller-input signal unobserved, and exits 0', () => {
  const repo = mergeConfidenceRepo()
  const r = run(['merge-confidence', '--root', repo.root, '--changed', 'src/widgets/catalogue.ts', '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.verdict, 'HUMAN')
  for (const [id, flag] of Object.entries(CALLER_INPUT_SIGNALS)) {
    const entry = signalIn(out, id)
    assert.equal(entry.band, 'unobserved', `${id}: ${entry.reason}`)
    assert.ok(entry.reason.includes(flag), `${id} does not name ${flag}: ${entry.reason}`)
    assert.match(entry.reason, /not given/, id)
  }
  // The repository's own facts are still read: the single change resolves.
  assert.equal(out.change, 'add-widget-catalogue')
  assert.equal(signalIn(out, 'decisions.open').band, 'green', signalIn(out, 'decisions.open').reason)
})

test('merge-confidence exits 1 on a review with a surviving blocker', () => {
  const review = file('mc-review-blocker.json', {
    surviving: [
      {
        dimension: 'typescript',
        severity: 'blocker',
        title: 'unchecked null deref on an empty store',
        file: 'src/widgets/catalogue.ts',
        votes: { real: 2, notReal: 0, uncited: 0, total: 2 }
      }
    ],
    counts: { raised: 1, droppedByPolicy: 0, dismissed: 0, droppedByQuality: 0, surviving: 1, dismissalsRejected: 0 }
  })
  const out = runJson(mergeArgs('--review', review), 1)
  assert.equal(out.verdict, 'BLOCK')
  assert.equal(signalIn(out, 'review.blockers').band, 'red')
  assert.equal(run(mergeArgs('--review', review)).code, 1, 'the exit is the verdict with or without --json')
})

test('HUMAN exits 0, and exits 1 under --require-merge', () => {
  const plain = run(mergeArgs('--json'))
  assert.equal(plain.code, 0, plain.stderr)
  assert.equal(JSON.parse(plain.stdout).verdict, 'HUMAN')
  const required = run(mergeArgs('--require-merge', '--json'))
  assert.equal(required.code, 1)
  assert.equal(JSON.parse(required.stdout).verdict, 'HUMAN', 'the verdict is still printed; only the exit changes')
})

test('a --review file that is not JSON exits 1 with nothing on stdout and the file named on stderr', () => {
  const broken = file('mc-review-broken.json', '{ "surviving": [')
  const r = run(mergeArgs('--review', broken, '--json'))
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '', 'no verdict may be printed for input that could not be read')
  assert.ok(r.stderr.includes(broken), r.stderr)
  assert.doesNotMatch(r.stderr, /\n\s+at /)

  const missing = join(dir, 'mc-no-such-review.json')
  const absent = run(mergeArgs('--review', missing, '--json'))
  assert.equal(absent.code, 1)
  assert.equal(absent.stdout, '')
  assert.ok(absent.stderr.includes(missing), absent.stderr)
})

test('a --pipeline file for another commit is unobserved; one for HEAD is read', () => {
  const repo = mergeConfidenceRepo()
  const checks = [{ name: 'unit', state: 'pass', required: true }]
  const stale = file('mc-pipeline-stale.json', { sha: '0'.repeat(40), checks })
  const staleOut = runJson(mergeArgs('--pipeline', stale))
  assert.equal(signalIn(staleOut, 'ci.pipeline').band, 'unobserved')
  assert.match(signalIn(staleOut, 'ci.pipeline').reason, /another commit/)

  const head = file('mc-pipeline-head.json', { sha: repo.sha, checks })
  assert.equal(signalIn(runJson(mergeArgs('--pipeline', head)), 'ci.pipeline').band, 'green', 'HEAD comes from the repository')
})

test('a --handoff file that states a smaller denominator is amber, naming the change’s own scenario count', () => {
  const handoff = file('mc-handoff-short.json', { scenariosChecked: 3, scenariosUnconfirmed: 0, verdictsRequired: 3 })
  const entry = signalIn(runJson(mergeArgs('--handoff', handoff)), 'conformance.delta')
  assert.equal(entry.band, 'amber')
  assert.ok(entry.reason.includes(`3 of ${SCENARIO_COUNT}`), entry.reason)

  const full = file('mc-handoff-full.json', { scenariosChecked: SCENARIO_COUNT, scenariosUnconfirmed: 0 })
  assert.equal(signalIn(runJson(mergeArgs('--handoff', full)), 'conformance.delta').band, 'green')
})

test('--base reads the diff shape from git, and a base git cannot diff dies with nothing on stdout', () => {
  // HEAD as the base diffs empty by construction: unobserved, never a small diff.
  const head = signalIn(runJson(mergeArgs('--base', 'HEAD')), 'diff.shape')
  assert.equal(head.band, 'unobserved', head.reason)
  assert.match(head.reason, /descendant/)

  const bad = run(mergeArgs('--base', 'no-such-ref-anywhere', '--json'))
  assert.equal(bad.code, 1)
  assert.equal(bad.stdout, '')
  assert.match(bad.stderr, /no-such-ref-anywhere/)

  const option = run(mergeArgs('--base', '-p', '--json'))
  assert.equal(option.code, 1, 'a base that reads as an option is refused, never handed to git')
  assert.equal(option.stdout, '')
  assert.match(option.stderr, /must name a ref/)
})

test('--base assesses every path git reports, naming on stderr the ones --changed left out', () => {
  const repo = mergeBaseRepo('merge-confidence-base-unnamed', {
    'src/widgets/catalogue.ts': 'export const catalogue = () => []\n',
    'src/payments/charge.ts': 'export const charge = () => 0\n'
  })
  const r = run([
    'merge-confidence', 'add-widget-catalogue', '--root', repo.root, '--base', repo.base,
    '--changed', 'src/widgets/catalogue.ts', '--json'
  ])
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stderr, /were not in --changed/)
  assert.ok(r.stderr.includes('src/payments/charge.ts'), r.stderr)
  const out = JSON.parse(r.stdout)
  const diff = signalIn(out, 'diff.shape')
  assert.equal(diff.band, 'green', diff.reason)
  assert.ok(diff.evidence.some(line => /2 changed file/.test(line)), diff.evidence.join('\n'))
  const risk = signalIn(out, 'risk.class')
  assert.equal(risk.band, 'amber', 'the payments path --changed omitted still reaches the risk classifier')
  assert.ok(risk.evidence.some(line => line.includes('payments')), risk.evidence.join('\n'))
})

/** The widget change's delta spec, rewritten so it mentions `path` — the rule the graph applies, read from text. */
const widgetSpecNaming = path => {
  const key = 'openspec/changes/add-widget-catalogue/specs/widgets/catalogue/spec.md'
  return {
    [key]: widgetChangeFiles()[key].replace(
      'The catalogue SHALL list every widget.',
      `The catalogue SHALL list every widget, rendered by \`${path}\`.`
    )
  }
}

const WIDGET_SOURCE = 'src/widgets/catalogue.ts'

/** A base + head checkout whose head adds WIDGET_SOURCE and whose delta spec names it. */
const namedWidgetRepo = sub => mergeBaseRepo(sub, { [WIDGET_SOURCE]: 'export const catalogue = () => []\n' }, widgetSpecNaming(WIDGET_SOURCE))

const baseArgs = repo => ['merge-confidence', 'add-widget-catalogue', '--root', repo.root, '--base', repo.base, '--changed', WIDGET_SOURCE]

test('a full set of hand-given inputs on a clean change reads HUMAN, held only by the run record no hand run has, and exits 0', () => {
  const repo = namedWidgetRepo('merge-confidence-base-full')
  const green = greenFixture()
  const r = run([
    ...baseArgs(repo),
    '--review', file('mc-full-review.json', green.review),
    '--verify', file('mc-full-verify.json', green.verify),
    '--handoff', file('mc-full-handoff.json', { scenariosChecked: SCENARIO_COUNT, scenariosUnconfirmed: 0 }),
    '--pipeline', file('mc-full-pipeline.json', { ...green.pipeline, sha: repo.sha }),
    '--coverage', file('mc-full-coverage.json', green.coverage),
    '--json'
  ])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.verdict, 'HUMAN')
  // Neither signal that used to be producer-less is among what drives it: the
  // living list and the spec-coverage facts are gathered from the repository.
  // `policy.humanPaths` is not either: with a base it reads the policy
  // committed there, and this base lists no changed path.
  assert.deepEqual(
    out.driving.map(d => d.id).sort(),
    ['run.integrity'],
    JSON.stringify(out.driving.map(d => [d.id, d.band, d.reason]), null, 2)
  )
  assert.equal(signalIn(out, 'run.integrity').band, 'unobserved')
  for (const id of [
    'verify.suite', 'verify.e2e', 'verify.coverage', 'ci.pipeline', 'diff.shape', 'review.ran', 'policy.humanPaths',
    'spec.coverage', 'conformance.living'
  ]) {
    assert.equal(signalIn(out, id).band, 'green', `${id}: ${signalIn(out, id).reason}`)
  }
  assert.doesNotMatch(r.stdout, /no input to this version can read MERGE|until .* lands/)
})

// --- spec.coverage through the binary: text only, no graph --------------------------

test('spec.coverage is amber, needing a fix, for an added source file no spec names, in a repository with no graph', () => {
  const repo = mergeBaseRepo('mc-speccov-unnamed', { [WIDGET_SOURCE]: 'export const catalogue = () => []\n' })
  assert.equal(existsSync(join(repo.root, '.claude', 'graph')), false, 'this fixture has no graph')
  const out = runJson(baseArgs(repo))
  const signal = signalIn(out, 'spec.coverage')
  assert.equal(signal.band, 'amber', said(signal))
  assert.equal(signal.kind, 'finding', 'a missing mention is a fix, not a question for a person')
  assert.ok(said(signal).includes(WIDGET_SOURCE), said(signal))
  assert.equal(out.verdict, 'HUMAN')
})

test('spec.coverage is green when a delta spec of the change names the added file, in a repository with no graph', () => {
  const repo = namedWidgetRepo('mc-speccov-named')
  assert.equal(existsSync(join(repo.root, '.claude', 'graph')), false, 'this fixture has no graph')
  const signal = signalIn(runJson(baseArgs(repo)), 'spec.coverage')
  assert.equal(signal.band, 'green', said(signal))
  assert.deepEqual(signal.flags, [])
})

test('spec.coverage ignores an added test file and an added document, so only source files can leave it amber', () => {
  const repo = mergeBaseRepo('mc-speccov-not-source', {
    'test/widgets/catalogue.test.ts': 'export {}\n',
    'docs/widgets.md': '# Widgets\n'
  })
  const signal = signalIn(
    runJson(['merge-confidence', 'add-widget-catalogue', '--root', repo.root, '--base', repo.base, '--changed', 'test/widgets/catalogue.test.ts,docs/widgets.md']),
    'spec.coverage'
  )
  assert.equal(signal.band, 'green', said(signal))
})

test('spec.coverage is unobserved, for want of a base, when --base is not given', () => {
  const repo = mergeConfidenceRepo()
  const r = run(['merge-confidence', '--root', repo.root, '--changed', WIDGET_SOURCE, '--json'])
  assert.equal(r.code, 0, r.stderr)
  const signal = signalIn(JSON.parse(r.stdout), 'spec.coverage')
  assert.equal(signal.band, 'unobserved')
  assert.match(signal.reason, /base/)
})

// --- merge-confidence --run: the evidence file a ship run's close writes -------------

const RUN_EVIDENCE_SCHEMA = 'interlock.merge-evidence/1'

/** What a clean, reviewed run's close would have written for `repo`'s head commit. */
function runEvidence(repo, over = {}) {
  const green = greenFixture()
  const { evidence = {}, ...top } = over
  return {
    schema: RUN_EVIDENCE_SCHEMA,
    change: 'add-widget-catalogue',
    runId: 'run-fixture-1',
    base: repo.base,
    headSha: repo.sha,
    committed: true,
    evidence: {
      review: green.review,
      verify: green.verify,
      handoff: { scenariosChecked: SCENARIO_COUNT, scenariosUnconfirmed: 0 },
      coverage: green.coverage,
      run: {
        halted: false,
        trajectoryComplete: true,
        stageMarkerGaps: 0,
        rejectedReports: 0,
        permissionPrompts: 0,
        autoModeDenials: 0,
        leftoverTasks: 0
      },
      ...evidence
    },
    result: null,
    ...top
  }
}

const SURVIVING_BLOCKER = {
  dimension: 'typescript',
  severity: 'blocker',
  title: 'unchecked null deref on an empty store',
  file: WIDGET_SOURCE,
  votes: { real: 2, notReal: 0, uncited: 0, total: 2 }
}

const pipelineFor = repo => file(`mc-run-pipeline-${repo.sha.slice(0, 7)}.json`, { ...greenFixture().pipeline, sha: repo.sha })

test('--run supplies the review, verification, handoff, coverage and run record, and with a passing pipeline the verdict is MERGE and the exit 0', () => {
  const repo = namedWidgetRepo('mc-run-merge')
  const evidence = file('mc-run-merge-evidence.json', runEvidence(repo))
  const r = run([...baseArgs(repo), '--run', evidence, '--pipeline', pipelineFor(repo), '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.verdict, 'MERGE', JSON.stringify(out.driving.map(d => [d.id, d.band, d.reason]), null, 2))
  assert.deepEqual(out.driving, [], 'nothing stands between this change and MERGE')
  for (const id of ['review.ran', 'review.blockers', 'verify.suite', 'verify.coverage', 'conformance.delta', 'run.integrity', 'spec.coverage', 'ci.pipeline']) {
    assert.equal(signalIn(out, id).band, 'green', `${id}: ${signalIn(out, id).reason}`)
  }
  assert.equal(r.stderr.includes('another commit'), false, 'a usable file is not complained about')
  assert.equal(run([...baseArgs(repo), '--run', evidence, '--pipeline', pipelineFor(repo), '--require-merge']).code, 0, 'MERGE satisfies --require-merge')
})

test('--run without a pipeline reads HUMAN, held by ci.pipeline alone, and exits 0', () => {
  const repo = namedWidgetRepo('mc-run-no-pipeline')
  const out = runJson([...baseArgs(repo), '--run', file('mc-run-no-pipeline-evidence.json', runEvidence(repo))])
  assert.equal(out.verdict, 'HUMAN')
  assert.deepEqual(out.driving.map(d => d.id), ['ci.pipeline'])
})

for (const [label, over, expected] of [
  ['another commit', { headSha: '0'.repeat(40) }, run => [/another commit/, new RegExp(run.sha.slice(0, 7)), /0000000/]],
  ['no commit made', { committed: false }, () => [/commit/i]],
  ['another change', { change: 'some-other-change' }, () => [/some-other-change/, /add-widget-catalogue/]],
  ['another schema', { schema: 'interlock.something-else/9' }, () => [/schema/i]]
]) {
  test(`a --run file for ${label} is refused on stderr, and nothing is taken from it`, () => {
    const repo = namedWidgetRepo(`mc-run-refused-${label.replace(/\W+/g, '-')}`)
    const evidence = file(`mc-run-refused-${label.replace(/\W+/g, '-')}.json`, runEvidence(repo, over))
    const r = run([...baseArgs(repo), '--run', evidence, '--json'])
    assert.equal(r.code, 0, r.stderr)
    for (const pattern of expected(repo)) assert.match(r.stderr, pattern)
    const out = JSON.parse(r.stdout)
    for (const id of ['review.blockers', 'verify.suite', 'run.integrity']) {
      assert.equal(signalIn(out, id).band, 'unobserved', `${id} took something from a refused file: ${signalIn(out, id).reason}`)
    }
    // With no file, review.ran is amber because no review ran; a refused file leaves it there.
    assert.equal(signalIn(out, 'review.ran').band, 'amber', signalIn(out, 'review.ran').reason)
    assert.match(signalIn(out, 'review.ran').reason, /no review ran/i)
    assert.equal(out.verdict, 'HUMAN')
  })
}

test('an explicit --review replaces the evidence file’s review, and the file’s other entries still stand', () => {
  const repo = namedWidgetRepo('mc-run-override')
  const evidence = file('mc-run-override-evidence.json', runEvidence(repo))
  const blocked = file('mc-run-override-review.json', {
    surviving: [SURVIVING_BLOCKER],
    counts: { raised: 1, droppedByPolicy: 0, dismissed: 0, droppedByQuality: 0, surviving: 1, dismissalsRejected: 0 }
  })
  const out = runJson([...baseArgs(repo), '--run', evidence, '--review', blocked], 1)
  assert.equal(out.verdict, 'BLOCK')
  assert.equal(signalIn(out, 'review.blockers').band, 'red')
  assert.equal(signalIn(out, 'verify.suite').band, 'green', 'the verification still comes from the file')
  assert.equal(signalIn(out, 'run.integrity').band, 'green', 'so does the run record')
})

test('a recorded MERGE over a surviving blocker still reads BLOCK, because the file’s result is never read', () => {
  const repo = namedWidgetRepo('mc-run-recorded-merge')
  const green = greenFixture()
  const evidence = file(
    'mc-run-recorded-merge-evidence.json',
    runEvidence(repo, {
      evidence: {
        review: { ...green.review, surviving: [SURVIVING_BLOCKER], counts: { ...green.review.counts, surviving: 1 } }
      },
      result: { verdict: 'MERGE', score: 100, worstBand: 'green', driving: [] }
    })
  )
  const out = runJson([...baseArgs(repo), '--run', evidence, '--pipeline', pipelineFor(repo)], 1)
  assert.equal(out.verdict, 'BLOCK')
  assert.equal(signalIn(out, 'review.blockers').band, 'red')
})

test('an unparseable or missing --run file exits 1 with nothing on stdout and the file named on stderr', () => {
  const repo = namedWidgetRepo('mc-run-unreadable')
  const broken = file('mc-run-broken.json', '{ "schema": ')
  const r = run([...baseArgs(repo), '--run', broken, '--json'])
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '', 'no verdict may be printed for input that could not be read')
  assert.ok(r.stderr.includes(broken), r.stderr)
  assert.doesNotMatch(r.stderr, /\n\s+at /)

  const missing = join(dir, 'mc-run-no-such-evidence.json')
  const absent = run([...baseArgs(repo), '--run', missing, '--json'])
  assert.equal(absent.code, 1)
  assert.equal(absent.stdout, '')
  assert.ok(absent.stderr.includes(missing), absent.stderr)
})

// --- conformance --living ---------------------------------------------------------------

const LIVING_BODY_MARKER = 'LIVING-BODY-MARKER-4471'

/** A living spec with three requirements, each carrying a body the list must not echo. */
const LIVING_WIDGETS_SPEC = [
  '# widgets/catalogue Specification',
  '',
  '## Purpose',
  '',
  'The shop catalogue.',
  '',
  '## Requirements',
  '',
  ...['The store SHALL keep widgets', 'Prices SHALL be whole cents', 'A widget SHALL have one name'].flatMap(title => [
    `### Requirement: ${title}`,
    '',
    `${title}. ${LIVING_BODY_MARKER}`,
    '',
    '#### Scenario: Happy path — holds',
    '',
    '- **GIVEN** a widget',
    '- **WHEN** it is stored',
    '- **THEN** the rule holds',
    ''
  ])
].join('\n')

const LIVING_SPEC_PATH = 'openspec/specs/widgets/catalogue/spec.md'
const livingHeadingLine = title => LIVING_WIDGETS_SPEC.split('\n').findIndex(l => l === `### Requirement: ${title}`) + 1

/**
 * The base commit holds the change and a living spec of three requirements; the
 * head adds the widget source and a fourth requirement to the working-tree spec,
 * so a list read from the base differs from one read from the working tree.
 */
function livingRepo(sub, headExtra = {}) {
  return mergeBaseRepo(
    sub,
    {
      [WIDGET_SOURCE]: 'export const catalogue = () => []\n',
      [LIVING_SPEC_PATH]: `${LIVING_WIDGETS_SPEC}\n### Requirement: Added at the head only\n\nHead text.\n`,
      ...headExtra
    },
    { [LIVING_SPEC_PATH]: LIVING_WIDGETS_SPEC }
  )
}

test('conformance --living lists the delta scenarios C, then the living requirements L, names the base it read, and blocks nothing', () => {
  const repo = livingRepo('cf-living-text')
  const r = run(['conformance', 'add-widget-catalogue', '--root', repo.root, '--living', '--base', repo.base])
  assert.equal(r.code, 0, r.stderr)
  const text = r.stdout
  for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'L1', 'L2', 'L3']) assert.match(text, new RegExp(`\\b${id}\\b`), `${id} is listed`)
  assert.ok(text.indexOf('C5') < text.indexOf('L1'), 'the living entries follow the scenarios')
  assert.doesNotMatch(text, /\bL4\b/, 'the requirement the head added is not in the base')
  assert.ok(text.includes('The store SHALL keep widgets'), text)
  assert.ok(text.includes(`${LIVING_SPEC_PATH}:${livingHeadingLine('The store SHALL keep widgets')}`), text)
  assert.ok(!text.includes(LIVING_BODY_MARKER), 'a requirement body is read at the cited line, never echoed')
  assert.ok(text.includes(repo.base) || text.includes(repo.base.slice(0, 7)), `the source of the living text is named: ${text}`)
  assert.match(text, /Nothing here blocks/)
})

test('conformance --living reads the working tree when no base is named, and says so', () => {
  const repo = livingRepo('cf-living-tree')
  const r = run(['conformance', 'add-widget-catalogue', '--root', repo.root, '--living'])
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /\bL4\b/, 'the working tree carries the fourth requirement')
  assert.match(r.stdout, /working tree/i)
})

test('conformance --living --json carries the living entries, their count, what the bound left out, and the partial reason', () => {
  const repo = livingRepo('cf-living-json')
  const out = runJson(['conformance', 'add-widget-catalogue', '--root', repo.root, '--living', '--base', repo.base])
  assert.equal(out.scenarios.length, SCENARIO_COUNT)
  assert.deepEqual(out.scenarios.map(s => s.id), ['C1', 'C2', 'C3', 'C4', 'C5'])
  const living = out.living
  assert.ok(living && typeof living === 'object', 'the living block is on the checklist')
  assert.deepEqual(living.requirements.map(e => e.id), ['L1', 'L2', 'L3'])
  assert.equal(living.requirementsRequired, 3, 'the count is the list’s own')
  assert.deepEqual(living.omitted, [])
  assert.ok(String(living.source).includes(repo.base) || String(living.source).includes(repo.base.slice(0, 7)), living.source)
  const first = living.requirements[0]
  assert.equal(first.capability, 'widgets/catalogue')
  assert.equal(first.artifact, LIVING_SPEC_PATH)
  assert.equal(first.line, livingHeadingLine('The store SHALL keep widgets'))
  assert.equal(first.title, 'The store SHALL keep widgets')
  assert.ok(!JSON.stringify(out).includes(LIVING_BODY_MARKER), 'no entry carries a requirement body')
  // No graph, one declared capability: built from the declaration, and said so.
  assert.match(String(living.partial), /graph/)
  assert.ok(!living.skipped)
})

test('conformance --living with nothing to select is a spoken skip, and the scenarios are still listed', () => {
  const repo = mergeBaseRepo('cf-living-skipped', { [WIDGET_SOURCE]: 'export {}\n' })
  const r = run(['conformance', 'add-widget-catalogue', '--root', repo.root, '--living', '--base', repo.base, '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.match(String(out.living.skipped), /graph/)
  assert.deepEqual(out.living.requirements ?? [], [])
  assert.equal(out.scenarios.length, SCENARIO_COUNT)
})

test('conformance --living with a base that names no commit reports the list as not built and still exits 0 with the scenarios', () => {
  const repo = livingRepo('cf-living-bad-ref')
  const r = run(['conformance', 'add-widget-catalogue', '--root', repo.root, '--living', '--base', 'no-such-ref-anywhere'])
  assert.equal(r.code, 0, r.stderr)
  for (const id of ['C1', 'C5']) assert.match(r.stdout, new RegExp(`\\b${id}\\b`), `${id} is still listed`)
  assert.doesNotMatch(r.stdout, /\bL1\b/)
  assert.match(r.stdout, /not built/i)
  assert.ok(r.stdout.includes('no-such-ref-anywhere'), 'the reference is named')

  const json = run(['conformance', 'add-widget-catalogue', '--root', repo.root, '--living', '--base', 'no-such-ref-anywhere', '--json'])
  assert.equal(json.code, 0, json.stderr)
  const out = JSON.parse(json.stdout)
  assert.equal(out.scenarios.length, SCENARIO_COUNT)
  assert.deepEqual(out.living.requirements ?? [], [])
  assert.ok(JSON.stringify(out.living).includes('no-such-ref-anywhere'), JSON.stringify(out.living))
})

test('conformance without --living prints what it printed before: no living entry, count or reason, whatever else is given', () => {
  const repo = livingRepo('cf-living-off')
  const keys = ['change', 'changedFiles', 'outsideSpecs', 'reason', 'scenarios', 'skipped', 'verdictsRequired']
  for (const extra of [[], ['--base', repo.base]]) {
    const out = runJson(['conformance', 'add-widget-catalogue', '--root', repo.root, ...extra])
    assert.deepEqual(Object.keys(out).sort(), keys, `the checklist is field for field what it was (${extra.join(' ') || 'no extras'})`)
    const text = run(['conformance', 'add-widget-catalogue', '--root', repo.root, ...extra])
    assert.equal(text.code, 0, text.stderr)
    assert.doesNotMatch(text.stdout, /\bL\d+\b|living/i)
    assert.match(text.stdout, /Nothing here blocks/)
  }
})

// --- merge-confidence reads the living list and the handoff's requirement counts ---------

test('conformance.living is green for every listed requirement confirmed, and amber for a short, an unconfirmed or an absent count', () => {
  const repo = livingRepo('mc-living-counts')
  const read = counts =>
    signalIn(
      runJson([...baseArgs(repo), '--handoff', file(`mc-living-${JSON.stringify(counts).length}-${Object.keys(counts).join('')}.json`, { scenariosChecked: SCENARIO_COUNT, scenariosUnconfirmed: 0, ...counts })]),
      'conformance.living'
    )

  const confirmed = read({ requirementsChecked: 3, requirementsUnconfirmed: 0 })
  assert.equal(confirmed.band, 'green', said(confirmed))
  assert.ok(confirmed.flags.includes('no-graph'), 'built from a declaration alone, and flagged')

  const short = read({ requirementsChecked: 2, requirementsUnconfirmed: 0, requirementsRequired: 2 })
  assert.equal(short.band, 'amber', 'a count the handoff states for itself does not shrink the command’s own')
  assert.ok(said(short).includes('3'), said(short))

  assert.equal(read({ requirementsChecked: 3, requirementsUnconfirmed: 1 }).band, 'amber')
  assert.equal(read({}).band, 'amber', 'a list with no counts reported is not confirmed')

  const none = signalIn(runJson(baseArgs(repo)), 'conformance.living')
  assert.equal(none.band, 'unobserved', 'with no handoff at all there is nothing to read the list against')
})

// --- USAGE ---------------------------------------------------------------------------

test('USAGE names --living and --run, and no longer says that no input can read MERGE', () => {
  const { stdout } = run(['--help'])
  const between = (from, to) => {
    const start = stdout.indexOf(from)
    assert.notEqual(start, -1, `USAGE is missing "${from}"`)
    const end = stdout.indexOf(to, start + from.length)
    return stdout.slice(start, end === -1 ? undefined : end)
  }
  const conformance = between('  interlock conformance', '  interlock domain-context')
  assert.ok(conformance.includes('--living'), conformance)
  assert.ok(conformance.includes('--base'), conformance)
  const mergeConfidence = between('  interlock merge-confidence', '  interlock report')
  assert.ok(mergeConfidence.includes('--run'), mergeConfidence)
  assert.doesNotMatch(stdout, /no input\s+to this version can read MERGE/)
  assert.doesNotMatch(stdout, /read unobserved until their producer lands/)
  // The detail text still tells a reader what an exit of 1 means.
  assert.match(stdout, /Exit 1 alone does not tell the two apart/)
})

test('limits --json carries the merge bands as their own group, ceiling table included', () => {
  const out = runJson(['limits'])
  assert.deepEqual(out.mergeBands, JSON.parse(JSON.stringify(MERGE_BANDS)))
  assert.deepEqual(out.mergeBands.ceiling, { ...MERGE_BANDS.ceiling })
  assert.equal(out.limits.maxWarningsForMerge, undefined, 'the merge bands are not entries of the iteration-count limits')
})

// --- judge-against-base-and-living-specs: the four new commands and the --base flag --
//
// What only the binary can get wrong: which ref a list is read from, that an
// unresolvable ref or a bad baseline ends the command with nothing on stdout,
// that a temporary worktree never outlives the command, and that the verdict's
// new signals are fed from the repository. The pure modules carry their own
// tests (coverage, spec-text, spec-audit, domain-context, review-policy); a
// fixture here is only as large as the wiring needs.
//
// Several JSON field names below (`capabilities`, `via`, `totals`, `flags`,
// `unreadable`, `humanPaths`, `differsFromBase`, `anomalies.requirementCitations`)
// are this file's statement of the CLI contract, taken from the change's design.

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid'
}

function gitAt(root, ...args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_IDENTITY } })
}

/** Write `files` into a checkout and commit them; returns the new commit. */
function commitFiles(root, files, message = 'next') {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  gitAt(root, 'add', '-A')
  gitAt(root, 'commit', '-q', '-m', message)
  return gitAt(root, 'rev-parse', 'HEAD').stdout.trim()
}

/** `git worktree list` rows: one means only the main checkout exists. */
const worktreeCount = root =>
  gitAt(root, 'worktree', 'list', '--porcelain').stdout.split('\n').filter(l => l.startsWith('worktree ')).length

/** An lcov record instrumenting lines 1..n with the given hit counts. */
const lcovRecord = (path, hits) =>
  `SF:${path}\n` +
  hits.map((h, i) => `DA:${i + 1},${h}`).join('\n') +
  `\nLF:${hits.length}\nLH:${hits.filter(h => h > 0).length}\nend_of_record\n`

// --- verify baseline / verify coverage ----------------------------------------

const COVERAGE_ON = { enabled: true, command: 'node cov.mjs', report_path: 'coverage/lcov.info', format: 'lcov' }
const BASELINE_PATH = '.claude/testing/coverage-baseline.json'
// Seven lines, the last unhit: 6 of 7 is 85.7. The diff below adds lines 4 to 7,
// three of them hit: 75 over 4 changed lines.
const HEAD_HITS = [1, 1, 1, 1, 1, 1, 0]

/** Base commit with a three-line lib/a.mjs; the head commit grows it to seven lines. */
function coverageRepo(sub, baseFiles = {}) {
  const repo = gitRepo(sub, { 'lib/a.mjs': 'a1\na2\na3\n', ...baseFiles })
  const head = commitFiles(repo.root, { 'lib/a.mjs': 'a1\na2\na3\na4\na5\na6\na7\n' })
  return { root: repo.root, base: repo.sha, head }
}

function writeProfile(root, coverage) {
  mkdirSync(join(root, '.claude', 'testing'), { recursive: true })
  writeFileSync(
    join(root, '.claude', 'testing', 'profile.json'),
    JSON.stringify({ version: 1, unit: { command: 'npm test', cwd: '.' }, coverage })
  )
}

function writeHeadReport(root, hits = HEAD_HITS) {
  mkdirSync(join(root, 'coverage'), { recursive: true })
  writeFileSync(join(root, 'coverage', 'lcov.info'), lcovRecord('lib/a.mjs', hits))
}

function writeBaseline(root, over = {}) {
  mkdirSync(join(root, '.claude', 'testing'), { recursive: true })
  writeFileSync(
    join(root, BASELINE_PATH),
    JSON.stringify({
      schema: 'interlock.coverage-baseline/1',
      sha: over.sha,
      ref: 'main',
      totalPct: 80,
      generatedAt: '2026-01-01T00:00:00.000Z',
      ...over
    })
  )
}

/** A coverage command committed at the base: it writes a 50 percent report where it runs. */
const covScript = ({ exit = 0, marker = null } = {}) =>
  [
    "import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'",
    marker ? `appendFileSync(${JSON.stringify(marker)}, 'ran\\n')` : '',
    "mkdirSync('coverage', { recursive: true })",
    "writeFileSync('coverage/lcov.info', 'SF:lib/a.mjs\\nLF:10\\nLH:5\\nend_of_record\\n')",
    `process.exit(${exit})`
  ].join('\n') + '\n'

const COVERAGE_INPUT_FIELDS = [
  'baseIsAncestor', 'baseSha', 'baseTotalPct', 'changedLines', 'configured', 'diffPct', 'headTotalPct',
  'unreportedAddedLines', 'unreportedFiles'
]

test('verify baseline records the total of a report on this commit, and refuses a report with none', () => {
  const repo = coverageRepo('cov-baseline-repo')
  const report = file('cov-baseline-report.lcov', lcovRecord('lib/a.mjs', [1, 1, 1, 1, 0]))
  const ok = run(['verify', 'baseline', '--report', report, '--root', repo.root])
  assert.equal(ok.code, 0, ok.stderr)
  const target = join(repo.root, BASELINE_PATH)
  const written = JSON.parse(readFileSync(target, 'utf8'))
  assert.equal(written.schema, 'interlock.coverage-baseline/1')
  assert.equal(written.sha, repo.head, 'the commit the report was taken on')
  assert.equal(written.ref, 'main', 'the branch it was taken on')
  assert.equal(written.totalPct, 80)
  assert.ok(!Number.isNaN(Date.parse(written.generatedAt)), `generatedAt: ${written.generatedAt}`)

  // No instrumented line, and no report at all: exit 1, the previous file untouched.
  const before = readFileSync(target, 'utf8')
  const noTotal = file('cov-baseline-empty.lcov', 'SF:lib/a.mjs\nend_of_record\n')
  const refused = run(['verify', 'baseline', '--report', noTotal, '--root', repo.root])
  assert.equal(refused.code, 1)
  assert.match(refused.stderr, /total/i)
  assert.equal(readFileSync(target, 'utf8'), before, 'a refused write leaves the previous baseline in place')

  const missing = join(dir, 'cov-baseline-no-such.lcov')
  const unreadable = run(['verify', 'baseline', '--report', missing, '--root', repo.root])
  assert.equal(unreadable.code, 1)
  assert.ok(unreadable.stderr.includes(missing), unreadable.stderr)
  assert.equal(readFileSync(target, 'utf8'), before)

  // A named path is written instead of the default one.
  const custom = join(dir, 'cov-baseline-custom.json')
  const named = run(['verify', 'baseline', '--report', report, '--baseline', custom, '--root', repo.root])
  assert.equal(named.code, 0, named.stderr)
  assert.equal(JSON.parse(readFileSync(custom, 'utf8')).totalPct, 80)
  assert.equal(readFileSync(target, 'utf8'), before, 'the default path is not touched when another is named')
})

test('verify coverage prints configured: false, and nothing else, when the profile declares no coverage', () => {
  let n = 0
  for (const coverage of [
    { ...COVERAGE_ON, enabled: false },
    { ...COVERAGE_ON, command: null }
  ]) {
    const repo = coverageRepo(`cov-unconfigured-${n++}`)
    writeProfile(repo.root, coverage)
    const out = runJson(['verify', 'coverage', '--base', repo.base, '--root', repo.root])
    assert.equal(out.configured, false, JSON.stringify(coverage))
    for (const key of ['headTotalPct', 'baseTotalPct', 'baseSha', 'diffPct', 'changedLines']) {
      assert.equal(out[key], null, `${key} is absent, not a measured figure`)
    }
  }
})

test('verify coverage exits 1 with an empty stdout for a missing report, an unsupported format and a corrupt baseline', () => {
  const missing = coverageRepo('cov-missing-report')
  writeProfile(missing.root, COVERAGE_ON)
  const noReport = run(['verify', 'coverage', '--base', missing.base, '--root', missing.root, '--json'])
  assert.equal(noReport.code, 1)
  assert.equal(noReport.stdout, '', 'the verdict reads an unproduced input as unobserved, never as clean')
  assert.ok(noReport.stderr.includes('coverage/lcov.info'), noReport.stderr)
  assert.match(noReport.stderr, /coverage command/)

  const xml = coverageRepo('cov-unsupported-format')
  writeProfile(xml.root, { ...COVERAGE_ON, report_path: 'coverage/cobertura.xml', format: 'cobertura' })
  mkdirSync(join(xml.root, 'coverage'), { recursive: true })
  writeFileSync(join(xml.root, 'coverage', 'cobertura.xml'), '<coverage/>\n')
  const unsupported = run(['verify', 'coverage', '--base', xml.base, '--root', xml.root, '--json'])
  assert.equal(unsupported.code, 1)
  assert.equal(unsupported.stdout, '')
  assert.ok(unsupported.stderr.includes('coverage/cobertura.xml'), unsupported.stderr)
  assert.match(unsupported.stderr, /lcov/, 'it names the one supported format')

  let n = 0
  for (const corrupt of [{ schema: undefined }, { totalPct: 101 }, { totalPct: 'high' }]) {
    const repo = coverageRepo(`cov-corrupt-baseline-${n++}`)
    writeProfile(repo.root, COVERAGE_ON)
    writeHeadReport(repo.root)
    writeBaseline(repo.root, { sha: repo.base, ...corrupt })
    const r = run(['verify', 'coverage', '--base', repo.base, '--root', repo.root, '--json'])
    assert.equal(r.code, 1, JSON.stringify(corrupt))
    assert.equal(r.stdout, '', 'a corrupt baseline is never read as no baseline')
    assert.ok(r.stderr.includes('coverage-baseline.json'), r.stderr)
  }
})

test('verify coverage dies without --base, and on a ref that names no commit', () => {
  const repo = coverageRepo('cov-needs-base')
  writeProfile(repo.root, COVERAGE_ON)
  writeHeadReport(repo.root)

  const none = run(['verify', 'coverage', '--root', repo.root, '--json'])
  assert.equal(none.code, 1)
  assert.equal(none.stdout, '', 'the diff is the base: without it the reader would be handed changedLines: null')
  assert.match(none.stderr, /--base/)
  assert.match(none.stderr, /required/)

  const bad = run(['verify', 'coverage', '--base', 'no-such-ref-anywhere', '--root', repo.root, '--json'])
  assert.equal(bad.code, 1)
  assert.equal(bad.stdout, '')
  assert.match(bad.stderr, /no-such-ref-anywhere/)
})

test('verify coverage prints exactly the nine fields the merge verdict reads, from the report, the baseline and the diff', () => {
  const repo = coverageRepo('cov-happy')
  writeProfile(repo.root, COVERAGE_ON)
  writeHeadReport(repo.root)
  writeBaseline(repo.root, { sha: repo.base })
  const r = run(['verify', 'coverage', '--base', repo.base, '--root', repo.root, '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(Object.keys(out).sort(), COVERAGE_INPUT_FIELDS, 'figures only: no band, no verdict')
  assert.deepEqual(out, {
    configured: true,
    headTotalPct: 85.7,
    baseTotalPct: 80,
    baseSha: repo.base,
    baseIsAncestor: true,
    diffPct: 75,
    changedLines: 4,
    // Every changed source file is in the report: an empty list, stated.
    unreportedFiles: [],
    unreportedAddedLines: 0
  })
})

// A changed source file the report holds no record for (design D13 of
// label-and-harden-the-merge-verdict). The head commit adds both files; the
// report still lists lib/a.mjs alone.
test('verify coverage names a new source file the report does not list, with its added lines, and leaves the figures alone', () => {
  const repo = coverageRepo('cov-unreported')
  const forty = Array.from({ length: 40 }, (_, i) => `export const line${i} = ${i}`).join('\n') + '\n'
  commitFiles(repo.root, { 'lib/fresh.mjs': forty, 'test/fresh.test.mjs': "import '../lib/fresh.mjs'\n", 'docs/fresh.md': '# fresh\n' })
  writeProfile(repo.root, COVERAGE_ON)
  writeHeadReport(repo.root)
  const out = runJson(['verify', 'coverage', '--base', repo.base, '--root', repo.root])
  assert.deepEqual(Object.keys(out).sort(), COVERAGE_INPUT_FIELDS)
  assert.deepEqual(out.unreportedFiles, ['lib/fresh.mjs'], 'the source file only: a test and a document are never listed')
  assert.equal(out.unreportedAddedLines, 40)
  // What the report did measure is what it was without that file.
  assert.equal(out.diffPct, 75)
  assert.equal(out.changedLines, 4)

  // The text form says it too.
  const text = run(['verify', 'coverage', '--base', repo.base, '--root', repo.root])
  assert.equal(text.code, 0, text.stderr)
  assert.ok(text.stdout.includes('lib/fresh.mjs'), text.stdout)
})

test('verify coverage lists no test file the report lacks, and prints both unreported fields as null with no coverage configured', () => {
  const repo = coverageRepo('cov-unreported-test-only')
  commitFiles(repo.root, { 'test/fresh.test.mjs': 'export {}\n' })
  writeProfile(repo.root, COVERAGE_ON)
  writeHeadReport(repo.root)
  const out = runJson(['verify', 'coverage', '--base', repo.base, '--root', repo.root])
  assert.deepEqual(out.unreportedFiles, [])
  assert.equal(out.unreportedAddedLines, 0)

  const bare = coverageRepo('cov-unreported-not-configured')
  commitFiles(bare.root, { 'lib/fresh.mjs': 'export {}\n' })
  const none = runJson(['verify', 'coverage', '--base', bare.base, '--root', bare.root])
  assert.deepEqual(Object.keys(none).sort(), COVERAGE_INPUT_FIELDS)
  assert.equal(none.configured, false)
  assert.equal(none.unreportedFiles, null)
  assert.equal(none.unreportedAddedLines, null)
})

test('verify coverage with no baseline anywhere leaves every base field empty and still judges the changed lines', () => {
  const repo = coverageRepo('cov-no-baseline')
  writeProfile(repo.root, COVERAGE_ON)
  writeHeadReport(repo.root)
  const out = runJson(['verify', 'coverage', '--base', repo.base, '--root', repo.root])
  assert.equal(out.configured, true)
  assert.equal(out.headTotalPct, 85.7)
  assert.equal(out.diffPct, 75)
  assert.equal(out.changedLines, 4)
  assert.equal(out.baseTotalPct, null)
  assert.equal(out.baseSha, null)
  assert.ok(out.baseIsAncestor === null || out.baseIsAncestor === false, `baseIsAncestor: ${out.baseIsAncestor}`)
})

test('verify coverage reports whether the baseline commit is an ancestor of HEAD, whatever its age, from the repository', () => {
  const repo = coverageRepo('cov-ancestry')
  // A sibling branch the head does not descend from.
  gitAt(repo.root, 'checkout', '-q', '-b', 'sibling', repo.base)
  const sibling = commitFiles(repo.root, { 'lib/sibling.mjs': 's\n' })
  gitAt(repo.root, 'checkout', '-q', 'main')
  writeProfile(repo.root, COVERAGE_ON)
  writeHeadReport(repo.root)

  writeBaseline(repo.root, { sha: repo.base })
  const onHistory = runJson(['verify', 'coverage', '--base', repo.base, '--root', repo.root])
  assert.equal(onHistory.baseSha, repo.base)
  assert.equal(onHistory.baseIsAncestor, true)

  writeBaseline(repo.root, { sha: sibling })
  const elsewhere = runJson(['verify', 'coverage', '--base', repo.base, '--root', repo.root])
  assert.equal(elsewhere.baseSha, sibling, 'the baseline is still named, so the verdict can say why it is unobserved')
  assert.equal(elsewhere.baseIsAncestor, false)
})

test('verify coverage --compute-base records a baseline for the merge base and leaves no worktree behind', () => {
  const repo = coverageRepo('cov-compute-base', { 'cov.mjs': covScript() })
  writeProfile(repo.root, COVERAGE_ON)
  writeHeadReport(repo.root)

  const r = run(['verify', 'coverage', '--base', repo.base, '--compute-base', '--root', repo.root, '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.baseTotalPct, 50, 'the coverage command ran on the merge base, not on the head')
  assert.equal(out.baseSha, repo.base)
  assert.equal(out.baseIsAncestor, true)
  assert.match(r.stderr, /baseline/i, 'it says it recorded one')

  const recorded = JSON.parse(readFileSync(join(repo.root, BASELINE_PATH), 'utf8'))
  assert.equal(recorded.sha, repo.base)
  assert.equal(recorded.totalPct, 50)
  assert.equal(worktreeCount(repo.root), 1, gitAt(repo.root, 'worktree', 'list').stdout)
})

test('verify coverage --compute-base exits 1 naming the command and its status, and cleans up after a failing run', () => {
  const repo = coverageRepo('cov-compute-base-fails', { 'cov.mjs': covScript({ exit: 3 }) })
  writeProfile(repo.root, COVERAGE_ON)
  writeHeadReport(repo.root)

  const r = run(['verify', 'coverage', '--base', repo.base, '--compute-base', '--root', repo.root, '--json'])
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.ok(r.stderr.includes('node cov.mjs'), r.stderr)
  assert.match(r.stderr, /\b3\b/, 'the exit status')
  assert.equal(worktreeCount(repo.root), 1, 'the worktree is removed whether the command passed or not')
  assert.equal(existsSync(join(repo.root, BASELINE_PATH)), false, 'a failed measurement records nothing')
})

test('verify coverage --compute-base creates no worktree and runs no command when a usable baseline exists', () => {
  const marker = join(dir, 'cov-compute-marker.txt')
  const repo = coverageRepo('cov-compute-base-usable', { 'cov.mjs': covScript({ marker }) })
  writeProfile(repo.root, COVERAGE_ON)
  writeHeadReport(repo.root)
  writeBaseline(repo.root, { sha: repo.base, totalPct: 80 })

  const out = runJson(['verify', 'coverage', '--base', repo.base, '--compute-base', '--root', repo.root])
  assert.equal(existsSync(marker), false, 'the coverage command ran')
  assert.equal(out.baseTotalPct, 80, 'the existing baseline is the base figure')
  assert.equal(out.baseSha, repo.base)
  assert.equal(worktreeCount(repo.root), 1)
})

// --- review / review-policy --base --------------------------------------------

/** A checkout whose first commit may hold a REVIEW.md, tagged `policy-base`. */
function policyRepo(sub, committed, extra = {}) {
  const repo = gitRepo(sub, {
    'lib/a.mjs': 'a\n',
    'dist/x.js': 'x\n',
    ...(committed === null ? {} : { 'REVIEW.md': committed }),
    ...extra
  })
  gitAt(repo.root, 'tag', 'policy-base')
  return repo
}

const POLICY_FINDINGS = [
  { dimension: 'typescript', severity: 'blocker', title: 'lib blocker', file: 'lib/a.mjs' },
  { dimension: 'typescript', severity: 'blocker', title: 'dist blocker', file: 'dist/x.js' }
]

/** Two real votes per title: survival is decided by the lists, not by the vote. */
const realVerdicts = titles =>
  titles.flatMap(findingTitle => [
    { findingTitle, isReal: true, refinedSeverity: 'blocker', qualityScore: 9 },
    { findingTitle, isReal: true, qualityScore: 8 }
  ])

const reviewArgs = (repo, findings, ...extra) => [
  'review',
  '--findings', file(`rb-findings-${repo.root.split('/').pop()}.json`, findings),
  '--verdicts', file(`rb-verdicts-${repo.root.split('/').pop()}.json`, realVerdicts(findings.map(f => f.title))),
  '--root', repo.root,
  ...extra
]

test('review --base applies the exclusions committed at the ref, not the ones the working tree adds', () => {
  const repo = policyRepo('rb-lists', '## Do Not Report\n- dist/\n')
  writeFileSync(join(repo.root, 'REVIEW.md'), '## Do Not Report\n- dist/\n- lib/\n')

  const out = JSON.parse(run([...reviewArgs(repo, POLICY_FINDINGS, '--base', 'policy-base'), '--json']).stdout)
  assert.deepEqual(out.surviving.map(f => f.title), ['lib blocker'], 'a pull request cannot exclude its own paths')
  assert.deepEqual(out.droppedByPolicy.map(f => f.title), ['dist blocker'])

  const text = run(reviewArgs(repo, POLICY_FINDINGS, '--base', 'policy-base'))
  assert.equal(text.code, 0, text.stderr)
  assert.match(text.stdout, /differs/i)
  assert.ok(text.stdout.includes('policy-base'), 'it names the reference whose lists were applied')

  // Without a base, the working tree is read exactly as before.
  const plain = JSON.parse(run([...reviewArgs(repo, POLICY_FINDINGS), '--json']).stdout)
  assert.deepEqual(plain.surviving, [], 'the working-tree exclusion applies when no base is given')
})

test('review --base says nothing about a copy that matches the ref, or differs only in line endings', () => {
  const same = policyRepo('rb-same', '## Do Not Report\n- dist/\n')
  const r = run(reviewArgs(same, POLICY_FINDINGS, '--base', 'policy-base'))
  assert.equal(r.code, 0, r.stderr)
  assert.doesNotMatch(r.stdout, /differs/i)
  // The absence of a sentence proves nothing on its own: the policy read says it, as a fact.
  const asked = ['review-policy', '--base', 'policy-base', '--json']
  assert.equal(JSON.parse(run([...asked, '--root', same.root]).stdout).differsFromBase, false)

  const crlf = policyRepo('rb-crlf', '## Do Not Report\r\n- dist/\r\n')
  writeFileSync(join(crlf.root, 'REVIEW.md'), '## Do Not Report\n- dist/\n')
  const c = run(reviewArgs(crlf, POLICY_FINDINGS, '--base', 'policy-base'))
  assert.equal(c.code, 0, c.stderr)
  assert.doesNotMatch(c.stdout, /differs/i, 'a line-ending difference is not a difference')
  assert.equal(JSON.parse(run([...asked, '--root', crlf.root]).stdout).differsFromBase, false)
})

test('review --base with no REVIEW.md at the ref declares no lists, reports no problem, and says the working copy differs', () => {
  const repo = policyRepo('rb-absent', null)
  writeFileSync(join(repo.root, 'REVIEW.md'), '## Do Not Report\n- lib/\n')
  const r = run([...reviewArgs(repo, POLICY_FINDINGS, '--base', 'policy-base'), '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.counts.droppedByPolicy, 0, 'the working copy’s exclusion is not applied')
  assert.deepEqual(out.policyProblems, [])
  assert.match(run(reviewArgs(repo, POLICY_FINDINGS, '--base', 'policy-base')).stdout, /differs/i)
})

test('review --base and review-policy --base refuse a ref that names no commit and a ref that reads as an option', () => {
  const repo = policyRepo('rb-bad-ref', '## Do Not Report\n- dist/\n')
  for (const head of [reviewArgs(repo, POLICY_FINDINGS), ['review-policy', '--root', repo.root]]) {
    const bad = run([...head, '--base', 'no-such-ref-anywhere', '--json'])
    assert.equal(bad.code, 1, head[0])
    assert.equal(bad.stdout, '', 'no review result is printed')
    assert.match(bad.stderr, /no-such-ref-anywhere/)

    const option = run([...head, '--base', '-p', '--json'])
    assert.equal(option.code, 1, head[0])
    assert.equal(option.stdout, '')
    assert.match(option.stderr, /must name a ref/)

    const valueless = run([...head, '--base'])
    assert.equal(valueless.code, 1, head[0])
    assert.match(valueless.stderr, /--base needs a ref/)
  }
})

const TOOL_GUARDS_SPEC = [
  '# hooks/tool-guards Specification',
  '',
  '## Purpose',
  '',
  'Guards.',
  '',
  '## Requirements',
  '',
  '### Requirement: Every guard SHALL fail open',
  '',
  'A guard SHALL allow on anything it cannot establish.',
  '',
  '#### Scenario: Happy path — an unknown stage',
  '',
  '- **GIVEN** an unknown stage',
  '- **WHEN** the guard runs',
  '- **THEN** it allows',
  ''
].join('\n')

test('review --base checks a requirement citation at the ref, reports a failed one, and still adjudicates the finding', () => {
  const repo = policyRepo('rb-citations', null, { 'openspec/specs/hooks/tool-guards/spec.md': TOOL_GUARDS_SPEC })
  // The working tree gains a requirement the ref does not have.
  writeFileSync(
    join(repo.root, 'openspec/specs/hooks/tool-guards/spec.md'),
    `${TOOL_GUARDS_SPEC}\n### Requirement: Working tree only SHALL not be citable at the ref\n\nText.\n`
  )
  const cite = heading => `openspec/specs/hooks/tool-guards/spec.md#${heading}`
  const findings = [
    { dimension: 'domain', severity: 'blocker', title: 'cites a real requirement', file: 'lib/a.mjs', requirement: cite('Every guard SHALL fail open') },
    { dimension: 'domain', severity: 'blocker', title: 'cites a requirement only the working tree has', file: 'lib/a.mjs', requirement: cite('Working tree only SHALL not be citable at the ref') },
    { dimension: 'domain', severity: 'blocker', title: 'cites outside the living specs', file: 'lib/a.mjs', requirement: 'openspec/changes/x/specs/a/spec.md#A requirement' }
  ]

  const r = run([...reviewArgs(repo, findings, '--base', 'policy-base'), '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(
    out.anomalies.requirementCitations.map(a => a.title).sort(),
    ['cites a requirement only the working tree has', 'cites outside the living specs'],
    'a valid citation is accepted silently'
  )
  for (const anomaly of out.anomalies.requirementCitations) {
    assert.ok(anomaly.requirement && anomaly.problem, JSON.stringify(anomaly))
  }
  assert.equal(out.counts.surviving, 3, 'a broken citation never drops a finding')
  assert.match(run(reviewArgs(repo, findings, '--base', 'policy-base')).stdout, /ANOMALY.*requirement/i)

  // Without a base the citation is checked against the working tree.
  const plain = JSON.parse(run([...reviewArgs(repo, findings), '--json']).stdout)
  assert.deepEqual(plain.anomalies.requirementCitations.map(a => a.title), ['cites outside the living specs'])
})

test('review reports a domain blocker that cites no requirement, still adjudicates it, and stays quiet about a domain warning', () => {
  const repo = policyRepo('rb-domain-blocker', null)
  const findings = [
    { dimension: 'domain', severity: 'blocker', title: 'contradiction with no citation', file: 'lib/a.mjs' },
    { dimension: 'domain', severity: 'warning', title: 'unspecified behaviour', file: 'lib/a.mjs' }
  ]
  const out = JSON.parse(run([...reviewArgs(repo, findings), '--json']).stdout)
  assert.deepEqual(out.anomalies.requirementCitations.map(a => a.title), ['contradiction with no citation'])
  assert.match(out.anomalies.requirementCitations[0].problem, /cites no requirement/)
  assert.equal(out.counts.surviving, 2, 'the blocker is adjudicated, not dropped or re-banded')
})

test('review-policy --base prints the always-human-review list from the ref beside the exclusions, and the prose from the working tree', () => {
  const repo = policyRepo(
    'rp-human',
    '## Do Not Report\n- dist/\n\n## Always Human Review\n- lib/release/\n- ./.github/workflows\n'
  )
  writeFileSync(
    join(repo.root, 'REVIEW.md'),
    '## What "Important" means\nData loss only.\n\n## Do Not Report\n- dist/\n\n## Always Human Review\n- docs/\n'
  )

  const out = JSON.parse(run(['review-policy', '--base', 'policy-base', '--root', repo.root, '--json']).stdout)
  assert.deepEqual(out.humanPaths, ['lib/release', '.github/workflows'], 'canonical form, read from the ref')
  assert.deepEqual(out.excludePaths, ['dist'])
  assert.match(out.prose, /Data loss only/, 'the prose is the working tree’s')
  assert.equal(out.differsFromBase, true)

  const text = run(['review-policy', '--base', 'policy-base', '--root', repo.root])
  assert.equal(text.code, 0, text.stderr)
  assert.match(text.stdout, /human-review:.*lib\/release/)
  assert.ok(text.stdout.includes('policy-base'), text.stdout)

  const working = JSON.parse(run(['review-policy', '--root', repo.root, '--json']).stdout)
  assert.deepEqual(working.humanPaths, ['docs'], 'without a base both lists come from the working tree, as before')
})

// --- merge-confidence --base: policy.humanPaths ---------------------------------

const said = signal => [signal.reason, ...(signal.evidence || [])].join('\n')

/** The base commit carries `policy`; the head commit adds `changed`. */
function humanPathsRepo(sub, policy, changed) {
  const files = Object.fromEntries(changed.map(p => [p, 'export {}\n']))
  return mergeBaseRepo(sub, files, policy === null ? {} : { 'REVIEW.md': policy })
}

const humanPathsRun = (repo, changed, ...extra) =>
  runJson(
    ['merge-confidence', 'add-widget-catalogue', '--root', repo.root, '--base', repo.base, '--changed', changed.join(','), ...extra],
    0
  )

test('policy.humanPaths is green when no listed path is touched and the policy is unchanged, and names the ref it read', () => {
  const changed = ['src/widgets/catalogue.ts']
  const repo = humanPathsRepo('mc-human-green', '## Always Human Review\n- lib/release/\n', changed)
  const signal = signalIn(humanPathsRun(repo, changed), 'policy.humanPaths')
  assert.equal(signal.band, 'green', said(signal))
  assert.deepEqual(signal.flags, [])
  assert.ok(
    said(signal).includes(repo.base) || said(signal).includes(repo.base.slice(0, 7)),
    `evidence names the reference: ${said(signal)}`
  )
})

test('policy.humanPaths is amber, for a person, naming a touched path and the listed path it falls under; the verdict is HUMAN', () => {
  const changed = ['src/widgets/catalogue.ts', 'lib/release/publish.mjs']
  const repo = humanPathsRepo('mc-human-touched', '## Always Human Review\n- lib/release/\n', changed)
  const out = humanPathsRun(repo, changed)
  const signal = signalIn(out, 'policy.humanPaths')
  assert.equal(signal.band, 'amber', said(signal))
  assert.equal(signal.kind, 'person')
  assert.ok(said(signal).includes('lib/release/publish.mjs'), said(signal))
  assert.match(said(signal), /lib\/release(?![\w.]|\/\w)/, `the listed path itself is named: ${said(signal)}`)
  assert.equal(out.verdict, 'HUMAN')
})

test('policy.humanPaths is amber naming REVIEW.md when the working copy differs from the base, and run.integrity does not move', () => {
  const changed = ['src/widgets/catalogue.ts', 'lib/release/publish.mjs']
  const policy = '## Always Human Review\n- lib/release/\n'
  const untouched = humanPathsRepo('mc-human-policy-same', policy, changed)
  const edited = humanPathsRepo('mc-human-policy-edited', policy, changed)
  writeFileSync(join(edited.root, 'REVIEW.md'), '## Always Human Review\n- docs/\n')

  const signal = signalIn(humanPathsRun(edited, changed), 'policy.humanPaths')
  assert.equal(signal.band, 'amber', said(signal))
  assert.equal(signal.kind, 'person')
  assert.ok(said(signal).includes('REVIEW.md'), said(signal))
  assert.ok(said(signal).includes('lib/release/publish.mjs'), 'the listed path from the base is still enforced')

  const pick = out => {
    const { band, kind, reason } = signalIn(out, 'run.integrity')
    return { band, kind, reason }
  }
  assert.deepEqual(pick(humanPathsRun(edited, changed)), pick(humanPathsRun(untouched, changed)))
})

test('policy.humanPaths is amber naming the problem when the committed section could not be read in full', () => {
  const changed = ['src/widgets/catalogue.ts']
  const repo = humanPathsRepo('mc-human-unreadable', '## Always Human Review\n- ../outside\n- lib/release/\n', changed)
  const signal = signalIn(humanPathsRun(repo, changed), 'policy.humanPaths')
  assert.equal(signal.band, 'amber', said(signal))
  assert.equal(signal.kind, 'person')
  assert.ok(said(signal).includes('../outside'), said(signal))
})

test('policy.humanPaths matches on the canonical path: ./lib/release covers lib/release/a.mjs and not lib/releasex/a.mjs', () => {
  const policy = '## Always Human Review\n- ./lib/release\n'
  const inside = ['lib/release/a.mjs']
  const beside = ['lib/releasex/a.mjs']
  assert.equal(signalIn(humanPathsRun(humanPathsRepo('mc-human-canon-in', policy, inside), inside), 'policy.humanPaths').band, 'amber')
  const other = signalIn(humanPathsRun(humanPathsRepo('mc-human-canon-out', policy, beside), beside), 'policy.humanPaths')
  assert.equal(other.band, 'green', said(other))
})

test('policy.humanPaths is green when the base has no REVIEW.md, and unobserved, for want of a base, without --base', () => {
  const changed = ['src/widgets/catalogue.ts']
  const absent = humanPathsRepo('mc-human-absent', null, changed)
  const green = signalIn(humanPathsRun(absent, changed), 'policy.humanPaths')
  assert.equal(green.band, 'green', said(green))

  const r = run(['merge-confidence', 'add-widget-catalogue', '--root', absent.root, '--changed', changed.join(','), '--json'])
  assert.equal(r.code, 0, r.stderr)
  const none = signalIn(JSON.parse(r.stdout), 'policy.humanPaths')
  assert.equal(none.band, 'unobserved')
  assert.match(none.reason, /no --base/)
})

// --- domain-context -------------------------------------------------------------

const GUARD_COMMIT = 'hooks/guard-commit.mjs'

function writeGraph(root, links) {
  mkdirSync(join(root, '.claude', 'graph'), { recursive: true })
  writeFileSync(
    join(root, '.claude', 'graph', 'graph.json'),
    JSON.stringify({ graph: { built_at: '2026-01-01T00:00:00Z' }, nodes: [], links })
  )
}

const specEdge = (spec, target, weight = 1) => ({
  source: `openspec:${spec}`,
  target: `file:${target}`,
  relation: 'implements_spec',
  confidence: 'INFERRED',
  source_file: spec,
  weight
})

const TOOL_GUARDS_PATH = 'openspec/specs/hooks/tool-guards/spec.md'

function domainRepo(sub, extra = {}) {
  return gitRepo(sub, {
    [TOOL_GUARDS_PATH]: TOOL_GUARDS_SPEC,
    [GUARD_COMMIT]: 'export {}\n',
    'lib/other.mjs': 'export {}\n',
    ...extra
  })
}

test('domain-context prints a selected capability, the file that linked it, and the text read at the reference', () => {
  const repo = domainRepo('dc-selected')
  writeGraph(repo.root, [specEdge(TOOL_GUARDS_PATH, GUARD_COMMIT)])
  // The working tree gains a requirement the reference does not have.
  writeFileSync(join(repo.root, TOOL_GUARDS_PATH), `${TOOL_GUARDS_SPEC}\n### Requirement: Working tree only\n\nText SHALL.\n`)

  const r = run(['domain-context', '--changed', GUARD_COMMIT, '--base', repo.sha, '--root', repo.root, '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.selected, true)
  assert.equal(out.capabilities.length, 1)
  assert.equal(out.capabilities[0].capability, 'hooks/tool-guards')
  assert.equal(out.capabilities[0].via, 'linked')
  assert.deepEqual(out.capabilities[0].files, [GUARD_COMMIT])
  assert.equal(out.ref, repo.sha, 'the reference the text was read from')
  assert.ok(out.text.includes('Every guard SHALL fail open'), out.text)
  assert.ok(!out.text.includes('Working tree only'), 'the base is read at the reference, not the working tree')

  const text = run(['domain-context', '--changed', GUARD_COMMIT, '--base', repo.sha, '--root', repo.root])
  assert.equal(text.code, 0, text.stderr)
  assert.ok(text.stdout.includes('hooks/tool-guards'), text.stdout)
})

test('domain-context with no graph and nothing declared exits 0 with a spoken skip, naming the working tree as its base', () => {
  const repo = domainRepo('dc-skipped')
  const r = run(['domain-context', '--changed', 'lib/other.mjs', '--root', repo.root, '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.selected, false)
  assert.match(JSON.stringify(out.skipped), /no graph/)
  assert.match(JSON.stringify(out), /working tree/i)
})

test('domain-context with no graph selects what the change declares and says the touched files were not mapped', () => {
  const repo = domainRepo('dc-declared', {
    'openspec/changes/tighten-guards/specs/hooks/tool-guards/spec.md': [
      '## MODIFIED Requirements',
      '',
      '### Requirement: Every guard SHALL fail open',
      '',
      'A guard SHALL allow on anything it cannot establish, including its own crash.',
      ''
    ].join('\n')
  })
  const r = run(['domain-context', 'tighten-guards', '--changed', 'lib/unmapped.mjs', '--root', repo.root, '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.selected, true)
  assert.equal(out.capabilities[0].capability, 'hooks/tool-guards')
  assert.equal(out.capabilities[0].via, 'declared')
  assert.match(JSON.stringify(out.partial), /graph/)
})

test('domain-context with a graph that links nothing is not selected, not skipped, and records the unlinked paths', () => {
  const repo = domainRepo('dc-unlinked')
  writeGraph(repo.root, [specEdge(TOOL_GUARDS_PATH, GUARD_COMMIT), specEdge(TOOL_GUARDS_PATH, 'lib/half.mjs', 0.5)])
  const r = run(['domain-context', '--changed', 'lib/other.mjs,lib/half.mjs', '--root', repo.root, '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.selected, false, 'a half-weight edge selects nothing')
  assert.ok(!out.skipped, 'an unlinked file is a gap the audit measures, not a review that degraded')
  assert.match(JSON.stringify(out.notSelected), /lib\/other\.mjs/)
})

test('domain-context exits 1 with an empty stdout on a base that names no commit', () => {
  const repo = domainRepo('dc-bad-ref')
  writeGraph(repo.root, [specEdge(TOOL_GUARDS_PATH, GUARD_COMMIT)])
  const r = run(['domain-context', '--changed', GUARD_COMMIT, '--base', 'no-such-ref-anywhere', '--root', repo.root, '--json'])
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /no-such-ref-anywhere/)
})

// --- spec-audit -----------------------------------------------------------------

const AUDIT_ALPHA = [
  '## Purpose',
  '',
  'Alpha.',
  '',
  '## Requirements',
  '',
  '### Requirement: Alpha SHALL list things',
  '',
  'Alpha SHALL list things and SHALL NOT drop one.',
  '',
  '#### Scenario: Happy path — lists',
  '',
  '- **GIVEN** things',
  '- **WHEN** listed',
  '- **THEN** all appear',
  '',
  '#### Scenario: Failure — a bad thing',
  '',
  '- **GIVEN** a bad thing',
  '- **WHEN** listed',
  '- **THEN** it is reported',
  '',
  '#### Scenario: Edge case — no things',
  '',
  '- **GIVEN** no things',
  '- **WHEN** listed',
  '- **THEN** none appear',
  '',
  '### Requirement: Alpha SHALL answer',
  '',
  'Alpha SHALL answer.',
  ''
].join('\n')

const AUDIT_BETA = [
  '## Purpose',
  '',
  'Beta.',
  '',
  '## Requirements',
  '',
  '### Requirement: Beta SHALL do a thing',
  '',
  'Beta SHALL do a thing.',
  '',
  '#### Scenario: Happy path — does it',
  '',
  '- **GIVEN** x',
  '- **WHEN** y',
  '- **THEN** z',
  ''
].join('\n')

function auditRepo(sub, specs) {
  const root = join(dir, sub)
  mkdirSync(root, { recursive: true })
  for (const [capability, text] of Object.entries(specs)) {
    mkdirSync(join(root, 'openspec', 'specs', capability), { recursive: true })
    writeFileSync(join(root, 'openspec', 'specs', capability, 'spec.md'), text)
  }
  return root
}

test('spec-audit exits 0 with no openspec/specs, and says no living spec exists instead of reporting zeros', () => {
  const root = join(dir, 'audit-empty')
  mkdirSync(root, { recursive: true })
  for (const args of [[], ['--json']]) {
    const r = run(['spec-audit', '--root', root, ...args])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /no living spec/i)
  }
  const out = runJson(['spec-audit', '--root', root])
  assert.equal(out.totals?.requirements ?? null, null, 'absent, not zero')
  assert.equal(out.totals?.scenarios ?? null, null)
  assert.deepEqual(out.capabilities ?? [], [])
})

test('spec-audit exits 0 on a corpus with flagged capabilities, and --json carries per-capability entries and totals', () => {
  const root = auditRepo('audit-corpus', { 'alpha/one': AUDIT_ALPHA, 'beta/two': AUDIT_BETA })
  const text = run(['spec-audit', '--root', root])
  assert.equal(text.code, 0, 'an audit that failed a build would be a gate by accident')

  const r = run(['spec-audit', '--root', root, '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  const alpha = out.capabilities.find(c => c.capability === 'alpha/one')
  const beta = out.capabilities.find(c => c.capability === 'beta/two')
  assert.equal(alpha.requirements, 2)
  assert.equal(alpha.scenarios, 3)
  assert.deepEqual(alpha.flags, [], 'one bound line, a Failure scenario and an Edge case scenario')
  assert.equal(beta.requirements, 1)
  assert.equal(beta.scenarios, 1)
  assert.deepEqual([...beta.flags].sort(), ['no-bound', 'no-edge-case', 'no-failure-scenario'])
  assert.equal(out.totals.requirements, 3)
  assert.equal(out.totals.scenarios, 4)
  assert.equal(out.totals.specs, 2)
  // No graph was built: the link measures are absent with a reason, not zero.
  assert.match(JSON.stringify(out), /no graph/i)
})

test('spec-audit names a spec it cannot read, leaves it out of the totals, and still exits 0', { skip: isRoot() }, () => {
  const root = auditRepo('audit-unreadable', { 'alpha/one': AUDIT_ALPHA, 'beta/two': AUDIT_BETA })
  const locked = join(root, 'openspec', 'specs', 'beta', 'two', 'spec.md')
  chmodSync(locked, 0o000)
  try {
    const r = run(['spec-audit', '--root', root, '--json'])
    assert.equal(r.code, 0, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.unreadable.length, 1)
    assert.ok(out.unreadable[0].path.includes('beta/two'), JSON.stringify(out.unreadable))
    assert.ok(out.unreadable[0].reason)
    assert.equal(out.totals.specs, 1, 'the totals say how many specs they cover')
    assert.equal(out.totals.requirements, 2)
  } finally {
    chmodSync(locked, 0o600)
  }
})

// =============================================================================
// A findings input with no findings list (label-and-harden-the-merge-verdict,
// design D10): `gate`, `review` and `remediate` exit 1 with the reason on
// stderr and nothing on stdout, as they do for a file they cannot read.
// =============================================================================

const LISTED_BLOCKER = {
  dimension: 'language',
  severity: 'blocker',
  file: 'lib/a.mjs',
  title: 'the loop drops the last row',
  description: 'off by one in the loop bound'
}

for (const [label, argv] of [
  ['gate', path => ['gate', '--findings', path]],
  ['review', path => ['review', '--findings', path, '--verdicts', file('nfl-verdicts.json', [])]],
  ['remediate', path => ['remediate', '--findings', path]]
]) {
  test(`${label} refuses an input that carries no findings list: exit 1, the reason on stderr, nothing on stdout`, () => {
    for (const [name, body] of [
      ['empty-object', {}],
      ['other-keys', { summary: 'nothing to report', counts: { blocker: 0 } }],
      ['a-number', 7],
      // `file` writes a string as it is, so the JSON string is spelt with its quotes.
      ['a-string', '"clean"']
    ]) {
      const path = file(`nfl-${label}-${name}.json`, body)
      for (const json of [[], ['--json']]) {
        const r = run([...argv(path), ...json])
        assert.equal(r.code, 1, `${label} ${name} ${json.join('')}: ${r.stdout}`)
        assert.equal(r.stdout, '', `${label} ${name}: stdout must be empty`)
        assert.ok(r.stderr.includes('no findings list'), r.stderr)
      }
    }
  })
}

test('gate handed the record interlock review --json prints blocks on its surviving blocker and lists it', () => {
  const findings = file('nfl-record-findings.json', [{ dimension: 'language', findings: [LISTED_BLOCKER] }])
  const verdicts = file('nfl-record-verdicts.json', [])
  const reviewed = run(['review', '--findings', findings, '--verdicts', verdicts, '--json'])
  assert.equal(reviewed.code, 0, reviewed.stderr)
  const record = JSON.parse(reviewed.stdout)
  assert.equal(record.surviving.length, 1, 'precondition: the review left one surviving blocker')
  assert.ok(!Array.isArray(record.findings), 'precondition: the record carries no findings key')

  const recordPath = file('nfl-record.json', record)
  const gated = run(['gate', '--findings', recordPath])
  assert.equal(gated.code, 1)
  assert.match(gated.stdout, /GATE BLOCKED/)
  assert.ok(gated.stdout.includes(LISTED_BLOCKER.title), gated.stdout)

  // The remediation plan reads the same list.
  const planned = runJson(['remediate', '--findings', recordPath])
  assert.equal(planned.counts.blockers, 1)
})

test('an empty list, and a record whose surviving list is empty, each pass the gate with zero findings', () => {
  for (const [name, body] of [['list', []], ['record', { surviving: [], dismissed: [LISTED_BLOCKER], counts: { raised: 1, surviving: 0 } }]]) {
    const out = runJson(['gate', '--findings', file(`nfl-empty-${name}.json`, body)])
    assert.equal(out.passed, true, name)
    assert.equal(out.total, 0, name)
  }
  // And nothing to fix is still a plan, exit 0.
  assert.equal(run(['remediate', '--findings', file('nfl-empty-plan.json', [])]).code, 0)
  assert.equal(run(['review', '--findings', file('nfl-empty-review.json', []), '--verdicts', file('nfl-empty-verdicts.json', [])]).code, 0)
})

// =============================================================================
// A glob-shaped item in an enforced list, at the merge verdict (design D11).
// The base commit holds the REVIEW.md, so its lists are the ones applied.
// =============================================================================

test('an always-human-review item src/** reads policy.humanPaths amber, for a person, naming the item', () => {
  const changed = ['src/widgets/catalogue.ts']
  const repo = humanPathsRepo('mc-human-pattern', '## Always Human Review\n- src/**\n', changed)
  const out = humanPathsRun(repo, changed)
  const signal = signalIn(out, 'policy.humanPaths')
  assert.equal(signal.band, 'amber', said(signal))
  assert.equal(signal.kind, 'person')
  assert.ok(said(signal).includes('"src/**"'), said(signal))
  assert.ok(said(signal).includes('Always Human Review'), said(signal))
  assert.notEqual(out.verdict, 'MERGE')
})

test('a do-not-report item docs/*.md is reported by review-policy and leaves policy.humanPaths green', () => {
  const changed = ['src/widgets/catalogue.ts']
  const repo = humanPathsRepo('mc-human-pattern-other-list', '## Do Not Report\n- docs/*.md\n', changed)
  const signal = signalIn(humanPathsRun(repo, changed), 'policy.humanPaths')
  assert.equal(signal.band, 'green', said(signal))

  const policy = runJson(['review-policy', '--root', repo.root, '--base', repo.base])
  assert.deepEqual(policy.excludePaths, [])
  assert.ok(policy.problems.some(p => p.includes('"Do Not Report" item "docs/*.md"')), policy.problems.join(' | '))
})

test('an always-human-review item app/[id]/ is a path: a file under it is amber by the path, and nothing is reported as a pattern', () => {
  const changed = ['app/[id]/page.tsx']
  const repo = humanPathsRepo('mc-human-brackets', '## Always Human Review\n- app/[id]/\n', changed)
  const signal = signalIn(humanPathsRun(repo, changed), 'policy.humanPaths')
  assert.equal(signal.band, 'amber', said(signal))
  assert.ok(said(signal).includes('app/[id]/page.tsx'), said(signal))
  assert.doesNotMatch(said(signal), /directory prefix/)
})
