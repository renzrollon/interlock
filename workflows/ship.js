export const meta = {
  name: 'ship',
  description:
    'Take a reviewed OpenSpec change from tasks to commit in one uninterrupted run — dependency-ordered waves of parallel implementers, unit verification, and a commit. Asks nothing. Pass --strict for the previous default (adversarial review, handoff, conformance).'
}

// ship — the loop, as a script.
//
// This used to be `skills/ship/SKILL.md`: eleven numbered headings of prose that
// a model was asked to follow in order, including "cap two remediation rounds"
// and "more than two task failures halts the run". Prose caps are suggestions.
// A model that has just spent an hour on a change is not the right party to ask
// whether it has earned a third round.
//
// So the control flow lives here and the policy lives in `interlock`:
//
//   this script   holds the loop, the branching and the intermediate results
//   interlock CLI  decides what the loop is allowed to do next
//   agents        read files, write code, run commands
//
// The runtime loads no modules and gives the script no filesystem or shell
// access of its own, which is why every decision below is a `interlock`
// subcommand executed by an agent rather than a function call. That constraint
// turned out to be a feature: the policy is testable without a model, and the
// script cannot quietly reimplement a rule it was supposed to obey.
//
// The runtime also accepts no mid-run user input. That is the zero-touch
// contract, and it is now structural rather than aspirational — there is no
// AskUserQuestion to remove, because there is nobody listening. Every decision
// that might need a human has to be settled before this script starts.

// --- run configuration -----------------------------------------------------

// The Workflow tool delivers `args` as a string, a JSON array, or `{ change }`.
// Treating an array as "not an object" used to drop the name, so validate ran
// nameless against every active change and halted. parseInvocation is marked
// so tests can eval it without the runtime.
// PARSE_INVOCATION_START
function parseInvocation(args) {
  let value = args
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        value = JSON.parse(trimmed)
      } catch {
        value = trimmed
      }
    } else {
      value = trimmed
    }
  }
  const tokens = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(/\s+/).filter(Boolean)
      : []
  const opts = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
  const flags = new Set(
    (Array.isArray(opts.flags) ? opts.flags : []).concat(tokens.filter(t => t.startsWith('-'))).map(String)
  )
  const has = name => flags.has(name) || flags.has(`--${name}`) || opts[name] === true
  const named =
    (typeof opts.change === 'string' && opts.change.trim()) ||
    (typeof opts.name === 'string' && opts.name.trim()) ||
    ''
  const strict = has('strict')
  return {
    changeArg: named || tokens.find(t => !t.startsWith('-')) || '',
    applyOnly: has('apply-only'),
    noCommit: has('no-commit'),
    skipE2e: has('skip-e2e'),
    skipCoverage: has('skip-coverage'),
    review: strict || has('review'),
    handoff: strict || has('handoff'),
    conformance: strict || has('conformance'),
    strict,
    maxParallel: Number.isInteger(opts.maxParallel) ? opts.maxParallel : null,
    mode: opts.mode === 'continue' ? 'continue' : 'checkpoint'
  }
}
// PARSE_INVOCATION_END

// The text a wave implementer is handed is a contract, not a convenience. It
// used to be a template literal inline at the agent() call, which meant the
// tier ladder and the stop-on-green rule could be reworded by anyone editing
// nearby control flow and nothing would notice — the same drift caps had before
// they moved into lib/limits.mjs. Marked so tests can eval it without the
// runtime and compare the assembled text against fixtures.
//
// It stays in this file rather than in lib/: the runtime rejects a script that
// loads modules at all, so a shared module would have to be duplicated here —
// and a duplicated string is the drift this exists to catch.
// ASSEMBLE_IMPLEMENTER_PROMPT_START
function assembleImplementerPrompt({ change, lane, task, previousHandoffs }) {
  // A lane is the unit now; a bare `task` is still accepted and means a lane of
  // one. That is not politeness to old callers — a one-task lane MUST assemble
  // byte-identically to the pre-lane prompt, and sharing one code path is the
  // only way that stays true as this text is edited.
  const tasks = (Array.isArray(lane) && lane.length ? lane : [task]).filter(
    t => t && typeof t === 'object'
  )
  const first = tasks[0] || { id: '(unknown)', description: '', tier: 1 }
  // The lane runs on its hardest task's ladder: one agent must be briefed for
  // everything it is about to do, and a tier is a floor, not an average.
  const tier = tasks.reduce((m, t) => (Number.isInteger(t.tier) && t.tier > m ? t.tier : m), 0) || 1

  const packets = (Array.isArray(previousHandoffs) ? previousHandoffs : []).filter(
    h => h && typeof h === 'object'
  )

  // Empty renders nothing at all, so a first wave's prompt is byte-identical to
  // what it was before handoffs existed and its snapshot stays stable.
  const previous = packets.length
    ? `\nPREVIOUS WAVE (schema-validated; do not re-derive from git):\n` +
      packets
        .map(
          h =>
            `- [${h.taskId} ${h.status}] ${h.summary}\n` +
            `  evidence: ${(Array.isArray(h.evidence) ? h.evidence : []).join(', ')}\n` +
            `  next: ${h.next}` +
            (h.blocker ? `\n  blocker: ${h.blocker}` : '')
        )
        .join('\n') +
      `\n`
    : ''

  // A lane of one renders exactly the text it rendered before lanes existed —
  // the single-task fixtures are the pin that keeps that honest.
  const single = tasks.length === 1

  const heading = single
    ? `Implement exactly one task from OpenSpec change "${change}".\n\n` +
      `TASK ${first.id}: ${first.description}\n\n`
    : `Implement ${tasks.length} tasks from OpenSpec change "${change}", IN THIS ORDER. They edit ` +
      `the same files, so they are one lane run by you alone — nobody else is touching them ` +
      `while you work.\n\n` +
      tasks.map((t, i) => `TASK ${i + 1}/${tasks.length} — ${t.id}: ${t.description}`).join('\n') +
      `\n\n`

  const scope = single
    ? `- Implement ONLY this task. Do not modify files outside its scope.\n`
    : `- Implement ONLY these tasks, in the order listed. Do not modify files outside their scope.\n` +
      `- Finish a task before starting the next one. Do not skip ahead, and do not do a later ` +
      `task's work under an earlier task's name.\n` +
      `- STOP at the first task you cannot complete. Report it as failed and report every task ` +
      `after it as not-attempted — do not continue past a failure.\n`

  const handoff = single
    ? `\nHANDOFF — the next wave reads your packet instead of reconstructing your work ` +
      `from git, so every result MUST carry one:\n` +
      `  { "schema": "interlock.wave-handoff/1", "taskId": "${first.id}", ` +
      `"status": "ok" | "blocked" | "partial",\n` +
      `    "summary": "...", "evidence": ["path:12-40"], "next": "...", "blocker": null }\n`
    : `\nHANDOFF — the next wave reads your packets instead of reconstructing your work ` +
      `from git. Report an outcome for EVERY task you were given:\n` +
      `  { "tasks": [ { "id": "<task id>", "outcome": "ok" | "failed" | "not-attempted",\n` +
      `      "handoff": { "schema": "interlock.wave-handoff/1", "taskId": "<same id>", ` +
      `"status": "ok" | "blocked" | "partial",\n` +
      `        "summary": "...", "evidence": ["path:12-40"], "next": "...", "blocker": null } } ] }\n` +
      `- One packet per task you ATTEMPTED, keyed by its own id. One packet cannot stand in for ` +
      `several tasks.\n` +
      `- A "not-attempted" task carries no packet. That absence is expected, not an error.\n` +
      `- A result that omits a task you were given fails every task in this lane, so report all ` +
      `${tasks.length}.\n` +
      `- Do not pass a packet between your own tasks — you already know what you just did.\n`

  return (
    heading +
    `CONTEXT — read only what your tier needs:\n` +
    `  tier 1: the task description alone\n` +
    `  tier 2+: the relevant section of openspec/changes/${change}/design.md\n` +
    `  tier 3+: the relevant file under openspec/changes/${change}/specs/\n` +
    `  tier 4+: design.md and the specs in full\n` +
    `Your tier is ${tier}.\n\n` +
    `RULES:\n` +
    scope +
    `- Do not fix unrelated problems you notice; report them instead.\n` +
    `- Run typecheck and lint on what you changed.\n` +
    `- Do not commit, and do not edit tasks.md — the orchestrator owns both.\n` +
    `- If .claude/graph/graph.json exists, interlock-graph query / consumers before grep.\n` +
    `- Locate (graph or grep) then Read spans. Do not re-read a file unless it changed.\n` +
    `- Return the schema only. No narrative.\n` +
    (tier <= 2
      ? `- If your tier is 1 or 2: after typecheck/lint pass, stop. Do not refactor or polish.\n`
      : '') +
    previous +
    handoff +
    `- status "ok" means blocker is null; "blocked" and "partial" need a non-empty blocker.\n` +
    `- evidence is at most 8 locators (path, path:line, path:start-end) — never file bodies.\n` +
    `- Keep it terse. A packet over the character cap \`interlock limits\` publishes fails the ` +
    `task, and it is never truncated for you.\n\n` +
    (single
      ? `Report ok:false if you could not complete the task, with what blocked you.`
      : `Report outcome "failed" for the task that blocked you, with what blocked you.`)
  )
}
// ASSEMBLE_IMPLEMENTER_PROMPT_END

// --- lanes -----------------------------------------------------------------
//
// A batch holds lanes; a lane is an ordered task list one agent runs start to
// finish. The planner owns which tasks share a lane (lib/waves.mjs) — this
// script only dispatches what it is handed, which is why none of the logic
// below decides anything about membership.

// LANE_DISPATCH_START
/** The model a lane runs on: the one its hardest task was assigned. */
function laneModel(lane) {
  const tier = lane.reduce((m, t) => (Number.isInteger(t.tier) && t.tier > m ? t.tier : m), 0)
  const hardest = lane.find(t => t.tier === tier) || lane[0]
  return hardest && hardest.model
}

// LANE_EFFORT_START
// The reasoning effort a lane runs at — mirror of lib/waves.mjs `laneEffort`.
// The runtime loads no modules, so the tier→effort table (lib/limits.mjs EFFORT)
// is inlined here and a parity test guards the two copies against drift. Effort
// is the hardest task's tier, never the first task's. null = inherit the session
// default (do not force): tiers 3–4 by policy, an untiered lane (tier 0) by
// fallback.
function laneEffort(lane) {
  const tier = lane.reduce((m, t) => (Number.isInteger(t.tier) && t.tier > m ? t.tier : m), 0)
  const byTier = { 1: 'low', 2: 'low', 3: null, 4: null, 5: 'xhigh' }
  return byTier[tier] ?? null
}
// LANE_EFFORT_END

/** Stable across replays, so a resumed run cache-hits the lane it already ran. */
function laneLabel(lane) {
  return lane.length === 1 ? lane[0].id : `${lane[0].id}+${lane.length - 1}`
}

const HANDOFF_SCHEMA_SHAPE = {
  type: 'object',
  required: ['taskId', 'status', 'summary', 'next'],
  properties: {
    schema: { type: 'string' },
    taskId: { type: 'string' },
    status: { type: 'string' },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    next: { type: 'string' },
    blocker: { type: ['string', 'null'] }
  }
}

// filesChanged is what the agent touched; evidence is where the next wave
// should look. Neither substitutes for the other.
const SINGLE_TASK_SCHEMA = {
  type: 'object',
  required: ['id', 'ok', 'handoff'],
  properties: {
    id: { type: 'string' },
    ok: { type: 'boolean' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
    note: { type: 'string' },
    handoff: HANDOFF_SCHEMA_SHAPE
  }
}

// One outcome per task, with `not-attempted` distinct from `failed`: the tick
// must not mark a task nobody ran, and the failure budget must not be spent on
// one.
const LANE_SCHEMA = {
  type: 'object',
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'outcome'],
        properties: {
          id: { type: 'string' },
          outcome: { type: 'string' },
          filesChanged: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
          note: { type: 'string' },
          handoff: HANDOFF_SCHEMA_SHAPE
        }
      }
    }
  }
}

