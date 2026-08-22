import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planVerification,
  judgeUnitResult,
  judgeE2eResult,
  judgeCoverageResult,
  judgeVerification,
  clusterFailures,
  normalizeFailureSignature,
  nextRepairAction,
  formatVerification,
  SKIP_REASONS,
  BANNERS,
  VERIFY_CONTEXTS,
  DEFAULT_VERIFY_CONTEXT,
  checkResultFieldSizes
} from '../../lib/verify.mjs'
import { LIMITS } from '../../lib/limits.mjs'

const profile = (over = {}) => ({
  version: 1,
  updated: '2026-08-12T00:00:00.000Z',
  discovered_from: ['package.json#scripts.test'],
  unit: {
    command: 'pnpm vitest run --reporter dot',
    cwd: 'packages/app',
    filter_syntax: 'pnpm vitest run -t <pattern>',
    single_file: 'pnpm vitest run <file>',
    env: {},
    timeout_ms: 120000,
    prerequisites: []
  },
  e2e: {
    enabled: false,
    command: null,
    cwd: '.',
    filter_syntax: null,
    single_file: null,
    env: {},
    timeout_ms: 600000,
    prerequisites: []
  },
  coverage: { enabled: false, command: null, report_path: 'coverage/lcov.info', format: 'lcov' },
  known_flaky: [],
  notes: [],
  ...over
})

const stepFor = (plan, kind) => plan.steps.find(s => s.kind === kind) || null
const skipFor = (plan, kind) => plan.skipped.find(s => s.kind === kind) || null

const unitResult = (over = {}) => ({ kind: 'unit', command: 'pnpm vitest run', exitCode: 0, ...over })

// --- the profile is the source of truth -----------------------------------

test("a profile's unit command is used verbatim; nothing is invented", () => {
  const plan = planVerification(profile())
  assert.equal(stepFor(plan, 'unit').command, 'pnpm vitest run --reporter dot')
  assert.equal(plan.hasProfile, true)
  const commands = plan.steps.map(s => s.command)
  assert.ok(!commands.some(c => /npm test/.test(c)), 'must never fall back to `npm test`')
  assert.deepEqual(commands, ['pnpm vitest run --reporter dot'])
})

test('an unusual runner survives untouched', () => {
  const plan = planVerification(profile({ unit: { command: 'bazel test //... --test_output=errors' } }))
  assert.equal(stepFor(plan, 'unit').command, 'bazel test //... --test_output=errors')
})

test('profile detail (cwd, timeout, filter) is carried onto the unit step', () => {
  const step = stepFor(planVerification(profile()), 'unit')
  assert.equal(step.cwd, 'packages/app')
  assert.equal(step.timeoutMs, 120000)
  assert.equal(step.filterSyntax, 'pnpm vitest run -t <pattern>')
  assert.equal(step.singleFile, 'pnpm vitest run <file>')
})

test('no profile → hasProfile:false with a skip reason, not a throw and not a guess', () => {
  for (const nothing of [null, undefined]) {
    const plan = planVerification(nothing)
    assert.equal(plan.hasProfile, false)
    assert.equal(stepFor(plan, 'unit'), null, 'must not invent a unit command')
    assert.equal(skipFor(plan, 'unit').reason, SKIP_REASONS.NO_PROFILE)
    assert.ok(plan.banners.includes(BANNERS.noProfile))
  }
})

test('a profile with no unit command skips for a different reason than no profile at all', () => {
  const plan = planVerification(profile({ unit: { command: null } }))
  assert.equal(plan.hasProfile, true)
  assert.equal(stepFor(plan, 'unit'), null)
  assert.equal(skipFor(plan, 'unit').reason, SKIP_REASONS.NO_COMMAND)
})

test('every entry in skipped carries a non-empty reason', () => {
  const plans = [
    planVerification(null),
    planVerification(profile()),
    planVerification(profile(), { e2e: true, coverage: false, lint: false }),
    planVerification(profile(), { elapsedMs: LIMITS.interWaveVerifyBudgetMs }),
    planVerification(profile({ unit: {} }), { preExistingFailures: true })
  ]
  for (const plan of plans) {
    assert.ok(plan.skipped.length > 0)
    for (const entry of plan.skipped) {
      assert.equal(typeof entry.reason, 'string')
      assert.ok(entry.reason.trim().length > 0, `empty reason for kind=${entry.kind}`)
      assert.ok(plan.banners.includes(`VERIFICATION SKIPPED: reason=${entry.reason}`))
    }
  }
})

