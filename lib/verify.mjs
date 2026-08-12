// Verification policy as code: what to run, and what a result means.
//
// This module decides; it never verifies. It spawns nothing, reads nothing,
// and executes nothing. The orchestration that consumes it is a dynamic
// workflow script that cannot `import()`, has no filesystem and no shell — only
// the agents it spawns can run a command. So the shape is inverted from the
// obvious one: `planVerification` says which commands *should* run, an agent
// runs them and reports back, and `judge*` says what the results mean.
//
// The policies below were prose in `skills/ship/SKILL.md`, and prose is exactly
// how they got broken:
//
//   1. "Use the test profile" became "run `npm test`" the moment a model could
//      not find the profile quickly. A plan built from a profile uses that
//      profile's commands verbatim; a plan built from nothing reports
//      `hasProfile:false` and a skip reason. There is no third branch where a
//      command gets guessed.
//
//   2. "A red unit suite halts" was a sentence a model could weigh against
//      other sentences. It is now a boolean with a reason string attached.
//
//   3. "Coverage is advisory" drifted into coverage-shaped blocking. Coverage
//      steps are never `blocking` and coverage judgements never `halt` — not
//      as a default, but structurally: `judgeCoverageResult` has no code path
//      that can return a halt.
//
//   4. E2E is run, never repaired. E2E failures are frequently environmental,
//      and auto-fixing them papers over real regressions, so a red e2e produces
//      a loud non-blocking signal instead of a gate.
//
//   5. Every skip carries a machine-readable reason, so the caller can always
//      print `VERIFICATION SKIPPED: reason=<reason>` rather than silently
//      verifying nothing.
//
//   6. Repair is bounded and clustered. Failures collapse by normalized error
//      signature so a shared root cause is fixed once, and the number of repair
//      iterations is capped by `LIMITS.rootCauseIterations`.
//
// Pure: no fs, no agent, no I/O, no clock, no imports outside `lib/`.
// Exposed to skills as `interlock verify …`.

import { LIMITS } from './limits.mjs'

/** Step kinds, in the order they should be executed. */
export const VERIFY_KINDS = ['typecheck', 'unit', 'lint', 'coverage', 'e2e']

/**
 * Kinds whose failure is a gate rather than a report. Deliberately short: a
 * type error is a compile error and a red unit suite is a regression, but lint,
 * coverage and e2e are all reported rather than enforced.
 */
export const BLOCKING_KINDS = ['typecheck', 'unit']

/**
 * Which of the `BLOCKING_KINDS` actually halt, per call site. Verification is
 * called from two places with two different published contracts, and collapsing
 * them breaks one of them:
 *
 * - `inter-wave` runs between waves, where the wave loop owns the response
 *   (`LIMITS.interWaveFixAttempts` targeted fixes, then halt or warn). A type
 *   error here must stop the next wave from building on top of it.
 * - `final` runs before the commit, where `skills/ship/SKILL.md` and
 *   `docs/04-when-it-stops.md` both publish the exhaustive list of hard halts.
 *   A red typecheck is not on that list, so it cannot silently become a fourth
 *   — it is reported loudly and does not stop the run.
 *
 * `final` is the default: it is the stricter-documented path, and a caller that
 * forgot to say which site it is should not accidentally acquire extra halts.
 */
export const VERIFY_CONTEXTS = {
  'inter-wave': { haltingKinds: BLOCKING_KINDS },
  final: { haltingKinds: BLOCKING_KINDS.filter(kind => kind === 'unit') }
}

export const DEFAULT_VERIFY_CONTEXT = 'final'

/**
 * Machine-readable skip reasons. The caller prints
 * `VERIFICATION SKIPPED: reason=<reason>`, so these strings are part of the
 * contract — add to them, never reword them in place.
 */
export const SKIP_REASONS = {
  /** No `.claude/testing/profile.json` at all. Never guess a command from this. */
  NO_PROFILE: 'no-test-profile',
  /** A profile exists but holds no command for this kind. */
  NO_COMMAND: 'no-detectable-command',
  /** The failures were already red before this change touched anything. */
  PRE_EXISTING: 'failures-are-pre-existing',
  /** `LIMITS.interWaveVerifyBudgetMs` spent; only typecheck still runs. */
  BUDGET_EXCEEDED: 'verify-budget-exceeded',
  /** `e2e.enabled` is false in the profile. */
  E2E_DISABLED: 'e2e-not-enabled',
  /** The caller did not opt in with `--e2e`. */
  E2E_NOT_REQUESTED: 'e2e-not-requested',
  /** `coverage.enabled` is false / no coverage command. Never an error. */
  COVERAGE_NOT_CONFIGURED: 'coverage-not-configured',
  /** The caller explicitly turned this step off. */
  CALLER_OPTED_OUT: 'disabled-by-caller'
}