// Turn one lane's agent result into an outcome per task it was given.
//
// Fails CLOSED, in one direction only: a result that does not account for every
// task in the lane fails all of them, because a lane that reported on two of
// its three tasks has told us nothing about the third — and "nothing" read as
// success is how a task silently ships unimplemented. `not-attempted` is the
// one outcome that is neither: it is reported, ticked nowhere, and counted
// nowhere.
function laneOutcomes(lane, result) {
  const failAll = error => lane.map(t => ({ id: t.id, outcome: 'failed', error, handoff: null }))
  if (!result) return failAll('agent returned no result')

  if (lane.length === 1) {
    const [only] = lane
    return [
      {
        id: result.id || only.id,
        outcome: result.ok ? 'ok' : 'failed',
        error: result.error,
        filesChanged: result.filesChanged,
        handoff: result.handoff
      }
    ]
  }

  const entries = Array.isArray(result.tasks) ? result.tasks : null
  if (!entries) return failAll('lane result carried no per-task outcomes')

  const byId = new Map()
  for (const e of entries) {
    if (e && typeof e === 'object' && typeof e.id === 'string') byId.set(e.id, e)
  }
  const missing = lane.filter(t => !byId.has(t.id)).map(t => t.id)
  if (missing.length) {
    return failAll(`lane result omitted an outcome for ${missing.join(', ')}`)
  }

  return lane.map(t => {
    const e = byId.get(t.id)
    if (e.outcome === 'ok') {
      return {
        id: t.id,
        outcome: 'ok',
        error: e.error,
        filesChanged: e.filesChanged,
        handoff: e.handoff
      }
    }
    if (e.outcome === 'not-attempted') return { id: t.id, outcome: 'not-attempted' }
    // Anything else — including a value the schema let through — is a failure.
    // Guessing which of three named outcomes an unnamed one meant is exactly
    // the inference this schema exists to remove.
    return {
      id: t.id,
      outcome: 'failed',
      error: e.error || `lane reported outcome ${JSON.stringify(e.outcome)}`,
      filesChanged: e.filesChanged,
      handoff: e.handoff
    }
  })
}
// LANE_DISPATCH_END

// RECORDED_VERDICT_START
//
// One authority for "what did this task do": the outcome `wave-state
// record-batch` recorded, not the outcome the implementing agent reported for
// itself. The claim is the input the state machine adjudicated — an invalid or
// over-budget handoff packet fails its task — so where the two differ the
// recorded outcome is the one a tick and a tally are built from.
//
// Both hosts read this block, for the same reason both read LANE_DISPATCH: a
// second copy of "which of two disagreeing observations is the run's" would
// drift, and both hosts would still look correct.

/** The three outcomes a batch can record. Anything else is not a verdict. */
const RECORDED_OUTCOMES = ['ok', 'failed', 'not-attempted']

/**
 * The recorded verdicts carried on a record-batch step, validated.
 *
 * One malformed entry invalidates the whole payload rather than being skipped:
 * a partial verdict read as a complete one is the defect this exists to close,
 * one level down. `null` means "no verdict arrived" and puts the caller on the
 * loud claim-derived fallback.
 */
function recordedOutcomes(step) {
  const raw = step && Array.isArray(step.recorded) ? step.recorded : null
  if (!raw || !raw.length) return null
  const out = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null
    if (typeof entry.id !== 'string' || !entry.id.trim()) return null
    if (!RECORDED_OUTCOMES.includes(entry.outcome)) return null
    out.push({
      id: entry.id.trim(),
      outcome: entry.outcome,
      reason: typeof entry.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : ''
    })
  }
  return out
}

/**
 * What to tick, what to tally, and which claims the run had to override.
 *
 * @param {Array<Array<{id: string, ok: boolean, error?: string}>>} batches the
 *   claims the run sent to `record-batch`, one array per batch, in command order
 * @param {Array<{id: string, outcome: string, reason: string}>|null} recorded
 *   the verdicts those commands reported, concatenated in the same order
 * @returns {{claimDerived: boolean, tickIds: string[],
 *   waves: Array<{ok: number, failed: number, failedIds: string[], recordedNotAttempted: string[]}>,
 *   overrides: Array<{id: string, outcome: string, reason: string}>}}
 */
function adjudicateBatches(batches, recorded) {
  const claims = batches.flat()
  // Every claim must have a verdict, or there is no verdict: a payload covering
  // three of five tasks would otherwise tally the other two from the claim
  // while reading as fully recorded.
  const covered = Boolean(recorded) && claims.every(c => recorded.some(o => o.id === c.id))
  const verdicts = covered ? recorded : null
  const rowsOf = batch =>
    batch.map(claim => {
      const found = verdicts ? verdicts.find(o => o.id === claim.id) : null
      return {
        id: claim.id,
        outcome: found ? found.outcome : claim.ok ? 'ok' : 'failed',
        reason: found ? found.reason : typeof claim.error === 'string' ? claim.error : ''
      }
    })

  const perBatch = batches.map(rowsOf)
  const rows = perBatch.flat()
  return {
    claimDerived: !verdicts,
    tickIds: rows.filter(r => r.outcome === 'ok').map(r => r.id),
    waves: perBatch.map(batchRows => ({
      ok: batchRows.filter(r => r.outcome === 'ok').length,
      failed: batchRows.filter(r => r.outcome === 'failed').length,
      failedIds: batchRows.filter(r => r.outcome === 'failed').map(r => r.id),
      recordedNotAttempted: batchRows.filter(r => r.outcome === 'not-attempted').map(r => r.id)
    })),
    overrides: rows.filter((row, i) => verdicts && (row.outcome === 'ok') !== claims[i].ok)
  }
}

/**
 * An overridden claim is a finding, not a silent correction. A run that quietly
 * fixed up five bad handoffs is indistinguishable from a clean one; a run that
 * says it overrode five claims tells its reader the implementer prompt or the
 * handoff contract needs attention.
 */
function overrideBanner(overrides) {
  const detail = overrides
    .map(o => `${o.id}: ${o.outcome}${o.reason ? ` — ${o.reason}` : ''}`)
    .join('; ')
  return (
    `CLAIM OVERRIDDEN: ${overrides.map(o => o.id).join(', ')} — the implementing agent reported ` +
    `otherwise and the run acted on what it recorded (${detail})`
  )
}

/**
 * The fallback said out loud. Silent fallback would reintroduce the defect in
 * the one case nobody would think to check — an older CLI, or a ping that lost
 * the field — and a count that was never read must not read as one that came
 * back clean.
 */
function claimDerivedBanner() {
  return (
    'CLAIM-DERIVED TALLIES: record-batch reported no usable per-task outcomes, so this wave was ' +
    'ticked and counted from what the implementing agents claimed rather than from what the run recorded'
  )
}
// RECORDED_VERDICT_END

// A reviewer used to be handed a dimension NAME and nothing else, while 6,833
// bytes of written criteria sat unread in skills/review-code/dimensions/. Six
// reviewers produced findings with no rubric, and two skeptics per finding then
// spent their budget adversarially verifying them. Roughly 285 tokens per agent
// buys the criteria the review was designed around, which is the cheaper half.
//
// The script has no filesystem, so the reading is delegated — but the rubric is
// not optional, and a dimension whose file cannot be read is a named
// degradation rather than a reviewer quietly proceeding on the name alone.
//
// `technical-lead` is the canonical name: it is what the rubric file is called.
// README and the review-code frontmatter used to call the same dimension
// `delivery`, which meant `--dimensions delivery` matched nothing at all.
const RUBRIC_INSTRUCTIONS =
  `RUBRIC — before dispatching a reviewer, read ` +
  `\${CLAUDE_PLUGIN_ROOT}/skills/review-code/dimensions/<dimension>.md and include that file's ` +
  `criteria in that reviewer's instructions. Each reviewer gets its OWN dimension's criteria and ` +
  `no other's. Dimension names are the rubric filenames — language, architecture, qa, ` +
  `technical-lead, devops, security. A name that resolves to no rubric file is rejected, never ` +
  `silently matched to nothing.\n` +
  `If a dimension's criteria cannot be read, list that dimension in missingRubrics rather than ` +
  `dispatching a reviewer with an empty rubric — a review run without criteria is reported, not ` +
  `assumed equivalent.\n\n`

// Where the remediation loop is in its budget. Rounds 1..cap are fix passes and
// round cap+1 is the verdict — so the bound is `roundCap`, never a literal.
// `roundCap` is the CLI's (`interlock remediate` reads LIMITS.remediationRounds);
// this function only arranges rounds around it, which is why raising the cap
// buys exactly one more fixing round and moves the verdict round with it.
//
// A cap the CLI did not state yields 'unknown' rather than a default. Guessing
// a bound is how a bounded loop becomes an open-ended one.
// REMEDIATION_BUDGET_START
function remediationBudget({ round, roundCap, blockersRemaining }) {
  if (!Number.isInteger(roundCap) || roundCap < 1) return { phase: 'unknown', next: null }
  if (round > roundCap) return { phase: 'verdict', next: null }
  // Nothing left to fix: skip straight to the verdict so the budget is still
  // formally closed rather than assumed.
  if (blockersRemaining === 0) return { phase: 'fix', next: roundCap + 1 }
  return { phase: 'fix', next: round + 1 }
}
// REMEDIATION_BUDGET_END

const {
  changeArg,
  applyOnly,
  noCommit,
  skipE2e,
  skipCoverage,
  review,
  handoff,
  conformance,
  strict,
  maxParallel,
  mode
} = parseInvocation(typeof args === 'undefined' ? undefined : args)

// A structurally impossible run should stop before it burns agents, and a loop
// whose exit condition depends on model output needs a backstop that does not.
// The runtime caps a run at 1000 agents; this stops long before that.
const MAX_LOOP_STEPS = 200

const banners = []
// `plan` starts null rather than assuming a path: a run that halted before the
// reuse check reported has to say so, because "we never found out" and "there
// was no prior plan" are different facts and only one of them is free.
// `spend` is one entry per wave, `outputTokens` the run total, both filled from
// the runtime's own accounting below. They start empty and unset rather than at
// zero for the same reason `plan` starts null: a run that never measured must
// not read as a run that measured nothing.
const summary = { waves: [], spend: [], outputTokens: undefined, halted: null, notes: [], closing: null, plan: null }

// --- token spend -----------------------------------------------------------
//
// `budget` is a workflow-runtime global — `{total, spent(), remaining()}` — and
// is read through three guards, none of which is paranoia:
//
//   1. `typeof budget === 'undefined'`. The ACP host evaluates parts of this
//      file with no such global, and a bare reference would throw a
//      ReferenceError rather than degrade.
//   2. `budget.spent` is a function. A runtime that stops exposing accounting
//      partway through a run must leave the later waves unmeasured, not fail
//      them.
//   3. NOT `budget.total`. It is null whenever no token target was given, while
//      `spent()` stays perfectly meaningful — guarding on it would blank the
//      measurement on every ordinary run.
//
// Every failure path returns null, never 0 and never a throw: a run must not die
// over its own bookkeeping, and an unmeasured wave must not read as a free one.
function spentTokens() {
  try {
    if (typeof budget === 'undefined' || !budget || typeof budget.spent !== 'function') return null
    const n = Number(budget.spent())
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
  } catch {
    return null
  }
}

// The reading the run opened at, and the reading at the last wave boundary.
const spendOpenedAt = spentTokens()
let spendMark = spendOpenedAt

/**
 * Close the current wave span and attribute its measured delta to `wave`.
 *
 * Called at the point the script closes a wave — beside the `summary.waves`
 * push, and after the inter-wave verification ping — and nowhere else, so the
 * script's notion of a wave boundary and the recorded attribution come from one
 * place. Two derivations of "where a wave ended" would drift, and spend would
 * land on the wrong wave with nothing to reveal it.
 *
 * Keyed by wave rather than pushed blindly: a wave that closes an
 * implementation span and then a verification span has two measured deltas and
 * one wave. Adding two measured figures is not the same as inventing a split of
 * one, which is why the deltas are summed and never divided.
 *
 * A wave whose span could not be measured records null. It is never assumed to
 * be zero on the grounds that no implementer ran — a verification-only span
 * still spends the orchestrator's turns.
 */
function markWaveSpend(wave) {
  const now = spentTokens()
  const delta = now === null || spendMark === null ? null : Math.max(0, now - spendMark)
  if (now !== null) spendMark = now
  const key = wave === undefined || wave === null || !String(wave).trim() ? 'unnumbered' : String(wave)
  const found = summary.spend.find(s => s.wave === key)
  if (!found) summary.spend.push({ wave: key, outputTokens: delta })
  else if (delta !== null) found.outputTokens = found.outputTokens === null ? delta : found.outputTokens + delta
}

// Computed once and used twice: the banner a human reads and the receipt a
// later process reads are the same list, so they cannot disagree. Two call
// sites would reintroduce exactly the divergence `degradationLines()` exists to
// remove, one level up — an accumulator can only report what someone remembered
// to push, and two derivations can only agree by luck.
let degradationsOnce = null

const STATE = '.claude/ship/state.json'
const WORK = '.claude/ship'

// Spawn prefix. Dual-write `type` (plugin agent) and `tools` (allowlist) so a
// runtime that ignores one key still shrinks the inherited catalog. Unknown
// keys are ignored; an omitted tools list is the ~40k floor (system tools plus
// the Skill listing). Keep these four literals identical to lib/host.mjs
// PING_AGENT / WORKER_AGENT / PING_TOOLS / WORKER_TOOLS — the workflow runtime
// rejects module loading, so these cannot live in lib/host.mjs alone.
const PING_AGENT = 'interlock:ping'
const WORKER_AGENT = 'interlock:worker'
const PING_TOOLS = ['Bash', 'Read', 'Write']
const WORKER_TOOLS = ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash']
const workerExtra = { type: WORKER_AGENT, tools: WORKER_TOOLS }
const pingExtra = { type: PING_AGENT, tools: PING_TOOLS }