// --- caller-supplied commands ---------------------------------------------

test('typecheck and lint are caller-supplied, never fabricated', () => {
  const bare = planVerification(profile())
  assert.equal(stepFor(bare, 'typecheck'), null)
  assert.equal(skipFor(bare, 'typecheck').reason, SKIP_REASONS.NO_COMMAND)
  assert.equal(skipFor(bare, 'lint').reason, SKIP_REASONS.NO_COMMAND)

  const given = planVerification(profile(), {
    typecheckCommand: 'tsc --noEmit -p tsconfig.json',
    lintCommand: 'eslint .'
  })
  assert.equal(stepFor(given, 'typecheck').command, 'tsc --noEmit -p tsconfig.json')
  assert.equal(stepFor(given, 'lint').command, 'eslint .')
})

test('typecheck blocks, lint does not', () => {
  const plan = planVerification(profile(), { typecheckCommand: 'tsc --noEmit', lintCommand: 'eslint .' })
  assert.equal(stepFor(plan, 'typecheck').blocking, true)
  assert.equal(stepFor(plan, 'unit').blocking, true)
  assert.equal(stepFor(plan, 'lint').blocking, false)
})

// --- coverage is advisory, always ------------------------------------------

test('a planned coverage step is never blocking', () => {
  const plan = planVerification(
    profile({ coverage: { enabled: true, command: 'pnpm vitest run --coverage', report_path: 'coverage/lcov.info', format: 'lcov' } })
  )
  const step = stepFor(plan, 'coverage')
  assert.equal(step.command, 'pnpm vitest run --coverage')
  assert.equal(step.blocking, false)
  assert.equal(step.advisory, true)
})

test('unconfigured coverage is a reasoned skip, never an error', () => {
  const plan = planVerification(profile())
  assert.equal(skipFor(plan, 'coverage').reason, SKIP_REASONS.COVERAGE_NOT_CONFIGURED)
})

test('terrible coverage still never blocks and never halts', () => {
  const judgement = judgeCoverageResult({
    kind: 'coverage',
    exitCode: 0,
    changedLines: 240,
    coveredLines: 0,
    perFile: [{ path: 'src/a.ts', changedLines: 240, coveredLines: 0 }]
  })
  assert.equal(judgement.halt, false)
  assert.equal(judgement.blocking, false)
  assert.equal(judgement.advisory, true)
  assert.equal(judgement.pct, 0)
  assert.equal(judgement.warnings.length, 1)
})

test('a coverage command that itself failed is still advisory', () => {
  const judgement = judgeCoverageResult({ kind: 'coverage', exitCode: 1, reason: 'c8 not installed' })
  assert.equal(judgement.halt, false)
  assert.equal(judgement.blocking, false)
  assert.equal(judgement.ran, false)
})

// --- e2e: run, never repaired ----------------------------------------------

test('e2e is planned only when enabled in the profile and requested by the caller', () => {
  const enabled = profile({ e2e: { enabled: true, command: 'npx playwright test', cwd: 'e2e', prerequisites: ['npx playwright install'] } })

  assert.equal(skipFor(planVerification(enabled), 'e2e').reason, SKIP_REASONS.E2E_NOT_REQUESTED)
  assert.equal(skipFor(planVerification(profile(), { e2e: true }), 'e2e').reason, SKIP_REASONS.E2E_DISABLED)

  const step = stepFor(planVerification(enabled, { e2e: true }), 'e2e')
  assert.equal(step.command, 'npx playwright test')
  assert.equal(step.blocking, false)
  assert.equal(step.repairable, false)
  assert.deepEqual(step.prerequisites, ['npx playwright install'])
})