/** Banner prefixes the caller prints verbatim (see the plan's §C3 table). */
export const BANNERS = {
  noProfile: 'NO TEST PROFILE: run /interlock:fix-tests --reconfigure once',
  skipped: reason => `VERIFICATION SKIPPED: reason=${reason}`,
  e2eFailed: detail => `E2E FAILED (non-blocking by policy): ${detail}`,
  typecheckFailed: detail => `TYPECHECK FAILED (non-blocking at the final gate): ${detail}`
}

function fail(message) {
  const err = new Error(message)
  err.userFacing = true
  throw err
}

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v)

function trimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function int(value, fallback = null) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
}

// --- profile validation ---------------------------------------------------

// Only the fields TEST-PROFILE.md actually defines are validated. An absent
// profile is not malformed — it is the documented "no profile" case and must
// produce `hasProfile:false`, not a throw.
function validateProfile(profile) {
  if (profile === null || profile === undefined) return
  if (!isObject(profile)) fail('test profile must be a JSON object (see shared/TEST-PROFILE.md)')

  if (profile.version !== undefined && !Number.isInteger(profile.version)) {
    fail('test profile "version" must be an integer')
  }
  if (profile.notes !== undefined && !Array.isArray(profile.notes)) {
    fail('test profile "notes" must be an array')
  }
  if (profile.known_flaky !== undefined && !Array.isArray(profile.known_flaky)) {
    fail('test profile "known_flaky" must be an array')
  }

  for (const section of ['unit', 'e2e', 'coverage']) {
    const value = profile[section]
    if (value === undefined || value === null) continue
    if (!isObject(value)) fail(`test profile "${section}" must be an object`)
    if (
      value.command !== undefined &&
      value.command !== null &&
      typeof value.command !== 'string'
    ) {
      fail(`test profile "${section}.command" must be a string or null`)
    }
    if (value.timeout_ms !== undefined && value.timeout_ms !== null && !Number.isInteger(value.timeout_ms)) {
      fail(`test profile "${section}.timeout_ms" must be an integer`)
    }
  }

  for (const [section, field] of [['e2e', 'enabled'], ['coverage', 'enabled']]) {
    const value = profile[section]
    if (isObject(value) && value[field] !== undefined && typeof value[field] !== 'boolean') {
      fail(`test profile "${section}.${field}" must be a boolean`)
    }
  }
}

// --- planning -------------------------------------------------------------

function step(kind, command, extra = {}) {
  return {
    id: kind,
    kind,
    command,
    blocking: BLOCKING_KINDS.includes(kind),
    ...extra
  }
}

/**
 * Decide which verification commands should run for this change.
 *
 * The unit / e2e / coverage commands come from the profile **verbatim** — this
 * function never synthesizes one. `typecheck` and `lint` have no field in
 * TEST-PROFILE.md, so they are caller-supplied via `opts`; if the caller has
 * none, the step is skipped with a reason rather than invented. (A profile that
 * carries `typecheck`/`lint` sections is honoured if present, but nothing here
 * creates one.)
 *
 * @param {object|null} profile parsed `.claude/testing/profile.json`, or null
 * @param {{
 *   e2e?: boolean,           // caller passed --e2e (default false)
 *   coverage?: boolean,      // default true; advisory either way
 *   lint?: boolean,          // default true
 *   typecheckCommand?: string|null,
 *   lintCommand?: string|null,
 *   elapsedMs?: number,      // time already spent verifying this run
 *   budgetMs?: number,       // default LIMITS.interWaveVerifyBudgetMs
 *   preExistingFailures?: boolean // suite was already red before this change
 * }} [opts]
 * @returns {{steps: Array, skipped: Array<{kind: string, reason: string, detail?: string}>,
 *   hasProfile: boolean, budgetMs: number, elapsedMs: number, budgetExceeded: boolean,
 *   banners: string[]}}
 */