// The two adversarial steps run at a fixed effort regardless of any lane tier —
// they are the steps whose job is catching what an implementer missed. Mirror of
// lib/limits.mjs EFFORT.verify / EFFORT.skeptic; the runtime loads no modules,
// so the value is inlined here the same way the lane tier→effort table is.
const VERIFY_EFFORT = 'xhigh'
const SKEPTIC_EFFORT = 'xhigh'

// Agents report structured results so the script can branch on a value rather
// than on a sentence. Every schema below is deliberately small: anything the
// script does not branch on stays in the agent's own context.
const step = (name, prompt, schema, extra = {}) =>
  agent(
    `${prompt}\n\nYou are one step of an automated ship run. Do not ask questions — ` +
      `there is no one listening. If something is undecidable, put it in the result ` +
      `fields rather than guessing at product intent.`,
    { label: name, schema, ...workerExtra, ...extra }
  )

// Mechanical CLI pings: the script cannot run the binary, but they do not need
// a large model. haiku is the same slug the planner already assigns to tier 1.
//
// Asking haiku to "report" a step taught it to set action:"report". The ping
// copies stdout; an unknown action is a relay miss, not a new state-machine
// verb. Do not enum-constrain action — a forced valid value is a silent wrong
// branch, and a loud halt after one retry is cheaper than skipping a wave.
const NEXT_ACTIONS = new Set(['run-batch', 'test-wave', 'verify', 'replan', 'done', 'halt'])
const COPY_STDOUT =
  'Copy stdout JSON into the result, including the raw stdout string in cliStdout. ' +
  'action must be copied from stdout. Never invent action. ' +
  'Allowed values: run-batch, test-wave, verify, replan, done, halt.'

// A step reaches this script transcribed by an agent — the script has no shell,
// so nothing here ever reads `wave-state` stdout itself. The schema is therefore
// the only thing telling that agent which shape to copy, and a step travels on
// more than one schema: the control-plane pings use `nextSchema`, and the
// classifier reports the first step on its own result.
//
// When batches widened from `Task[][]` to `Lane[][]`, only `nextSchema` was
// widened. The classifier kept the pre-lane `tasks` and never declared
// `remainingBatches` at all — and an undeclared property passes validation
// holding anything, so a model told to "copy stdout JSON" with no slot to copy
// into wrote a list of task ids and the wave loop crashed on it. Hence one
// statement of the shape, read by every schema that carries a step.
const TASK_SHAPE = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    description: { type: 'string' },
    tier: { type: 'integer' },
    model: { type: 'string' },
    paths: { type: 'array', items: { type: 'string' } }
  }
}
/** A batch: the lanes scheduled together. One agent runs one lane, in order. */
const BATCH_SHAPE = { type: 'array', items: { type: 'array', items: TASK_SHAPE } }
/**
 * batches → lanes → tasks. The middle level is the lane: one agent runs
 * everything inside it, in order. Flattening any level here would put the run
 * back on one agent per task without anything saying so.
 */
const REMAINING_BATCHES_SHAPE = { type: 'array', items: BATCH_SHAPE }

const STEP_FIELDS = {
  action: { type: 'string' },
  cliStdout: { type: 'string' },
  wave: { type: 'integer' },
  // The current batch, which is `remainingBatches[0]`: an array of lanes.
  tasks: BATCH_SHAPE,
  remainingBatches: REMAINING_BATCHES_SHAPE,
  // Sits beside remainingBatches because it belongs to the same step: one
  // `next` hands over a whole wave plus what the wave before it reported.
  // If the ping drops the field the implementers simply get no previous-wave
  // block — inventing "reconstruct it from git log" instructions instead
  // would put back exactly the inference this replaced.
  previousHandoffs: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        schema: { type: 'string' },
        taskId: { type: 'string' },
        status: { type: 'string' },
        summary: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } },
        next: { type: 'string' },
        blocker: { type: ['string', 'null'] }
      }
    }
  },
  changed: { type: 'array', items: { type: 'string' } }
}

const nextSchema = {
  type: 'object',
  required: ['action'],
  properties: {
    ...STEP_FIELDS,
    reason: { type: 'string' },
    mode: { type: 'string' },
    fixAttempt: { type: 'integer' },
    ok: { type: 'boolean' },
    halted: { type: 'boolean' },
    skipped: { type: 'boolean' },
    // `interlock tasks tick` exits non-zero on an id it cannot mark. The ping
    // reports that here so the loop can name it, rather than a completed task
    // silently staying unchecked and reading downstream as a failure.
    tickFailed: { type: 'boolean' },
    tickMissing: { type: 'array', items: { type: 'string' } },
    // What `record-batch` recorded for each task in the batch it just recorded:
    // the field the tick list and the per-wave tallies are built from. The ping
    // accumulates one array per record command, in command order, because a
    // catch-up loop of three batches would otherwise report the last batch's
    // outcomes as the whole wave's.
    recorded: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          outcome: { type: 'string' },
          reason: { type: 'string' }
        }
      }
    },
    // The plan-reuse probe reports on the same ping that adopts the plan, so
    // its answer travels on this schema rather than on one of its own. `reuse`
    // is the only affirmative: anything else — including a missing field — is a
    // rebuild, and `reuseStatus` names which of the CLI's outcomes it was.
    reuse: { type: 'boolean' },
    reuseStatus: { type: 'string' },
    noRemainingWork: { type: 'boolean' },
    taskCount: { type: 'integer' },
    laneCount: { type: 'integer' }
  }
}

// bedrock.claude-haiku-4-5 is not reachable in every account (Bedrock model
// access is opt-in per model), and a step that cannot run halts the whole
// loop at the same point on every retry. Validate probes reachability once;
// when haiku is available, pingExtra.model is set so these pings do not inherit
// a sonnet session. Mutate pingExtra rather than rebinding it — cheap closes
// over the object. type and tools were set above; do not replace the object.
const cheap = (name, prompt, extra = {}) => step(name, prompt, nextSchema, { ...pingExtra, ...extra })

// `wave-state next` only logs the *implementer* spawns it names in its own
// tasks[] (design.md "Agent spawns") — it has no way to know about the
// mechanical ping that is about to run this very prompt. One extra
// `run-log append` inside the same prompt covers that spawn without paying a
// second agent turn, so `record-batch-*` / `inter-wave-verify-*` / `replan-*`
// each report themselves as a `kind: "ping"` spawn before doing their real work.
const pingSpawnLine = (label, kind = 'ping') =>
  `Also log this step as a spawn: read "runId" from ${STATE}, write ` +
  `{ "type": "agent-spawn", "runId": "<that id>", "change": "${change}", "label": "${label}", ` +
  `"kind": "${kind}" } to ${WORK}/spawn-${label}.json, then run: ` +
  `interlock run-log append --event ${WORK}/spawn-${label}.json --root .\n` +
  `This never fails the run: a non-zero exit or written:false is reported and ignored.\n\n`

// STEP_SHAPE_START
/**
 * The batches the wave loop will dispatch from a step.
 *
 * Stated here rather than inline at the loop so the check below and the loop
 * itself cannot disagree about which field they are looking at — a validator
 * that passes a payload the loop then rejects is worse than no validator.
 */
function batchesOf(step) {
  return step && Array.isArray(step.remainingBatches) && step.remainingBatches.length
    ? step.remainingBatches
    : [step && Array.isArray(step.tasks) ? step.tasks : []]
}

/**
 * Whether a step carries work the loop can actually dispatch: batches → lanes →
 * tasks, every level a non-empty array, every task an object with an id.
 *
 * Named an action is not the same as carries a wave. A `run-batch` transcribed
 * as a list of task ids satisfies every schema that never declared the field,
 * and it used to reach `lanes.some(...)` and throw — killing the run outside
 * `halt`, so no outcome was recorded and no trajectory was closed. Steps that
 * dispatch nothing (`verify`, `replan`, `done`, `halt`) carry no batches and
 * are not judged on them.
 */
function dispatchableShape(step) {
  if (!step) return false
  if (step.action !== 'run-batch' && step.action !== 'test-wave') return true
  const batches = batchesOf(step)
  const taskOk = t => t && typeof t === 'object' && typeof t.id === 'string' && t.id.trim()
  const laneOk = lane => Array.isArray(lane) && lane.length > 0 && lane.every(taskOk)
  const batchOk = lanes => Array.isArray(lanes) && lanes.length > 0 && lanes.every(laneOk)
  return batches.length > 0 && batches.every(batchOk)
}
// STEP_SHAPE_END

/**
 * The step objects an agent's result could be, in the order they are trusted:
 * the CLI's own stdout first, then the fields the agent mapped by hand.
 */
function stepCandidates(result) {
  const candidates = []
  if (result && typeof result.cliStdout === 'string') {
    try {
      const parsed = JSON.parse(result.cliStdout)
      if (parsed && NEXT_ACTIONS.has(parsed.action)) candidates.push(parsed)
    } catch {
      // stdout was not JSON; fall through to the mapped action
    }
  }
  if (result && NEXT_ACTIONS.has(result.action)) candidates.push(result)
  return candidates
}

function stepFromAgent(result) {
  const resolved = stepCandidates(result).find(dispatchableShape) || null
  if (!resolved) return null
  // record-verify's stdout is the *next* step, which carries neither the skip
  // flag nor the tick outcome. The agent still reports both on its own result,
  // and both are things the run has to say out loud, so they are carried over
  // rather than lost to the stdout preference above.
  const carried = {}
  if (result.skipped && !resolved.skipped) {
    carried.skipped = result.skipped
    carried.reason = result.reason
  }
  if (result.tickFailed) {
    carried.tickFailed = true
    carried.tickMissing = result.tickMissing
  }
  // The accumulated verdicts beat the resolved step's own: `cliStdout` is the
  // LAST record-batch command's output, so on a catch-up loop it holds one
  // batch's outcomes while the agent's own field holds every batch's.
  if (Array.isArray(result.recorded)) carried.recorded = result.recorded
  return Object.keys(carried).length ? { ...resolved, ...carried } : resolved
}

// A succeeded task whose checkbox could not be marked. Reported, never
// discarded: downstream, an unchecked box is indistinguishable from a task
// that failed.
function noteTickFailure(step) {
  if (!step || !step.tickFailed) return
  const ids = Array.isArray(step.tickMissing) ? step.tickMissing.filter(Boolean) : []
  banners.push(
    `TASK TICK FAILED: could not mark ${ids.length ? ids.join(', ') : 'one or more succeeded task id(s)'} ` +
      `complete — the work was done, the checkbox was not`
  )
}

// `steps` is the loop cursor, closed over so a retry gets a unique label.
// nextStep is pure — re-reading state does not mutate it. A new label
// cache-misses only this ping; implementer labels stay stable.
async function readNext(raw) {
  const resolved = stepFromAgent(raw)
  if (resolved) return resolved
  const retry = await cheap(
    `next-retry-${steps}`,
    `Run: interlock wave-state next --state ${STATE} --json\n\n` + COPY_STDOUT
  )
  const retried = stepFromAgent(retry)
  if (retried) return retried
  // Both reads were refused, for one of two different reasons, and naming the
  // wrong one sends the next person to the wrong place. A known action that was
  // still refused is a shape failure: the step said run-batch and did not carry
  // batches of lanes of tasks.
  const misshapen = [retry, raw].flatMap(stepCandidates)[0]
  if (misshapen) {
    return {
      action: 'halt',
      reason:
        `misshapen ${misshapen.action} step from the state machine: a dispatchable step must ` +
        `carry batches of lanes of tasks, and this one did not — state was re-read once and ` +
        `came back the same`
    }
  }
  const invented = (retry && retry.action) || (raw && raw.action) || '(none)'
  return { action: 'halt', reason: `unrecognized step from the state machine: ${invented}` }
}

// Set once validate resolves the change. `halt` can fire before that, so the
// outcome record reads this rather than the `change` binding below, which is
// not initialized yet on the earliest failure path.
let resolvedChange = changeArg || '(unresolved)'