test('a red e2e does not halt and produces the non-blocking signal', () => {
  const judgement = judgeE2eResult({ kind: 'e2e', exitCode: 1, total: 40, failed: 3 })
  assert.equal(judgement.halt, false)
  assert.equal(judgement.blocking, false)
  assert.equal(judgement.passed, false)
  assert.equal(judgement.repairable, false)
  const banner = judgement.signals.find(s => s.banner)
  assert.ok(banner, 'a red e2e must emit a banner signal')
  assert.match(banner.banner, /^E2E FAILED \(non-blocking by policy\): /)
})

test('a green e2e emits no banner', () => {
  const judgement = judgeE2eResult({ kind: 'e2e', exitCode: 0, total: 40, failed: 0 })
  assert.equal(judgement.passed, true)
  assert.deepEqual(judgement.signals, [])
})

// --- the unit halt ----------------------------------------------------------

test('a red unit suite halts', () => {
  const judgement = judgeUnitResult(unitResult({ exitCode: 1, total: 186, passed: 183, failed: 3, skipped: 0 }))
  assert.equal(judgement.halt, true)
  assert.equal(judgement.status, 'red')
  assert.match(judgement.reason, /red/)
})

test('a nonzero failed count halts even when the runner exited 0', () => {
  assert.equal(judgeUnitResult(unitResult({ exitCode: 0, failed: 2 })).halt, true)
})

test('a green unit suite does not halt', () => {
  const judgement = judgeUnitResult(unitResult({ exitCode: 0, total: 186, passed: 186, failed: 0, skipped: 0 }))
  assert.equal(judgement.halt, false)
  assert.equal(judgement.status, 'green')
})

test('a unit command that could not run halts', () => {
  const judgement = judgeUnitResult({ kind: 'unit', ran: false, reason: 'command not found (exit 127)' })
  assert.equal(judgement.halt, true)
  assert.equal(judgement.status, 'error')
  assert.match(judgement.reason, /did not run/)
})

test('pre-existing failures are excused, with the reason the caller prints', () => {
  const red = unitResult({ exitCode: 1, failed: 3 })
  assert.equal(judgeUnitResult(red).halt, true)
  const excused = judgeUnitResult(red, { preExistingFailures: true })
  assert.equal(excused.halt, false)
  assert.equal(excused.reason, SKIP_REASONS.PRE_EXISTING)
  assert.equal(excused.preExisting, true)
})

test('a signature list excuses only the clusters it names', () => {
  const failures = [
    'AssertionError: expected 1 to equal 2 at test/a.test.mjs:4:1',
    'TypeError: db is not a function at src/db.ts:9:2'
  ]
  const known = ['AssertionError: expected 1 to equal 2 at test/zzz.test.mjs:99:1']
  const partly = judgeUnitResult(unitResult({ exitCode: 1, failed: 2, failures }), {
    preExistingFailures: known
  })
  assert.equal(partly.halt, true, 'one new cluster is still a halt')

  const all = judgeUnitResult(unitResult({ exitCode: 1, failed: 1, failures: [failures[0]] }), {
    preExistingFailures: known
  })
  assert.equal(all.halt, false)
})

// --- the weakened suite -----------------------------------------------------

test('a suite that went green by shrinking is not green', () => {
  const judgement = judgeUnitResult(
    unitResult({ exitCode: 0, total: 180, passed: 180, failed: 0, skipped: 0 }),
    { baseline: { kind: 'unit', exitCode: 1, total: 186, passed: 183, failed: 3, skipped: 0 } }
  )
  assert.equal(judgement.halt, true)
  assert.equal(judgement.status, 'weakened')
  assert.equal(judgement.weakened.signal, 'total-decreased')
})

test('a suite that went green by skipping is not green', () => {
  const judgement = judgeUnitResult(
    unitResult({ exitCode: 0, total: 186, passed: 183, failed: 0, skipped: 3 }),
    { baseline: { kind: 'unit', exitCode: 1, total: 186, passed: 183, failed: 3, skipped: 0 } }
  )
  assert.equal(judgement.halt, true)
  assert.equal(judgement.weakened.signal, 'skipped-increased')
})

