export const meta = {
  name: 'ship',
  description:
    'Take a reviewed OpenSpec change from tasks to commit in one uninterrupted run — dependency-ordered waves of parallel implementers, unit verification, and a commit. Asks nothing. Pass --strict for the previous default (adversarial review, handoff, conformance).'
}

// ship — the loop, INTERPRETED.
//
// This used to be `skills/ship/SKILL.md`: eleven numbered headings of prose a
// model was asked to follow in order. Then it became a script that held the
// loop, the branching and every agent's briefing — and `bin/interlock-ship-acp`
// held a second copy of the same, sharing this file's policy by evaluating
// marked blocks of its source through `new Function`. Every new classifier
// field, banner or prompt sentence had to be added twice, and this repository's
// own memory records the times it was added once.
//
// So the loop moved into the CLI (`lib/run.mjs`) and what is left here is an
// interpreter:
//
//   interlock run  emits a step: the agents to spawn, with their briefings,
//                  and the exact argv to call once they return
//   this script    spawns what a step names and calls the argv it names
//   agents         read files, write code, run commands
//
// The loop is four lines. It branches on nothing — not a flag, not a mode, not
// a count, not a verdict. Every branch the run has (apply-only, no-commit,
// skip-e2e, isolate-waves, replan allowed, verify skipped, done) is taken inside
// the CLI, from the run manifest and the wave state. There is nothing here for
// the ACP driver to duplicate, because there is nothing here to duplicate.
//
// What this file still owns is host plumbing, and nothing else:
//
//   - `parseInvocation`, because argument delivery is host-specific.
//   - The ping that runs a CLI command. The runtime loads no modules and gives
//     the script no filesystem or shell of its own, so every `interlock` call is
//     an agent that runs the command and copies stdout.
//   - Delivering a briefing BY REFERENCE. The script cannot hold several
//     kilobytes of prompt without a ping copying it, and a relay miss on a 4 KB
//     string is silent under-instruction — so the worker is handed a path and a
//     hash and must report the hash back. See BOOTSTRAP.
//   - The runtime's own token counter, which no other process can read.
//   - `RUNAWAY_BACKSTOP`, which is the RUNTIME's agent ceiling and not a policy
//     cap. The policy bound on run steps is `interlock limits`' `maxRunSteps`,
//     enforced by the CLI, which returns a halt step naming it.
//
// The strict tail — adversarial review, bounded remediation, the verdict and
// the handoff artifacts — used to run inline here behind a `host-tail` step,
// and was the last loop text this file held. `emit-strict-tail-from-cli` made
// it part of the program the CLI emits, so this script interprets those steps
// exactly as it interprets a batch: spawn what the step names, write the
// results, call the argv. There is no seam left, and the no-policy sweep in
// test/workflows.test.mjs has no allowance.
//
// The runtime also accepts no mid-run user input. That is the zero-touch
// contract, and it is structural rather than aspirational — there is no
// AskUserQuestion to remove, because there is nobody listening.

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
  // The PLAN shape, which is a different decision from `mode` below (that one is
  // checkpoint/continue). Both flags at once is a contradiction the run reports
  // and stops on, never a last-wins guess: the two produce different bills and
  // different agent counts, and picking one silently would ship the shape the
  // operator did not ask for. The conflict is reported rather than thrown so the
  // parse stays pure and the halt happens where every other halt does.
  const soloFlag = has('solo')
  const wavesFlag = has('waves')
  // The TASK shape, which is a third decision again: whether the change's
  // leading failing-test section runs first instead of deferring. Absent both
  // flags, `tasks.md`'s own section heading decides — so an ordinary change is
  // planned exactly as it was before either flag existed. Contradictory flags
  // are reported and stopped on for the same reason --solo/--waves are: the two
  // produce different wave orders and different verifications.
  const tddFlag = has('tdd')
  const noTddFlag = has('no-tdd')
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
    // Opt-in, default off — unset, a run is byte-for-byte today's behavior: no
    // worktree, no merge-lanes step. See design.md Decision 1 for why this is
    // gated rather than always-on.
    isolateWaves: has('isolate-waves'),
    laneMode: soloFlag && wavesFlag ? null : soloFlag ? 'solo' : wavesFlag ? 'waves' : null,
    laneModeConflict: soloFlag && wavesFlag,
    tddMode: tddFlag && noTddFlag ? null : tddFlag ? 'tdd' : noTddFlag ? 'no-tdd' : null,
    tddModeConflict: tddFlag && noTddFlag,
    maxParallel: Number.isInteger(opts.maxParallel) ? opts.maxParallel : null,
    mode: opts.mode === 'continue' ? 'continue' : 'checkpoint'
  }
}
// PARSE_INVOCATION_END