// The closing step: it shuts the trajectory and reports the values nothing
// else in this run has seen.
//
// It used to compose the corpus line too, handing this agent the halt state,
// the remediation rounds and the surviving blocker count under the sentence
// "Correct any field that does not match what actually happened". Those are
// values the script observed, and that sentence let the party being assessed
// rewrite the assessment's inputs — in the one file whose entire purpose is to
// answer "should we have skipped the human that time?". The corpus line is now
// written after the receipt, from the receipt (`appendReceipt` below), and this
// step is asked only for the four values that live in the wave state and the
// suite result, where nothing else in the run can reach them.
const recordOutcome = async () => {
  // The trajectory's closing event mirrors what this same ping already knows —
  // whether the run halted — so closing it costs no extra agent turn. A halted
  // run gets run-halt with the halt reason; every other exit (apply-only,
  // no-commit, or a clean finish) gets run-complete with whatever tasks are
  // still failed and unticked.
  const closeEvent = summary.halted
    ? { type: 'run-halt', reason: summary.halted }
    : { type: 'run-complete', leftoverTaskIds: leftoverIds() }

  const result = await step(
    'record-outcome',
    `Close this run out: report what only you can see, and shut its trajectory.\n\n` +
      `First, find out what this run left behind — every task still unchecked, not only the ones ` +
      `that failed. A halt can leave whole waves that never ran, and those are exactly what a ` +
      `later reader needs named:\n` +
      `  interlock validate --change ${resolvedChange} --json\n` +
      `Report every "id" from its tasks.items whose "done" is false as leftoverTaskIds, copied ` +
      `exactly and in the order given. Do not derive them from tasks.md yourself, do not include ` +
      `an item whose id is null, and if the command fails leave the field out entirely — omitted ` +
      `means unknown, and unknown must never be reported as an empty list.\n\n` +
      `Also close the run trajectory. Read "runId" from ${STATE} and add it as "runId" to this ` +
      `object, then write the result to ${WORK}/run-log-close.json:\n` +
      JSON.stringify(closeEvent) +
      (summary.halted
        ? ''
        : `\nReplace its "leftoverTaskIds" with the same list you just read from validate — the ` +
          `event and your reported field must not disagree.`) +
      `\nThen run: interlock run-log append --event ${WORK}/run-log-close.json --root .\n` +
      `This also never fails a run: a non-zero exit or written:false is reported and ignored.\n\n` +
      `Finally, check the trajectory is reconstructable:\n` +
      `  interlock run-log check --state ${STATE} --json\n` +
      `Report its exit as reconstructable:<bool>, and if it was non-zero, copy its "problems" ` +
      `array (joined) into reconstructabilityDetail. This one DOES matter: an incomplete ` +
      `trajectory means the run cannot be reconstructed later, which is itself a reason to halt.\n\n` +
      `Then report the four values nothing else in this run has seen. They go into the corpus as ` +
      `REPORTED — your reading of the run, labelled as such. The run's own measurements (whether ` +
      `it halted, rounds consumed, blockers surviving, wave tallies, the commit sha) are recorded ` +
      `separately from its receipt and are not yours to supply, correct or confirm.\n` +
      `  - unitGreen: whether the unit suite was green at the end of this run\n` +
      `Read ${STATE} for the other three, so the summary can say what the run accepted rather ` +
      `than infer it from an empty list:\n` +
      `  - skippedVerificationReasons: every "reason" in the state's skippedVerifications\n` +
      `  - capExhaustedVerifications: how many of those have reason "${capExhaustedSkipReason()}"\n` +
      `  - unresolvedErrors: the number of entries in the state's "unresolved" array\n` +
      `Report 0 / [] when the state says so. Leave a field out entirely rather than guessing it: ` +
      `omitted means unknown, and unknown is reported as unknown, never as clean.\n\n` +
      `Also read ${WORK}/plan-fingerprint.json and report its "hash" string as planFingerprint, ` +
      `copied exactly. It identifies which plan over which artifacts this run executed, so a reader ` +
      `holding neither repository can tell two runs of the same plan apart from two different ones. ` +
      `Report the hash only — never the plan's contents. If the file is missing or unreadable, leave ` +
      `the field out.`,
    {
      type: 'object',
      required: ['ok'],
      properties: {
        ok: { type: 'boolean' },
        detail: { type: 'string' },
        reconstructable: { type: 'boolean' },
        reconstructabilityDetail: { type: 'string' },
        // The reported group. Every one is optional on purpose: an omitted
        // field is unknown, and unknown must never arrive as a clean value.
        unitGreen: { type: 'boolean' },
        skippedVerificationReasons: { type: 'array', items: { type: 'string' } },
        capExhaustedVerifications: { type: 'integer' },
        unresolvedErrors: { type: 'integer' },
        planFingerprint: { type: 'string' },
        leftoverTaskIds: { type: 'array', items: { type: 'string' } }
      }
    },
    { model: 'haiku' }
  )

  // The closing step's own outcome is part of the degradation block, so it is
  // stored rather than only returned. A run that never reached here leaves this
  // null, which prints as "unknown".
  summary.closing = result || null

  // A run that was otherwise clean but left an incomplete trajectory is still
  // a halt — reconstructability is the gate this whole change exists for, not
  // a second-class bookkeeping concern the way outcomes.jsonl is.
  if (result && result.reconstructable === false && !summary.halted) {
    summary.halted = `ship-run trajectory is not reconstructable: ${result.reconstructabilityDetail || 'see interlock run-log check'}`
  }

  return result
}

// Appended after `recordOutcome()`, because its inputs are not complete until
// the closing step has reported: `summary.closing` carries the skip reasons,
// the cap exhaustion count and the unresolved-error count the receipt records,
// and `degradationLines()` reads that same field.
//
// A run that dies between the closing step and this append leaves no receipt.
// That is deliberately not papered over — `run-log list` says "no receipt
// recorded" for a closed run, because "the run did not reach its own close" is
// a finding rather than missing data.
const appendReceipt = async () => {
  const receipt = buildReceipt({
    change: resolvedChange,
    summary,
    degradations: resolveDegradations(),
    planFingerprint: summary.closing ? summary.closing.planFingerprint : undefined,
    leftoverTaskIds: leftoverIds()
  })

  // The corpus line's reported half, and only that half. The observed half is
  // not here and is not transportable: `interlock outcomes append` reads it off
  // the receipt this same step just appended, so the receipt and the corpus
  // line cannot disagree about one run. A field the closing step could not read
  // is left out rather than sent as a clean value.
  const reported = {}
  const closing = summary.closing || {}
  if (typeof closing.unitGreen === 'boolean') reported.unitGreen = closing.unitGreen
  if (Array.isArray(closing.skippedVerificationReasons)) {
    reported.skippedVerificationReasons = closing.skippedVerificationReasons
  }
  if (Number.isFinite(closing.capExhaustedVerifications)) {
    reported.capExhaustedVerifications = closing.capExhaustedVerifications
  }
  if (Number.isFinite(closing.unresolvedErrors)) reported.unresolvedErrors = closing.unresolvedErrors
  const outcome = { change: resolvedChange, mode, reported }

  await step(
    'record-receipt',
    `Append the run's receipt to its trajectory, then record its corpus line.\n\n` +
      `Write this JSON to ${WORK}/run-receipt.json exactly as given, byte for byte:\n` +
      JSON.stringify(receipt) +
      `\n\nThis is the run's own record of what it observed, not yours. Do not adjust, correct, ` +
      `re-derive, reorder or add to any field, and do not drop one that looks wrong — a value you ` +
      `changed in transit is worse than the value the run measured, because nothing downstream can ` +
      `tell the two apart. That includes the measurements: "spend" and "outputTokens" were read from ` +
      `the runtime's own counter by the script, and a figure you sanity-checked, corrected or ` +
      `re-derived would stop being a measurement and become a report. The ONE field you add is ` +
      `"runId", read from ${STATE}.\n\n` +
      `Then run: interlock run-log append --event ${WORK}/run-receipt.json --root .\n\n` +
      `This never fails a run: a non-zero exit or a written:false result is reported and ignored, ` +
      `like every other trajectory append. Losing the receipt must never fail the run that earned it.\n\n` +
      `Then, and only after that append, record one line in the learning corpus. Write this JSON ` +
      `to ${WORK}/outcome.json exactly as given, byte for byte, adding nothing:\n` +
      JSON.stringify(outcome) +
      `\nThen run: interlock outcomes append --record ${WORK}/outcome.json --state ${STATE} --root .\n\n` +
      `It carries only what a step could see. What the run measured is read by that command from ` +
      `the receipt you just appended — which is why the order matters, and why there is nothing ` +
      `here for you to reconcile against it. Report its "written" value as outcomeWritten.\n\n` +
      `This never fails a run either: losing a corpus line must never fail the run that produced it.`,
    {
      type: 'object',
      required: ['ok'],
      properties: {
        ok: { type: 'boolean' },
        detail: { type: 'string' },
        outcomeWritten: { type: 'boolean' }
      }
    },
    { model: 'haiku' }
  )
}

// The one close every exit path takes: record the outcome, then the receipt,
// then print. Written once rather than at each of the five `return finish()`
// sites, because a path that recorded an outcome and skipped its receipt would
// leave the least explicable runs the least explained.
const closeRun = async () => {
  // The run total, read once on the way out. Not the sum of the per-wave
  // deltas: everything outside a wave span — validation, planning, review,
  // remediation, the commit — is in this figure and in none of those, and
  // adding the parts up would silently under-report the whole.
  const spentAtClose = spentTokens()
  summary.outputTokens =
    spentAtClose === null || spendOpenedAt === null ? null : Math.max(0, spentAtClose - spendOpenedAt)
  await recordOutcome()
  await appendReceipt()
  return finish()
}

const halt = async reason => {
  summary.halted = reason
  // A halted run is the most informative record in the corpus, so it is written
  // on the way out rather than skipped as a failure.
  return closeRun()
}

// --- 1. resolve and validate ----------------------------------------------

const validateCmd = changeArg
  ? `interlock validate --change ${changeArg} --json`
  : 'interlock validate --json'

const loaded = await step(
  'validate',
  `Resolve the OpenSpec change${changeArg ? ` named "${changeArg}"` : ' to ship'} and validate it.\n\n` +
    `Run exactly: ${validateCmd}\n\n` +
    (changeArg
      ? `Do not omit --change ${changeArg}. Do not run a nameless validate. Do not list changes and pick one.\n\n`
      : `If that exits because multiple changes are active, report ok:false with the candidates — do not pick one.\n\n`) +
    `A non-zero exit means the change is not implementable — report ok:false with the CLI reason ` +
    `and stop; do not attempt repairs.\n\n` +
    `Unchecked tasks are the work this run implements. A change with 0 checked boxes is the normal ` +
    `starting state, not a reason to halt.\n\n` +
    `Also run: printenv CLAUDE_CODE_SUBAGENT_MODEL\n` +
    `If it prints a value, report it as subagentModelOverride. If it is unset the command exits ` +
    `non-zero and prints nothing — that is the normal case, so leave the field out rather than ` +
    `reporting an empty string.\n\n` +
    `Then run: printenv CLAUDE_CODE_USE_BEDROCK; printenv AWS_BEDROCK\n` +
    `If subagentModelOverride is set, leave haikuAvailable out — routing is already overridden.\n` +
    `If either Bedrock variable prints a non-empty value other than 0 or false, report ` +
    `haikuAvailable:false. Bedrock accounts often cannot reach haiku and a failed ping halts the loop.\n` +
    `Otherwise report haikuAvailable:true. When unsure, haikuAvailable:false so pings inherit ` +
    `the session model rather than hard-failing.\n\n` +
    `Then create the working directory ${WORK}/ and report the resolved change name.`,
  {
    type: 'object',
    required: ['ok', 'change'],
    properties: {
      ok: { type: 'boolean' },
      change: { type: 'string' },
      detail: { type: 'string' },
      hasGraph: { type: 'boolean' },
      graphReason: { type: 'string' },
      hasTestProfile: { type: 'boolean' },
      subagentModelOverride: { type: 'string' },
      haikuAvailable: { type: 'boolean' }
    }
  }
)

if (!loaded || !loaded.ok) {
  return await halt(`validate failed: ${(loaded && loaded.detail) || 'no result from the validate step'}`)
}

const change = loaded.change
resolvedChange = change

if (loaded.hasGraph === false) {
  banners.push(
    `GRAPH UNAVAILABLE: ${loaded.graphReason || 'never built'} — implementer and reviewer agents fall back to grep and will be slower`
  )
}
if (loaded.hasTestProfile === false) {
  banners.push('NO TEST PROFILE: run /interlock:fix-tests --reconfigure once')
}
// CLAUDE_CODE_SUBAGENT_MODEL overrides both the session model and the per-agent
// model this script asks for, so when it is set the planner's tier ladder — the
// opus clamp, the haiku pings — is not in effect and the run costs whatever that
// model costs. Nothing here can prevent that; it is the user's environment. But a
// summary claiming no degradation while the entire model ladder was bypassed is
// exactly the silence the banner block exists to remove.
const subagentModel =
  typeof loaded.subagentModelOverride === 'string' ? loaded.subagentModelOverride.trim() : ''
if (subagentModel) {
  banners.push(
    `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=${subagentModel} — every agent runs on ` +
      `that model, so the per-tier assignment in the plan is not in effect`
  )
} else if (loaded.haikuAvailable === true) {
  pingExtra.model = 'haiku'
}

// --- 2. reuse the plan if it provably still fits, otherwise classify -------
//
// `plan-waves` is the most expensive fixed step of a run: it reads proposal.md,
// design.md, tasks.md and every delta spec in full, and it used to re-run
// unconditionally — including on a second invocation of the same change minutes
// later. So the run first asks whether the stored plan still matches the inputs
// it was built from, and only classifies when that cannot be established.
//
// Reuse is never assumed. `interlock plan reuse` exits 0 either way and names
// its outcome, and this script treats anything other than an affirmative match
// as a rebuild — including an error while checking. The direction is deliberate:
// failing to prove reuse costs a classifier run, which is exactly what happens
// today, while wrongly reusing would run the wrong plan.

const maxParallelFlag = maxParallel ? ` --max-parallel ${maxParallel}` : ''