test('without a baseline the weakening check reports itself unavailable rather than guessing', () => {
  const judgement = judgeUnitResult(unitResult({ exitCode: 0, total: 180, failed: 0 }))
  assert.equal(judgement.weakenedCheck, 'unavailable')
  assert.equal(judgement.weakened, null)
  assert.equal(judgement.halt, false)
})

test('a suite that grew is not weakened', () => {
  const judgement = judgeUnitResult(
    unitResult({ exitCode: 0, total: 190, failed: 0, skipped: 0 }),
    { baseline: { kind: 'unit', exitCode: 1, total: 186, failed: 3, skipped: 0 } }
  )
  assert.equal(judgement.weakenedCheck, 'ok')
  assert.equal(judgement.halt, false)
})

// --- root-cause clustering ---------------------------------------------------

test('failures sharing a root cause collapse to one cluster despite path and line', () => {
  const clusters = clusterFailures([
    {
      test: 'renders the header',
      file: 'src/components/Header.tsx',
      message: "TypeError: Cannot read properties of undefined (reading 'id') at src/components/Header.tsx:42:9"
    },
    {
      test: 'renders the footer',
      file: 'src/components/Footer.tsx',
      message: "TypeError: Cannot read properties of undefined (reading 'id') at src/components/Footer.tsx:118:3"
    },
    {
      test: 'renders the nav',
      file: 'src/nav/Nav.tsx',
      message: "TypeError: Cannot read properties of undefined (reading 'id') at src/nav/Nav.tsx:7:15"
    }
  ])
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].count, 3)
  assert.equal(clusters[0].tests.length, 3)
  assert.equal(clusters[0].files.length, 3)
  assert.ok(clusters[0].representative.includes('Cannot read properties of undefined'))
})

test('genuinely different errors stay separate, largest cluster first', () => {
  const clusters = clusterFailures([
    'TypeError: fetch is not a function at src/a.ts:1:1',
    'TypeError: fetch is not a function at src/b.ts:2:2',
    'AssertionError: expected 3 to equal 4 at test/sum.test.mjs:9:1'
  ])
  assert.equal(clusters.length, 2)
  assert.equal(clusters[0].count, 2)
  assert.equal(clusters[1].count, 1)
})

test('assertions that differ in their expected values do not collapse', () => {
  const clusters = clusterFailures([
    'AssertionError: expected 3 to equal 4 at test/a.test.mjs:1:1',
    'AssertionError: expected 7 to equal 9 at test/a.test.mjs:2:1'
  ])
  assert.equal(clusters.length, 2)
})

test('addresses, hashes and timings are normalized away', () => {
  assert.equal(
    normalizeFailureSignature('Segmentation fault at 0x7fff5fbff8c0 after 1200ms'),
    normalizeFailureSignature('Segmentation fault at 0x00007f9adeadbeef after 3.4s')
  )
  assert.equal(
    normalizeFailureSignature('snapshot 8b1a9953c4611296a827abf8c47804d7 mismatch'),
    normalizeFailureSignature('snapshot e10adc3949ba59abbe56e057f20f883e mismatch')
  )
  assert.equal(
    normalizeFailureSignature('run 550e8400-e29b-41d4-a716-446655440000 failed'),
    normalizeFailureSignature('run 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed')
  )
})

test('windows paths and ansi colouring do not fork a cluster', () => {
  const clusters = clusterFailures([
    'Error: boom at src/x/y.ts:3:1',
    '\u001b[31mError: boom\u001b[0m at C:\\repo\\src\\x\\y.ts:9:4'
  ])
  assert.equal(clusters.length, 1)
})

test('clustering tolerates empty and absent input, and rejects nonsense', () => {
  assert.deepEqual(clusterFailures([]), [])
  assert.deepEqual(clusterFailures(undefined), [])
  assert.deepEqual(clusterFailures(null), [])
  assert.deepEqual(clusterFailures(['', '   ']), [])
  assert.throws(() => clusterFailures('boom'), /failures must be an array/)
})

// --- the repair budget --------------------------------------------------------

