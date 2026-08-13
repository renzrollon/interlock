export const meta = {
  name: 'ship',
  description:
    'Take a reviewed OpenSpec change from tasks to commit in one uninterrupted run — dependency-ordered waves of parallel implementers, adversarial review, bounded remediation, verification, handoff artifacts, and a commit. Asks nothing.'
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

const opts = typeof args === 'object' && args !== null ? args : {}
const flags = new Set(
  (Array.isArray(opts.flags) ? opts.flags : [])
    .concat(typeof opts === 'string' ? [opts] : [])
    .map(String)
)
const has = name => flags.has(name) || flags.has(`--${name}`) || opts[name] === true

const changeArg = typeof opts.change === 'string' ? opts.change : ''
const applyOnly = has('apply-only')
const noCommit = has('no-commit')
const skipE2e = has('skip-e2e')
const skipCoverage = has('skip-coverage')
const maxParallel = Number.isInteger(opts.maxParallel) ? opts.maxParallel : null

// How this run was reached. `spec --continue` sets it when it invokes ship after
// a clean readiness gate; anything else is a run a human chose to start. The
// corpus exists to compare those two populations, so ship must not assume.
const mode = opts.mode === 'continue' ? 'continue' : 'checkpoint'

// A structurally impossible run should stop before it burns agents, and a loop
// whose exit condition depends on model output needs a backstop that does not.
// The runtime caps a run at 1000 agents; this stops long before that.
const MAX_LOOP_STEPS = 200

const banners = []
const summary = { waves: [], halted: null, notes: [] }

const STATE = '.claude/ship/state.json'
const WORK = '.claude/ship'

// Agents report structured results so the script can branch on a value rather
// than on a sentence. Every schema below is deliberately small: anything the
// script does not branch on stays in the agent's own context.
const ok = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' }, detail: { type: 'string' } }
}

const step = (name, prompt, schema, extra = {}) =>
  agent(
    `${prompt}\n\nYou are one step of an automated ship run. Do not ask questions — ` +
      `there is no one listening. If something is undecidable, report it in your ` +
      `result rather than guessing at product intent.`,
    { label: name, schema, ...extra }
  )

// Mechanical CLI pings: the script cannot run the binary, but they do not need
// a large model. haiku is the same slug the planner already assigns to tier 1.
const nextSchema = {
  type: 'object',
  required: ['action'],
  properties: {
    action: { type: 'string' },
    reason: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          tier: { type: 'integer' },
          model: { type: 'string' }
        }
      }
    },
    mode: { type: 'string' },
    fixAttempt: { type: 'integer' },
    wave: { type: 'integer' },
    ok: { type: 'boolean' },
    halted: { type: 'boolean' },
    skipped: { type: 'boolean' }
  }
}

const cheap = (name, prompt) => step(name, prompt, nextSchema, { model: 'haiku' })

// Set once validate resolves the change. `halt` can fire before that, so the
// outcome record reads this rather than the `change` binding below, which is
// not initialized yet on the earliest failure path.
let resolvedChange = changeArg || '(unresolved)'

// One line per run in the learning corpus, for halted and clean runs alike — a
// corpus of only successes cannot answer the question it exists for. Nothing
// gates on it yet; it accumulates so that a later decision about continuity can
// be made against evidence rather than against a feeling.
const recordOutcome = async () =>
  step(
    'record-outcome',
    `Append one outcome record for this run.\n\n` +
      `Write this JSON to ${WORK}/outcome.json:\n` +
      JSON.stringify({
        change: resolvedChange,
        mode,
        ship: {
          ok: !summary.halted,
          remediationRounds: summary.remediationRounds || 0,
          codeBlockersSurviving: (summary.review && summary.review.blockers) || 0
        }
      }) +
      `\n\nCorrect any field that does not match what actually happened, and add ` +
      `ship.unitGreen — these values are a starting point, not a claim. Leave a field out ` +
      `entirely rather than guessing it.\n\n` +
      `Then run: interlock outcomes append --record ${WORK}/outcome.json --root .\n\n` +
      `This never fails a run: a non-zero exit or a written:false result is reported and ignored. ` +
      `Losing a corpus line must never fail the run that produced it.`,
    ok,
    { model: 'haiku' }
  )

const halt = async reason => {
  summary.halted = reason
  // A halted run is the most informative record in the corpus, so it is written
  // on the way out rather than skipped as a failure.
  await recordOutcome()
  return finish()
}