export function planVerification(profile, opts = {}) {
  validateProfile(profile)
  if (!isObject(opts)) fail('verify options must be an object')

  const hasProfile = isObject(profile)
  const unit = hasProfile && isObject(profile.unit) ? profile.unit : {}
  const e2e = hasProfile && isObject(profile.e2e) ? profile.e2e : {}
  const coverage = hasProfile && isObject(profile.coverage) ? profile.coverage : {}
  const typecheckSection = hasProfile && isObject(profile.typecheck) ? profile.typecheck : {}
  const lintSection = hasProfile && isObject(profile.lint) ? profile.lint : {}

  const budgetMs = int(opts.budgetMs, null) ?? LIMITS.interWaveVerifyBudgetMs
  const elapsedMs = int(opts.elapsedMs, 0) ?? 0
  const budgetExceeded = elapsedMs >= budgetMs

  const wantE2e = opts.e2e === true
  const wantCoverage = opts.coverage !== false
  const wantLint = opts.lint !== false

  const steps = []
  const skipped = []
  const skip = (kind, reason, detail) => {
    const entry = { kind, reason }
    if (detail) entry.detail = detail
    skipped.push(entry)
  }

  // The reason a profile-derived step is unavailable: never having a profile is
  // a different failure from having one with nothing in it, and the caller
  // prints them differently.
  const missingReason = hasProfile ? SKIP_REASONS.NO_COMMAND : SKIP_REASONS.NO_PROFILE

  // --- typecheck: caller-supplied, and the one thing that survives the budget.
  const typecheckCommand =
    trimmedString(opts.typecheckCommand) || trimmedString(typecheckSection.command)
  if (typecheckCommand) {
    steps.push(step('typecheck', typecheckCommand, { cwd: trimmedString(typecheckSection.cwd) || '.' }))
  } else {
    skip('typecheck', SKIP_REASONS.NO_COMMAND, 'no typecheck command was supplied by the caller')
  }

  // --- unit
  const unitCommand = trimmedString(unit.command)
  if (budgetExceeded) {
    skip('unit', SKIP_REASONS.BUDGET_EXCEEDED, `${elapsedMs}ms of ${budgetMs}ms budget spent`)
  } else if (opts.preExistingFailures === true) {
    skip('unit', SKIP_REASONS.PRE_EXISTING, 'the suite was already red before this change')
  } else if (!unitCommand) {
    skip('unit', missingReason, hasProfile ? 'profile has no unit.command' : undefined)
  } else {
    steps.push(
      step('unit', unitCommand, {
        cwd: trimmedString(unit.cwd) || '.',
        timeoutMs: int(unit.timeout_ms, null),
        filterSyntax: trimmedString(unit.filter_syntax),
        singleFile: trimmedString(unit.single_file),
        prerequisites: Array.isArray(unit.prerequisites) ? [...unit.prerequisites] : [],
        env: isObject(unit.env) ? { ...unit.env } : {}
      })
    )
  }

  // --- lint
  const lintCommand = trimmedString(opts.lintCommand) || trimmedString(lintSection.command)
  if (!wantLint) skip('lint', SKIP_REASONS.CALLER_OPTED_OUT)
  else if (budgetExceeded) {
    skip('lint', SKIP_REASONS.BUDGET_EXCEEDED, `${elapsedMs}ms of ${budgetMs}ms budget spent`)
  } else if (!lintCommand) {
    skip('lint', SKIP_REASONS.NO_COMMAND, 'no lint command was supplied by the caller')
  } else {
    steps.push(step('lint', lintCommand, { cwd: trimmedString(lintSection.cwd) || '.' }))
  }

  // --- coverage: advisory, always. Never blocking, whatever the number says.
  const coverageCommand = trimmedString(coverage.command)
  if (!wantCoverage) skip('coverage', SKIP_REASONS.CALLER_OPTED_OUT)
  else if (budgetExceeded) {
    skip('coverage', SKIP_REASONS.BUDGET_EXCEEDED, `${elapsedMs}ms of ${budgetMs}ms budget spent`)
  } else if (!hasProfile) skip('coverage', SKIP_REASONS.NO_PROFILE)
  else if (coverage.enabled === false || !coverageCommand) {
    skip('coverage', SKIP_REASONS.COVERAGE_NOT_CONFIGURED)
  } else {
    steps.push(
      step('coverage', coverageCommand, {
        reportPath: trimmedString(coverage.report_path),
        format: trimmedString(coverage.format) || 'lcov',
        advisory: true
      })
    )
  }

  // --- e2e: opt-in, run, never repaired.
  const e2eCommand = trimmedString(e2e.command)
  if (!wantE2e) skip('e2e', SKIP_REASONS.E2E_NOT_REQUESTED)
  else if (budgetExceeded) {
    skip('e2e', SKIP_REASONS.BUDGET_EXCEEDED, `${elapsedMs}ms of ${budgetMs}ms budget spent`)
  } else if (!hasProfile) skip('e2e', SKIP_REASONS.NO_PROFILE)
  else if (e2e.enabled !== true) skip('e2e', SKIP_REASONS.E2E_DISABLED)
  else if (!e2eCommand) skip('e2e', SKIP_REASONS.NO_COMMAND, 'profile has no e2e.command')
  else {
    steps.push(
      step('e2e', e2eCommand, {
        cwd: trimmedString(e2e.cwd) || '.',
        timeoutMs: int(e2e.timeout_ms, null),
        prerequisites: Array.isArray(e2e.prerequisites) ? [...e2e.prerequisites] : [],
        env: isObject(e2e.env) ? { ...e2e.env } : {},
        repairable: false
      })
    )
  }

  steps.sort((a, b) => VERIFY_KINDS.indexOf(a.kind) - VERIFY_KINDS.indexOf(b.kind))

  const banners = []
  if (!hasProfile) banners.push(BANNERS.noProfile)
  for (const s of skipped) banners.push(BANNERS.skipped(s.reason))

  return { steps, skipped, hasProfile, budgetMs, elapsedMs, budgetExceeded, banners }
}