test('the repair budget decrements and halts exactly at the cap', () => {
  const clusters = clusterFailures(['TypeError: x is not a function at src/a.ts:1:1'])
  const at = used => nextRepairAction({ iterationsUsed: used, clusters, halt: true })

  assert.equal(at(0).action, 'repair')
  assert.equal(at(0).iterationsLeft, LIMITS.rootCauseIterations)

  const last = at(LIMITS.rootCauseIterations - 1)
  assert.equal(last.action, 'repair')
  assert.equal(last.iterationsLeft, 1)

  const spent = at(LIMITS.rootCauseIterations)
  assert.equal(spent.action, 'halt')
  assert.equal(spent.iterationsLeft, 0)
  assert.match(spent.reason, new RegExp(`${LIMITS.rootCauseIterations} iteration`))
})

test('repair targets the largest root cause first', () => {
  const clusters = clusterFailures([
    'TypeError: db is undefined at src/a.ts:1:1',
    'TypeError: db is undefined at src/b.ts:2:1',
    'AssertionError: expected 1 to equal 2 at test/c.test.mjs:3:1'
  ])
  const action = nextRepairAction({ iterationsUsed: 1, clusters, halt: true })
  assert.equal(action.action, 'repair')
  assert.equal(action.target.count, 2)
})

test('a weakened suite is never repaired by another iteration', () => {
  const action = nextRepairAction({
    iterationsUsed: 0,
    clusters: [],
    halt: true,
    weakened: { signal: 'total-decreased', detail: '186 → 180' }
  })
  assert.equal(action.action, 'halt')
  assert.match(action.reason, /weakened/)
})

test('nothing red is accepted, and pre-existing failures are accepted with their reason', () => {
  assert.equal(nextRepairAction({ iterationsUsed: 2, clusters: [], halt: false }).action, 'accept')
  const preExisting = nextRepairAction({ clusters: [{ signature: 'x', count: 1 }], halt: true, preExisting: true })
  assert.equal(preExisting.action, 'accept')
  assert.equal(preExisting.reason, SKIP_REASONS.PRE_EXISTING)
})

// --- the verify budget --------------------------------------------------------

test('an exceeded verify budget leaves only typecheck, with a reason on every skip', () => {
  const plan = planVerification(profile({ coverage: { enabled: true, command: 'pnpm coverage' } }), {
    typecheckCommand: 'tsc --noEmit',
    lintCommand: 'eslint .',
    e2e: true,
    elapsedMs: LIMITS.interWaveVerifyBudgetMs
  })
  assert.equal(plan.budgetExceeded, true)
  assert.deepEqual(plan.steps.map(s => s.kind), ['typecheck'])
  for (const kind of ['unit', 'lint', 'coverage', 'e2e']) {
    assert.equal(skipFor(plan, kind).reason, SKIP_REASONS.BUDGET_EXCEEDED)
  }
})

test('the budget comes from LIMITS, not from a hardcoded number', () => {
  const under = planVerification(profile(), { elapsedMs: LIMITS.interWaveVerifyBudgetMs - 1 })
  assert.equal(under.budgetMs, LIMITS.interWaveVerifyBudgetMs)
  assert.equal(under.budgetExceeded, false)
  assert.ok(stepFor(under, 'unit'))

  const overridden = planVerification(profile(), { elapsedMs: 10, budgetMs: 5 })
  assert.equal(overridden.budgetExceeded, true)
})

test('docs-only --changed skips every kind', () => {
  const plan = planVerification(profile(), {
    changed: ['docs/foo.md', 'README.md'],
    context: 'inter-wave',
    typecheckCommand: 'tsc --noEmit'
  })
  assert.deepEqual(plan.steps, [])
  for (const kind of ['typecheck', 'unit', 'lint', 'coverage', 'e2e']) {
    assert.equal(skipFor(plan, kind).reason, SKIP_REASONS.DOCS_ONLY)
  }
})

test('inter-wave context omits e2e and coverage by default', () => {
  const plan = planVerification(
    profile({ coverage: { enabled: true, command: 'pnpm coverage' } }),
    { context: 'inter-wave', typecheckCommand: 'tsc --noEmit' }
  )
  assert.ok(stepFor(plan, 'unit'))
  assert.ok(stepFor(plan, 'typecheck'))
  assert.equal(skipFor(plan, 'e2e').reason, SKIP_REASONS.E2E_NOT_REQUESTED)
  assert.equal(skipFor(plan, 'coverage').reason, SKIP_REASONS.CALLER_OPTED_OUT)
})