// --- 1. resolve and validate ----------------------------------------------

const loaded = await step(
  'validate',
  `Resolve the OpenSpec change${changeArg ? ` named "${changeArg}"` : ' to ship'} and validate it.\n\n` +
    `Run: interlock validate ${changeArg || ''} --json\n\n` +
    `A non-zero exit means the change is not implementable — report ok:false with the reason ` +
    `and stop; do not attempt repairs.\n\n` +
    `Also run: printenv CLAUDE_CODE_SUBAGENT_MODEL\n` +
    `If it prints a value, report it as subagentModelOverride. If it is unset the command exits ` +
    `non-zero and prints nothing — that is the normal case, so leave the field out rather than ` +
    `reporting an empty string.\n\n` +
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
      subagentModelOverride: { type: 'string' }
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
}

// --- 2. classify, then let the planner decide -----------------------------

const planned = await step(
  'plan-waves',
  `For OpenSpec change "${change}": read proposal.md, design.md, tasks.md and specs/**/*.md in full — ` +
    `this is the artifact leash and is not subject to bounded retrieval.\n\n` +
    `Classify every UNCHECKED task with: id, group (wave number — tasks in a group must be ` +
    `independent of each other), description, tier 1-5, model, isTestTask.\n\n` +
    `Tier 1 trivial one-file edit → haiku. Tier 2 single-concern change. Tier 3 new logic in one ` +
    `domain. Tier 4 cross-file work following existing patterns — a mechanical refactor across many ` +
    `files is tier 4 sonnet, because breadth is not depth. Tier 5 only for genuinely novel ` +
    `architecture, and only tier 5 may be opus. When unsure, sonnet.\n\n` +
    `Write the classification to ${WORK}/classified.json, then run:\n` +
    `  interlock waves --classified ${WORK}/classified.json --json${maxParallel ? ` --max-parallel ${maxParallel}` : ''} > ${WORK}/plan.json\n` +
    `  interlock wave-state create --plan ${WORK}/plan.json --json > ${STATE}\n\n` +
    `The planner is authoritative: it clamps over-eager opus, orders the waves, defers test tasks ` +
    `and splits wide waves into batches. Do not re-derive or override any of it.\n\n` +
    `Report the plan's wave count and total task count.`,
  {
    type: 'object',
    required: ['ok', 'waveCount', 'taskCount'],
    properties: {
      ok: { type: 'boolean' },
      waveCount: { type: 'integer' },
      taskCount: { type: 'integer' },
      detail: { type: 'string' }
    }
  }
)

if (!planned || !planned.ok) {
  return await halt(`wave planning failed: ${(planned && planned.detail) || 'no result from the planner step'}`)
}

// --- 3. the wave loop ------------------------------------------------------
//
// Every branch below comes from `interlock wave-state next`. The script does not
// decide when to verify, when a replan is allowed, or when accumulated failures
// have exhausted the budget — it asks, and obeys.
//
// record-* / replan pass --write-state so their stdout IS the next step. That
// saves a second agent turn after every batch. One `next` still starts the loop.

let steps = 0
let next = await cheap(
  `next-1`,
  `Run: interlock wave-state next --state ${STATE} --json\n\n` +
    `Report the step verbatim. Do not interpret it, and do not act on it.`
)