// --- failure signatures ---------------------------------------------------

const ANSI = /\u001b\[[0-9;]*m/g
const SOURCE_EXT =
  'js|jsx|mjs|cjs|ts|tsx|mts|cts|py|go|rs|rb|java|kt|kts|swift|php|cs|scala|vue|svelte|json|ya?ml|html|css|snap|txt|log'

/**
 * Reduce one failure line to a root-cause signature by erasing the parts that
 * differ between two occurrences of the *same* cause: file paths, line/column
 * numbers, memory addresses, hashes, and timings. Everything else — the error
 * class, the message, the expected/actual values — is signal and survives.
 * @param {string} text
 * @returns {string}
 */
export function normalizeFailureSignature(text) {
  let s = String(text == null ? '' : text)
  s = s.replace(ANSI, '')
  s = s.replace(/\\/g, '/')
  s = s.replace(/[\r\n]+/g, ' ')
  // Common runner markers so "✕ foo" and "FAIL foo" do not fork a cluster.
  s = s.replace(/(^|\s)(?:[✕✗×✘●x])\s+/g, '$1')
  // Runner prefixes only — never the error class, which is signal.
  s = s.replace(/(^|\s)(?:FAIL(?:ED)?|not ok\s*\d*)[:\s]+/g, '$1')
  // Addresses and hashes before anything else — they can look like numbers.
  s = s.replace(/\b0x[0-9a-fA-F]+\b/g, '<addr>')
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
  s = s.replace(/\b[0-9a-f]{7,}\b/gi, '<hash>')
  // Timings.
  s = s.replace(/\b\d+(?:[.,]\d+)?\s?(?:ms|µs|us|ns|sec|secs|seconds?|s)\b/gi, '<time>')
  // Paths that contain a separator, with optional :line:col.
  s = s.replace(
    /(?:[A-Za-z]:)?(?:\.{0,2}\/)?(?:[\w.@+~-]+\/)+[\w.@+~-]+(?::\d+(?::\d+)?)?/g,
    '<path>'
  )
  // Bare filenames with a known extension, with optional :line:col.
  s = s.replace(new RegExp(`\\b[\\w.@+~-]+\\.(?:${SOURCE_EXT})\\b(?::\\d+(?::\\d+)?)?`, 'gi'), '<path>')
  // Whatever line/column references survived on their own.
  s = s.replace(/:\d+:\d+\b/g, ':<line>')
  s = s.replace(/\b(line|row|col|column)\s+\d+/gi, '$1 <n>')
  s = s.replace(/\((\d+):(\d+)\)/g, '(<line>)')
  return s.replace(/\s+/g, ' ').trim()
}

function failureText(failure) {
  if (typeof failure === 'string') return failure
  if (!isObject(failure)) return ''
  return (
    trimmedString(failure.message) ||
    trimmedString(failure.error) ||
    trimmedString(failure.text) ||
    trimmedString(failure.title) ||
    trimmedString(failure.test) ||
    trimmedString(failure.name) ||
    ''
  )
}

function failureTest(failure) {
  if (typeof failure === 'string') return failure
  if (!isObject(failure)) return ''
  return trimmedString(failure.test) || trimmedString(failure.name) || trimmedString(failure.title) || failureText(failure)
}

/**
 * Group failures by normalized error signature so a shared root cause is fixed
 * once instead of N times. Ordered by cluster size descending, so the caller
 * can spend its repair budget on the biggest cause first.
 *
 * Accepts raw failure lines (strings) or `{test, message, file, line}` objects
 * — both are things an agent can honestly transcribe from runner output.
 *
 * @param {Array<string|object>} failures
 * @returns {Array<{signature: string, count: number, tests: string[], files: string[],
 *   representative: string}>}
 */
export function clusterFailures(failures) {
  if (failures === undefined || failures === null) return []
  if (!Array.isArray(failures)) fail('failures must be an array of strings or objects')

  const map = new Map()
  for (const failure of failures) {
    const text = failureText(failure)
    const signature = normalizeFailureSignature(text)
    if (!signature) continue
    if (!map.has(signature)) {
      map.set(signature, { signature, count: 0, tests: [], files: [], representative: text })
    }
    const cluster = map.get(signature)
    cluster.count += 1
    const test = failureTest(failure)
    if (test && !cluster.tests.includes(test)) cluster.tests.push(test)
    const file = isObject(failure) ? trimmedString(failure.file) : null
    if (file && !cluster.files.includes(file)) cluster.files.push(file)
  }

  return [...map.values()].sort(
    (a, b) => b.count - a.count || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0)
  )
}

// --- judging --------------------------------------------------------------