test('a source --changed path still plans typecheck and unit', () => {
  const plan = planVerification(profile(), {
    changed: ['lib/waves.mjs'],
    context: 'inter-wave',
    typecheckCommand: 'tsc --noEmit'
  })
  assert.ok(stepFor(plan, 'typecheck'))
  assert.ok(stepFor(plan, 'unit'))
})

test('a suite that was already red before the change skips the unit step', () => {
  const plan = planVerification(profile(), { preExistingFailures: true })
  assert.equal(stepFor(plan, 'unit'), null)
  assert.equal(skipFor(plan, 'unit').reason, SKIP_REASONS.PRE_EXISTING)
})

// --- the whole verdict ---------------------------------------------------------

test('a red unit halts the verdict; a red e2e alongside it only banners', () => {
  const plan = planVerification(
    profile({ e2e: { enabled: true, command: 'npx playwright test' } }),
    { e2e: true }
  )
  const verdict = judgeVerification(plan, [
    { kind: 'unit', exitCode: 1, total: 10, failed: 2 },
    { kind: 'e2e', exitCode: 1, total: 4, failed: 1 }
  ])
  assert.equal(verdict.halt, true)
  assert.match(verdict.reason, /red/)
  assert.ok(verdict.banners.some(b => b.startsWith('E2E FAILED (non-blocking by policy)')))
})

test('a red e2e alone never halts the verdict', () => {
  const plan = planVerification(
    profile({ e2e: { enabled: true, command: 'npx playwright test' } }),
    { e2e: true }
  )
  const verdict = judgeVerification(plan, [
    { kind: 'unit', exitCode: 0, total: 10, failed: 0 },
    { kind: 'e2e', exitCode: 1, total: 4, failed: 1 }
  ])
  assert.equal(verdict.halt, false)
  assert.equal(verdict.e2e.halt, false)
  assert.ok(verdict.banners.some(b => b.startsWith('E2E FAILED (non-blocking by policy)')))
})

// --- halting depends on where verification was called from ----------------
//
// Inter-wave and final verification are two call sites with two policies. A
// type error between waves must stop the next wave building on it; the same
// error at commit time is loud but not a halt, because ship and
// docs/04-when-it-stops.md both publish "the only three hard halts" and a
// typecheck is not one of them.

const typecheckPlan = () =>
  planVerification(profile(), { typecheckCommand: 'tsc --noEmit' })

test('a failed typecheck halts between waves', () => {
  const verdict = judgeVerification(
    typecheckPlan(),
    [
      { kind: 'typecheck', exitCode: 2 },
      { kind: 'unit', exitCode: 0, failed: 0 }
    ],
    { context: 'inter-wave' }
  )
  assert.equal(verdict.halt, true)
  assert.match(verdict.reason, /typecheck/)
})

test('the same failed typecheck does not halt the final verdict', () => {
  const verdict = judgeVerification(typecheckPlan(), [
    { kind: 'typecheck', exitCode: 2 },
    { kind: 'unit', exitCode: 0, failed: 0 }
  ])
  assert.equal(verdict.halt, false)
})

test('a red typecheck at the final gate is still reported, not swallowed', () => {
  const verdict = judgeVerification(typecheckPlan(), [
    { kind: 'typecheck', exitCode: 2 },
    { kind: 'unit', exitCode: 0, failed: 0 }
  ])
  const said = JSON.stringify(verdict.signals) + formatVerification(verdict)
  assert.match(said, /typecheck/i)
})

test('the final context still halts on a red unit suite', () => {
  const verdict = judgeVerification(typecheckPlan(), [
    { kind: 'typecheck', exitCode: 0 },
    { kind: 'unit', exitCode: 1, failed: 3 }
  ])
  assert.equal(verdict.halt, true)
  assert.match(verdict.reason, /unit/i)
})