// --- host plumbing ----------------------------------------------------------

// Spawn prefix for this script's OWN control-plane pings. A step names the type
// and tools of every agent it asks for, so these two literals are all that is
// left of the four this file used to carry — and they are the ping's, which is
// plumbing rather than policy. Dual-write `type` (plugin agent) and `tools`
// (allowlist) so a runtime that ignores one key still shrinks the inherited
// catalog.
const PING_AGENT = 'interlock:ping'
const PING_TOOLS = ['Bash', 'Read', 'Write']
const pingExtra = { type: PING_AGENT, tools: PING_TOOLS }

const WORK = '.claude/ship'
const RESULTS = `${WORK}/results.json`

// The runtime caps a run at 1000 agents. This is that ceiling, named so nobody
// mistakes it for policy: it is NOT a bound on the loop, and it is deliberately
// not derived from `maxRunSteps` or from anything else the CLI publishes. It
// exists only so a loop whose exit condition depends on a relay cannot spin
// forever if that relay breaks.
const RUNAWAY_BACKSTOP = 1000

// Briefings are delivered BY REFERENCE (design D2). The CLI writes each one to a
// file whose first line carries its sha256; this script hands the worker the
// path and requires the hash back. A result whose `briefing` is absent or
// differs is treated as a null result — the task fails closed with a named
// reason, exactly as a missing handoff packet does.
//
// This text is plumbing, not policy: it names a file and a field and says
// nothing whatsoever about the work. It is pinned against
// test/fixtures/prompts/bootstrap.txt so it cannot quietly grow instructions.
const BOOTSTRAP = (label, path, sha) =>
  `Your briefing for this step is the file ${path}.\n\n` +
  `Read it in full before doing anything else and follow it as the whole of your instructions. ` +
  `Its first line is an HTML comment carrying a sha256; report that hex string as "briefing" in ` +
  `your result. A result without it is discarded and this step is recorded as failed, so read the ` +
  `file rather than guessing at what "${label}" means.\n\n` +
  `Expected sha256: ${sha}`

// Everything this host observed that the CLI could not, which is now two
// things: `banners`, the degradations only this host can raise, folded into the
// close through --host-banners; and `spend`, the runtime's own token counter,
// which no other process can read. The review, remediation and handoff figures
// used to live here too and are the CLI's own now — it adjudicated them.
const banners = []
const summary = { spend: [], notes: [] }
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

// --- the run ----------------------------------------------------------------

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
  isolateWaves,
  laneMode,
  laneModeConflict,
  tddMode,
  tddModeConflict,
  maxParallel,
  mode
} = parseInvocation(typeof args === 'undefined' ? undefined : args)

let steps = 0
let resolvedChange = changeArg || '(unresolved)'

/** A control-plane ping: mechanical, cheap, and never asked to decide anything. */
const ping = (name, prompt, schema) => agent(prompt, { label: name, schema, ...pingExtra })

/**
 * Spawn one agent a step named.
 *
 * The step named its type, tools, model, effort, isolation and schema, so this
 * passes them through and adds only the two things a by-reference host needs:
 * the bootstrap, and `briefing` as a required field.
 */