/**
 * Shape every `judge*` function consumes. An agent produces all of it by
 * running the planned command and reading stdout:
 *
 *   { kind, command, exitCode, ran?, total?, passed?, failed?, skipped?,
 *     failures?: Array<string|{test,message,file,line}>, durationMs? }
 *
 * `exitCode` is always available; the counts come from the runner's own summary
 * line; `failures` are the failure lines copied verbatim. Nothing here requires
 * structured output that no test runner emits.
 */
function validateResult(result, kind) {
  if (!isObject(result)) fail(`${kind} result must be an object`)
  if (result.ran === false) return
  if (result.exitCode === undefined || result.exitCode === null) {
    fail(`${kind} result must include a numeric exitCode (or ran:false)`)
  }
  if (!Number.isFinite(Number(result.exitCode))) {
    fail(`${kind} result "exitCode" must be a number`)
  }
}

function countsOf(result) {
  return {
    total: int(result.total, null),
    passed: int(result.passed, null),
    failed: int(result.failed, null),
    skipped: int(result.skipped, null)
  }
}

// A suite that went green by shrinking is not green. Only honestly detectable
// when the caller supplies a baseline run: without one, we say so rather than
// pretend.
function detectWeakening(counts, baseline) {
  if (!isObject(baseline)) return { weakened: null, check: 'unavailable' }
  const base = countsOf(baseline)
  if (base.total === null && base.skipped === null) return { weakened: null, check: 'unavailable' }
  if (counts.total === null && counts.skipped === null) return { weakened: null, check: 'unavailable' }

  if (base.total !== null && counts.total !== null && counts.total < base.total) {
    return {
      weakened: {
        signal: 'total-decreased',
        detail: `test count fell from ${base.total} to ${counts.total} — tests were removed, not fixed`
      },
      check: 'ok'
    }
  }
  if (base.skipped !== null && counts.skipped !== null && counts.skipped > base.skipped) {
    return {
      weakened: {
        signal: 'skipped-increased',
        detail: `skipped tests rose from ${base.skipped} to ${counts.skipped} — failures were silenced, not fixed`
      },
      check: 'ok'
    }
  }
  return { weakened: null, check: 'ok' }
}

/**
 * Decide whether a unit result halts the run. A red unit suite is a hard halt,
 * expressed as a boolean the caller cannot reinterpret.
 *
 * @param {object} result see the shape note above
 * @param {{baseline?: object, preExistingFailures?: boolean|string[]}} [opts]
 *   `baseline` is the same shape, captured before the change — required for the
 *   weakened-suite check. `preExistingFailures` is `true` (everything was
 *   already red) or an array of signatures known to be red beforehand.
 * @returns {{halt: boolean, reason: string, status: string, ran: boolean,
 *   exitCode: number|null, counts: object, clusters: Array, weakened: object|null,
 *   weakenedCheck: string, preExisting: boolean, signals: Array}}
 */
export function judgeUnitResult(result, opts = {}) {
  validateResult(result, 'unit')
  if (!isObject(opts)) fail('verify options must be an object')

  const ran = result.ran !== false
  const exitCode = ran ? Number(result.exitCode) : null
  const counts = countsOf(result)
  const clusters = clusterFailures(result.failures)
  const signals = []

  if (!ran) {
    const reason = trimmedString(result.reason) || 'the unit command could not be executed'
    return {
      halt: true,
      reason: `unit suite did not run — ${reason}`,
      status: 'error',
      ran: false,
      exitCode: null,
      counts,
      clusters,
      weakened: null,
      weakenedCheck: 'unavailable',
      preExisting: false,
      signals: [{ level: 'halt', kind: 'unit', message: `unit suite did not run — ${reason}` }]
    }
  }

  const failedCount = counts.failed === null ? null : counts.failed
  const red = exitCode !== 0 || (failedCount !== null && failedCount > 0)

  const { weakened, check } = detectWeakening(counts, opts.baseline)
  if (weakened) {
    signals.push({ level: 'halt', kind: 'unit', message: `suite was weakened: ${weakened.detail}` })
  }
  if (check === 'unavailable') {
    signals.push({
      level: 'info',
      kind: 'unit',
      message: 'weakened-suite check unavailable — no baseline counts were supplied'
    })
  }

  // Excusing pre-existing failures: `true` excuses everything, an array of
  // signatures excuses only the clusters that match one of them.
  let preExisting = false
  if (red) {
    if (opts.preExistingFailures === true) preExisting = true
    else if (Array.isArray(opts.preExistingFailures) && opts.preExistingFailures.length) {
      const known = new Set(opts.preExistingFailures.map(normalizeFailureSignature))
      preExisting = clusters.length > 0 && clusters.every(c => known.has(c.signature))
    }
  }

  // A weakened suite outranks everything: it is the one way a "green" result is
  // still a halt.
  if (weakened) {
    return {
      halt: true,
      reason: `unit suite was weakened (${weakened.signal}) — ${weakened.detail}`,
      status: 'weakened',
      ran: true,
      exitCode,
      counts,
      clusters,
      weakened,
      weakenedCheck: check,
      preExisting,
      signals
    }
  }

  if (!red) {
    return {
      halt: false,
      reason: 'unit suite is green',
      status: 'green',
      ran: true,
      exitCode,
      counts,
      clusters,
      weakened: null,
      weakenedCheck: check,
      preExisting: false,
      signals
    }
  }

  const failedLabel = failedCount === null ? `exit ${exitCode}` : `${failedCount} failing`
  if (preExisting) {
    const message = `unit failures are pre-existing (${failedLabel}) — not caused by this change`
    signals.push({ level: 'warn', kind: 'unit', reason: SKIP_REASONS.PRE_EXISTING, message })
    return {
      halt: false,
      reason: SKIP_REASONS.PRE_EXISTING,
      status: 'red-pre-existing',
      ran: true,
      exitCode,
      counts,
      clusters,
      weakened: null,
      weakenedCheck: check,
      preExisting: true,
      signals
    }
  }

  const reason = `unit suite is red (${failedLabel}, ${clusters.length} root-cause cluster(s))`
  signals.push({ level: 'halt', kind: 'unit', message: reason })
  return {
    halt: true,
    reason,
    status: 'red',
    ran: true,
    exitCode,
    counts,
    clusters,
    weakened: null,
    weakenedCheck: check,
    preExisting: false,
    signals
  }
}

