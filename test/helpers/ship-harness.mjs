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
  'plan-waves',
  'record-batch-',
  'next-retry-',
  'inter-wave-verify-',
  'replan-',
  'review',
  'remediate-',
  'verify',
  'handoff',
  'commit',
  'record-outcome'
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

/** A `wave-state next` step, as the CLI would print it, wrapped for the ping. */
export function stepResult(step, extra = {}) {
  return { ...step, ...extra, cliStdout: JSON.stringify(step) }
}

const RUN_BATCH = stepResult({
  action: 'run-batch',
  wave: 1,
  waveIndex: 0,
  waveKind: 'impl',
  batchIndex: 0,
  batchCount: 1,
  tasks: [task('1.1')],
  remainingBatches: [[task('1.1')]],
  previousHandoffs: [],
  changed: ['lib/a.mjs'],
  maxParallel: 8
})

const DONE = stepResult({ action: 'done' })

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
    'plan-waves': { ok: true, waveCount: 1, taskCount: 1, coverageOk: true, ...RUN_BATCH },
    '1.1': { id: '1.1', ok: true, handoff: handoffFor('1.1') },
    'record-batch-': DONE,
    'inter-wave-verify-': DONE,
    'replan-': DONE,
    'next-retry-': DONE,
    review: { ok: true, raised: 2, dismissed: 1, droppedByQuality: 0, surviving: 1, blockers: 0 },
    'remediate-': { ok: true, blockersRemaining: 0, roundCap: 2, isFinalRound: false },
    verify: { ok: true, unitGreen: true, skipReasons: [] },
    handoff: { ok: true, manualTestPlan: false, skipReason: 'backend only' },
    commit: { ok: true, sha: 'deadbee' },
    'record-outcome': { ok: true, reconstructable: true }
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
 * @param {{args?: unknown, responses?: object}} [opts]
 *   `responses` is merged over `defaultResponses()`. A value may be a function
 *   `(label, callIndex) => result` so a label answered twice can answer
 *   differently the second time.
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
    prompts.push({ label, prompt: String(prompt), model: options.model })
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

  const run = new Function(
    'agent',
    'pipeline',
    'parallel',
    'log',
    'phase',
    'args',
    `return (async () => {\n${shipSource()}\n})()`
  )

  const output = await run(
    agent,
    pipeline,
    parallel,
    noop,
    noop,
    opts.args === undefined ? 'demo-change' : opts.args
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
    }
  ]
}