test('the default context is the stricter-documented final one', () => {
  assert.equal(DEFAULT_VERIFY_CONTEXT, 'final')
  const explicit = judgeVerification(typecheckPlan(), [
    { kind: 'typecheck', exitCode: 2 },
    { kind: 'unit', exitCode: 0, failed: 0 }
  ], { context: 'final' })
  const implicit = judgeVerification(typecheckPlan(), [
    { kind: 'typecheck', exitCode: 2 },
    { kind: 'unit', exitCode: 0, failed: 0 }
  ])
  assert.equal(explicit.halt, implicit.halt)
})

test('an unrecognized context is an error, never the permissive branch', () => {
  // Defaulting a typo to the lenient set is how a hard halt goes missing.
  assert.throws(
    () => judgeVerification(typecheckPlan(), [{ kind: 'unit', exitCode: 0 }], { context: 'inter_wave' }),
    /verify context must be one of/
  )
})

test('only the unit suite can halt the final verdict', () => {
  // The assertion that catches the next person adding a fourth hard halt.
  assert.deepEqual(VERIFY_CONTEXTS.final.haltingKinds, ['unit'])
})

test('the verdict repeats every skip as a printable banner', () => {
  const plan = planVerification(null, { typecheckCommand: 'tsc --noEmit' })
  const verdict = judgeVerification(plan, [{ kind: 'typecheck', exitCode: 0 }])
  assert.equal(verdict.halt, false)
  assert.ok(verdict.banners.includes(BANNERS.noProfile))
  for (const s of plan.skipped) {
    assert.ok(verdict.banners.includes(`VERIFICATION SKIPPED: reason=${s.reason}`))
  }
})