/**
 * Judge an e2e result. Structurally incapable of halting: e2e is run, never
 * repaired, and a red e2e is a banner, not a gate.
 * @param {object} result see the shape note above
 * @returns {{halt: false, blocking: false, passed: boolean, status: string,
 *   reason: string, repairable: false, clusters: Array, signals: Array}}
 */
export function judgeE2eResult(result, opts = {}) {
  validateResult(result, 'e2e')
  if (!isObject(opts)) fail('verify options must be an object')

  const ran = result.ran !== false
  const counts = countsOf(result)
  const exitCode = ran ? Number(result.exitCode) : null
  const failedCount = counts.failed
  const passed = ran && exitCode === 0 && (failedCount === null || failedCount === 0)
  const clusters = clusterFailures(result.failures)
  const signals = []

  let status
  let reason
  if (!ran) {
    status = 'error'
    reason = trimmedString(result.reason) || 'the e2e command could not be executed'
  } else if (passed) {
    status = 'green'
    reason = 'e2e suite is green'
  } else {
    status = 'red'
    reason = failedCount === null ? `exit ${exitCode}` : `${failedCount} failing`
  }

  if (!passed) {
    signals.push({
      level: 'warn',
      kind: 'e2e',
      message: BANNERS.e2eFailed(reason),
      banner: BANNERS.e2eFailed(reason)
    })
  }

  return {
    halt: false,
    blocking: false,
    passed,
    status,
    reason,
    repairable: false,
    counts,
    clusters,
    signals
  }
}

/**
 * Judge a coverage result. Advisory by construction — there is no return path
 * that sets `halt` or `blocking`, however bad the number is.
 * @param {object} result `{ exitCode, ran?, pct?, changedLines?, coveredLines?, perFile? }`
 * @returns {{halt: false, blocking: false, advisory: true, ran: boolean,
 *   pct: number|null, warnings: string[], signals: Array}}
 */
export function judgeCoverageResult(result, opts = {}) {
  if (!isObject(result)) fail('coverage result must be an object')
  if (!isObject(opts)) fail('verify options must be an object')

  const ran = result.ran !== false && result.exitCode !== undefined && Number(result.exitCode) === 0
  const perFile = Array.isArray(result.perFile) ? result.perFile.filter(isObject) : []

  let pct = typeof result.pct === 'number' && Number.isFinite(result.pct) ? result.pct : null
  const changedLines = int(result.changedLines, null)
  const coveredLines = int(result.coveredLines, null)
  if (pct === null && changedLines !== null && coveredLines !== null && changedLines > 0) {
    pct = Math.round((coveredLines / changedLines) * 1000) / 10
  }

  const warnings = perFile
    .filter(row => int(row.coveredLines, 0) === 0 && int(row.changedLines, 0) > 0)
    .map(row => `${row.path}: ${int(row.changedLines, 0)} changed line(s), 0 covered`)

  const signals = warnings.map(message => ({ level: 'info', kind: 'coverage', message }))
  if (!ran) {
    signals.push({
      level: 'info',
      kind: 'coverage',
      message: `coverage not measured — ${trimmedString(result.reason) || 'coverage command did not succeed'} (advisory)`
    })
  }

  return {
    halt: false,
    blocking: false,
    advisory: true,
    ran,
    pct,
    changedLines,
    coveredLines,
    perFile,
    warnings,
    signals
  }
}

