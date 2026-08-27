// Run workflows/ship.js against stubbed agents and capture every prompt it
// assembled.
//
// Why execute the script rather than grep it. `workflows/ship.js` builds a
// dozen prompts by concatenating template literals. A stray unary `+` in one of
// those chains is valid JavaScript: it coerces its operand to `NaN`, drops a
// whole instruction out of the assembled string, and leaves the source bytes
// completely intact. So `readFileSync` + `assert.match` — the technique every
// other prompt test in this repo used — passes on the broken file. Only the
// assembled output can see this class of defect, which is why the rule is
// "assemble, then assert" rather than "grep for the sentence".
//
// The script cannot be imported: the workflow runtime rejects a script
// containing `import()`, so ship.js has no exports and ends in a top-level
// `return`. It is instead read, stripped of its `export const meta` block, and
// evaluated inside an async function via `new Function` — the same trick
// test/spine/implementer-prompt.test.mjs already uses on one marked region,
// generalized to the whole script so coverage cannot quietly shrink to the
// prompts somebody remembered to mark.
//
// Deliberately Node-only: no network, no API key, no model. Every `agent()` is
// answered from a canned script.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHIP = join(ROOT, 'workflows', 'ship.js')

/** The coercion artifacts JavaScript produces when a concatenation goes wrong. */
export const COERCION_ARTIFACTS = ['NaN', 'undefined', '[object Object]', 'null']

/**
 * Which coercion artifacts an assembled prompt contains.
 *
 * `NaN`, `undefined` and `[object Object]` are flagged wherever they appear.
 * None of them has a legitimate use in a prompt: each is what JavaScript prints
 * when an interpolation lost its operand.
 *
 * `null` is different, and the difference is stated rather than papered over.
 * These prompts contain the word deliberately, in two shapes:
 *
 *   - a JSON value the agent is shown — `"blocker": null`, `"blocker":null`
 *   - English prose — "status ok means blocker is null", "leave the field null"
 *
 * Flagging those would make the check noise, and a noisy check gets muted. So
 * `null` is flagged only where it cannot be deliberate: quoted as a whole
 * string (`"null"`, which is what `change "${change}"` produces when `change`
 * is null), after an `=`, or glued to adjacent text. THE RESIDUAL IS REAL: a
 * coerced null landing in prose position — "leave the field null" produced by
 * an interpolation rather than typed — is not detectable from the assembled
 * string alone, and this helper does not claim otherwise.
 *
 * @param {string} prompt an assembled prompt
 * @returns {string[]} the artifacts found
 */