async function spawnOne(s) {
  const result = await agent(BOOTSTRAP(s.label, s.promptPath, s.promptSha256), {
    label: s.label,
    type: s.type,
    tools: s.tools,
    ...(s.model ? { model: s.model } : {}),
    ...(s.effort ? { effort: s.effort } : {}),
    ...(s.isolation ? { isolation: s.isolation } : {}),
    schema: {
      ...s.schema,
      required: [...(s.schema.required || []), 'briefing'],
      properties: { ...(s.schema.properties || {}), briefing: { type: 'string' } }
    }
  })
  // Fail closed on an unacknowledged briefing. An agent that did not read its
  // instructions did not do this task, whatever it reports about it — and a
  // silently under-instructed worker is exactly the failure prompt integrity
  // exists to catch. So it is a null result with a named reason, which the
  // recorder already treats as a failed task, rather than a warning beside a
  // result that gets counted.
  const ack = result && typeof result.briefing === 'string' ? result.briefing.trim() : ''
  if (ack !== s.promptSha256) {
    banners.push(
      `BRIEFING NOT ACKNOWLEDGED: ${s.label} reported ${ack || '(nothing)'} for a briefing whose ` +
        `sha256 is ${s.promptSha256} — the step is recorded as failed rather than trusted`
    )
    return null
  }
  return result
}

/** Spawn everything a step names, in parallel. */
async function spawnAll(step) {
  const spawns = Array.isArray(step.spawns) ? step.spawns : []
  if (!spawns.length) return []
  return await pipeline(spawns, s => spawnOne(s))
}

/**
 * Run one `interlock` command and return the step it printed.
 *
 * The script has no shell, so this is a ping that writes whatever files the
 * command reads, runs the argv and copies stdout. `cliStdout` is the record:
 * a step is read from the CLI's own bytes, never from a field a model retyped,
 * and a relay that produced neither is a loud stop rather than a guess at what
 * the CLI decided.
 */
async function cli(argv, results, extraWrites = []) {
  const label = `cli-${++steps}`
  const writes = [...(results === undefined ? [] : [{ path: RESULTS, value: results }]), ...extraWrites]
  const writeLines = writes
    .map(w => `Write this JSON to ${w.path} exactly as given:\n${JSON.stringify(w.value)}`)
    .join('\n\n')
  // Quoted, because an argv token can hold a whole sentence: a halt reason is
  // one argument and reads as several the moment it is joined with spaces. The
  // relay runs a command line, so the quoting has to happen where the command
  // line is built.
  const quote = a => (/[^\w@%+=:,./-]/.test(String(a)) ? `'${String(a).replace(/'/g, `'\\''`)}'` : String(a))
  const command =
    `interlock ${argv.map(quote).join(' ')}${results === undefined ? '' : ` --results ${RESULTS}`} --json`
  const relayed = await ping(
    label,
    `You are a mechanical relay for one command. Do not interpret it, and do not do the work it ` +
      `describes.\n\n` +
      (writeLines ? `${writeLines}\n\n` : '') +
      `Then run exactly:\n  ${command}\n\n` +
      `Copy that command's stdout into this result verbatim as cliStdout, and copy its "action" ` +
      `field into action. Never invent either, never summarize, and never adjust a value: a step ` +
      `edited in transit is indistinguishable afterwards from the step the CLI emitted.\n` +
      `A non-zero exit is still a result — copy whatever it printed.`,
    {
      type: 'object',
      properties: { cliStdout: { type: 'string' }, action: { type: 'string' } }
    }
  )
  if (relayed && typeof relayed.cliStdout === 'string') {
    try {
      const parsed = JSON.parse(relayed.cliStdout)
      if (parsed && typeof parsed.action === 'string') return parsed
    } catch {
      // stdout was not JSON. Nothing is inferred from that: the caller stops.
    }
  }
  return null
}

// Before anything is spawned: two contradictory shape flags is a question only
// the operator can answer, and this run has nobody to ask. Halting here costs
// one invocation; guessing costs a whole run of the wrong shape.
if (laneModeConflict) {
  return await stop(
    'contradictory plan-shape flags: --solo and --waves were both passed — pass exactly one, or ' +
      'neither to let the classifier recommend inside the published envelope'
  )
}