const reuseProbe = await cheap(
  'plan-reuse',
  `Decide whether the stored execution plan for change "${change}" can be reused.\n\n` +
    `Run: interlock plan reuse --change ${change}${maxParallelFlag} --json\n\n` +
    `That command never fails: it prints { reuse, status, reason, noRemainingWork, narrowedPath }. ` +
    `Copy reuse into this result as reuse, status as reuseStatus, reason as reason, and ` +
    `noRemainingWork as noRemainingWork. Copy them as printed — never infer reuse:true from a ` +
    `plan file existing, and never rewrite the reason.\n\n` +
    `If reuse is false, or noRemainingWork is true, STOP THERE. Do not create a run state, do not ` +
    `classify anything, and leave action out of your result.\n\n` +
    `If reuse is true and noRemainingWork is false, adopt the plan in this same turn using the ` +
    `narrowedPath from that JSON:\n` +
    `  interlock wave-state create --plan <narrowedPath> --change ${change} --json${maxParallelFlag} > ${STATE}\n\n` +
    `Log the run start: read "runId" from ${STATE}, write ` +
    `{ "type": "run-start", "runId": "<that id>", "change": "${change}", "mode": "${mode}", ` +
    `"strict": ${strict} } to ${WORK}/run-start.json, then run: ` +
    `interlock run-log append --event ${WORK}/run-start.json --root .\n` +
    `This never fails the run: a non-zero exit or written:false is reported and ignored.\n\n` +
    `  interlock wave-state next --state ${STATE} --json\n\n` +
    COPY_STDOUT +
    `\nThat last stdout is the first loop step. If any command in the adopt sequence exits ` +
    `non-zero, report reuse:false with the reason — a plan that cannot be turned into a run state ` +
    `is not a plan that was reused.`
)

const reused = Boolean(reuseProbe && reuseProbe.reuse === true)
const reuseStatus =
  (reuseProbe && typeof reuseProbe.reuseStatus === 'string' && reuseProbe.reuseStatus) ||
  (reuseProbe ? 'unreported' : 'check-failed')
const reuseReason =
  (reuseProbe && typeof reuseProbe.reason === 'string' && reuseProbe.reason.trim()) ||
  (reuseProbe
    ? 'the plan-reuse check reported no reason'
    : 'the plan-reuse step returned no result')

// Every task in the stored plan is already ticked. That is not an empty run to
// dispatch — it is a change with nothing left to do, and creating a zero-batch
// run would report a clean ship that implemented nothing.
if (reused && reuseProbe.noRemainingWork === true) {
  summary.plan = { reused: true, status: reuseStatus, reason: reuseReason }
  summary.notes.push(
    'NO REMAINING WORK: every task in the stored plan is already complete — nothing was dispatched'
  )
  // Chose not to commit, rather than never found out: nothing was dispatched,
  // so there was nothing to commit. See `buildReceipt`'s `committed`.
  summary.commitSkipped = true
  return closeRun()
}

// The adopted step, when the probe both matched AND turned the plan into a run
// state. A probe claiming reuse without producing a step is a rebuild: the plan
// was never adopted, whatever it said about matching.
const adopted = reused ? stepFromAgent(reuseProbe) : null

summary.plan = adopted
  ? { reused: true, status: reuseStatus, reason: reuseReason }
  : {
      reused: false,
      status: reused ? 'adopt-failed' : reuseStatus,
      reason: reused
        ? `the matching plan could not be turned into a run state (${reuseReason})`
        : reuseReason
    }

const planned = adopted
  ? null
  : await step(
  'plan-waves',
  `For OpenSpec change "${change}": read proposal.md, design.md, tasks.md and specs/**/*.md in full — ` +
    `this is the artifact leash and is not subject to bounded retrieval.\n\n` +
    `Classify every UNCHECKED task with: id, group (wave number), description, tier 1-5, model, ` +
    `isTestTask, paths, and dependsOn.\n\n` +
    `GROUPING — four rules, in order:\n` +
    `  1. Default group to the numbered tasks.md section (1.x → group 1, 2.x → group 2).\n` +
    `  2. A shared file is NOT a reason for a new group. Put the predicted edit paths in \`paths\` ` +
    `and let the planner fold colliding tasks into one LANE of the SAME wave — an ordered task ` +
    `list run by a single agent. Inventing a new group to avoid a file clash costs a verification ` +
    `cycle; naming the path costs nothing and saves a spawn.\n` +
    `  3. A dependency on a task editing a DIFFERENT file is a reason for a \`dependsOn\` EDGE, ` +
    `not a reason to increment \`group\`. Incrementing \`group\` to order one cross-file dependency ` +
    `serializes every task in the new group that is independent of it; an edge orders only the ` +
    `dependent task, so its independent siblings keep sharing a batch. Prefer the edge.\n` +
    `  4. Only add a group for a LATER NUMBERED SECTION that needs an earlier section's output ` +
    `to already exist. The next sequential slice of the same file is NOT a new group — it stays ` +
    `in that file's section group and becomes a later batch. Groups run sequentially; tasks in a ` +
    `group are otherwise independent.\n\n` +
    `\`paths\` is your best prediction of the repo-relative files the task will edit. Predict what you ` +
    `can and OMIT the field when you genuinely cannot — an invented path serializes a batch for ` +
    `nothing, while an omitted one only leaves things as they were.\n\n` +
    `\`dependsOn\` is the array of ids of EARLIER tasks whose output this task needs — the file it ` +
    `imports, the type it consumes, the helper it calls. Populate it whenever that is true, and ` +
    `omit it otherwise. Every id must name a task in this same classification, must not point at ` +
    `a later numbered section, and must not point at a test task; the edges must not form a cycle. ` +
    `A dangling id, a backward edge or a cycle FAILS the plan rather than being dropped, so declare ` +
    `only dependencies you can point at.\n\n` +
    // The unary `+` that used to sit here coerced the next operand to NaN, so
    // tiers 1-3 and the haiku routing rule never reached the classifier — and
    // the sentence stayed intact in these bytes, which is why every
    // source-text assertion passed. test/spine/planner-prompt.test.mjs now
    // asserts the ASSEMBLED string instead.
    `Tier 1 trivial one-file edit → haiku. Tier 2 single-concern change. Tier 3 new logic in one ` +
    `domain. Tier 4 cross-file work following existing patterns — a mechanical refactor across many ` +
    `files is tier 4 sonnet, because breadth is not depth. Tier 5 only for genuinely novel ` +
    `architecture, and only tier 5 may be opus. When unsure, sonnet.\n\n` +
    `Write the classification to ${WORK}/classified.json, then run:\n` +
    `  interlock tasks coverage --change ${change} --classified ${WORK}/classified.json --json\n` +
    `Copy coverage ok and omitted into this result as coverageOk and omitted. Never invent ` +
    `coverageOk:true if that CLI exited non-zero. A coverage gap means you omitted a checkbox — ` +
    `add it and rewrite classified.json before calling waves.\n\n` +
    `Then:\n` +
    `  interlock waves --classified ${WORK}/classified.json --json${maxParallelFlag} > ${WORK}/plan.json\n` +
    `  interlock plan fingerprint --change ${change} --write${maxParallelFlag} --json\n` +
    `That stores the fingerprint of the artifacts this plan was derived from, so a later run of the ` +
    `same unedited change reuses this plan instead of re-reading everything. Report its "written" ` +
    `value as fingerprintWritten. It never fails the run: a non-zero exit or written:false costs the ` +
    `NEXT run a classifier pass, which is what every run used to pay.\n` +
    `  interlock wave-state create --plan ${WORK}/plan.json --change ${change} --json > ${STATE}\n\n` +
    `Log the run start: read "runId" from ${STATE}, write ` +
    `{ "type": "run-start", "runId": "<that id>", "change": "${change}", "mode": "${mode}", ` +
    `"strict": ${strict} } to ${WORK}/run-start.json, then run: ` +
    `interlock run-log append --event ${WORK}/run-start.json --root .\n` +
    `This never fails the run: a non-zero exit or written:false is reported and ignored.\n\n` +
    `  interlock wave-state next --state ${STATE} --json\n\n` +
    COPY_STDOUT +
    `\nThe last command's stdout is the first loop step (action, tasks, wave, cliStdout). ` +
    `coverageOk is from the coverage command, not from next.\n\n` +
    `The planner is authoritative: it clamps over-eager opus, orders the waves, defers test tasks ` +
    `and splits wide waves into batches. Do not re-derive or override any of it.\n\n` +
    `Report the plan's wave count and total task count.`,
  {
    type: 'object',
    required: ['ok', 'waveCount', 'taskCount', 'coverageOk'],
    properties: {
      ok: { type: 'boolean' },
      waveCount: { type: 'integer' },
      taskCount: { type: 'integer' },
      coverageOk: { type: 'boolean' },
      omitted: { type: 'array', items: { type: 'string' } },
      fingerprintWritten: { type: 'boolean' },
      detail: { type: 'string' },
      // This result carries the first loop step, so it declares the step shape
      // from the same statement the pings use. It used to declare its own,
      // narrower version: `tasks` as a flat task list and no `remainingBatches`
      // whatsoever. `additionalProperties` is deliberately left open — the
      // classifier legitimately reports fields a step does not have, and a
      // rejected result costs a whole classifier pass.
      ...STEP_FIELDS
    }
  }
)

// Both gates below belong to the classifier and are skipped on the reuse path —
// not as a shortcut, but because neither question applies: there is no fresh
// classification to have failed, and coverage was checked when this plan was
// built. What guards the reused plan is the fingerprint: an added, removed,
// reordered or reworded task changes the hash and sends the run back through the
// classifier, which is where coverage is enforced.
if (planned) {
  if (!planned.ok) {
    return await halt(`wave planning failed: ${planned.detail || 'no result from the planner step'}`)
  }

  const coverageOk = Boolean(planned.coverageOk)
  const omitted = Array.isArray(planned.omitted) ? planned.omitted : []
  if (!coverageOk) {
    return await halt(
      `plan omitted unchecked tasks: ${omitted.join(', ') || planned.detail || 'classified.json does not cover remaining checkboxes'}`
    )
  }
  if (planned.fingerprintWritten === false) {
    banners.push(
      'PLAN FINGERPRINT NOT STORED: this plan cannot be proven current later, so the next run ' +
        'will re-classify every artifact from scratch'
    )
  }
} else if (!adopted) {
  // Unreachable by construction — `planned` is null only when `adopted` is a
  // step — but a loop entered with neither would run zero waves and report a
  // clean ship, so it is refused rather than trusted.
  return await halt('neither a reused plan nor a fresh classification produced a first step')
}

// --- 3. the wave loop ------------------------------------------------------
//
// Every branch below comes from `interlock wave-state next`. The script does not
// decide when to verify, when a replan is allowed, or when accumulated failures
// have exhausted the budget — it asks, and obeys.
//
// record-* / replan pass --write-state so their stdout IS the next step. That
// saves a second agent turn after every batch. The planner already ran the first
// `next`, so the loop starts from that result. An unknown action is retried once
// via `next-retry-*` (pure re-read, new label) rather than treated as a policy halt.

let steps = 0
// On the reuse path the first step came from the probe that adopted the plan; on
// the rebuild path it came from the classifier's final `wave-state next`. Either
// way the loop starts from a step somebody already paid for.
let next = adopted || (await readNext(planned))