while (steps++ < MAX_LOOP_STEPS) {
  if (!next) return await halt('the run state could not be read')
  if (next.action === 'done') break
  if (next.action === 'halt' || next.halted) return await halt(next.reason || 'the run state halted')

  if (next.action === 'run-batch' || next.action === 'test-wave') {
    const tasks = Array.isArray(next.tasks) ? next.tasks : []
    if (!tasks.length) return await halt('the state machine asked for a batch with no tasks')

    // One agent per task, in parallel, always. Context isolation is the entire
    // point of waves — a task implemented in the orchestrator's context defeats it.
    const results = await pipeline(tasks, task =>
      agent(
        `Implement exactly one task from OpenSpec change "${change}".\n\n` +
          `TASK ${task.id}: ${task.description}\n\n` +
          `CONTEXT — read only what your tier needs:\n` +
          `  tier 1: the task description alone\n` +
          `  tier 2+: the relevant section of openspec/changes/${change}/design.md\n` +
          `  tier 3+: the relevant file under openspec/changes/${change}/specs/\n` +
          `  tier 4+: design.md and the specs in full\n` +
          `Your tier is ${task.tier}.\n\n` +
          `RULES:\n` +
          `- Implement ONLY this task. Do not modify files outside its scope.\n` +
          `- Do not fix unrelated problems you notice; report them instead.\n` +
          `- Run typecheck and lint on what you changed.\n` +
          `- Do not commit, and do not edit tasks.md — the orchestrator owns both.\n` +
          `- If .claude/graph/graph.json exists, interlock-graph query / consumers before grep.\n` +
          `- Locate (graph or grep) then Read spans. Do not re-read a file unless it changed.\n` +
          `- Return the schema only. No narrative.\n` +
          `- If your tier is 1 or 2: after typecheck/lint pass, stop. Do not refactor or polish.\n\n` +
          `Report ok:false if you could not complete the task, with what blocked you.`,
        {
          label: task.id,
          model: task.model,
          schema: {
            type: 'object',
            required: ['id', 'ok'],
            properties: {
              id: { type: 'string' },
              ok: { type: 'boolean' },
              filesChanged: { type: 'array', items: { type: 'string' } },
              error: { type: 'string' },
              note: { type: 'string' }
            }
          }
        }
      )
    )

    // A null result is an agent that was stopped or hit an unrecoverable error.
    // It is a task failure, not an absent task — dropping it would let the run
    // walk past the failure budget without noticing.
    const reported = tasks.map((task, i) => {
      const r = results[i]
      if (!r) return { id: task.id, ok: false, error: 'agent returned no result' }
      return { id: r.id || task.id, ok: Boolean(r.ok), error: r.error }
    })

    summary.waves.push({
      wave: next.wave,
      kind: next.action,
      ok: reported.filter(r => r.ok).length,
      failed: reported.filter(r => !r.ok).length
    })

    next = await cheap(
      `record-batch-${steps}`,
      `Record this batch result against the run state.\n\n` +
        `Write this JSON to ${WORK}/batch.json:\n${JSON.stringify({ tasks: reported })}\n\n` +
        `Then run:\n` +
        `  interlock wave-state record-batch --state ${STATE} --result ${WORK}/batch.json --write-state ${STATE} --json\n\n` +
        `Stdout is the next step (same shape as wave-state next). Report it verbatim. ` +
        `A non-zero exit means the recorded result halted the run — report action:halt with the reason.\n\n` +
        `Then tick the checkbox in openspec/changes/${change}/tasks.md for every task that succeeded. ` +
        `Do not tick a failed one.`
    )
    continue
  }

  if (next.action === 'verify') {
    const mode = next.mode === 'fix' ? 'fix' : 'check'
    next = await cheap(
      `inter-wave-verify-${steps}`,
      `Inter-wave verification for change "${change}"${mode === 'fix' ? `, fix attempt ${next.fixAttempt}` : ''}.\n\n` +
        `Run the project's fast checks against what the last wave changed: typecheck first, then ` +
        `tests for the modified files, then lint if it is quick. Adapt to the stack.\n\n` +
        (mode === 'fix'
          ? `The previous check failed. Make ONE targeted fix and re-run only the failing step.\n\n`
          : '') +
        `Judge the outcome with:\n` +
        `  interlock verify judge --plan <plan> --results <results> --context inter-wave --json\n` +
        `The inter-wave context is load-bearing — a red typecheck stops the next wave here, though ` +
        `it would not stop the commit later.\n\n` +
        `Then record it:\n` +
        `  write { "ok": <bool>, "errors": [...], "blocksNextWave": <bool> } — or ` +
        `{ "skipped": true, "reason": "<reason>" } — to ${WORK}/verify.json\n` +
        `  interlock wave-state record-verify --state ${STATE} --result ${WORK}/verify.json --write-state ${STATE} --json\n\n` +
        `Stdout is the next step. Report it verbatim. A non-zero exit means action:halt.\n` +
        `If you skipped, also set skipped:true and reason — that reason is printed to the user.\n\n` +
        `Skip verification when no commands are detectable, when the failures are pre-existing, or ` +
        `when it would exceed the budget — but a skip ALWAYS carries a reason. Set blocksNextWave true ` +
        `only when the next wave genuinely cannot build on this state.`
    )

    if (next && next.skipped && next.reason) {
      banners.push(`VERIFICATION SKIPPED: reason=${next.reason}`)
    }
    continue
  }

  if (next.action === 'replan') {
    next = await cheap(
      `replan-${steps}`,
      `A completed wave may have invalidated later ones for change "${change}".\n\n` +
        `Revise ONLY groups that have not executed yet — the CLI rejects a revision to an executed ` +
        `group, and that rejection is correct, not an obstacle to work around.\n\n` +
        `If you have revisions, write [{ "group": <n>, "tasks": [...] }] to ${WORK}/replan.json, then:\n` +
        `  interlock wave-state replan --state ${STATE} --groups ${WORK}/replan.json --write-state ${STATE} --json\n` +
        `Stdout is the next step. Report it verbatim.\n\n` +
        `If nothing actually needs revising: run \`interlock wave-state next --state ${STATE} --json\` ` +
        `and report that step. Do not invent groups.`
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
  await recordOutcome()
  return finish()
}

// --- 4. review the diff ----------------------------------------------------

const review = await step(
  'review',
  `Adversarially review the diff for change "${change}".\n\n` +
    `Fan out one reviewer per dimension: language, architecture, qa and technical-lead always; ` +
    `devops when the diff touches deploy, config or infrastructure; security when it touches auth, ` +
    `input handling or data exposure. Each writes findings as ` +
    `{ dimension, findings: [{ severity, file, line, title, description, suggestion }] }.\n\n` +
    `Then put TWO skeptics on every blocker and warning independently, each emitting ` +
    `{ findingTitle, file, isReal, confidence, reasoning, refinedSeverity, qualityScore, severityScore }. ` +
    `Include the file — title alone is not unique, and two findings sharing a title in different ` +
    `files would otherwise share one verdict.\n\n` +
    `Write findings to ${WORK}/findings.json and verdicts to ${WORK}/verdicts.json, then:\n` +
    `  interlock review --findings ${WORK}/findings.json --verdicts ${WORK}/verdicts.json --metrics ${change} --json > ${WORK}/review.json\n\n` +
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
      detail: { type: 'string' }
    }
  }
)