/**
 * Roll a plan plus the results an agent reported back into one verdict.
 * @param {object} plan output of `planVerification`
 * @param {Array<object>} results one entry per executed step, each carrying `kind`
 * @param {{context?: 'inter-wave'|'final', baseline?: object,
 *   preExistingFailures?: boolean|string[]}} [opts]
 *   `context` selects the halting set — see `VERIFY_CONTEXTS`. Defaults to
 *   `final`. An unrecognised value is an error rather than a default, because
 *   quietly taking the permissive branch on a typo is how a hard halt goes
 *   missing.
 * @returns {{halt: boolean, reason: string|null, context: string, haltingKinds: string[],
 *   unit: object|null, e2e: object|null, coverage: object|null, signals: Array,
 *   banners: string[], skipped: Array}}
 */
export function judgeVerification(plan, results = [], opts = {}) {
  // Both halves matter: `skipped` is iterated below, so a hand-written plan
  // missing it would throw a raw TypeError instead of an actionable error.
  if (!isObject(plan) || !Array.isArray(plan.steps) || !Array.isArray(plan.skipped)) {
    fail('verification plan must come from planVerification (needs both "steps" and "skipped" arrays)')
  }
  if (!Array.isArray(results)) fail('verification results must be an array')
  if (!isObject(opts)) fail('verify options must be an object')

  const context = opts.context === undefined ? DEFAULT_VERIFY_CONTEXT : opts.context
  if (!Object.prototype.hasOwnProperty.call(VERIFY_CONTEXTS, context)) {
    fail(`verify context must be one of ${Object.keys(VERIFY_CONTEXTS).join('|')} (got "${context}")`)
  }
  const haltingKinds = VERIFY_CONTEXTS[context].haltingKinds

  const byKind = new Map()
  for (const r of results) {
    if (!isObject(r)) fail('each verification result must be an object')
    const kind = trimmedString(r.kind)
    if (!kind || !VERIFY_KINDS.includes(kind)) {
      fail(`verification result "kind" must be one of ${VERIFY_KINDS.join('|')}`)
    }
    byKind.set(kind, r)
  }

  const signals = []
  const banners = []
  if (!plan.hasProfile) banners.push(BANNERS.noProfile)
  for (const s of plan.skipped) {
    banners.push(BANNERS.skipped(s.reason))
    signals.push({
      level: 'info',
      kind: s.kind,
      reason: s.reason,
      message: `${s.kind}: ${BANNERS.skipped(s.reason)}${s.detail ? ` (${s.detail})` : ''}`
    })
  }

  let halt = false
  let reason = null

  // One expression covers both contexts: a blocking kind that failed halts if
  // and only if this call site's halting set contains it, and is otherwise
  // reported loudly enough that nobody mistakes the banner for silence.
  const record = (kind, failed, detail, how = {}) => {
    if (!failed) return
    if (haltingKinds.includes(kind)) {
      if (!how.alreadySignalled) signals.push({ level: 'halt', kind, message: detail })
      if (!halt) {
        halt = true
        reason = detail
      }
      return
    }
    const text = how.banner || detail
    signals.push({ level: 'warn', kind, message: text, banner: text })
    banners.push(text)
  }

  const typecheck = byKind.get('typecheck')
  if (typecheck) {
    validateResult(typecheck, 'typecheck')
    const ok = typecheck.ran !== false && Number(typecheck.exitCode) === 0
    const detail = typecheck.ran === false
      ? trimmedString(typecheck.reason) || 'the typecheck command could not be executed'
      : `exit ${Number(typecheck.exitCode)}`
    record('typecheck', !ok, `typecheck failed (${detail})`, {
      banner: BANNERS.typecheckFailed(detail)
    })
  }

  let unit = null
  if (byKind.has('unit')) {
    unit = judgeUnitResult(byKind.get('unit'), opts)
    signals.push(...unit.signals)
    // judgeUnitResult already emitted its own halt signal — do not double it.
    record('unit', unit.halt, unit.reason, { alreadySignalled: true })
  }

  const lint = byKind.get('lint')
  if (lint && lint.ran !== false && Number(lint.exitCode) !== 0) {
    signals.push({ level: 'warn', kind: 'lint', message: 'lint failed (non-blocking)' })
  }

  let coverage = null
  if (byKind.has('coverage')) {
    coverage = judgeCoverageResult(byKind.get('coverage'), opts)
    signals.push(...coverage.signals)
  }

  let e2e = null
  if (byKind.has('e2e')) {
    e2e = judgeE2eResult(byKind.get('e2e'), opts)
    signals.push(...e2e.signals)
    for (const s of e2e.signals) if (s.banner) banners.push(s.banner)
  }

  return {
    halt,
    reason,
    context,
    haltingKinds: [...haltingKinds],
    unit,
    e2e,
    coverage,
    signals,
    banners,
    skipped: plan.skipped
  }
}

// --- repair budget --------------------------------------------------------