while (steps++ < MAX_LOOP_STEPS) {
  if (!next) return await halt('the run state could not be read')
  if (next.action === 'done') break
  if (next.action === 'halt' || next.halted) return await halt(next.reason || 'the run state halted')

  if (next.action === 'run-batch' || next.action === 'test-wave') {
    const remaining = batchesOf(next)
    const accumulated = []
    // Per batch, everything a summary line needs that the recorded outcomes do
    // not carry. Held rather than pushed on the spot: the tallies are built
    // after the record commands report what they recorded, so a batch that ran
    // three batches ago still gets its own line — counted from the verdict.
    const pending = []
    // Captured before the record ping, which replaces `next` with the step
    // AFTER this wave.
    const waveNumber = next.wave
    const waveKind = next.action
    // The wave's changed-file set, taken from the plan rather than recomputed
    // from raw `task.paths`. `wave-state next` canonicalizes and deduplicates
    // it (lib/waves.mjs `uniquePaths`), so one file spelled two ways is one
    // entry here instead of inflating the set a verification is scoped to.
    const wavePaths = Array.isArray(next.changed) ? next.changed.filter(p => typeof p === 'string' && p.trim()) : []

    for (let i = 0; i < remaining.length; i++) {
      const lanes = remaining[i]
      // `readNext` refuses a misshapen step before it reaches here, but `adopted`
      // does not pass through it, so the batch is still checked rather than
      // assumed. A non-array with a truthy `length` — a string of task ids is
      // exactly that — used to walk past this guard and throw on the next line.
      if (!Array.isArray(lanes) || !lanes.length) {
        return await halt('the state machine asked for a batch with no lanes')
      }
      if (lanes.some(lane => !Array.isArray(lane) || !lane.length)) {
        return await halt('the state machine asked for a batch holding an empty lane')
      }

      // One agent per LANE, in parallel, always. A lane is work a path collision
      // already forced to run in order, so isolating its tasks from each other
      // isolates nothing and pays a spawn prefix per task. Isolation between
      // lanes is the property waves exist for and is untouched.
      // Every batch of this wave gets the SAME previous-wave packets: the whole
      // wave came out of one `next`, so batch 2 is not entitled to batch 1's
      // report. `previousHandoffs` is dropped by the ping when the state had
      // none, and the assembler renders nothing for an empty list.
      const previousHandoffs = Array.isArray(next.previousHandoffs) ? next.previousHandoffs : []

      const results = await pipeline(lanes, lane =>
        agent(
          assembleImplementerPrompt({ change, lane, previousHandoffs }),
          {
            label: laneLabel(lane),
            model: laneModel(lane),
            effort: laneEffort(lane),
            ...workerExtra,
            // A one-task lane keeps the pre-lane result shape, because its
            // prompt is the pre-lane prompt byte for byte and a schema asking
            // for something else would contradict it.
            schema: lane.length === 1 ? SINGLE_TASK_SCHEMA : LANE_SCHEMA
          }
        )
      )

      // A null result is an agent that was stopped or hit an unrecoverable error.
      // It is a task failure, not an absent task — dropping it would let the run
      // walk past the failure budget without noticing.
      // Keep this projection to { id, ok, error, filesChanged, handoff }. The
      // fused record ping writes these objects straight into batch-N.json, so a
      // field dropped here is a field record-batch never sees — and a missing
      // packet on a task claiming ok:true fails that task closed.
      //
      // `filesChanged` is in that list for exactly this reason. It was being
      // requested from every implementer, returned, and dropped right here,
      // which is why nothing could cross-check a packet's evidence against the
      // work it claims to describe. It is a REPORT, not an observation — the
      // observed set is read from git at record-batch — and the two are kept
      // apart all the way to the stored verdict.
      //
      // A null result gets no handoff on purpose: an agent that never returned
      // could not have written one, and demanding a packet from it would
      // replace "agent returned no result" with a complaint about the report.
      const reported = []
      const unattempted = []
      lanes.forEach((lane, j) => {
        const outcomes = laneOutcomes(lane, results[j])
        for (const o of outcomes) {
          if (o.outcome === 'not-attempted') unattempted.push(o.id)
          else reported.push({ id: o.id, ok: o.outcome === 'ok', error: o.error, handoff: o.handoff, filesChanged: o.filesChanged })
        }
      })
      accumulated.push(reported)
      pending.push({ lanes: lanes.length, notAttempted: unattempted })

      // A task nobody ran is not a task that failed. It is left unticked and
      // uncounted on purpose — spending the failure budget on the three tasks
      // sitting behind one real blocker would halt a run that has one problem.
      if (unattempted.length) {
        banners.push(
          `LANE STOPPED EARLY: ${unattempted.join(', ')} not attempted after an earlier task in ` +
            `the same lane failed — not counted as failures, and still unchecked in tasks.md`
        )
      }

      const anyFailed = reported.some(r => !r.ok)
      if (anyFailed || i === remaining.length - 1) {
        const writes = accumulated
          .map(
            (tasksResult, n) =>
              `Write this JSON to ${WORK}/batch-${n}.json:\n${JSON.stringify({ tasks: tasksResult })}`
          )
          .join('\n\n')
        const recordCmds = accumulated
          .map(
            (_, n) =>
              `  interlock wave-state record-batch --state ${STATE} --result ${WORK}/batch-${n}.json --write-state ${STATE} --json`
          )
          .join('\n')
        next = await readNext(
          await cheap(
            `record-batch-${steps}`,
            `Record these batch result(s) against the run state, in order.\n\n` +
              pingSpawnLine(`record-batch-${steps}`) +
              writes +
              `\n\nThen run these commands in order (each --write-state updates the file; the LAST stdout is the next step):\n` +
              recordCmds +
              `\n\n` +
              COPY_STDOUT +
              ` from the LAST record-batch command.\n` +
              `A non-zero exit means the recorded result halted the run — copy action:halt with the reason.\n\n` +
              `Each record-batch command prints a "recorded" array: the outcome it recorded for every ` +
              `task in that batch. Report those arrays as "recorded" — copy each command's array ` +
              `VERBATIM and concatenate them in command order, so a loop of three commands reports ` +
              `three batches' outcomes rather than one batch's. Do NOT merge duplicate ids, drop ` +
              `entries, reorder them, or reconcile an outcome against what you believe happened: a ` +
              `value adjusted in transit is indistinguishable afterwards from the value the run ` +
              `recorded. If a command printed no such array, leave the field out rather than ` +
              `inventing one.\n` +
              `Do not tick any task in this step. Ticking happens next, from the outcomes you just ` +
              `copied — a box ticked from what an agent claimed is how unimplemented work ships ` +
              `behind a "[x]".\n` +
              `\nIf that last stdout has action:"verify", do not return yet and do not spawn another agent. ` +
              `In this same turn, run the structural inter-wave plan:\n` +
              `  interlock verify plan --no-profile --context inter-wave` +
              (wavePaths.length
                ? ` --changed ${[...new Set(wavePaths)].join(' ')}`
                : '') +
              ` --json > ${WORK}/vplan.json\n` +
              `If .claude/testing/profile.json exists, pass --profile that file instead of --no-profile.\n` +
              `Run ONLY the steps in vplan.json. If steps is empty, write ` +
              `{ "skipped": true, "reason": "<first skipped reason>" } to ${WORK}/verify.json ` +
              `and record-verify — do not invent extra suites.\n` +
              (anyFailed ? '' : '') +
              `If a check's combined stdout/stderr exceeds the spill threshold (interlock limits), ` +
              `read runId from ${STATE} and spill it:\n` +
              `  interlock verify spill --run-id <runId> --kind <kind> --input <raw-output-file> --json\n` +
              `Put the returned locator and preview in that step's result — never the full text.\n` +
              `Judge:\n` +
              `  interlock verify judge --plan ${WORK}/vplan.json --results ${WORK}/vresults.json --context inter-wave --state ${STATE} --json\n` +
              `Then:\n` +
              `  write { "ok": <bool>, "errors": [...], "blocksNextWave": <bool> } — or ` +
              `{ "skipped": true, "reason": "<reason>" } — to ${WORK}/verify.json\n` +
              `  interlock wave-state record-verify --state ${STATE} --result ${WORK}/verify.json --write-state ${STATE} --json\n` +
              `Copy THAT last record-verify stdout as the result (or the last record-batch stdout if action was not verify).`
          )
        )
        if (next && next.skipped && next.reason) {
          banners.push(`VERIFICATION SKIPPED: reason=${next.reason}`)
        }

        // One authority, read once, for the tick and for the tallies alike.
        const verdict = adjudicateBatches(accumulated, recordedOutcomes(next))
        if (verdict.claimDerived) banners.push(claimDerivedBanner())
        if (verdict.overrides.length) banners.push(overrideBanner(verdict.overrides))
        // The wave's span closes here, at the same statement that turns it into
        // summary rows — one place, so the boundary the script acted on and the
        // boundary the receipt reports cannot drift apart. The figure is the
        // wave's aggregate: the rows below are per BATCH, and splitting one
        // measured span across them would be a number nobody measured.
        markWaveSpend(waveNumber)

        verdict.waves.forEach((counts, n) => {
          const batch = pending[n] || { lanes: 0, notAttempted: [] }
          summary.waves.push({
            wave: waveNumber,
            kind: waveKind,
            lanes: batch.lanes,
            ok: counts.ok,
            failed: counts.failed,
            failedIds: counts.failedIds,
            // The lane that stopped early, plus anything the recorder found no
            // result for at all. Neither is ticked and neither is a failure.
            notAttempted: [
              ...batch.notAttempted,
              ...counts.recordedNotAttempted.filter(id => !batch.notAttempted.includes(id))
            ]
          })
        })

        // Its own step, because the ids are not knowable until the step above
        // reported them: a tick fused into the record ping could only ever tick
        // what the agents claimed, which is the defect this replaced.
        if (verdict.tickIds.length) {
          const ticked = await cheap(
            `tick-${steps}`,
            `Mark the tasks this run RECORDED as succeeded complete for change "${change}".\n\n` +
              pingSpawnLine(`tick-${steps}`) +
              `Run exactly this, and do not edit tasks.md by hand:\n` +
              `  interlock tasks tick --change ${change} --ids ${verdict.tickIds.join(',')} --json\n` +
              `This id list is the run's own record of what succeeded — do not add an id, drop one, ` +
              `or substitute what an implementer told you.\n` +
              `That command exits non-zero when an id has no matching checkbox. If it does, report ` +
              `tickFailed:true and put the ids from its "missing" array in tickMissing. Do not retry ` +
              `it and do not edit tasks.md yourself — a task that finished and stayed unchecked reads ` +
              `downstream as a failed task, so it has to be said out loud.\n` +
              `Report action:"${next && next.action ? next.action : 'done'}" — this step decides nothing ` +
              `about the run's next move.`
          )
          noteTickFailure(ticked)
        }
        break
      }
    }
    continue
  }

  if (next.action === 'verify') {
    // Captured before the ping replaces `next` with the step after this span.
    const verifyWave = next.wave
    const mode = next.mode === 'fix' ? 'fix' : 'check'
    const changedFlag =
      Array.isArray(next.changed) && next.changed.length
        ? ` --changed ${next.changed.join(' ')}`
        : ''
    next = await readNext(
      await cheap(
        `inter-wave-verify-${steps}`,
        `Inter-wave verification for change "${change}"${mode === 'fix' ? `, fix attempt ${next.fixAttempt}` : ''} ` +
          `(fallback — prefer fusing this into the record-batch ping).\n\n` +
          pingSpawnLine(`inter-wave-verify-${steps}`) +
          (mode === 'fix'
            ? `The previous check failed. Make ONE targeted fix and re-run only the failing step.\n\n`
            : '') +
          `Run the structural plan (do not invent extra suites):\n` +
          `  interlock verify plan --no-profile --context inter-wave${changedFlag} --json > ${WORK}/vplan.json\n` +
          `If .claude/testing/profile.json exists, pass --profile that file instead of --no-profile.\n` +
          `Run ONLY the steps in vplan.json. If steps is empty, write ` +
          `{ "skipped": true, "reason": "<first skipped reason>" } to ${WORK}/verify.json ` +
          `and record-verify — do not invent extra suites.\n\n` +
          `If a check's combined stdout/stderr exceeds the spill threshold (interlock limits), read ` +
          `runId from ${STATE} and spill it:\n` +
          `  interlock verify spill --run-id <runId> --kind <kind> --input <raw-output-file> --json\n` +
          `Put the returned locator and preview in that step's result — never the full text. ` +
          `Counts and failure lines/clusters still go in the result as usual.\n\n` +
          `Judge the outcome with:\n` +
          `  interlock verify judge --plan ${WORK}/vplan.json --results ${WORK}/vresults.json --context inter-wave --state ${STATE} --json\n` +
          `The inter-wave context is load-bearing — a red typecheck stops the next wave here, though ` +
          `it would not stop the commit later.\n\n` +
          `Then record it:\n` +
          `  write { "ok": <bool>, "errors": [...], "blocksNextWave": <bool> } — or ` +
          `{ "skipped": true, "reason": "<reason>" } — to ${WORK}/verify.json\n` +
          `  interlock wave-state record-verify --state ${STATE} --result ${WORK}/verify.json --write-state ${STATE} --json\n\n` +
          COPY_STDOUT +
          `\nA non-zero exit means action:halt.\n` +
          `If you skipped, also set skipped:true and reason — that reason is printed to the user.\n\n` +
          `Set blocksNextWave true only when the next wave genuinely cannot build on this state.`,
        { effort: VERIFY_EFFORT }
      )
    )

    // A span whose only work was a verification still spent the orchestrator's
    // turns, so its measured delta is recorded rather than assumed to be zero
    // on the grounds that no implementer was spawned.
    markWaveSpend(verifyWave)

    if (next && next.skipped && next.reason) {
      banners.push(`VERIFICATION SKIPPED: reason=${next.reason}`)
    }
    continue
  }

  if (next.action === 'replan') {
    next = await readNext(
      await cheap(
        `replan-${steps}`,
        `A completed wave may have invalidated later ones for change "${change}".\n\n` +
          pingSpawnLine(`replan-${steps}`) +
          `Revise ONLY groups that have not executed yet — the CLI rejects a revision to an executed ` +
          `group, and that rejection is correct, not an obstacle to work around.\n\n` +
          `If you have revisions, write [{ "group": <n>, "tasks": [...] }] to ${WORK}/replan.json, then:\n` +
          `  interlock wave-state replan --state ${STATE} --groups ${WORK}/replan.json --write-state ${STATE} --json\n` +
          COPY_STDOUT +
          `\n\nIf nothing actually needs revising: run \`interlock wave-state next --state ${STATE} --json\` ` +
          `and copy that step. Do not invent groups.`
      )
    )
    if (!next) return await halt('the replan step returned no result')
    continue
  }

  return await halt(`unrecognized step from the state machine: ${next.action}`)
}

if (steps >= MAX_LOOP_STEPS) {
  return await halt(`the wave loop exceeded ${MAX_LOOP_STEPS} steps without reaching a terminal state`)
}