test('the verdict rejects results it cannot attribute to a step kind', () => {
  const plan = planVerification(profile())
  assert.throws(() => judgeVerification(plan, [{ kind: 'smoke', exitCode: 0 }]), /kind" must be one of/)
  assert.throws(() => judgeVerification({}, []), /must come from planVerification/)
})

// --- validation ---------------------------------------------------------------

test('a malformed profile fails with a user-facing message', () => {
  const cases = [
    ['not an object', /must be a JSON object/],
    [{ unit: 'npm test' }, /"unit" must be an object/],
    [{ unit: { command: 42 } }, /"unit.command" must be a string/],
    [{ unit: { command: 'npm test' }, e2e: { enabled: 'yes' } }, /"e2e.enabled" must be a boolean/],
    [{ version: '1', unit: {} }, /"version" must be an integer/],
    [{ unit: { command: 'npm test', timeout_ms: '5s' } }, /"unit.timeout_ms" must be an integer/],
    [{ unit: {}, notes: 'none' }, /"notes" must be an array/]
  ]
  for (const [bad, pattern] of cases) {
    assert.throws(() => planVerification(bad), pattern)
  }
  try {
    planVerification('nope')
    assert.fail('should have thrown')
  } catch (err) {
    assert.equal(err.userFacing, true)
  }
})

test('a malformed result fails with a user-facing message', () => {
  assert.throws(() => judgeUnitResult(null), /result must be an object/)
  assert.throws(() => judgeUnitResult({ kind: 'unit' }), /must include a numeric exitCode/)
  assert.throws(() => judgeUnitResult({ kind: 'unit', exitCode: 'one' }), /"exitCode" must be a number/)
})

// --- purity --------------------------------------------------------------------

test('planVerification never mutates the caller input', () => {
  const input = profile({ e2e: { enabled: true, command: 'npx playwright test', prerequisites: ['seed db'] } })
  const before = JSON.parse(JSON.stringify(input))
  const opts = { e2e: true, typecheckCommand: 'tsc --noEmit', elapsedMs: 0 }
  const optsBefore = JSON.parse(JSON.stringify(opts))

  const plan = planVerification(input, opts)
  plan.steps[0].command = 'mutated'
  plan.steps.find(s => s.kind === 'e2e').prerequisites.push('extra')

  assert.deepEqual(input, before)
  assert.deepEqual(opts, optsBefore)
})

test('judging never mutates the caller input', () => {
  const result = unitResult({
    exitCode: 1,
    total: 10,
    failed: 2,
    failures: ['TypeError: x at src/a.ts:1:1', 'TypeError: x at src/b.ts:2:2']
  })
  const before = JSON.parse(JSON.stringify(result))
  const judgement = judgeUnitResult(result, { baseline: { total: 10, skipped: 0 } })
  judgement.clusters[0].tests.push('injected')
  assert.deepEqual(result, before)
})

// --- formatting -----------------------------------------------------------------

test('formatVerification prints skip reasons in the shape the caller banners', () => {
  const out = formatVerification(planVerification(null))
  assert.match(out, /NO TEST PROFILE:/)
  assert.match(out, new RegExp(`VERIFICATION SKIPPED: reason=${SKIP_REASONS.NO_PROFILE}`))
})

test('formatVerification prints the planned commands and their blocking status', () => {
  const out = formatVerification(planVerification(profile(), { typecheckCommand: 'tsc --noEmit' }))
  assert.match(out, /\[blocking\] typecheck: tsc --noEmit/)
  assert.match(out, /\[blocking\] unit: pnpm vitest run --reporter dot/)
})

test('formatVerification renders a unit judgement, a verdict and a repair action', () => {
  const judgement = judgeUnitResult(
    unitResult({ exitCode: 1, total: 10, failed: 2, failures: ['TypeError: x at src/a.ts:1:1'] })
  )
  assert.match(formatVerification(judgement), /UNIT HALT/)

  const plan = planVerification(profile())
  const verdict = judgeVerification(plan, [{ kind: 'unit', exitCode: 0, failed: 0 }])
  assert.match(formatVerification(verdict), /VERIFY OK/)

  const action = nextRepairAction({ iterationsUsed: LIMITS.rootCauseIterations, clusters: [], halt: true })
  assert.match(formatVerification(action), /^HALT — /)
})

test('formatVerification rejects something it cannot render', () => {
  assert.throws(() => formatVerification(null), /nothing to format/)
  assert.throws(() => formatVerification({ nope: true }), /expects a plan/)
})

// --- the oversized-result allowlist (spec: ship/cap-authority) -------------
//
// checkResultFieldSizes is the anti-swallow check: an agent that pastes a whole
// red suite into a result field is rejected rather than judged. It had four
// unguarded doors — `summary`, `message`, `error` and `notes` were absent from
// RESULT_TEXT_FIELDS — and no direct test at all.

const CEILING = LIMITS.verifyPreviewChars
const text = (n) => 'x'.repeat(n)

const TEXT_FIELDS = [
  'detail',
  'cliStdout',
  'reason',
  'stdout',
  'stderr',
  'output',
  'summary',
  'message',
  'error',
  'notes'
]

for (const field of TEXT_FIELDS) {
  test(`an oversized "${field}" is a violation naming the field and its length`, () => {
    const r = checkResultFieldSizes([{ kind: 'unit', [field]: text(CEILING + 1) }])
    assert.equal(r.ok, false, `${field} is text-bearing and must be checked`)
    assert.equal(r.violations.length, 1)
    assert.deepEqual(r.violations[0], {
      kind: 'unit',
      field,
      length: CEILING + 1,
      limit: CEILING
    })
  })
}

test('the ceiling is a boundary in both directions', () => {
  assert.equal(checkResultFieldSizes([{ kind: 'unit', summary: text(CEILING) }]).ok, true)
  assert.equal(checkResultFieldSizes([{ kind: 'unit', summary: text(CEILING + 1) }]).ok, false)
})

test('the ceiling defaults to the published cap and honours an override', () => {
  assert.equal(checkResultFieldSizes([{ kind: 'unit', notes: text(10) }], { maxChars: 5 }).ok, false)
  assert.equal(checkResultFieldSizes([{ kind: 'unit', notes: text(10) }]).ok, true)
})

test('an ordinary result passes and non-objects are skipped rather than thrown on', () => {
  const r = checkResultFieldSizes([
    null,
    'nonsense',
    { kind: 'unit', summary: 'ok', error: '', notes: 'short', message: 'fine' }
  ])
  assert.deepEqual(r, { ok: true, violations: [] })
  assert.throws(() => checkResultFieldSizes('not an array'), /must be an array/)
})
