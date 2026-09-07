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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
 * A task result claiming success. `record-batch` fails a task that claims
 * ok:true without a valid handoff, so the packet is part of the fixture, not
 * an optional extra.
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
    'interlock tasks coverage'
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
  // Three disjoint lanes deferred across batches at maxParallel 1. The tasks are
  // tier 4, ABOVE the cohesion ceiling, so they stay three separate lanes rather
  // than packing into one — cohesion (not maxParallel) is what would fold them,
  // and maxParallel 1 then spreads the three lanes one-per-batch.
  const classified = file('classified-serial.json', {
    tasks: [
      { id: '1.1', group: 1, description: 'auth a', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/a.ts'] },
      { id: '1.2', group: 1, description: 'auth b', tier: 4, model: 'haiku', isTestTask: false, paths: ['src/b.ts'] },
      { id: '1.3', group: 1, description: 'auth c', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/c.ts'] }
    ]
  })
  const plan = runJson(['waves', '--classified', classified, '--max-parallel', '1'])
  assert.equal(plan.waves[0].batches.length, 3, 'one lane per batch at maxParallel 1')

  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-serial.json', plan), '--max-parallel', '1', '--change', 'add-widget', '--root', dir])
  const runId = state0.runId
  const first = runJson(['wave-state', 'next', '--state', file('serial-run0.json', state0), '--change', 'add-widget', '--root', dir])
  assert.equal(first.remainingBatches.length, 3)
  assert.deepEqual(
    first.remainingBatches.map(b => b.map(l => l.map(t => t.id))),
    [[['1.1']], [['1.2']], [['1.3']]]
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
    '--result', file('serial-batch0.json', { tasks: [okTask('1.1')] }),
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
    ['sonnet', 'haiku'],
    'a lane runs on its hardest task\'s model'
  )
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
  // The verdict and the claim can differ — an invalid packet fails a task that
  // claimed success — and a caller that receives only the next action has no
  // way to learn which. Without this field a host ticks and tallies from the
  // claim, which is how a task ships unimplemented behind a `- [x]`.
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
    [['1.1', 'ok'], ['1.2', 'failed']],
    'one entry per task in the batch, carrying what the state machine recorded'
  )
  assert.equal(step.recorded[0].reason, undefined, 'a succeeded task owes no reason')
  assert.match(step.recorded[1].reason, /invalid handoff: .*status/)
  assert.ok(
    step.recorded[1].reason.length < 400,
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

test('notify checkpoint posts the spec checkpoint title at default priority', async () => {
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

test('a notify a person invoked directly exits 1 when the relay refused it', async () => {
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