/**
 * Decide what to do next against a red suite. Repair is bounded by
 * `LIMITS.rootCauseIterations` across the whole run, because repairing by root
 * cause is slow by design and an unbounded loop turns a ship into an open-ended
 * debugging session.
 *
 * @param {{iterationsUsed?: number, clusters?: Array, halt?: boolean,
 *   weakened?: object|null, preExisting?: boolean, maxIterations?: number}} state
 * @returns {{action: 'repair'|'halt'|'accept', reason: string,
 *   iterationsLeft: number, target: object|null}}
 */
export function nextRepairAction(state = {}) {
  if (!isObject(state)) fail('repair state must be an object')

  const max = int(state.maxIterations, null) ?? LIMITS.rootCauseIterations
  const used = Math.max(0, int(state.iterationsUsed, 0) ?? 0)
  const iterationsLeft = Math.max(0, max - used)
  const clusters = Array.isArray(state.clusters) ? state.clusters : []
  const target = clusters.length ? clusters[0] : null

  // Weakening is never repairable by another iteration — the previous iteration
  // is what caused it.
  if (state.weakened) {
    return {
      action: 'halt',
      reason: 'suite was weakened rather than fixed — revert the shrinking change',
      iterationsLeft,
      target: null
    }
  }

  if (state.preExisting === true) {
    return {
      action: 'accept',
      reason: SKIP_REASONS.PRE_EXISTING,
      iterationsLeft,
      target: null
    }
  }

  const stillRed = state.halt === true || clusters.length > 0
  if (!stillRed) {
    return { action: 'accept', reason: 'nothing left to repair', iterationsLeft, target: null }
  }

  if (iterationsLeft <= 0) {
    return {
      action: 'halt',
      reason: `root-cause repair budget exhausted (${max} iteration(s)) with ${clusters.length} cluster(s) unresolved`,
      iterationsLeft: 0,
      target: null
    }
  }

  return {
    action: 'repair',
    reason: target
      ? `repair the largest root cause first (${target.count} failure(s)): ${target.signature}`
      : 'repair the remaining failures by root cause',
    iterationsLeft,
    target
  }
}

// --- formatting -----------------------------------------------------------

function formatPlanOutput(plan) {
  const lines = []
  lines.push(
    `verification plan: ${plan.steps.length} step(s), ${plan.skipped.length} skipped` +
      (plan.hasProfile ? '' : ' (no test profile)')
  )
  if (plan.budgetExceeded) {
    lines.push(`  budget exceeded: ${plan.elapsedMs}ms of ${plan.budgetMs}ms — typecheck only`)
  }
  for (const s of plan.steps) {
    lines.push(`  [${s.blocking ? 'blocking' : 'advisory'}] ${s.kind}: ${s.command}`)
  }
  for (const s of plan.skipped) {
    lines.push(`  ${BANNERS.skipped(s.reason)} kind=${s.kind}${s.detail ? ` (${s.detail})` : ''}`)
  }
  if (!plan.hasProfile) lines.push(`  ${BANNERS.noProfile}`)
  return lines.join('\n') + '\n'
}

function formatVerdictOutput(verdict) {
  const lines = []
  const where = verdict.context ? ` [${verdict.context}]` : ''
  lines.push(
    verdict.halt
      ? `VERIFY HALT${where} — ${verdict.reason}`
      : `VERIFY OK${where} — nothing blocking`
  )
  for (const s of verdict.signals) lines.push(`  [${s.level}] ${s.kind}: ${s.message}`)
  return lines.join('\n') + '\n'
}

function formatUnitOutput(judgement) {
  const lines = []
  lines.push(judgement.halt ? `UNIT HALT — ${judgement.reason}` : `UNIT OK — ${judgement.reason}`)
  const { total, passed, failed, skipped } = judgement.counts
  if (total !== null || failed !== null) {
    lines.push(`  total=${total ?? '?'} passed=${passed ?? '?'} failed=${failed ?? '?'} skipped=${skipped ?? '?'}`)
  }
  for (const c of judgement.clusters) {
    lines.push(`  cluster x${c.count}: ${c.signature}`)
  }
  if (judgement.weakenedCheck === 'unavailable') {
    lines.push('  weakened-suite check unavailable (no baseline counts supplied)')
  }
  return lines.join('\n') + '\n'
}

/**
 * Human-readable rendering of a plan, a unit judgement, or a full verdict.
 * @param {object} value output of `planVerification`, `judgeUnitResult`, or `judgeVerification`
 */
export function formatVerification(value) {
  if (!isObject(value)) fail('nothing to format')
  if (Array.isArray(value.steps)) return formatPlanOutput(value)
  if (Array.isArray(value.banners)) return formatVerdictOutput(value)
  if (Array.isArray(value.clusters)) return formatUnitOutput(value)
  if (typeof value.action === 'string') {
    return `${value.action.toUpperCase()} — ${value.reason} (${value.iterationsLeft} iteration(s) left)\n`
  }
  fail('formatVerification expects a plan, a judgement, or a repair action')
}