if (!review || !review.ok) {
  summary.notes.push(`review did not complete: ${(review && review.detail) || 'no result'}`)
}
summary.review = review || null

// --- 5. remediation, bounded ----------------------------------------------
//
// Rounds 1..cap are fix passes; the round after the cap is the verdict, and it
// is the only one that can halt. The script asks for the round it is on and
// does not decide when the budget is spent.

let round = 1
let remediation = null

while (round <= 3) {
  const isVerdict = round === 3
  remediation = await step(
    `remediate-${round}`,
    `Remediation ${isVerdict ? 'verdict' : `round ${round}`} for change "${change}".\n\n` +
      `Run: interlock remediate --findings ${WORK}/review.json --round ${round} --json\n\n` +
      (isVerdict
        ? `This is the verdict round. It fixes nothing — it reports whether blockers survived the ` +
          `budget. A non-zero exit means unresolved blockers; report halted:true with the reason.`
        : `Fan out ONE fixer agent per file from the plan's byFile groups — those groups are ` +
          `disjoint, so they are safe in parallel. Apply the unscoped group last, sequentially. ` +
          `Fix blockers and warnings; never fix a suggestion. A finding you do not fix is recorded ` +
          `with its reason, never silently dropped.\n\n` +
          `Then re-review ONLY the dimensions the plan lists in reReviewDimensions, put two skeptics ` +
          `on the new findings as before, and rewrite ${WORK}/review.json via interlock review.\n\n` +
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
        blockersRemaining: { type: 'integer' }
      }
    }
  )

  if (!remediation) return await halt(`remediation round ${round} returned no result`)
  if (remediation.halted) return await halt(remediation.reason || 'unresolved blockers after remediation')
  if (!isVerdict && remediation.blockersRemaining === 0) {
    // Nothing left to fix; go straight to the verdict so the budget is still
    // formally closed rather than assumed.
    round = 3
    continue
  }
  round += 1
}

summary.remediation = remediation
summary.remediationRounds = Math.min(round, 2)

// --- 6. verify -------------------------------------------------------------