if (tddModeConflict) {
  return await stop(
    'contradictory task-shape flags: --tdd and --no-tdd were both passed — pass exactly one, or ' +
      "neither to let tasks.md's own leading-section heading decide"
  )
}

// The environment probe. Everything it asks about is a property of THIS HOST —
// whether haiku is reachable, whether the graph was built, whether a test
// profile exists, whether model routing is overridden — so it is asked here and
// carried to the close as a host banner, rather than being something the CLI
// could have found out for itself.
const probed = await ping(
  'validate',
  `Report this environment. Change nothing, and do not start any work.\n\n` +
    `Run: test -f .claude/graph/graph.json && echo yes || echo no\n` +
    `Report yes as hasGraph:true, no as hasGraph:false with a one-line graphReason.\n\n` +
    `Run: test -f .claude/testing/profile.json && echo yes || echo no\n` +
    `Report it as hasTestProfile.\n\n` +
    `Run: printenv CLAUDE_CODE_SUBAGENT_MODEL\n` +
    `If it prints a value, report it as subagentModelOverride. If it is unset the command exits ` +
    `non-zero and prints nothing — that is the normal case, so leave the field out rather than ` +
    `reporting an empty string.\n\n` +
    `Then run: printenv CLAUDE_CODE_USE_BEDROCK; printenv AWS_BEDROCK\n` +
    `If subagentModelOverride is set, leave haikuAvailable out — routing is already overridden.\n` +
    `If either Bedrock variable prints a non-empty value other than 0 or false, report ` +
    `haikuAvailable:false. Bedrock accounts often cannot reach haiku and a failed ping halts the loop.\n` +
    `Otherwise report haikuAvailable:true. When unsure, haikuAvailable:false so pings inherit ` +
    `the session model rather than hard-failing.\n\n` +
    `Then create the working directory ${WORK}/.`,
  {
    type: 'object',
    properties: {
      hasGraph: { type: 'boolean' },
      graphReason: { type: 'string' },
      hasTestProfile: { type: 'boolean' },
      subagentModelOverride: { type: 'string' },
      haikuAvailable: { type: 'boolean' }
    }
  }
)

if (probed && probed.hasGraph === false) {
  banners.push(
    `GRAPH UNAVAILABLE: ${probed.graphReason || 'never built'} — implementer and reviewer agents fall back to grep and will be slower`
  )
}
if (probed && probed.hasTestProfile === false) {
  banners.push('NO TEST PROFILE: run /interlock:fix-tests --reconfigure once')
}
// CLAUDE_CODE_SUBAGENT_MODEL overrides both the session model and the per-agent
// model a step asks for, so when it is set the planner's tier ladder — the opus
// clamp, the haiku pings — is not in effect and the run costs whatever that
// model costs. Nothing here can prevent that; it is the user's environment. But
// a summary claiming no degradation while the entire model ladder was bypassed
// is exactly the silence the banner block exists to remove.
const subagentModel =
  probed && typeof probed.subagentModelOverride === 'string'
    ? probed.subagentModelOverride.trim()
    : ''
if (subagentModel) {
  banners.push(
    `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=${subagentModel} — every agent runs on ` +
      `that model, so the per-tier assignment in the plan is not in effect`
  )
} else if (probed && probed.haikuAvailable === true) {
  // Mutate rather than rebind — `ping` closes over the object.
  pingExtra.model = 'haiku'
}

// --- the loop ---------------------------------------------------------------

let step = await cli([
  'run',
  'start',
  ...(changeArg ? ['--change', changeArg] : []),
  ...(applyOnly ? ['--apply-only'] : []),
  ...(noCommit ? ['--no-commit'] : []),
  ...(skipE2e ? ['--skip-e2e'] : []),
  ...(skipCoverage ? ['--skip-coverage'] : []),
  ...(isolateWaves ? ['--isolate-waves'] : []),
  ...(laneMode ? ['--mode', laneMode] : []),
  ...(tddMode === 'tdd' ? ['--tdd'] : tddMode === 'no-tdd' ? ['--no-tdd'] : []),
  ...(Number.isInteger(maxParallel) ? ['--max-parallel', String(maxParallel)] : []),
  ...(mode === 'continue' ? ['--continue'] : []),
  ...(review ? ['--review'] : []),
  ...(handoff ? ['--handoff'] : []),
  ...(conformance ? ['--conformance'] : []),
  ...(strict ? ['--strict'] : []),
  '--host',
  'workflow'
])