export function coercionArtifacts(prompt) {
  const text = String(prompt)
  const found = []
  for (const artifact of ['NaN', 'undefined', '[object Object]']) {
    if (text.includes(artifact)) found.push(artifact)
  }
  if (/["']null["']|=\s*null\b|[A-Za-z0-9_]null|null[A-Za-z0-9_]/.test(text)) found.push('null')
  return found
}

/**
 * The prompts a ship run assembles, by agent label. Labels ending in `-N` carry
 * the loop-step counter, so they are matched by prefix.
 *
 * This list is the coverage contract: `assertPromptCoverage` fails when one of
 * these is never assembled, so adding a prompt without extending the enumerated
 * runs is a test failure rather than a silent reduction in what is checked.
 */
export const EXPECTED_PROMPT_LABELS = Object.freeze([
  'validate',
  'plan-reuse',
  'plan-waves',
  'record-batch-',
  'tick-',
  'next-retry-',
  'inter-wave-verify-',
  'replan-',
  'merge-base-',
  'merge-lanes-',
  'review',
  'remediate-',
  'verify',
  'handoff',
  'commit',
  'record-outcome',
  'record-receipt'
])

/** ship.js with its `export const meta` block removed, so it can be evaluated. */
export function shipSource() {
  const text = readFileSync(SHIP, 'utf8')
  const body = text.replace(/^export const meta = \{[\s\S]*?^\}\n/m, '')
  if (body === text) {
    throw new Error('ship.js no longer opens with an `export const meta = {…}` block')
  }
  return body
}

/** A handoff packet the wave state machine would accept. */
export function handoffFor(id) {
  return {
    schema: 'interlock.wave-handoff/1',
    taskId: id,
    status: 'ok',
    summary: `did ${id}`,
    evidence: [`lib/a.mjs:1-2`],
    next: 'nothing',
    blocker: null
  }
}

function task(id, over = {}) {
  return { id, description: `task ${id}`, tier: 2, model: 'sonnet', paths: ['lib/a.mjs'], ...over }
}

/**
 * One per-task verdict, as `wave-state record-batch` reports it and the ping
 * copies it back.
 */
export function recordedOutcome(id, outcome = 'ok', reason) {
  return reason === undefined ? { id, outcome } : { id, outcome, reason }
}

/**
 * A `wave-state next` step, as the CLI would print it, wrapped for the ping.
 *
 * `recorded` is the third argument rather than a key in `extra` because it is
 * the one field these fixtures exist to be able to CONTRADICT (design.md —
 * Decision 7). Every response here used to be derived from the same lane
 * fixture as the agent's own claim, so a run where the agent claimed success
 * and the CLI recorded failure — routine in production — was unreachable in
 * tests, and the defect this change fixes passed the whole suite. It rides
 * beside `cliStdout` rather than inside it on purpose: the ping accumulates the
 * arrays of EVERY record-batch command it ran, while stdout is only the last
 * one's.
 */
export function stepResult(step, extra = {}, recorded = null) {
  const wrapped = { ...step, ...extra, cliStdout: JSON.stringify(step) }
  if (recorded) wrapped.recorded = recorded
  return wrapped
}

/**
 * The same step with no `cliStdout` — the agent's own transcription, and
 * nothing authoritative to prefer over it.
 *
 * Every other fixture here attaches stdout, which is the path the script
 * prefers and the only path these tests used to exercise. That is how a step
 * schema could go stale for a whole release: the fallback branch was reachable
 * in production on any turn the ping dropped the field, and unreachable here.
 */
export function stepResultNoStdout(step, extra = {}) {
  return { ...step, ...extra }
}

export const RUN_BATCH = stepResult({
  action: 'run-batch',
  wave: 1,
  waveIndex: 0,
  waveKind: 'impl',
  batchIndex: 0,
  batchCount: 1,
  // A batch holds LANES, and a lane holds tasks: one agent per lane. The
  // default is one lane of one task, which is the shape every pre-lane fixture
  // described and the shape a cap of 1 still produces.
  tasks: [[task('1.1')]],
  remainingBatches: [[[task('1.1')]]],
  previousHandoffs: [],
  changed: ['lib/a.mjs'],
  maxParallel: 8
})

export const DONE = stepResult({ action: 'done' })

/**
 * What the record-batch ping reports on the default one-task run: the run is
 * over, and the CLI recorded 1.1 as succeeded.
 *
 * The verdict is part of the DEFAULT fixture because a run whose recorded
 * outcomes never arrived is a degraded run that says so — so a default response
 * without it would make every unrelated test assert a claim-derived banner.
 */
export const RECORD_DONE = stepResult({ action: 'done' }, {}, [recordedOutcome('1.1', 'ok')])

/**
 * What the plan-reuse probe reports when the stored plan matched: the CLI's
 * verdict AND the first loop step, because the probe that establishes reuse is
 * the same ping that adopts the plan.
 */
export function reuseAdopted(step = RUN_BATCH, over = {}) {
  return {
    ...step,
    reuse: true,
    reuseStatus: 'match',
    reason: 'the stored plan still matches every input it was built from',
    noRemainingWork: false,
    ...over
  }
}

/** What it reports when there is nothing to reuse — the first-run default. */
export function reuseRebuilt(over = {}) {
  return {
    reuse: false,
    reuseStatus: 'no-plan',
    reason: 'no stored plan at .claude/ship/plan.json',
    ...over
  }
}

/**
 * The default answers. Every key is an agent label (or a label prefix ending in
 * `-`); the value is the result object, or a function of (label, callIndex).
 */
export function defaultResponses() {
  return {
    validate: {
      ok: true,
      change: 'demo-change',
      hasGraph: true,
      hasTestProfile: true,
      haikuAvailable: true
    },
    // The default is a first run: nothing stored, so the classifier runs. Tests
    // that want the reuse path answer this label with `reuseAdopted()`.
    'plan-reuse': reuseRebuilt(),
    'plan-waves': {
      ok: true,
      waveCount: 1,
      taskCount: 1,
      coverageOk: true,
      fingerprintWritten: true,
      ...RUN_BATCH
    },
    '1.1': { id: '1.1', ok: true, handoff: handoffFor('1.1') },
    // Only consulted under --isolate-waves; harmless everywhere else since the
    // script never assembles these labels unless the flag is set.
    'merge-base-': { mergeBase: 'deadbeef' },
    'merge-lanes-': { status: 'clean', folds: [{ lane: '1.1', files: ['lib/a.mjs'] }], collisions: [], unresolved: [] },
    'record-batch-': RECORD_DONE,
    // The tick runs on its own ping, after the record ping has reported what
    // the CLI recorded — the loop cannot know which ids to tick until then.
    'tick-': { ok: true },
    'inter-wave-verify-': DONE,
    'replan-': DONE,
    'next-retry-': DONE,
    review: { ok: true, raised: 2, dismissed: 1, droppedByQuality: 0, surviving: 1, blockers: 0 },
    'remediate-': { ok: true, blockersRemaining: 0, roundCap: 2, isFinalRound: false },
    verify: { ok: true, unitGreen: true, skipReasons: [] },
    handoff: { ok: true, manualTestPlan: false, skipReason: 'backend only' },
    commit: { ok: true, sha: 'deadbee' },
    'record-outcome': {
      ok: true,
      reconstructable: true,
      skippedVerificationReasons: [],
      capExhaustedVerifications: 0,
      unresolvedErrors: 0,
      planFingerprint: 'a'.repeat(64)
    },
    'record-receipt': { ok: true }
  }
}

/**
 * The receipt JSON a run handed its `record-receipt` ping, parsed back out of
 * the assembled prompt.
 *
 * Read from the prompt rather than from the script's internals on purpose: the
 * payload only matters if it survives assembly, and the transport is the one
 * step of the receipt's path that an agent can see.
 */
export function receiptFrom(prompts) {
  const prompt = prompts.find(p => p.label === 'record-receipt')
  if (!prompt) return null
  const m = /\{"type":"run-receipt".*?\}\n\n/s.exec(prompt.prompt)
  if (!m) return null
  return JSON.parse(m[0].trim())
}

/**
 * The corpus line a run handed its closing ping, parsed back out of the
 * assembled prompt.
 *
 * Read from the prompt for the same reason `receiptFrom` is: the payload only
 * matters if it survives assembly. It carries the reported half only — the
 * observed half is read off the receipt by `interlock outcomes append`, so a
 * test asserting on an observed value asserts on the receipt instead.
 */
export function outcomeFrom(prompts) {
  const prompt = prompts.find(p => p.label === 'record-receipt')
  if (!prompt) return null
  const m = /\{"change":.*?\}\nThen run: interlock outcomes append/s.exec(prompt.prompt)
  if (!m) return null
  return JSON.parse(m[0].slice(0, m[0].lastIndexOf('}') + 1))
}

/**
 * A stand-in for the workflow runtime's `budget`, whose cumulative counter
 * advances by `perRead` on every read.
 *
 * Monotonic and never repeating, so a per-wave delta that landed on the wrong
 * boundary produces a different number rather than the same one — a fixture
 * returning a constant would make every wrong attribution look right.
 *
 * `total` is null on purpose: that is what the runtime reports when no token
 * target was set, and it is the case a guard written against `budget.total`
 * would blank.
 */
export function countingBudget(perRead = 100) {
  let spent = 0
  const reads = []
  return {
    total: null,
    spent() {
      spent += perRead
      reads.push(spent)
      return spent
    },
    reads
  }
}

function lookup(responses, label) {
  if (Object.prototype.hasOwnProperty.call(responses, label)) return responses[label]
  for (const key of Object.keys(responses)) {
    if (key.endsWith('-') && label.startsWith(key)) return responses[key]
  }
  return null
}

/**
 * Execute ship.js with stubbed agents.
 *
 * @param {{args?: unknown, responses?: object, budget?: {total: number|null, spent: () => number}}} [opts]
 *   `responses` is merged over `defaultResponses()`. A value may be a function
 *   `(label, callIndex) => result` so a label answered twice can answer
 *   differently the second time. `budget` stands in for the workflow runtime's
 *   token accounting; omitted, the script sees no such global at all.
 * @returns {Promise<{prompts: Array<{label: string, prompt: string, model?: string}>,
 *   output: string, calls: string[]}>}
 */
export async function runShip(opts = {}) {
  const responses = { ...defaultResponses(), ...(opts.responses || {}) }
  const prompts = []
  const calls = []
  const seen = new Map()

  const agent = async (prompt, options = {}) => {
    const label = options.label || '(unlabeled)'
    const n = (seen.get(label) || 0) + 1
    seen.set(label, n)
    prompts.push({
      label,
      prompt: String(prompt),
      model: options.model,
      isolation: options.isolation
    })
    calls.push(label)
    const canned = lookup(responses, label)
    return typeof canned === 'function' ? canned(label, n) : canned
  }

  const pipeline = async (items, ...stages) =>
    Promise.all(
      (Array.isArray(items) ? items : []).map(async (item, i) => {
        let value = item
        for (const stage of stages) value = await stage(value, item, i)
        return value
      })
    )

  const parallel = async thunks => Promise.all((thunks || []).map(t => t()))
  const noop = () => {}

  // `budget` is a workflow-runtime global the script reads for token spend. It
  // is a parameter here rather than a fixture default so BOTH shapes are
  // reachable: a runtime that exposes accounting, and one that does not. Left
  // out, the parameter is `undefined` and `typeof budget === 'undefined'` holds
  // inside the script — which is the degrade path the ACP host actually takes,
  // and the one a bare reference would have thrown on.
  const run = new Function(
    'agent',
    'pipeline',
    'parallel',
    'log',
    'phase',
    'args',
    'budget',
    `return (async () => {\n${shipSource()}\n})()`
  )

  const output = await run(
    agent,
    pipeline,
    parallel,
    noop,
    noop,
    opts.args === undefined ? 'demo-change' : opts.args,
    opts.budget
  )
  return { prompts, output: String(output ?? ''), calls }
}

/** Every prompt an enumerated set of runs assembled, flattened. */
export async function collectPrompts(runs) {
  const all = []
  for (const run of runs) {
    const { prompts } = await runShip(run)
    all.push(...prompts)
  }
  return all
}

/**
 * The runs that between them reach every prompt in `EXPECTED_PROMPT_LABELS`,
 * including the ones only an opt-in flag or a fallback branch builds.
 */
export function coverageRuns() {
  return [
    // Lean: validate → one wave → verify → commit.
    {},
    // --strict: review, remediation and the handoff tail.
    { args: 'demo-change --strict' },
    // The verify action arriving at the top of the loop (the unfused fallback).
    {
      responses: {
        'record-batch-': stepResult({
          action: 'verify',
          wave: 1,
          waveIndex: 0,
          waveKind: 'impl',
          mode: 'initial',
          fixAttempt: 0,
          errors: [],
          changed: ['lib/a.mjs']
        }),
        'inter-wave-verify-': DONE
      }
    },
    // The replan action, and an unrecognized action forcing next-retry-N.
    {
      responses: {
        'record-batch-': stepResult({ action: 'replan', revisableGroups: [2], replansUsed: 0 }),
        'replan-': { action: 'report' },
        'next-retry-': DONE
      }
    },
    // The reuse path: the probe matched and adopted the plan, so the classifier
    // never runs. Enumerated here so the cheaper path is covered rather than
    // only the one every other run happens to take.
    { responses: { 'plan-reuse': reuseAdopted() } },
    // --isolate-waves: the merge-base and merge-lanes pings only ever get
    // assembled behind this flag.
    { args: 'demo-change --isolate-waves' }
  ]
}