const verified = await step(
  'verify',
  `Final verification for change "${change}".\n\n` +
    `Read .claude/testing/profile.json. Where the discovery ladder would ask a question, leave the ` +
    `field null and note it — never interview, that is /interlock:fix-tests's job.\n\n` +
    `  interlock verify plan --profile <profile|--no-profile> ${skipCoverage ? '--no-coverage ' : ''}${skipE2e ? '' : '--e2e '}--json > ${WORK}/vplan.json\n\n` +
    `Run each planned step, record { kind, exitCode, total, passed, failed, failures } for each, then:\n` +
    `  interlock verify judge --plan ${WORK}/vplan.json --results ${WORK}/vresults.json --context final --json\n\n` +
    `On a red unit suite, repair by ROOT CAUSE — cluster the failures with interlock verify cluster, ` +
    `fix the shared cause once, and ask interlock verify repair whether another iteration is allowed. ` +
    `Never weaken a test, loosen an assertion or narrow the suite: a suite that went green by ` +
    `shrinking is not green, and the CLI checks for exactly that when given a baseline.\n\n` +
    `A red unit suite is a hard halt. A red e2e is NOT — report it, never repair it. Coverage is ` +
    `advisory and blocks nothing.\n\n` +
    `Report every skip reason and whether e2e failed.`,
  {
    type: 'object',
    required: ['ok'],
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

// --- 7. handoff artifacts, explanation, learnings -------------------------

const handoff = await step(
  'handoff',
  `Produce the handoff artifacts for change "${change}".\n\n` +
    `  interlock surface --changed <files changed by this run> --json\n\n` +
    `If needsManualTestPlan is true, write openspec/changes/${change}/manual-test-plan.md covering ` +
    `every touched file, with spec scenarios and tasks mapped to numbered cases. If it is false, ` +
    `skip it and say why — a backend-only change does not get a UI test plan.\n\n` +
    `Then write openspec/changes/${change}/code-explanation.md as a commit teach-in: why each file ` +
    `changed, what changed, the blast radius, and what would break if it were left out.\n\n` +
    `Finally, capture at most three learnings from fixes made during this run — recurring failure ` +
    `modes under .claude/memory/failure-modes/, module coupling under .claude/memory/coupling/ — ` +
    `each one small file, indexed in .claude/memory/MEMORY.md. Only genuinely recurring patterns; ` +
    `write nothing if nothing recurred. This is silent.`,
  {
    type: 'object',
    required: ['ok'],
    properties: {
      ok: { type: 'boolean' },
      manualTestPlan: { type: 'boolean' },
      skipReason: { type: 'string' },
      learnings: { type: 'integer' }
    }
  }
)

summary.handoff = handoff

if (noCommit) {
  summary.notes.push('--no-commit: everything ran, the commit is yours')
  await recordOutcome()
  return finish()
}

// --- 8. commit -------------------------------------------------------------

const committed = await step(
  'commit',
  `Commit change "${change}" as ONE feature-level commit.\n\n` +
    `Read the change artifacts and write a verb-phrase conventional-commit message with a short ` +
    `outcome summary. Stage only the files this run touched — never \`git add -A\`, never amend, ` +
    `never push.\n\n` +
    `Then record the outcome for the ladder:\n` +
    `  interlock autonomy record review-code --blockers <surviving blocker count>\n` +
    `That record is storage only. Never print an autonomy level, L2/L3, or anything about a ladder — ` +
    `it is experimental and means nothing to the reader.`,
  {
    type: 'object',
    required: ['ok'],
    properties: { ok: { type: 'boolean' }, sha: { type: 'string' }, detail: { type: 'string' } }
  }
)

summary.commit = committed

await recordOutcome()
return finish()

// --- the summary -----------------------------------------------------------

function finish() {
  // The banner block is always printed, on a halt and on a clean run alike.
  // Silence is the failure mode it exists to remove: a summary with no banner
  // section is indistinguishable from a run that degraded and hid it.
  const lines = []

  lines.push(summary.halted ? `SHIP HALTED — ${summary.halted}` : `SHIP COMPLETE — ${change || 'change'}`)

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
    lines.push(
      `  handoff: manual test plan ${summary.handoff.manualTestPlan ? 'written' : `skipped (${summary.handoff.skipReason || 'not UI-testable'})`}`
    )
  }
  if (summary.commit && summary.commit.ok) lines.push(`  commit: ${summary.commit.sha || 'created'}`)
  for (const note of summary.notes) lines.push(`  ${note}`)

  lines.push('')
  if (banners.length) {
    for (const banner of banners) lines.push(banner)
  } else {
    lines.push(
      'No degradation banners — graph, test profile, model routing, verification and e2e were all clean.'
    )
  }

  return lines.join('\n')
}