while (step && step.then) {
  if (steps > RUNAWAY_BACKSTOP) {
    return await stop(`the interpreter exceeded the runtime's agent ceiling (${RUNAWAY_BACKSTOP})`)
  }
  for (const banner of step.banners || []) banners.push(banner)
  if (typeof step.change === 'string' && step.change) resolvedChange = step.change

  // A wave's measured span closes where the wave closes: at the step that
  // dispatches or verifies it. One place, so the boundary the script acted on
  // and the boundary the receipt reports cannot drift apart.
  if (step.action === 'run-batch' || step.action === 'test-wave' || step.action === 'verify') {
    markWaveSpend(step.wave)
  }

  const results = await spawnAll(step)
  // The close is the one continuation that needs more than the spawn results:
  // it reads what only this host observed. Appending here rather than at the
  // one call site `stop()` uses is what keeps a CLEAN run's banners and token
  // spend from being dropped — they used to reach the close only on a halt,
  // which is the path least likely to have any.
  step = isClose(step.then.argv)
    ? await cli([...step.then.argv, ...closeArgs()], results, closeWrites())
    : await cli(step.then.argv, results)
}

if (!step) {
  return await stop('the run program returned no step — the CLI relay could not be read')
}

// The last argv was `run close`, so `step` IS the close: its summary and its
// banners. Print and stop.
return finish(step)

// --- closing ----------------------------------------------------------------

/**
 * Stop the run through the CLI's own close, so a halt records a receipt, an
 * outcome and a terminal trajectory event exactly as a completion does. A
 * halted run is the most informative record in the corpus, which is why it is
 * written on the way out rather than skipped as a failure.
 */
function isClose(argv) {
  return Array.isArray(argv) && argv[0] === 'run' && argv[1] === 'close'
}

async function stop(reason) {
  const closed = await cli(['run', 'close', '--halt', reason, ...closeArgs()], undefined, closeWrites())
  return finish(
    closed || {
      action: 'halt',
      summary:
        `SHIP HALTED — ${reason}\n\n` +
        `The close itself could not be reached, so no receipt was written for this run.`
    }
  )
}

/** The flags the close reads for what only this host observed. */
function closeArgs() {
  return [
    ...(banners.length ? ['--host-banners', `${WORK}/host-banners.json`] : []),
    '--host-observed',
    `${WORK}/host-observed.json`,
    // Unconditional: this driver knows nothing about topics, servers or
    // notification text. It requests the push; the CLI decides whether one is
    // configured and what it says (design D1).
    '--notify'
  ]
}

/** Those same values, as writes the relay performs before running the close. */
function closeWrites() {
  const spentAtClose = spentTokens()
  return [
    ...(banners.length ? [{ path: `${WORK}/host-banners.json`, value: banners }] : []),
    {
      path: `${WORK}/host-observed.json`,
      value: {
        ...summary,
        outputTokens:
          spentAtClose === null || spendOpenedAt === null
            ? null
            : Math.max(0, spentAtClose - spendOpenedAt)
      }
    }
  ]
}

/** Print the close's summary. */
function finish(closed) {
  const text =
    typeof closed.summary === 'string' && closed.summary.trim()
      ? closed.summary
      : `SHIP ${closed.action === 'halt' ? 'HALTED' : 'ENDED'} — ${resolvedChange}`
  return (
    text +
    // Printed by this host alone: `/goal` is a Claude Code convention and means
    // nothing on another host, so it is not part of the summary the CLI builds.
    '\nGOAL MET: interlock ship returned a terminal summary.'
  )
}