if (applyOnly) {
  summary.notes.push('--apply-only: stopped after the waves')
  summary.commitSkipped = true
  return closeRun()
}

// --- 4. review the diff (opt-in: --review / --strict) ----------------------

if (review) {
  const reviewResult = await step(
    'review',
    `Adversarially review the diff for change "${change}".\n\n` +
      `Fan out one reviewer per dimension: language, architecture, qa and technical-lead always; ` +
      `devops when the diff touches deploy, config or infrastructure; security when it touches auth, ` +
      `input handling or data exposure. Each writes findings as ` +
      `{ dimension, findings: [{ severity, file, line, title, description, suggestion }] }.\n\n` +
      RUBRIC_INSTRUCTIONS +
      `Then put TWO skeptics on every blocker and warning independently, each emitting ` +
      `{ findingTitle, file, isReal, confidence, reasoning, evidence, refinedSeverity, qualityScore, severityScore }. ` +
      `Include the file — title alone is not unique, and two findings sharing a title in different ` +
      `files would otherwise share one verdict.\n\n` +
      `A verdict of isReal:false MUST carry evidence — the file:line span the skeptic actually read, ` +
      `such as "src/auth.ts:41-58", naming a file that is actually in this diff. The CLI checks both ` +
      `halves: a bare filename, a single word, prose, or a path that is not in the diff all fail. ` +
      `An uncited refutation dismisses nothing: it is recorded, its quality ` +
      `score still counts, and the finding survives to the report. Voting a finding real needs no ` +
      `evidence — only the dismissing direction is gated, because a dismissed finding is invisible.\n\n` +
      `Write findings to ${WORK}/findings.json and verdicts to ${WORK}/verdicts.json, then run this ` +
      `with --changed set to the comma-separated files in the diff, so the CLI can check that each ` +
      `dismissal cites one of them:\n` +
      `  interlock review --findings ${WORK}/findings.json --verdicts ${WORK}/verdicts.json --changed <files> --metrics ${change} --json > ${WORK}/review.json\n\n` +
      `The CLI decides survival and applies the quality band. Do not filter findings yourself and do ` +
      `not restate a threshold — the numbers live in the CLI precisely so they are not re-argued here.\n\n` +
      `Write JSON to the work files. Return the counts only — do not paste dimension reports or skeptic reasoning into this result.`,
    {
      type: 'object',
      required: ['ok'],
      properties: {
        ok: { type: 'boolean' },
        raised: { type: 'integer' },
        dismissed: { type: 'integer' },
        droppedByQuality: { type: 'integer' },
        surviving: { type: 'integer' },
        blockers: { type: 'integer' },
        missingRubrics: { type: 'array', items: { type: 'string' } },
        detail: { type: 'string' }
      }
    },
    // The skeptics reason inside this one worker agent (it fans out dimensions
    // and two skeptics per finding in its own context, then calls the CLI), so
    // pinning this spawn's effort is what pins the skeptics — fixed at xhigh
    // regardless of any lane tier.
    { effort: SKEPTIC_EFFORT }
  )

  for (const dimension of (reviewResult && reviewResult.missingRubrics) || []) {
    banners.push(
      `REVIEW RUBRIC UNAVAILABLE: ${dimension} — that reviewer worked from the dimension name alone`
    )
  }

  if (!reviewResult || !reviewResult.ok) {
    summary.notes.push(`review did not complete: ${(reviewResult && reviewResult.detail) || 'no result'}`)
  }
  summary.review = reviewResult || null

  // --- 5. remediation, bounded ----------------------------------------------
  //
  // Rounds 1..cap are fix passes; the round after the cap is the verdict, and it
  // is the only one that can halt. The script asks for the round it is on and
  // does not decide when the budget is spent. This halt cannot fire on a lean
  // run — review never ran.
  //
  // `roundCap` comes from `interlock remediate`, which reads
  // LIMITS.remediationRounds. It used to be the literal 3 here — cap + 1 — so
  // raising the cap would have silently stopped the verdict round from being
  // the verdict round. The script cannot import lib/limits.mjs (the runtime
  // rejects a script that loads modules), so the cap arrives the same way every
  // other policy value does: from the CLI.

  let round = 1
  let roundCap = null
  let fixRoundsRun = 0
  let remediation = null

  while (round <= MAX_LOOP_STEPS) {
    const isVerdict = remediationBudget({ round, roundCap }).phase === 'verdict'
    remediation = await step(
      `remediate-${round}`,
      `Remediation ${isVerdict ? 'verdict' : `round ${round}`} for change "${change}".\n\n` +
        `Run: interlock remediate --findings ${WORK}/review.json --round ${round} --json\n\n` +
        `Copy that command's "roundCap" into this result as roundCap. It is the round budget the ` +
        `CLI owns; this loop reads it rather than restating it, so never invent or adjust it.\n\n` +
        (isVerdict
          ? `This is the verdict round. It fixes nothing — it reports whether blockers survived the ` +
            `budget. A non-zero exit means unresolved blockers; report halted:true with the reason.`
          : `Fan out ONE fixer agent per file from the plan's byFile groups — those groups are ` +
            `disjoint, so they are safe in parallel. Apply the unscoped group last, sequentially. ` +
            `Fix blockers and warnings; never fix a suggestion. A finding you do not fix is recorded ` +
            `with its reason, never silently dropped.\n\n` +
            `Then re-review ONLY the dimensions the plan lists in reReviewDimensions, put two skeptics ` +
            `on the new findings as before, and rewrite ${WORK}/review.json via interlock review.\n\n` +
            RUBRIC_INSTRUCTIONS +
            `A re-reviewed dimension gets the same criteria it got on the first pass. A dimension in ` +
            `reReviewDimensions that did not run in the first pass is either given its criteria or ` +
            `rejected as not applicable — never dispatched with an empty rubric.\n\n` +
            `Write JSON to the work files. Return the counts only — do not paste fixer or skeptic reasoning into this result.`),
      {
        type: 'object',
        required: ['ok'],
        properties: {
          ok: { type: 'boolean' },
          halted: { type: 'boolean' },
          reason: { type: 'string' },
          fixed: { type: 'integer' },
          deferred: { type: 'integer' },
          blockersRemaining: { type: 'integer' },
          roundCap: { type: 'integer' },
          missingRubrics: { type: 'array', items: { type: 'string' } }
        }
      }
    )

    if (!remediation) return await halt(`remediation round ${round} returned no result`)
    if (Number.isInteger(remediation.roundCap)) roundCap = remediation.roundCap
    for (const dimension of remediation.missingRubrics || []) {
      banners.push(
        `REVIEW RUBRIC UNAVAILABLE: ${dimension} — that re-reviewer worked from the dimension name alone`
      )
    }
    if (remediation.halted) return await halt(remediation.reason || 'unresolved blockers after remediation')
    if (isVerdict) break

    fixRoundsRun += 1
    const after = remediationBudget({
      round,
      roundCap,
      blockersRemaining: remediation.blockersRemaining
    })
    if (after.phase === 'unknown') {
      // Fail closed. A budget the CLI never stated is not a budget, and looping
      // on a guess is how an unbounded remediation session starts.
      return await halt(
        `remediation round ${round} did not report the round budget — ` +
          `\`interlock remediate\` publishes roundCap and this loop will not guess it`
      )
    }
    round = after.next
  }

  summary.remediation = remediation
  // What the run actually consumed, not a constant. This was
  // `Math.min(round, 2)` where `round` is always one past the bound at loop
  // exit — a fictional field in the corpus that exists to answer whether these
  // gates can be relaxed.
  summary.remediationRounds = fixRoundsRun
}

// --- 6. verify -------------------------------------------------------------

const verified = await step(
  'verify',
  `Final verification for change "${change}".\n\n` +
    pingSpawnLine('verify', 'verify') +
    `Read .claude/testing/profile.json. Where the discovery ladder would ask a question, leave the ` +
    `field null and note it — never interview, that is /interlock:fix-tests's job.\n\n` +
    `  interlock verify plan --profile <profile|--no-profile> ${skipCoverage ? '--no-coverage ' : ''}${skipE2e ? '' : '--e2e '}--json > ${WORK}/vplan.json\n\n` +
    `Run each planned step. If a step's combined stdout/stderr exceeds the spill threshold ` +
    `(interlock limits), read runId from ${STATE} and spill it:\n` +
    `  interlock verify spill --run-id <runId> --kind <kind> --input <raw-output-file> --json\n` +
    `then record { kind, exitCode, total, passed, failed, failures, locator, preview } for that step — ` +
    `never the full text. Record { kind, exitCode, total, passed, failed, failures } for steps under ` +
    `the threshold, then:\n` +
    `  interlock verify judge --plan ${WORK}/vplan.json --results ${WORK}/vresults.json --context final --state ${STATE} --json\n\n` +
    `On a red unit suite, repair by ROOT CAUSE — cluster the failures with interlock verify cluster, ` +
    `fix the shared cause once, and ask interlock verify repair whether another iteration is allowed. ` +
    `Never weaken a test, loosen an assertion or narrow the suite: a suite that went green by ` +
    `shrinking is not green, and the CLI checks for exactly that when given a baseline.\n\n` +
    `A red unit suite is a hard halt. A red e2e is NOT — report it, never repair it. Coverage is ` +
    `advisory and blocks nothing.\n\n` +
    `Report every skip reason and whether e2e failed.`,
  {
    type: 'object',
    // `unitGreen` is required, not optional. The gate below refuses to commit
    // without it, so leaving it out of the schema would turn a missing field
    // into a halt on every run rather than into the answer the gate needs.
    required: ['ok', 'unitGreen'],
    properties: {
      ok: { type: 'boolean' },
      halted: { type: 'boolean' },
      reason: { type: 'string' },
      unitGreen: { type: 'boolean' },
      e2eFailed: { type: 'boolean' },
      e2eDetail: { type: 'string' },
      skipReasons: { type: 'array', items: { type: 'string' } }
    }
  }
)

if (!verified) return await halt('the verify step returned no result')
for (const reason of verified.skipReasons || []) {
  banners.push(`VERIFICATION SKIPPED: reason=${reason}`)
}
if (verified.e2eFailed) {
  banners.push(`E2E FAILED (non-blocking by policy): ${verified.e2eDetail || 'see the run log'}`)
}
if (verified.halted) return await halt(verified.reason || 'verification halted the run')

// The completion gate. Both fields were declared, one was required, and neither
// was branched on — so a red verify reached the commit unless the agent ALSO
// volunteered halted:true. The run depended on the verifying agent choosing to
// stop itself, which is the one party that should not be deciding. An absent
// field is "not verified", never a passing verdict.
if (verified.ok !== true) {
  return await halt(
    `verification did not report ok:true (got ${JSON.stringify(verified.ok)}) — ` +
      `an unverified run does not commit`
  )
}
if (verified.unitGreen !== true) {
  return await halt(
    `verification reported no green unit suite (unitGreen=${JSON.stringify(verified.unitGreen)}) — ` +
      `a red or unreported unit suite does not commit`
  )
}

// --- 7. handoff artifacts, explanation, learnings (opt-in) ----------------

if (handoff || conformance) {
  const handoffParts = [
    `Produce the handoff artifacts for change "${change}".\n`,
    `  interlock surface --changed <files changed by this run> --json\n`
  ]
  if (handoff) {
    handoffParts.push(
      `If needsManualTestPlan is true, write openspec/changes/${change}/manual-test-plan.md covering ` +
        `every touched file, with spec scenarios and tasks mapped to numbered cases. If it is false, ` +
        `skip it and say why — a backend-only change does not get a UI test plan.\n\n` +
        `Then write openspec/changes/${change}/code-explanation.md as a commit teach-in: why each file ` +
        `changed, what changed, the blast radius, and what would break if it were left out.\n`
    )
  }
  if (conformance) {
    handoffParts.push(
      `Spec conformance:\n` +
        `  interlock conformance ${change} --changed <files changed by this run> --json\n` +
        `That emits questions, never verdicts. For each scenario it lists, read the implementation and ` +
        `answer whether the described behaviour was actually built, citing file:line. Write the answers ` +
        `to openspec/changes/${change}/conformance.md with one section per scenario id. A scenario you ` +
        `cannot confirm is recorded as unconfirmed with what you looked at — never as satisfied, and ` +
        `never omitted. If the checklist is empty, say so and move on.\n\n` +
        `This never halts the run: a prose scenario matched to code is a judgement, and a judgement ` +
        `that stopped a ship run would be a gate built on a guess. Report it and let a person read it.\n`
    )
  }
  if (handoff) {
    handoffParts.push(
      `Finally, capture at most three learnings from fixes made during this run — recurring failure ` +
        `modes under .claude/memory/failure-modes/, module coupling under .claude/memory/coupling/ — ` +
        `each one small file, indexed in .claude/memory/MEMORY.md. Only genuinely recurring patterns; ` +
        `write nothing if nothing recurred. This is silent.`
    )
  }

  const handoffResult = await step(
    'handoff',
    handoffParts.join('\n'),
    {
      type: 'object',
      required: ['ok'],
      properties: {
        ok: { type: 'boolean' },
        manualTestPlan: { type: 'boolean' },
        skipReason: { type: 'string' },
        learnings: { type: 'integer' },
        scenariosChecked: { type: 'integer' },
        scenariosUnconfirmed: { type: 'integer' }
      }
    }
  )

  summary.handoff = handoffResult
}

