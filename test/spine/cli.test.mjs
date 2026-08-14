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
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'interlock')

let dir

/** Run the real binary. Never throws on a non-zero exit — that is the assertion. */
function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    input: opts.input === undefined ? '' : opts.input
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

// --- fixtures -------------------------------------------------------------

const FINDINGS = [
  { dimension: 'typescript', severity: 'blocker', title: 'unchecked null deref', file: 'src/a.ts' },
  { dimension: 'typescript', severity: 'warning', title: 'missing return type', file: 'src/a.ts' },
  { dimension: 'qa', severity: 'suggestion', title: 'add an empty-case test', file: 'src/b.ts' }
]

const CLEAN_FINDINGS = [
  { dimension: 'qa', severity: 'suggestion', title: 'add an empty-case test', file: 'src/b.ts' }
]

const CLASSIFIED = {
  tasks: [
    { id: '1.1', group: 1, description: 'sessions table', tier: 3, model: 'opus', isTestTask: false },
    { id: '1.2', group: 1, description: 'login route', tier: 2, model: 'sonnet', isTestTask: false },
    { id: '2.1', group: 2, description: 'middleware', tier: 3, model: 'sonnet', isTestTask: false },
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
    'interlock wave-state replan'
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
  assert.match(verify.stderr, /plan\|judge\|unit\|cluster\|repair/)

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

test('a missing ledger is "none recorded" and exits 0', () => {
  const r = run(['ledger', 'add-auth', '--root', paths.root])
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /DECISIONS — none recorded/)
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

test('a fully resolved ledger exits 0', () => {
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
  const out = runJson(['ledger', 'add-auth', '--root', paths.root], 0)
  assert.equal(out.blocking, false)
  assert.equal(out.agentResolved, 1)
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
  assert.deepEqual(step.tasks.map(t => t.id), ['1.1', '1.2'])
  // The clamp is applied by the planner, so it survives into the state.
  assert.deepEqual(step.tasks.map(t => t.model), ['sonnet', 'sonnet'])

  const batch = file('batch1.json', { tasks: [{ id: '1.1', ok: true }, { id: '1.2', ok: true }] })
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

test('record-batch --write-state writes the new state and stdout is the next step', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-ws.json', plan)])
  const batch = file('ws-batch.json', { tasks: [{ id: '1.1', ok: true }, { id: '1.2', ok: true }] })
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

test('record-verify --write-state stdout is the next step after a green check', () => {
  const plan = runJson(['waves', '--classified', paths.classified])
  const state0 = runJson(['wave-state', 'create', '--plan', file('plan-wv.json', plan)])
  const afterBatch = runJson([
    'wave-state', 'record-batch',
    '--state', file('wv-run0.json', state0),
    '--result', file('wv-batch.json', { tasks: [{ id: '1.1', ok: true }, { id: '1.2', ok: true }] })
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
  file(`${base}/design.md`, over.design ?? '# Design\n\nUse the existing helper.\n')
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
  const review = file('review-clean.json', { blockers: 0, warnings: 1 })
  const out = runJson(['ready', name, '--root', dir, '--review', review], 0)
  assert.equal(out.ready, true)
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
  const review = file('review-h.json', { blockers: 0 })
  const r = run(['ready', name, '--root', dir, '--review', review])
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

test('an unknown outcomes subcommand is an actionable error', () => {
  const r = run(['outcomes', 'frobnicate', '--root', dir])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /frobnicate/)
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