if (noCommit) {
  summary.notes.push('--no-commit: everything ran, the commit is yours')
  summary.commitSkipped = true
  return closeRun()
}

// --- 8. commit -------------------------------------------------------------

const committed = await step(
  'commit',
  `Commit change "${change}" as ONE feature-level commit.\n\n` +
    `Read the change artifacts and write a verb-phrase conventional-commit message with a short ` +
    `outcome summary. Stage only the files this run touched — never \`git add -A\`, never amend, ` +
    `never push.` +
    (strict
      ? `\n\nThen record the outcome for the ladder:\n` +
        `  interlock autonomy record review-code --blockers <surviving blocker count>\n` +
        `That record is storage only. Never print an autonomy level, L2/L3, or anything about a ladder — ` +
        `it is experimental and means nothing to the reader.`
      : ''),
  {
    type: 'object',
    required: ['ok'],
    properties: { ok: { type: 'boolean' }, sha: { type: 'string' }, detail: { type: 'string' } }
  }
)

summary.commit = committed

return closeRun()

// --- the summary -----------------------------------------------------------

function leftoverIds() {
  // What the checkbox says, when the closing step managed to read it. "Left
  // behind" is not "failed": a halt at verification leaves whole waves that
  // never ran, and a receipt built from the failure list reported none of them
  // — so a halted run, the most informative record in the corpus, listed
  // nothing. The failure list stays as the fallback for a run that never
  // reached its close.
  const reported = summary.closing && summary.closing.leftoverTaskIds
  if (Array.isArray(reported)) return reported.filter(id => typeof id === 'string')
  return summary.waves.flatMap(w => w.failedIds || [])
}

// The cache behind `resolveDegradations()`. Declared with the rest of the run
// state rather than beside its reader: everything below the script's terminal
// `return` is hoisted declarations only, so a `let` down there would stay in
// its temporal dead zone forever.
function resolveDegradations() {
  if (!degradationsOnce) degradationsOnce = degradationLines()
  return degradationsOnce
}

function finish() {
  // The banner block is always printed, on a halt and on a clean run alike.
  // Silence is the failure mode it exists to remove: a summary with no banner
  // section is indistinguishable from a run that degraded and hid it.
  const leftover = leftoverIds()
  const lines = []

  if (summary.halted) {
    lines.push(`SHIP HALTED — ${summary.halted}`)
  } else if (leftover.length) {
    lines.push(`SHIP COMPLETE WITH LEFTOVERS — ${resolvedChange}`)
  } else {
    lines.push(`SHIP COMPLETE — ${resolvedChange}`)
  }

  // Printed on a halt too, and it did not used to be: the run that stopped
  // early is the one whose unfinished work someone has to pick up, and the
  // receipt carries this list either way. A banner that stayed quiet about it
  // made the record and the summary disagree on the halt path alone.
  if (leftover.length) {
    lines.push(`  leftover tasks (boxes still unchecked): ${leftover.join(', ')}`)
  }

  // Which path the plan took, always, in both directions. A run that silently
  // changed its own cost is the failure mode this block exists to remove, and
  // "there was no prior plan" is a reason like any other — reported, not passed
  // over because it is the common case.
  if (summary.plan) {
    lines.push(
      summary.plan.reused
        ? `  PLAN REUSED (${summary.plan.status}): ${summary.plan.reason}`
        : `  PLAN REBUILT (${summary.plan.status}): ${summary.plan.reason}`
    )
  } else {
    lines.push(
      '  PLAN UNKNOWN: the run ended before the plan-reuse check reported, so whether the ' +
        'classifier ran was never observed'
    )
  }

  for (const wave of summary.waves) {
    lines.push(`  wave ${wave.wave ?? '?'} (${wave.kind}): ${wave.ok} ok, ${wave.failed} failed`)
  }
  if (summary.review) {
    const r = summary.review
    lines.push(
      `  review: ${r.raised ?? '?'} raised, ${r.dismissed ?? 0} dismissed by skeptics, ` +
        `${r.droppedByQuality ?? 0} dropped as too weak to report, ${r.surviving ?? '?'} surviving`
    )
  }
  if (summary.remediation) {
    lines.push(
      `  remediation: ${summary.remediation.fixed ?? 0} fixed, ${summary.remediation.deferred ?? 0} deferred`
    )
  }
  if (summary.handoff) {
    if (handoff) {
      lines.push(
        `  handoff: manual test plan ${summary.handoff.manualTestPlan ? 'written' : `skipped (${summary.handoff.skipReason || 'not UI-testable'})`}`
      )
    }
    if (summary.handoff.scenariosChecked) {
      const unconfirmed = summary.handoff.scenariosUnconfirmed || 0
      lines.push(
        `  conformance: ${summary.handoff.scenariosChecked - unconfirmed}/${summary.handoff.scenariosChecked} scenarios confirmed` +
          (unconfirmed ? ` — ${unconfirmed} unconfirmed, see conformance.md` : '')
      )
    }
  }
  if (summary.commit && summary.commit.ok) lines.push(`  commit: ${summary.commit.sha || 'created'}`)
  for (const note of summary.notes) lines.push(`  ${note}`)

  lines.push('Do not start another ship run unless the user asks.')
  lines.push('GOAL MET: interlock ship returned a terminal summary.')

  lines.push('')
  // A lean run must not look like --strict. Silence here is the same failure
  // mode the degradation block exists to remove.
  const skipped = []
  if (!review) skipped.push('review')
  if (!handoff) skipped.push('handoff')
  if (!conformance) skipped.push('conformance')
  if (skipped.length) {
    lines.push(
      `LEAN SHIP: skipped ${skipped.join(', ')} — pass --review / --handoff / --strict to enable`
    )
  }

  const degradations = resolveDegradations()
  if (degradations.length) {
    for (const banner of degradations) lines.push(banner)
  } else {
    lines.push(
      'No degradation banners — graph, test profile, model routing, verification and e2e were all clean.'
    )
  }

  return lines.join('\n')
}

/**
 * Every degradation this run accepted, derived from what was recorded.
 *
 * The block used to print whatever happened to be in `banners`, so silence and
 * cleanliness were indistinguishable: the seven push sites covered graph, test
 * profile, model routing, three skip reasons and e2e, while cap exhaustion and
 * unresolved errors pushed nothing at all. An accumulator can only report what
 * someone remembered to push — which is the exact property this block exists to
 * remove.
 *
 * So the run conditions are read back from the closing step, and the closing
 * step's own outcome is one of them. A run that halted before it is reported as
 * UNKNOWN rather than omitted, because "we never found out" and "there was
 * nothing" are different facts.
 */
function degradationLines() {
  const out = [...banners]
  const closing = summary.closing

  if (!closing) {
    out.push(
      'CLOSING STEP OUTCOME UNKNOWN: the run ended before record-outcome reported, so the ' +
        'conditions it reads back — skipped verifications, cap exhaustion, unresolved errors — ' +
        'were never observed'
    )
  } else {
    if (closing.ok === false) {
      out.push(`CLOSING STEP DEGRADED: ${closing.detail || 'record-outcome reported ok:false'}`)
    }
    for (const reason of closing.skippedVerificationReasons || []) {
      out.push(`VERIFICATION SKIPPED: reason=${reason}`)
    }
    if (closing.capExhaustedVerifications > 0) {
      out.push(
        `VERIFY CAP EXHAUSTED: ${closing.capExhaustedVerifications} inter-wave checkpoint(s) were ` +
          `skipped because the per-run verification cap was already spent`
      )
    }
    if (closing.unresolvedErrors > 0) {
      out.push(
        `UNRESOLVED ERRORS CARRIED PAST A WAVE: ${closing.unresolvedErrors} — the fix budget was ` +
          `spent and the run continued because the errors were reported as not blocking`
      )
    }
  }

  // Deduplicate: a skip reason can be both banner-pushed as it happened and
  // read back from the state at the end, and printing it twice reads as two
  // skips.
  return [...new Set(out)]
}

// BUILD_RECEIPT_START
/**
 * The wave-state skip reason meaning the per-run verification cap was already
 * spent.
 *
 * A hoisted function rather than a `const` so the closing prompt further up can
 * name it too: two literals is how the printed banner and the recorded count
 * would come to disagree about what "cap exhausted" means, and only one of them
 * would be wrong in a way anyone noticed.
 */
function capExhaustedSkipReason() {
  return 'verify-cap-reached'
}

/**
 * The three verification conditions a receipt reports, read out of a wave-state
 * object in the shape `summary.closing` carries them.
 *
 * This host cannot read that file, so it asks its closing agent for the same
 * three facts. A host that CAN read it uses this instead — one fewer hop, and
 * one statement of which skip reason means the cap was spent.
 */
function closingFromWaveState(state) {
  if (!state || !Array.isArray(state.skippedVerifications)) return null
  const reasons = state.skippedVerifications.map(s => (s && s.reason) || '').filter(Boolean)
  return {
    skippedVerificationReasons: reasons,
    capExhaustedVerifications: reasons.filter(r => r === capExhaustedSkipReason()).length,
    unresolvedErrors: Array.isArray(state.unresolved) ? state.unresolved.length : undefined
  }
}

/**
 * The run's receipt payload: what this run observed about itself, in the field
 * names `lib/run-log.mjs`'s `run-receipt` whitelist copies by name.
 *
 * Pure, and closure-free on purpose — `bin/interlock-ship-acp` evaluates this
 * block out of this file rather than carrying a second copy, because two
 * hosts writing "the same" receipt from two implementations is precisely the
 * drift a reader could never see: both trajectories would look fine.
 *
 * Every field is either observed or `undefined`. Nothing here substitutes a
 * zero for a value the run never found out: the writer turns an absent field
 * into `null`, and `null` reads as unknown. A receipt that reported an
 * unobserved review as zero blockers would flatter exactly the halted runs
 * this record exists to explain.
 *
 * @param {{
 *   change?: string,
 *   summary?: object,
 *   degradations?: string[],
 *   planFingerprint?: string,
 *   leftoverTaskIds?: string[]
 * }} input
 */
function buildReceipt(input) {
  const source = input || {}
  const summary = source.summary || {}
  const closing = summary.closing || null
  const plan = summary.plan || null
  const review = summary.review || null
  const commit = summary.commit || null

  // surviving counts blockers and warnings together, so the warning count is
  // the difference — and only when both halves were actually observed. A
  // negative difference means the two counts disagree, which is reported as
  // unknown rather than as a number nobody measured.
  const surviving = review && Number.isFinite(review.surviving) ? review.surviving : undefined
  const blockers = review && Number.isFinite(review.blockers) ? review.blockers : undefined
  const warnings =
    surviving !== undefined && blockers !== undefined && surviving >= blockers
      ? surviving - blockers
      : undefined

  return {
    type: 'run-receipt',
    change: source.change,
    waves: (Array.isArray(summary.waves) ? summary.waves : []).map(wave => ({
      wave: wave.wave,
      ok: wave.ok,
      failed: wave.failed,
      notAttempted: wave.notAttempted
    })),
    // Measured by the script from the runtime's own counter and carried, not
    // computed by anyone downstream. Element by element, because these entries
    // ride on the same summary the review findings and suite output do.
    spend: (Array.isArray(summary.spend) ? summary.spend : []).map(entry => ({
      wave: entry.wave,
      outputTokens: entry.outputTokens
    })),
    outputTokens: summary.outputTokens,
    planReused: plan ? plan.reused === true : undefined,
    planStatus: plan ? plan.status : undefined,
    planReason: plan ? plan.reason : undefined,
    planFingerprint: source.planFingerprint,
    reviewRaised: review ? review.raised : undefined,
    reviewSurviving: surviving,
    reviewBlockers: blockers,
    reviewWarnings: warnings,
    remediationRounds: summary.remediationRounds,
    // These three are what `degradationLines()` reads, from the same place, so
    // the receipt's counts and the printed banners cannot come apart.
    skippedVerifications: closing
      ? (closing.skippedVerificationReasons || []).length
      : undefined,
    capExhaustedVerifications: closing ? closing.capExhaustedVerifications : undefined,
    unresolvedErrors: closing ? closing.unresolvedErrors : undefined,
    leftoverTaskIds: source.leftoverTaskIds,
    halted: Boolean(summary.halted),
    haltReason: summary.halted || undefined,
    // Tri-state, and the reason the field is not just the sha: a run told not
    // to commit reports false, a run that halted before it ever reached a
    // commit step reports unknown, and those are different facts about the
    // same absent sha. `commitSkipped` is set only where the run chose to stop
    // — never inferred from the sha being missing.
    committed: commit ? commit.ok === true : summary.commitSkipped === true ? false : undefined,
    commit: commit && commit.ok === true ? commit.sha : undefined,
    degradations: source.degradations
  }
}
// BUILD_RECEIPT_END
