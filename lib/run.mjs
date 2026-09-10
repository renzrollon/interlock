// The run program — every step of the lean ship loop, emitted by the CLI.
//
// Interlock has two drivers of one loop: `workflows/ship.js` on the Claude Code
// Workflow runtime and `bin/interlock-ship-acp` over ACP. Each used to carry its
// own copy of the loop's control flow and of the text every agent is handed, and
// policy was shared only by smuggling marked blocks of one driver's source
// through `new Function`. Every new classifier field, banner or prompt sentence
// had to be added twice, and this repository's own memory records the times it
// was added once.
//
// So the CLI emits the whole program. A step names the agents to spawn — with
// their label, model, effort, agent type, tool allowlist, result schema and
// briefing — and the exact `interlock` argv to call once those agents return.
// The interpreter on either host is: spawn everything in `spawns` in parallel,
// write the results, call `then.argv`, repeat until `then` is null. A driver
// never branches on a flag, a mode, a count or a verdict (design D3).
//
// This module decides; it does not spawn, and it does not print. It reads and
// writes the run's own files and calls the pure state machine, the planner, the
// verifier and the receipt builder. The three helpers it cannot import — the
// trajectory loggers and the git readers that live in `bin/interlock` — arrive
// through `ctx.deps` rather than being written a second time here.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { LIMITS, EFFORT } from './limits.mjs'
import { spawnPrefix } from './host.mjs'
import { PLUGIN_ROOT } from './doctor.mjs'
import { RED_SECTION_MARKER, inspectChange, planCoverage, tickTasks } from './artifacts.mjs'
import { FINGERPRINT_PATH, computeFingerprint, resolvePlanReuse, writeFingerprint } from './plan-fingerprint.mjs'
import { clearStage } from './ship-stage.mjs'
import { appendRunLogEvent, checkRunLog } from './run-log.mjs'
import { appendOutcome, observedFromReceipt } from './outcomes.mjs'
import { readPredictedPaths, readTouchedPaths } from './run-paths.mjs'
import {
  buildReceipt,
  closingFromWaveState,
  degradationLines,
  formatRunSummary,
  summaryHeadline,
  tailFromManifest
} from './receipt.mjs'
import { detectUnarchived } from './drift.mjs'
import { projectSlug } from './project-slug.mjs'
import { composeCloseMessage, postNtfy, readNotifyConfig } from './notify.mjs'
import { SKIP_REASONS, planVerification, judgeVerification } from './verify.mjs'
import { resolveReview, readReviewPolicy } from './review-core.mjs'
import { writeReviewMetrics } from './metrics.mjs'
import { planRemediation } from './remediate.mjs'
import { classifySurface } from './surface.mjs'
import { buildChecklist } from './conformance.mjs'
import { record as recordAutonomy } from './autonomy.mjs'
import {
  applyReplan,
  batchOutcomes,
  createRunState,
  laneEffort,
  laneLabel,
  laneModel,
  nextStep,
  planWaves,
  recordBatchResult,
  recordVerifyResult
} from './waves.mjs'
import {
  assembleCommitPrompt,
  assembleHandoffPrompt,
  assembleImplementerPrompt,
  assemblePlannerPrompt,
  assembleRemediatePrompt,
  assembleReplanPrompt,
  assembleReviewPrompt,
  assembleVerdictPrompt,
  assembleVerifyPrompt,
  publishStageLine,
  selectDimensions
} from './prompts/index.mjs'
import {
  COMMIT_SCHEMA,
  HANDOFF_RESULT_SCHEMA,
  LANE_SCHEMA,
  PLANNER_SCHEMA,
  REMEDIATE_RESULT_SCHEMA,
  REPLAN_SCHEMA,
  REVIEW_RESULT_SCHEMA,
  SINGLE_TASK_SCHEMA,
  VERDICT_RESULT_SCHEMA,
  VERIFY_RESULT_SCHEMA
} from './prompts/schemas.mjs'

// --- the shapes -------------------------------------------------------------

/** The run manifest's schema (design D4). */
export const RUN_SCHEMA = 'interlock.run/1'

/** The step record's schema (design D3). */
export const STEP_SCHEMA = 'interlock.run-step/1'

/** Root of the per-run state tree, shared with `lib/ship-stage.mjs`. */
export const WORK_DIR = join('.claude', 'ship')
export const MANIFEST_PATH = join(WORK_DIR, 'run.json')
export const STATE_PATH = join(WORK_DIR, 'state.json')
export const BRIEFINGS_DIR = join(WORK_DIR, 'briefings')
export const CLASSIFIED_PATH = join(WORK_DIR, 'classified.json')
export const PLAN_FILE_PATH = join(WORK_DIR, 'plan.json')
export const REPLAN_PATH = join(WORK_DIR, 'replan.json')
// Where the review/remediation worker writes what it found, so `run reviewed`
// and `run remediated` can adjudicate it themselves rather than trust a count
// the agent reports about itself (design D2).
export const FINDINGS_PATH = join(WORK_DIR, 'findings.json')
export const VERDICTS_PATH = join(WORK_DIR, 'verdicts.json')

/** The first line of every briefing file: what it is, whose it is, and its hash. */
export const BRIEFING_HEADER = (label, sha) =>
  `<!-- interlock briefing v1 label=${label} sha256=${sha} -->`

/**
 * The actions a step may carry: the six the state machine already emits, plus
 * the ones the program adds around them.
 *
 * `review`, `remediate` and `verdict` are the strict tail, emitted by the CLI
 * itself (`emit-strict-tail-from-cli`, design D1) rather than handed back to a
 * host that holds loop text of its own — the seam this change closes.
 */
export const ACTIONS = Object.freeze([
  'run-batch',
  'test-wave',
  'verify',
  'replan',
  'done',
  'halt',
  'classify',
  'verify-final',
  'review',
  'remediate',
  'verdict',
  'handoff',
  'commit',
  'close',
  'complete'
])

// --- the manifest -----------------------------------------------------------

/**
 * What a run whose host declared no capabilities is assumed to be: the Workflow
 * host, which owns its own lane worktrees and has everything else.
 *
 * Stated here rather than imported from `lib/host/registry.mjs` for two
 * reasons. The run program is the only party that reads it — an adapter
 * declares its own capabilities and never consults this default. And the CLI
 * must not import the adapters: they spawn vendor binaries, and the policy
 * engine has no business loading a transport in order to answer "which wave
 * next".
 */
export const ASSUMED_CAPABILITIES = Object.freeze({
  schemaEnforced: true,
  modelSelect: 'flag',
  worktree: 'runtime',
  hooks: true,
  usage: true,
  // The one thing the Workflow host does NOT have, and the reason cache
  // accounting is declared separately from usage at all: its runtime exposes
  // `budget.spent()`, a single cumulative scalar with no decomposition, so a run
  // there can report what it spent and never what it re-read or re-wrote. A
  // manifest written before this key existed reads `false` here, which is the
  // honest answer — that run measured no cache figures either.
  cacheAccounting: false,
  billing: 'claude-subscription-programmatic'
})

const FLAG_FIELDS = Object.freeze([
  'applyOnly',
  'noCommit',
  'skipE2e',
  'skipCoverage',
  'isolateWaves',
  'laneMode',
  'tddMode',
  'maxParallel',
  'mode',
  'review',
  'handoff',
  'conformance',
  'strict'
])

/**
 * Write the run manifest. Every later `run` subcommand reads it, which is what
 * lets a driver pass its parsed flags once and never consult them again — the
 * flags are host-specific in their delivery and identical in their meaning
 * (design D4).
 */
export function writeManifest(root, manifest) {
  const path = join(root, MANIFEST_PATH)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

/**
 * Read the run manifest. Returns null when there is none — a `run` subcommand
 * reached without a `run start` — so the caller can say that rather than
 * defaulting to a run shape nobody asked for.
 */
export function readManifest(root) {
  try {
    const value = JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8'))
    return value && typeof value === 'object' && value.schema === RUN_SCHEMA ? value : null
  } catch {
    return null
  }
}

/**
 * A fresh manifest for `run start`.
 *
 * `host` is an object rather than the bare id it used to be, because every later
 * step has to read what the host CANNOT do: whether it creates its own lane
 * worktrees, whether the plugin's guards fire in it, whether it reports token
 * usage, which account it spends. A step that branched on the id instead would
 * have to know every adapter, which is the coupling `lib/host/registry.mjs`
 * exists to remove (design D1).
 *
 * A run that declared no capabilities is the Workflow host: it owns its own
 * worktrees and has everything. That default is what keeps `workflows/ship.js`
 * — which passes `--host workflow` and nothing else — byte-for-byte unchanged.
 */
export function newManifest({ change, flags, host, hostCapabilities }) {
  const carried = {}
  for (const field of FLAG_FIELDS) carried[field] = flags && flags[field] !== undefined ? flags[field] : null
  const capabilities =
    hostCapabilities && typeof hostCapabilities === 'object' && !Array.isArray(hostCapabilities)
      ? { ...ASSUMED_CAPABILITIES, ...hostCapabilities }
      : { ...ASSUMED_CAPABILITIES }
  return {
    schema: RUN_SCHEMA,
    change,
    flags: carried,
    host: host ? { id: host, ...capabilities } : null,
    // Per-spawn output tokens, accumulated as results arrive (design D9). A
    // `null` entry is a spawn whose host reported nothing, and it makes its wave
    // — and the run — unknown rather than smaller.
    usage: [],
    startedAt: new Date().toISOString(),
    steps: 0,
    // The monotonic stage-marker write count. It lives on the manifest rather
    // than in a module-level counter because every `run` subcommand is a fresh
    // process, and a marker index that restarted at 1 each call would let a
    // guard read a leftover marker as current.
    stageIndex: 0,
    // The argv this run last emitted as a continuation. A `run` subcommand
    // called out of sequence is refused against it (design: the sequence guard),
    // so a driver that skips or repeats a step is told which call was expected
    // rather than silently advancing the state machine twice.
    lastThen: null,
    // The shared-tree HEAD captured when an isolated batch was dispatched, held
    // across the driver round trip so `record-batch` folds against the base the
    // lanes actually forked from. The emitted step carries it for the driver;
    // this is where the CLI reads it back, because the driver returns only
    // results and the wave state has no such field.
    mergeBase: null,
    // The inter-wave verification budget's own clock (`interWaveVerifyBudgetMs`).
    // Every `run` subcommand is a fresh process running BETWEEN agent turns, so
    // the interval a verify agent spends is only measurable across two
    // invocations: the step records when it dispatched, the judge folds the
    // elapsed time in and clears the mark.
    verifyStartedAt: null,
    verifyElapsedMs: 0,
    // Banners the CLI raised on earlier steps, carried to the close so the
    // summary reports everything the run degraded on rather than only what the
    // last step happened to hold.
    banners: [],
    // The per-batch summary rows the receipt reports, accumulated as batches are
    // recorded. Held here for the same reason `banners` is: the close is a fresh
    // process and cannot recompute what earlier steps observed.
    waves: [],
    plan: null,
    commit: null,
    commitSkipped: false,
    halted: null,
    notes: [],
    runId: null,
    // The strict tail (design D2, D4, D7). `reviewDimensions` is the CLI's
    // selection plus any the reviewer added of its own accord; `review` and
    // `remediation` are the adjudicated counts, never the agent's self-report;
    // `fixRoundsRun` is what the run actually consumed, not the published cap.
    reviewDimensions: null,
    review: null,
    remediation: null,
    fixRoundsRun: 0,
    // What the handoff writer reported about the artifacts it authored — the
    // one tail figure the CLI cannot re-derive, because it is a fact about
    // files an agent wrote rather than a judgement with a correct answer
    // (design D5).
    handoff: null,
    // The autonomy-ladder record `run close` wrote, from the CLI's own
    // surviving-blocker count (design D6). Storage only; nothing prints a level.
    autonomy: null
  }
}

/**
 * One declared capability of the run's host, or the Workflow host's value.
 *
 * Every read goes through here so a manifest written before hosts declared
 * anything — or by a driver that passed only an id — answers as the Workflow
 * host rather than as `undefined`, which would read as "cannot" for every
 * boolean capability and silently degrade an old run.
 *
 * @param {object|null} manifest
 * @param {string} key
 */
export function hostCapability(manifest, key) {
  const host = manifest && manifest.host && typeof manifest.host === 'object' ? manifest.host : null
  if (host && host[key] !== undefined) return host[key]
  return ASSUMED_CAPABILITIES[key]
}

/**
 * Where the host publishes the identifier of the session a process is running
 * under. A fact about Claude Code, not an Interlock threshold, so it is a named
 * constant in the module that reads it — the convention every `INTERLOCK_*`
 * reader already follows — and it appears in no driver: the no-policy sweep has
 * no allowance, and D11 puts the acquisition in the CLI for exactly that reason.
 *
 * VERIFIED 2026-09-10, which D11 required before this could be recorded at all.
 * The hazard was that on the Workflow host `interlock run start` executes inside
 * a ping subagent, so the value in scope might be the subagent's rather than the
 * parent session's — and a wrong identifier is worse than none, because it joins
 * the trajectory to a transcript that is not the run's. Measured: a subagent's
 * shell reports the SAME value as its parent conversation, and that value names
 * the parent's transcript file (`~/.claude/projects/<slug>/<id>.jsonl`).
 * Subagents inherit the session; they do not get one of their own. So the value
 * observed on the Workflow host is the parent session's and is recordable.
 *
 * `CLAUDE_CODE_HOST_SESSION_ID` is a different identifier (`local_…`) that names
 * no transcript, and is deliberately not what is read here.
 */
export const HOST_SESSION_ID_ENV = 'CLAUDE_CODE_SESSION_ID'

/**
 * The Workflow host's id, restated here rather than imported from
 * `lib/host/registry.mjs` for the reason `ASSUMED_CAPABILITIES` is: importing
 * from that module would load every vendor adapter, and the policy engine has no
 * business loading a transport.
 */
const WORKFLOW_HOST = 'workflow'

/**
 * The host session this run executes under, or null.
 *
 * Read from the CLI's own environment — never carried or passed by a driver
 * (D11): `workflows/ship.js` has no shell or filesystem, and `bin/interlock-run`
 * is a plain Node process with no session at all.
 *
 * Recorded only on the host whose steps run INSIDE that session. On the runner
 * the agents are separate vendor processes with sessions of their own, so a
 * variable inherited from whatever shell launched `interlock-run` names a
 * transcript that does not contain the run — the same wrong-identifier failure
 * D11 guards against, arriving from the other direction. That is why this reads
 * the host rather than the environment alone.
 */
export function hostSessionId(manifest, env = process.env) {
  if (hostId(manifest) !== WORKFLOW_HOST) return null
  const raw = env && typeof env[HOST_SESSION_ID_ENV] === 'string' ? env[HOST_SESSION_ID_ENV].trim() : ''
  return raw || null
}

/** The run's host id, or null for a run that named none. */
export function hostId(manifest) {
  const host = manifest && manifest.host
  if (host && typeof host === 'object' && typeof host.id === 'string') return host.id
  return typeof host === 'string' && host ? host : null
}

// --- the step budget (design D9) --------------------------------------------

/**
 * Count this call against the run's step budget.
 *
 * Returns a `halt` step once the published cap is exceeded and null otherwise.
 * The cap is `LIMITS.maxRunSteps`, read here rather than restated: it was a
 * literal in both drivers, which is exactly what `openspec/specs/ship/
 * cap-authority` forbids for a loop bound.
 */
export function countStep(root, manifest) {
  manifest.steps = (Number.isInteger(manifest.steps) ? manifest.steps : 0) + 1
  if (manifest.steps > LIMITS.maxRunSteps) {
    manifest.halted = `the run exceeded the published run-step cap (maxRunSteps=${LIMITS.maxRunSteps}) without reaching a terminal state`
    writeManifest(root, manifest)
    return haltStep(manifest.halted)
  }
  return null
}

// --- usage (design D9) ------------------------------------------------------

/**
 * Fold one step's spawn results into the run's token accounting.
 *
 * Every results-taking `run` subcommand calls this, because a run's spend is the
 * sum over every spawn it made — the review fan-out and the verification agent
 * cost tokens exactly as a wave does, and a total that counted only waves would
 * understate every strict run.
 *
 * UNKNOWN IS NOT ZERO, and it is contagious by design: one spawn whose host
 * reported nothing makes its whole group unknown, because the alternative is a
 * number that looks like a measurement and is actually a lower bound. A host
 * that never reports usage therefore records `null` throughout, which is what
 * the trajectory already means by "no token accounting".
 *
 * @param {object} manifest
 * @param {Array<object|null>} results
 * @param {number|null} [wave] the wave these spawns belonged to, or null for a
 *   step outside the waves (verification, review, remediation, the commit)
 */
export function recordUsage(manifest, results, wave = null) {
  const list = Array.isArray(results) ? results : []
  if (!list.length) return
  if (!Array.isArray(manifest.usage)) manifest.usage = []

  let outputTokens = 0
  let known = true
  const usages = []
  for (const result of list) {
    const usage = result && typeof result === 'object' ? result.usage : null
    const out = usage && typeof usage === 'object' && Number.isFinite(usage.outputTokens)
      ? usage.outputTokens
      : null
    if (out === null) known = false
    else outputTokens += out
    usages.push(usage && typeof usage === 'object' ? usage : null)
  }
  manifest.usage.push({
    wave: Number.isInteger(wave) ? wave : null,
    outputTokens: known ? outputTokens : null,
    // The input side, under exactly the rule the output side already holds. A
    // host with no cache accounting supplies neither field on any spawn, so both
    // of these come out `null` — unknown, which is a different fact from a wave
    // that measured and found no cache activity.
    ...foldCacheUsage(usages)
  })
}

/**
 * Sum one step's cache figures across its spawns, unknown-contagious.
 *
 * The tiers are NOT enumerated here. They are whatever the host reported them
 * under, unioned across the step's spawns, so a run records the decomposition
 * its host actually supplies rather than a list this module guessed — and so a
 * tier is never invented for a host that does not have one. Restating the
 * adapter's field names would also mean importing an adapter, which the policy
 * engine does not do.
 *
 * A tier one spawn reported and another omitted is `null` for the group: the
 * second spawn's figure was not measured, and adding only the first would
 * produce a lower bound that reads as a total. Same rule, one type down, as the
 * output-token fold above.
 */
function foldCacheUsage(usages) {
  const list = usages.filter(u => u && typeof u === 'object')
  if (!list.length) return { cacheReadInputTokens: null, cacheCreationInputTokens: null }

  const read = list.reduce(
    (sum, usage) =>
      sum === null || !Number.isFinite(usage.cacheReadInputTokens) ? null : sum + usage.cacheReadInputTokens,
    0
  )

  const tiers = new Set()
  for (const usage of list) {
    const creation = usage.cacheCreationInputTokens
    if (creation && typeof creation === 'object' && !Array.isArray(creation)) {
      for (const tier of Object.keys(creation)) tiers.add(tier)
    }
  }
  let creation = null
  if (tiers.size) {
    creation = {}
    for (const tier of tiers) {
      creation[tier] = list.reduce((sum, usage) => {
        const block = usage.cacheCreationInputTokens
        const value = block && typeof block === 'object' ? block[tier] : undefined
        return sum === null || !Number.isFinite(value) ? null : sum + value
      }, 0)
    }
  }
  return { cacheReadInputTokens: read, cacheCreationInputTokens: creation }
}

/**
 * Add one recorded entry's cache figures into a running group total, holding the
 * unknown-contagious rule across entries the way `summarizeUsage` does for
 * output tokens. `null` in, `null` out, permanently.
 */
function addCacheEntry(total, entry) {
  const read =
    total.cacheReadInputTokens === null || !Number.isFinite(entry.cacheReadInputTokens)
      ? null
      : total.cacheReadInputTokens + entry.cacheReadInputTokens

  const incoming =
    entry.cacheCreationInputTokens && typeof entry.cacheCreationInputTokens === 'object'
      ? entry.cacheCreationInputTokens
      : null
  let creation = total.cacheCreationInputTokens
  if (creation === null && incoming === null) {
    // Nothing reported on either side; stays absent.
  } else if (incoming === null) {
    // A contributing entry reported no decomposition at all, so every tier the
    // group has so far becomes unknown rather than being carried as a total.
    creation = Object.fromEntries(Object.keys(creation).map(tier => [tier, null]))
  } else if (creation === null) {
    creation = { ...incoming }
  } else {
    const merged = {}
    for (const tier of new Set([...Object.keys(creation), ...Object.keys(incoming)])) {
      const a = creation[tier]
      const b = incoming[tier]
      merged[tier] = Number.isFinite(a) && Number.isFinite(b) ? a + b : null
    }
    creation = merged
  }
  return { cacheReadInputTokens: read, cacheCreationInputTokens: creation }
}

const EMPTY_CACHE_TOTAL = Object.freeze({ cacheReadInputTokens: 0, cacheCreationInputTokens: null })

/**
 * The receipt's `spend` rows and run total, summed from what was recorded.
 *
 * Per wave and per run, with `null` for either wherever a single contributing
 * spawn went unmeasured. A wave that appears in several batches sums across
 * them; a run with no entries at all reports nothing rather than zero.
 *
 * @param {object} manifest
 * @returns {{spend: Array<object>, outputTokens: number|null|undefined,
 *   cacheReadInputTokens: number|null|undefined,
 *   cacheCreationInputTokens: object|null|undefined}}
 */
export function summarizeUsage(manifest) {
  const entries = Array.isArray(manifest && manifest.usage) ? manifest.usage : []
  if (!entries.length) {
    return {
      spend: [],
      outputTokens: undefined,
      cacheReadInputTokens: undefined,
      cacheCreationInputTokens: undefined
    }
  }

  const byWave = new Map()
  for (const entry of entries) {
    if (!Number.isInteger(entry && entry.wave)) continue
    const current = byWave.has(entry.wave)
      ? byWave.get(entry.wave)
      : { outputTokens: 0, ...EMPTY_CACHE_TOTAL }
    byWave.set(entry.wave, {
      outputTokens:
        current.outputTokens === null || entry.outputTokens === null
          ? null
          : current.outputTokens + entry.outputTokens,
      ...addCacheEntry(current, entry)
    })
  }

  const runTotal = entries.reduce(
    (sum, entry) => (sum === null || entry.outputTokens === null ? null : sum + entry.outputTokens),
    0
  )
  const runCache = entries.reduce((total, entry) => addCacheEntry(total, entry), { ...EMPTY_CACHE_TOTAL })

  return {
    spend: [...byWave.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([wave, totals]) => ({ wave, ...totals })),
    outputTokens: runTotal,
    ...runCache
  }
}

// --- briefings (design D2) --------------------------------------------------

// --- lane worktrees (design D7) ---------------------------------------------

/**
 * Where a driver-owned lane worktree goes.
 *
 * Under `.claude/ship/`, which is git-ignored, so a lane's checkout is invisible
 * to the `git status` sweep that reads what the batch actually changed — a
 * worktree that showed up there would report every file in the repository as
 * touched by the wave that created it.
 */
export const LANE_WORKTREES_DIR = join(WORK_DIR, 'worktrees')

/**
 * The path one lane's worktree takes, derived rather than reported.
 *
 * On the Workflow host the runtime picks the directory and the lane reports its
 * own `pwd`, because an orchestrator predicting a path the runtime did not use
 * is a fold that silently finds nothing. On a runner host the DRIVER creates the
 * worktree, so the prediction and the reality are the same act — and deriving it
 * here means the step that names it and the fold that removes it read one
 * function rather than two conventions.
 *
 * The label is sanitised, not hashed: a directory named after its lane is one a
 * halted run's operator can find, and lane labels are already CLI-safe ids.
 *
 * @param {number|string} wave
 * @param {string} label
 * @returns {string} repo-relative
 */
export function laneWorktreePath(wave, label) {
  const safe = String(label || 'lane').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'lane'
  return join(LANE_WORKTREES_DIR, `wave-${wave ?? 'x'}`, safe)
}

/** The hash a host reports back to prove it read the briefing it was handed. */
export function briefingHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Write one briefing and return what a spawn carries: its path, its hash and
 * its text.
 *
 * The Workflow host cannot hold a briefing — it has no filesystem, and asking a
 * ping to copy several kilobytes into a result field would breach the published
 * result-field cap — so it spawns the worker with a fixed bootstrap naming this
 * path and requires the hash back. The ACP host reads `prompt` and sends it
 * inline. One file serves both.
 */
export function writeBriefing(root, label, text) {
  const promptSha256 = briefingHash(text)
  const promptPath = join(BRIEFINGS_DIR, `${label}.md`)
  const dest = join(root, promptPath)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, `${BRIEFING_HEADER(label, promptSha256)}\n${text}`)
  return { promptPath, promptSha256, prompt: text }
}

// --- step records (design D3) -----------------------------------------------

/**
 * The one thing every briefing says that is not about the work: there is nobody
 * to ask. Both drivers appended it to every prompt they sent, in the same words;
 * it is stated here so neither has to.
 */
const AUTONOMY_LINE =
  '\n\nYou are one step of an automated ship run. Do not ask questions — there is ' +
  'no one listening. If something is undecidable, put it in the result fields rather than ' +
  'guessing at product intent.'

/** One agent a step asks for. */
function spawn(root, { label, kind, model, effort, schema, prompt, isolation, worktree }) {
  return {
    label,
    kind,
    model: model || null,
    effort: effort === undefined ? null : effort,
    ...spawnPrefix(kind === 'ping' ? 'ping' : 'worker'),
    schema,
    isolation: isolation || null,
    // Only meaningful under isolation, and null on the Workflow host even then:
    // there the lane reports its own `pwd`, because the orchestrator predicting
    // a worktree path and the runtime choosing a different one is a fold that
    // silently finds nothing. On a runner host the driver creates the directory
    // this names, so predicting it and using it are one act (design D7).
    worktree: worktree || null,
    ...writeBriefing(root, label, prompt + AUTONOMY_LINE)
  }
}

/** Assemble a step record. Every step the program emits goes through here. */
export function makeStep(fields) {
  const { action, then = null, spawns = [], ...rest } = fields
  if (!ACTIONS.includes(action)) {
    throw new Error(`unknown run action "${action}" — expected one of ${ACTIONS.join(', ')}`)
  }
  return { schema: STEP_SCHEMA, action, then, spawns, ...rest }
}

/** The terminal step of a run that cannot continue. */
export function haltStep(reason, extra = {}) {
  return makeStep({
    action: 'halt',
    reason,
    // A halt still closes: the receipt, the outcome record and the trajectory's
    // terminal event are what a halted run is FOR. `then` is the close, not
    // null — a run that stopped without recording why is the one record this
    // corpus most needs and least often has.
    then: { argv: ['run', 'close', '--halt', reason] },
    ...extra
  })
}

// --- the wave-state fields a step carries through ---------------------------

const PASS_THROUGH = Object.freeze([
  'wave',
  'waveIndex',
  'waveKind',
  'batchIndex',
  'batchCount',
  'remainingBatches',
  'previousHandoffs',
  'changed',
  'mode',
  'runMode',
  'reason',
  'fixAttempt',
  'fixAttemptsRemaining',
  'errors',
  'nextWave',
  'nextWaveKind',
  'revisableGroups',
  'replansUsed',
  'replansRemaining',
  'maxParallel',
  'summary',
  'kind',
  'failures',
  'unresolved'
])

function passThrough(state) {
  const out = {}
  for (const field of PASS_THROUGH) {
    if (state[field] !== undefined) out[field] = state[field]
  }
  return out
}

// --- decoration: a wave-state step becomes a run step -----------------------

/** Every lane in the batch a step dispatches, as the wave-state emitted them. */
function lanesOf(step) {
  const batches =
    Array.isArray(step.remainingBatches) && step.remainingBatches.length
      ? step.remainingBatches
      : [Array.isArray(step.tasks) ? step.tasks : []]
  return Array.isArray(batches[0]) ? batches[0] : []
}

/**
 * Turn the pure state machine's step into the run step a driver obeys.
 *
 * This is where every branch the loop used to take in two drivers is taken
 * once: apply-only, no-commit, isolate-waves, a tail flag, a skipped verify, a
 * replan. The driver sees the result, never the question.
 *
 * @param {object} ctx    { root, deps }
 * @param {object} step   the wave-state step (`nextStep(state)`)
 * @param {object} manifest
 * @param {object} [extra] fields to carry onto the emitted step (banners, notes)
 */
export function decorate(ctx, step, manifest, extra = {}) {
  const { root } = ctx
  const carried = { ...passThrough(step), ...extra }
  const change = manifest.change

  if (step.action === 'halt') {
    return haltStep(step.reason || 'the run state halted', carried)
  }

  if (step.action === 'run-batch' || step.action === 'test-wave') {
    const lanes = lanesOf(step)
    if (!lanes.length || lanes.some(lane => !Array.isArray(lane) || !lane.length)) {
      return haltStep('the state machine asked for a batch with no dispatchable lane', carried)
    }
    const isolate = manifest.flags.isolateWaves === true
    // Who creates the lane's worktree (design D1, D7). The Workflow runtime does
    // it from an `isolation` field on the spawn; a runner host has no runtime to
    // ask, so the step names the directory and the driver runs `git worktree
    // add` itself. Both fold through the same `run record-batch`.
    const driverWorktrees = isolate && hostCapability(manifest, 'worktree') === 'driver'
    const previousHandoffs = Array.isArray(step.previousHandoffs) ? step.previousHandoffs : []
    // The stage line rides on the batch's briefings rather than on a step of its
    // own: the agent doing the work is the one with a filesystem, and a marker
    // written by anyone else would carry the wrong pid.
    const stage = publishStageLine('implement', change, ++manifest.stageIndex)
    const spawns = lanes.map(lane =>
      spawn(root, {
        label: laneLabel(lane),
        kind: 'implementer',
        model: laneModel(lane),
        effort: laneEffort(lane),
        schema: lane.length === 1 ? SINGLE_TASK_SCHEMA : LANE_SCHEMA,
        isolation: isolate && !driverWorktrees ? 'worktree' : null,
        worktree: driverWorktrees ? { path: laneWorktreePath(step.wave, laneLabel(lane)) } : null,
        // `solo` comes off the STEP, not off the invocation flag: the planner
        // decides the mode (a classifier recommendation inside the envelope
        // reaches solo with no flag at all), the run state carries it, and
        // `nextStep` echoes it. Reading the flag here would brief the agent for
        // a shape the planner may not have built.
        prompt:
          stage +
          '\n' +
          assembleImplementerPrompt({
            change,
            lane,
            previousHandoffs,
            isolateWaves: isolate,
            solo: step.mode === 'solo'
          })
      })
    )
    // The shared tree's HEAD before this batch's lanes fork off — read now, not
    // after, so nothing else lands on the shared tree between the reading and
    // the fold. Only under isolation; unset, a batch runs byte-for-byte as it
    // did before worktree isolation existed.
    let mergeBase = null
    if (isolate) {
      mergeBase = ctx.deps.headCommit(root)
      if (!mergeBase) {
        return haltStep(
          'could not capture the shared-tree base commit before an isolated batch — merge-lanes ' +
            'cannot fold lane worktrees back without one',
          carried
        )
      }
      // Onto the manifest as well as onto the step. The step goes to the driver
      // and the driver returns only results; `record-batch` reads a pure
      // wave-state step that carries no such field, so without this the fold
      // would re-read HEAD *after* the lanes ran — a different commit whenever
      // anything else landed on the shared tree in between.
      manifest.mergeBase = mergeBase
    }
    return makeStep({
      action: step.action,
      ...carried,
      lanes: lanes.map(lane => lane.map(t => ({ id: t.id }))),
      mergeBase,
      then: { argv: ['run', 'record-batch'] },
      spawns
    })
  }

  if (step.action === 'verify') {
    return verifyStep(ctx, manifest, {
      context: 'inter-wave',
      label: `inter-wave-verify-${manifest.steps}`,
      changed: Array.isArray(step.changed) ? step.changed : [],
      carried
    })
  }

  if (step.action === 'replan') {
    return makeStep({
      action: 'replan',
      ...carried,
      then: { argv: ['run', 'replan'] },
      spawns: [
        spawn(root, {
          label: `replan-${manifest.steps}`,
          kind: 'ping',
          model: 'haiku',
          effort: null,
          schema: REPLAN_SCHEMA,
          prompt: assembleReplanPrompt({ change, replanPath: REPLAN_PATH })
        })
      ]
    })
  }

  if (step.action === 'done') {
    // Three ways a run of waves ends, decided here rather than in a driver.
    if (manifest.flags.applyOnly === true) {
      manifest.notes.push('--apply-only: stopped after the waves')
      manifest.commitSkipped = true
      return makeStep({ action: 'close', ...carried, then: { argv: ['run', 'close'] } })
    }
    // The strict tail (design D1): `--review` (or `--strict`, which implies
    // it) fans out the adversarial review here, in the CLI. A run carrying
    // only `--handoff` and/or `--conformance` has nothing to review, so it
    // walks straight to final verification exactly as a lean run does — the
    // handoff step is decided after that verdict passes (design D5), not here.
    if (manifest.flags.review === true) {
      return reviewStep(ctx, manifest, carried)
    }
    return finalVerifyStep(ctx, manifest, carried)
  }

  return haltStep(`unrecognized step from the state machine: ${step.action}`, carried)
}

/** The final verification step: the same verify spawn, judged in the `final` context. */
export function finalVerifyStep(ctx, manifest, carried = {}) {
  return verifyStep(ctx, manifest, {
    context: 'final',
    label: 'verify',
    changed: [],
    carried,
    action: 'verify-final'
  })
}

/**
 * A verification step — a spawn that runs the planned checks, or a skipped
 * marker carrying the planner's own reason.
 *
 * The plan is built HERE and the verdict is rendered by `run judge`. The agent
 * between them runs commands and reports what happened; it is never asked
 * whether the run may continue. A plan with no steps emits no spawn at all: the
 * step still names its continuation, so the interpreter spawns nothing, calls
 * the argv and the skip is recorded by the CLI that decided it.
 */
function verifyStep(ctx, manifest, { context, label, changed, carried, action = 'verify' }) {
  const { root } = ctx
  const interWave = context === 'inter-wave'
  const profile = readProfile(root)
  const opts = { context, changed }
  if (context === 'final') {
    opts.e2e = manifest.flags.skipE2e !== true
    opts.coverage = manifest.flags.skipCoverage !== true
  } else {
    // The budget's input (`interWaveVerifyBudgetMs`). Accumulated across
    // invocations on the manifest, because this process runs BETWEEN agent turns
    // and never sees the interval a verify agent spends; without it the
    // comparison would be `0 >= budget` forever and the published cap would
    // bound nothing.
    opts.elapsedMs = numberOrUndefined(manifest.verifyElapsedMs) || 0
  }
  const plan = planVerification(profile, opts)
  writeWork(root, `vplan-${context}.json`, plan)

  if (!plan.steps.length) {
    // A spent budget is the reason, not whichever kind happens to sit first in
    // `skipped` — typecheck is skipped for its own missing command and would
    // otherwise mask the budget as the cause of an empty plan.
    const reason = plan.budgetExceeded
      ? SKIP_REASONS.BUDGET_EXCEEDED
      : (plan.skipped[0] && plan.skipped[0].reason) || 'no detectable commands'
    return makeStep({
      action,
      ...carried,
      context,
      skipped: true,
      reason,
      banners: [...(carried.banners || []), `VERIFICATION SKIPPED: reason=${reason}`],
      then: { argv: ['run', 'judge', '--context', context] },
      spawns: []
    })
  }

  // The interval starts now: the driver is about to spawn an agent that runs
  // these commands, and `run judge` — the next process — folds the elapsed time
  // in. Only inter-wave; the final check is not budgeted.
  if (interWave) manifest.verifyStartedAt = new Date().toISOString()

  return makeStep({
    action,
    ...carried,
    context,
    skipped: false,
    then: { argv: ['run', 'judge', '--context', context] },
    spawns: [
      spawn(root, {
        label,
        kind: 'verify',
        model: null,
        effort: null,
        schema: VERIFY_RESULT_SCHEMA,
        prompt:
          (context === 'final'
            ? // `fix-tests`, not `verify`: the final step repairs a red suite by
              // root cause, and that repair is exactly when weakening a test is
              // the hazard — so the marker it publishes puts guard-tests into
              // deny for test files.
              publishStageLine('fix-tests', manifest.change, ++manifest.stageIndex) + '\n'
            : '') +
          assembleVerifyPrompt({
            change: manifest.change,
            context,
            steps: plan.steps,
            runId: manifest.runId,
            statePath: STATE_PATH,
            // A retry's own facts. The state machine computed which attempt this
            // is and what failed last time; briefing the second attempt
            // identically to the first buys an agent that re-runs the same
            // commands with no knowledge that they were already red. The final
            // check has no attempt counter, so it carries none.
            ...(interWave
              ? {
                  fixAttempt: carried.fixAttempt,
                  fixAttemptsRemaining: carried.fixAttemptsRemaining,
                  errors: carried.errors
                }
              : {})
          })
      })
    ]
  })
}

// --- the strict tail (design D1, D2, D3, D4, D8) ----------------------------
//
// Adversarial review, bounded remediation, and the verdict — the sections
// `workflows/ship.js` used to run inline behind a `host-tail` step (design D6,
// now retired). Every judgement that has a correct answer moves here: which
// dimensions run, what their criteria say, what a diff's findings survive to,
// what a round fixes versus defers, and when the budget is spent. A driver
// obeys the step and asks nothing.

/** Where a dimension's written criteria live, relative to the plugin itself —
 * not the target repository `ctx.root` names, which may hold no such file at
 * all. Mirrors `lib/doctor.mjs`'s own `PLUGIN_ROOT` resolution. */
const REVIEW_DIMENSIONS_DIR = join('skills', 'review-code', 'dimensions')

/**
 * A dimension's written criteria — the file every reviewer prompt used to be
 * told to open for itself (`RUBRIC_INSTRUCTIONS`, retired). Read here once so
 * the whole run states the degradation when it cannot, rather than a reviewer
 * silently proceeding on the dimension's name alone (design D3, rubric-
 * delivery). Never throws: an unreadable or absent file is `null`.
 */
function readDimensionRubric(name) {
  try {
    const text = readFileSync(join(PLUGIN_ROOT, REVIEW_DIMENSIONS_DIR, `${name}.md`), 'utf8')
    return text.trim() || null
  } catch {
    return null
  }
}

/** `{ name, rubric }` for every dimension name, in order — what both prompt
 * assemblers take (design D3). */
function resolveDimensionRubrics(names) {
  return (Array.isArray(names) ? names : []).map(name => ({ name, rubric: readDimensionRubric(name) }))
}

/**
 * The review step: one worker, every selected dimension fanned out inside it,
 * two skeptics per finding (design D1, D3, D4, D8).
 *
 * Dimensions are `selectDimensions`'s rule over the run's OBSERVED changed
 * paths — never a reviewer's judgement call — and a dimension whose criteria
 * could not be read is named on the step rather than dispatched silently on
 * its name alone.
 */
function reviewStep(ctx, manifest, carried = {}) {
  const { root } = ctx
  const change = manifest.change
  const changedPaths = ctx.deps.observedChangedPaths(root)
  const { dimensions: names, reasons } = selectDimensions(changedPaths)
  const dimensions = resolveDimensionRubrics(names)
  const policy = readReviewPolicy(root)

  const banners = [...(carried.banners || [])]
  for (const d of dimensions) {
    if (d.rubric === null) {
      banners.push(`REVIEW RUBRIC UNAVAILABLE: ${d.name} — that reviewer works from the dimension name alone`)
    }
  }

  // Carried across every later `run reviewed`/`run remediated` call in this
  // run, each its own process: what the CLI selected, and why, so an agent-
  // added dimension can be told apart from one the CLI asked for (design D4).
  manifest.reviewDimensions = { selected: names, reasons }

  const stageLine = publishStageLine('review', change, ++manifest.stageIndex)
  return makeStep({
    action: 'review',
    ...carried,
    banners,
    then: { argv: ['run', 'reviewed'] },
    spawns: [
      spawn(root, {
        label: 'review',
        kind: 'review',
        model: null,
        // The skeptics reason inside this one worker (it fans out dimensions
        // and two skeptics per finding in its own context), so pinning this
        // spawn's effort is what pins them — fixed regardless of any lane tier
        // (design D8).
        effort: EFFORT.skeptic,
        schema: REVIEW_RESULT_SCHEMA,
        prompt: assembleReviewPrompt({
          change,
          dimensions,
          policyProse: policy.prose,
          findingsPath: FINDINGS_PATH,
          verdictsPath: VERDICTS_PATH,
          stageLine
        })
      })
    ]
  })
}

/**
 * One remediation-round step: a fixing round (`assembleRemediatePrompt`), or —
 * when the plan says this is the round after the cap — the verdict
 * (`assembleVerdictPrompt`), which fixes nothing and re-reviews nothing.
 */
function remediateStep(ctx, manifest, plan, extra = {}) {
  const { root } = ctx
  const change = manifest.change
  const then = { argv: ['run', 'remediated', '--round', String(plan.round)] }

  if (plan.isFinalRound) {
    return makeStep({
      action: 'verdict',
      ...extra,
      round: plan.round,
      then,
      spawns: [
        spawn(root, {
          label: `remediate-${plan.round}`,
          kind: 'remediate',
          model: null,
          effort: EFFORT.skeptic,
          schema: VERDICT_RESULT_SCHEMA,
          prompt: assembleVerdictPrompt({ change, round: plan.round })
        })
      ]
    })
  }

  const dimensions = resolveDimensionRubrics(plan.reReviewDimensions)
  const policyProse = readReviewPolicy(root).prose
  const stageLine = publishStageLine('remediation', change, ++manifest.stageIndex)
  return makeStep({
    action: 'remediate',
    ...extra,
    round: plan.round,
    then,
    spawns: [
      spawn(root, {
        label: `remediate-${plan.round}`,
        kind: 'remediate',
        model: null,
        effort: EFFORT.skeptic,
        schema: REMEDIATE_RESULT_SCHEMA,
        prompt: assembleRemediatePrompt({ change, round: plan.round, plan, dimensions, policyProse, stageLine })
      })
    ]
  })
}

/** Wrap a `lib/remediate.mjs` call: its own validation throws a user-facing
 * message on a round out of range, which is a halt here, never a crash. */
function planRemediationRound(surviving, round) {
  try {
    return { plan: planRemediation(surviving, { round }), error: null }
  } catch (err) {
    return { plan: null, error: (err && err.message) || String(err) }
  }
}

/**
 * A stage marker the agent could not publish, said out loud.
 *
 * The guards for that stage fail open — their documented default — so the run
 * continues, but a window in which `hooks/guard-tests.mjs` was not in force is
 * exactly the thing a reader of the trajectory must not have to infer. The
 * Workflow host used to raise this itself; the tail is the CLI's now, so the
 * CLI raises it.
 */
function stageMarkerBanners(results) {
  const out = []
  for (const entry of Array.isArray(results) ? results : []) {
    const warning =
      entry && typeof entry.stageMarkerWarning === 'string' ? entry.stageMarkerWarning.trim() : ''
    if (warning) {
      out.push(`STAGE MARKER NOT PUBLISHED: ${warning} — the guards for this stage fail open`)
    }
  }
  return out
}

/**
 * Re-adjudicate the work files a review or fixer just wrote, write `review.json`
 * and the metrics file exactly as `interlock review --metrics <change>` would,
 * and record the counts on the manifest (design D2, D7).
 */
function adjudicateReview(ctx, manifest) {
  const { root } = ctx
  const findings = readJson(join(root, FINDINGS_PATH))
  const verdicts = readJson(join(root, VERDICTS_PATH))
  const changedPaths = ctx.deps.observedChangedPaths(root)
  const policy = readReviewPolicy(root)

  const result = resolveReview(findings, verdicts, { changedPaths, excludePaths: policy.excludePaths })
  writeWork(root, 'review.json', result)

  const banners = []
  const metrics = writeReviewMetrics(root, { change: manifest.change, counts: result.counts })
  if (!metrics.written) {
    banners.push(`REVIEW METRICS NOT WRITTEN: ${metrics.reason}`)
  }
  return { result, banners }
}

/**
 * `run reviewed` — the continuation of the review step (design D2).
 *
 * Adjudicates `findings.json`/`verdicts.json` against the run's OWN observed
 * changed paths (never the agent's), writes `review.json` and the metrics
 * file, records any agent-added dimension, and asks `lib/remediate.mjs` for
 * round one: a fixing round, or straight to final verification when nothing
 * survived to fix.
 */
export function runReviewed(ctx, { results }) {
  const { root } = ctx
  const manifest = readManifest(root)
  if (!manifest) return noManifest()
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  // Outside the waves, but not outside the run's spend (design D9).
  recordUsage(manifest, results)

  const { result, banners } = adjudicateReview(ctx, manifest)
  banners.push(...stageMarkerBanners(results))

  // A review step that reported nothing usable still adjudicates — the files
  // are read either way — but "the review did not complete" is a different
  // fact from "the review found nothing", and the summary must not blur them
  // (workflow-host spec, edge case: an agent that returns no findings file).
  const report = results && results[0] && typeof results[0] === 'object' ? results[0] : null
  if (!report || report.ok !== true) {
    manifest.notes.push(
      `review did not complete: ${(report && report.detail) || 'the step returned no usable result'}`
    )
  }

  // A dimension the reviewer added beyond the CLI's selection (design D4).
  // The CLI cannot know why; the one-line reason is the agent's own report,
  // carried here rather than inferred.
  const selected = new Set((manifest.reviewDimensions && manifest.reviewDimensions.selected) || [])
  const added = Array.isArray(report && report.addedDimensions)
    ? report.addedDimensions.filter(d => d && typeof d.name === 'string' && !selected.has(d.name))
    : []
  if (added.length) {
    manifest.reviewDimensions = { ...(manifest.reviewDimensions || { selected: [], reasons: {} }), added }
  }

  manifest.banners.push(...banners)

  const { plan, error } = planRemediationRound(result.surviving, 1)
  if (!plan) {
    return finishStep(ctx, manifest, haltStep(`remediation planning failed: ${error}`, { banners }))
  }
  writeWork(root, 'remediate-1.json', plan)

  // The first adjudication's counts, which is what the receipt reports as the
  // review. `blockers` is not one of `resolveReview`'s counts — severity is
  // resolved by the gate — so it comes from the round-one plan, computed from
  // the same surviving set and never from the agent's self-report.
  manifest.review = {
    counts: { ...result.counts, blockers: plan.counts.blockers },
    dimensions: manifest.reviewDimensions
  }

  if (!plan.fix.byFile.length && !plan.fix.unscoped.length) {
    // Round one found nothing that needs a fixer. Spending a remediation round
    // — or the verdict round after it — on a clean review is pure token cost,
    // so this is the one place the tail skips straight to final verification
    // (design D2) rather than walking the rest of the budget as later rounds do.
    manifest.remediation = { fixed: 0, deferred: plan.deferred.length, blockersRemaining: plan.counts.blockers }
    return finishStep(ctx, manifest, finalVerifyStep(ctx, manifest, { banners }))
  }

  manifest.remediation = { fixed: 0, deferred: plan.deferred.length, blockersRemaining: plan.counts.blockers }
  return finishStep(ctx, manifest, remediateStep(ctx, manifest, plan, { banners }))
}

/**
 * `run remediated --round N` — the continuation of a fixing or verdict round
 * (design D2).
 *
 * Re-adjudicates the (possibly rewritten) findings/verdicts files, records
 * fixed/deferred and bumps `fixRoundsRun` for a completed FIX round, then asks
 * `lib/remediate.mjs` for what comes next. A round that already cleared every
 * blocker jumps straight to the verdict round rather than spending the rest of
 * the fix budget on it (moved from `workflows/ship.js`'s retired
 * `remediationBudget`) — only the verdict round itself may halt.
 */
export function runRemediated(ctx, { round, results }) {
  const { root } = ctx
  const manifest = readManifest(root)
  if (!manifest) return noManifest()
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  // Outside the waves, but not outside the run's spend (design D9).
  recordUsage(manifest, results)

  const roundCap = LIMITS.remediationRounds
  const completedRound = Number.isInteger(round) ? round : null
  if (completedRound === null || completedRound < 1 || completedRound > roundCap + 1) {
    return finishStep(ctx, manifest, haltStep(
      `run remediated called with an invalid --round (got ${JSON.stringify(round)}, expected 1-${roundCap + 1})`
    ))
  }

  const { result, banners } = adjudicateReview(ctx, manifest)
  banners.push(...stageMarkerBanners(results))

  if (completedRound === roundCap + 1) {
    // The verdict round just reported. It fixed and re-reviewed nothing, so
    // this re-adjudication reflects exactly what the last fix round left
    // standing — which is what decides the halt (design D2).
    const { plan, error } = planRemediationRound(result.surviving, completedRound)
    if (!plan) {
      return finishStep(ctx, manifest, haltStep(`remediation planning failed: ${error}`, { banners }))
    }
    writeWork(root, `remediate-${completedRound}.json`, plan)
    manifest.remediation = {
      ...(manifest.remediation || {}),
      deferred: (manifest.remediation && manifest.remediation.deferred) || 0,
      blockersRemaining: plan.counts.blockers
    }
    manifest.banners.push(...banners)
    if (plan.halt) {
      return finishStep(ctx, manifest, haltStep(plan.haltReason, { banners }))
    }
    return finishStep(ctx, manifest, finalVerifyStep(ctx, manifest, { banners }))
  }

  // A completed FIX round. What it attempted is the plan that put it on the
  // wire in the first place — read back rather than re-derived, so "fixed" is
  // never a fresh guess about the same round.
  const attemptedPlan = readJson(join(root, WORK_DIR, `remediate-${completedRound}.json`))
  const attempted = attemptedPlan ? attemptedPlan.counts.fixing : 0

  let { plan: nextPlan, error } = planRemediationRound(result.surviving, completedRound + 1)
  if (!nextPlan) {
    return finishStep(ctx, manifest, haltStep(`remediation planning failed: ${error}`, { banners }))
  }

  // Every blocker cleared: nothing left justifies spending the rest of the fix
  // budget, so the next round IS the verdict regardless of what its number
  // would otherwise be.
  if (nextPlan.counts.blockers === 0 && !nextPlan.isFinalRound) {
    const jumped = planRemediationRound(result.surviving, roundCap + 1)
    if (!jumped.plan) {
      return finishStep(ctx, manifest, haltStep(`remediation planning failed: ${jumped.error}`, { banners }))
    }
    nextPlan = jumped.plan
  }
  writeWork(root, `remediate-${nextPlan.round}.json`, nextPlan)

  // Still broken, under the SAME dimensions this round touched (re-review ran
  // only `attemptedPlan.reReviewDimensions`, so `nextPlan`'s findings reflect
  // exactly those and nothing else) — what did not get fixed.
  const stillBroken = nextPlan.counts.blockers + nextPlan.counts.warnings
  const fixed = Math.max(0, attempted - stillBroken)

  manifest.fixRoundsRun = (manifest.fixRoundsRun || 0) + 1
  manifest.remediation = {
    fixed: ((manifest.remediation && manifest.remediation.fixed) || 0) + fixed,
    deferred: ((manifest.remediation && manifest.remediation.deferred) || 0) + nextPlan.deferred.length,
    blockersRemaining: nextPlan.counts.blockers
  }
  manifest.banners.push(...banners)
  return finishStep(ctx, manifest, remediateStep(ctx, manifest, nextPlan, { banners }))
}

// --- small file helpers -----------------------------------------------------

function readProfile(root) {
  try {
    return JSON.parse(readFileSync(join(root, '.claude', 'testing', 'profile.json'), 'utf8'))
  } catch {
    // No profile is not a degradation to report here — `planVerification` says
    // so itself, in the skip reasons it returns.
    return null
  }
}

function writeWork(root, name, value) {
  const path = join(root, WORK_DIR, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
  return join(WORK_DIR, name)
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function readState(root) {
  return readJson(join(root, STATE_PATH))
}

export function writeState(root, state) {
  const path = join(root, STATE_PATH)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n')
  return state
}

// --- the sequence guard -----------------------------------------------------

/**
 * Refuse a `run` subcommand the program did not ask for next.
 *
 * The manifest records the argv the last step named as its continuation. A
 * driver that skipped a step, repeated one, or called a subcommand of its own
 * invention would otherwise advance the state machine twice or record a batch
 * against the wrong wave — both silent. Returns null when the call is in
 * sequence, and the reason it is not when it is not.
 */
export function checkSequence(manifest, argv) {
  const expected = manifest.lastThen
  if (!Array.isArray(expected) || !expected.length) return null
  // Compare what the program asked for as a PREFIX of what was called: the
  // driver appends `--results <file>` and may append `--json`, and neither is
  // part of the ask. Everything the step named must be present, in order.
  const strip = list => list.filter(a => a !== '--json')
  const want = strip(expected)
  const got = strip(argv)
  const matches = want.every((token, i) => got[i] === token)
  if (matches) return null
  return (
    `out of sequence: the run program's last step named \`interlock ${want.join(' ')}\` as its ` +
    `continuation, and this call was \`interlock ${got.join(' ')}\``
  )
}

/** Record the continuation this step named, so the next call can be checked against it. */
export function recordThen(root, manifest, step) {
  manifest.lastThen = step && step.then && Array.isArray(step.then.argv) ? step.then.argv : null
  writeManifest(root, manifest)
  return step
}

// --- trajectory -------------------------------------------------------------

/**
 * Log every agent this step asks for.
 *
 * `wave-state next` already logs the IMPLEMENTER spawns it names in its own
 * tasks[]; it has no way to know about the ping, the verifier or the committer
 * the program is about to ask for. Both drivers used to cover those with an
 * extra `run-log append` fused into each prompt — an instruction a model could
 * skip. The CLI that decided on the spawn records it.
 */
function logSpawns(ctx, manifest, step) {
  // No run identity yet — the classify step runs before there is a wave state,
  // so nothing is owed. The same rule `logVerifyJudgement` follows: a call with
  // no runId is not part of a logged run, and logging is not what should fail it.
  if (!manifest.runId) return step
  for (const s of step.spawns || []) {
    if (s.kind === 'implementer') continue // logged by wave-state, at the lane
    const written = appendRunLogEvent(ctx.root, {
      runId: manifest.runId || undefined,
      change: manifest.change,
      type: 'agent-spawn',
      label: s.label,
      model: s.model || undefined,
      kind: s.kind
    })
    if (!written.written) ctx.warn(`agent-spawn not recorded: ${written.reason}`)
  }
  return step
}

function logCliExit(ctx, manifest, command, exitCode) {
  if (!manifest.runId) return
  const written = appendRunLogEvent(ctx.root, {
    runId: manifest.runId,
    change: manifest.change,
    type: 'cli-exit',
    command,
    exitCode
  })
  if (!written.written) ctx.warn(`cli-exit not recorded: ${written.reason}`)
}

/** The shared tree's HEAD. Never throws: an unreadable base is null, never a guess. */
function headCommit(ctx) {
  return ctx.deps.headCommit(ctx.root)
}

// --- adjudication (moved from the RECORDED_VERDICT block) -------------------
//
// One authority for "what did this task do": the outcome `record-batch`
// recorded, not the outcome the implementing agent reported for itself. The
// claim is the input the state machine adjudicated — an invalid or over-budget
// handoff packet fails its task — so where the two differ the recorded outcome
// is the one a tick and a tally are built from.
//
// Both hosts read this from one place now. A second copy of "which of two
// disagreeing observations is the run's" would drift, and both hosts would
// still look correct.

/** The three outcomes a batch can record. Anything else is not a verdict. */
const RECORDED_OUTCOMES = ['ok', 'failed', 'not-attempted']

/**
 * The recorded verdicts `batchOutcomes` produced, validated.
 *
 * One malformed entry invalidates the whole payload rather than being skipped:
 * a partial verdict read as a complete one is the defect this exists to close,
 * one level down. `null` means "no verdict arrived" and puts the caller on the
 * loud claim-derived fallback.
 */
export function recordedOutcomes(raw) {
  if (!Array.isArray(raw) || !raw.length) return null
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
 *   claims sent to `record-batch`, one array per batch, in command order
 * @param {Array<{id: string, outcome: string, reason: string}>|null} recorded
 *   the verdicts those commands reported, concatenated in the same order
 */
export function adjudicateBatches(batches, recorded) {
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
export function overrideBanner(overrides) {
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
 * the one case nobody would think to check, and a count that was never read
 * must not read as one that came back clean.
 */
export function claimDerivedBanner() {
  return (
    'CLAIM-DERIVED TALLIES: record-batch reported no usable per-task outcomes, so this wave was ' +
    'ticked and counted from what the implementing agents claimed rather than from what the run recorded'
  )
}

/**
 * Turn one lane's agent result into an outcome per task it was given.
 *
 * Fails CLOSED, in one direction only: a result that does not account for every
 * task in the lane fails all of them, because a lane that reported on two of its
 * three tasks has told us nothing about the third — and "nothing" read as
 * success is how a task silently ships unimplemented. `not-attempted` is the one
 * outcome that is neither: it is reported, ticked nowhere, and counted nowhere.
 */
export function laneOutcomes(lane, result) {
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
  if (missing.length) return failAll(`lane result omitted an outcome for ${missing.join(', ')}`)

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
    // Guessing which of three named outcomes an unnamed one meant is exactly the
    // inference the schema exists to remove.
    return {
      id: t.id,
      outcome: 'failed',
      error: e.error || `lane reported outcome ${JSON.stringify(e.outcome)}`,
      filesChanged: e.filesChanged,
      handoff: e.handoff
    }
  })
}

// --- run start (design D4, D2) ----------------------------------------------

/**
 * Begin a run: write the manifest, validate the change, and either adopt a
 * reusable plan or ask for a classification.
 *
 * `plan-waves` is the most expensive fixed step of a run — it reads proposal.md,
 * design.md, tasks.md and every delta spec in full — so the program first asks
 * whether the stored plan still matches the inputs it was built from. Reuse is
 * never assumed: anything other than an affirmative match is a rebuild,
 * including an error while checking. Failing to prove reuse costs a classifier
 * run; wrongly reusing would run the wrong plan.
 *
 * @param {{root: string, deps: object, warn: (m: string) => void}} ctx
 * @param {{change: string, flags: object, host?: string, hostCapabilities?: object}} input
 */
export function runStart(ctx, { change, flags, host, hostCapabilities }) {
  const { root } = ctx
  const manifest = newManifest({ change, flags, host, hostCapabilities })
  writeManifest(root, manifest)

  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  const inspection = inspectChange(root, change)
  if (!inspection.ready) {
    const problems = (inspection.problems || []).map(p => (typeof p === 'string' ? p : p.detail || p.id))
    return finishStep(ctx, manifest, haltStep(
      `validate failed: ${problems.join('; ') || 'the change is not implementable'}`
    ))
  }

  // The marker is readable here; the structural fallback is not, because no
  // classification exists until the classify step runs. So a marker-shaped TDD
  // run — the ordinary one — matches its stored fingerprint and reuses its plan,
  // and a structurally-inferred one re-plans rather than reusing a plan built
  // for the other shape. `resolveRedWave` is called without `tasks` to say
  // exactly that, and stays silent about step 3 rather than claiming it failed.
  const reuseRed = resolveRedWave({
    tddMode: manifest.flags.tddMode || null,
    redSection: inspection.tasks.redSection
  })
  manifest.banners.push(...reuseRed.banners)

  const reuse = resolvePlanReuse(root, change, {
    maxParallel: numberOrUndefined(manifest.flags.maxParallel),
    mode: manifest.flags.laneMode || undefined,
    redWave: reuseRed.group
  })

  if (reuse.reuse && reuse.noRemainingWork) {
    // Every task in the stored plan is already ticked. That is not an empty run
    // to dispatch — it is a change with nothing left to do, and creating a
    // zero-batch run would report a clean ship that implemented nothing.
    manifest.plan = { reused: true, status: reuse.status, reason: reuse.reason }
    manifest.notes.push(
      'NO REMAINING WORK: every task in the stored plan is already complete — nothing was dispatched'
    )
    manifest.commitSkipped = true
    return finishStep(ctx, manifest, makeStep({ action: 'close', then: { argv: ['run', 'close'] } }))
  }

  if (reuse.reuse && reuse.narrowed) {
    manifest.plan = { reused: true, status: reuse.status, reason: reuse.reason }
    writeWork(root, 'plan-reuse.json', reuse.narrowed)
    return finishStep(ctx, manifest, adoptPlan(ctx, manifest, reuse.narrowed))
  }

  manifest.plan = { reused: false, status: reuse.status, reason: reuse.reason }
  writeManifest(root, manifest)

  // No reusable plan: one spawn, whose whole job is to write `classified.json`.
  // It never runs the CLI — `run classified` does coverage, the planner, the
  // plan file and the state creation afterwards (design D7).
  return finishStep(ctx, manifest, makeStep({
    action: 'classify',
    then: { argv: ['run', 'classified', '--classified', CLASSIFIED_PATH] },
    spawns: [
      spawn(root, {
        label: 'plan-waves',
        kind: 'planner',
        model: null,
        effort: null,
        schema: PLANNER_SCHEMA,
        prompt: assemblePlannerPrompt({ change, classifiedPath: CLASSIFIED_PATH })
      })
    ]
  }))
}

function numberOrUndefined(value) {
  return Number.isInteger(value) ? value : undefined
}

/** Turn a plan into a run state, log the run start, and emit the first step. */
function adoptPlan(ctx, manifest, plan) {
  const { root } = ctx
  let state
  try {
    state = createRunState(plan, {
      maxParallel: numberOrUndefined(manifest.flags.maxParallel),
      change: manifest.change
    })
  } catch (err) {
    return haltStep(`wave-state create failed: ${(err && err.message) || String(err)}`)
  }
  writeState(root, state)
  manifest.runId = typeof state.runId === 'string' ? state.runId : null

  const started = appendRunLogEvent(root, {
    runId: manifest.runId || undefined,
    change: manifest.change,
    type: 'run-start',
    mode: manifest.flags.mode || 'checkpoint',
    strict: manifest.flags.strict === true,
    host: hostId(manifest) || undefined,
    // `undefined`, not a placeholder: a host with no session records absent, and
    // the run is unaffected either way — nothing downstream reads this to decide
    // anything, and `run-log check` does not require it.
    sessionId: hostSessionId(manifest, ctx.env) || undefined
  })
  if (!started.written) ctx.warn(`run-start not recorded: ${started.reason}`)

  const { step, ok } = ctx.deps.logWaveMutation(root, {
    source: 'create',
    change: manifest.change,
    state
  })
  if (!ok) ctx.warn('the wave-state trajectory append failed on run start')
  ctx.deps.logAgentSpawns(root, { state, change: manifest.change, step, source: 'next' })
  return decorate(ctx, step, manifest)
}

// --- run classified (design D7) ---------------------------------------------

/**
 * Which section, if any, runs as the leading failing-test wave.
 *
 * The execution half of the TDD task shape `/interlock:spec` authors. It is
 * resolved HERE rather than in the planner because it comes from `tasks.md` —
 * `lib/waves.mjs` is pure and cannot read a file — and rather than from the
 * classifier because the shape is a fact the author wrote down, not a judgement
 * worth re-taking on every run. That is also why nothing in the classifier
 * prompt changed for this: a change nobody authored for TDD is classified today
 * exactly as it was yesterday.
 *
 * Precedence, and every branch says what it did:
 *   1. `--no-tdd` refuses the shape outright.
 *   2. The explicit `tasks.md` marker wins, with no flag needed.
 *   3. `--tdd` with no marker falls back to STRUCTURE: the lowest section whose
 *      classified tasks are all test tasks. This is what makes the flag useful
 *      on a change written test-first without the exact heading.
 *   4. Otherwise there is no red wave, which is the ordinary case.
 *
 * @param {{tddMode: string|null, redSection: number|null, tasks?: Array}} input
 *   `tasks` is the classification. OMIT it where no classification exists yet —
 *   the plan-reuse check at `runStart` runs before the classifier — and step 3
 *   is skipped silently rather than reported as unavailable, because "we cannot
 *   answer that yet" is not the same claim as "there is no red wave here". The
 *   cost is that a structurally-inferred shape does not match a stored
 *   fingerprint and re-plans; the alternative is reusing a plan built for the
 *   other shape, which is the failure the fingerprint exists to prevent.
 * @returns {{group: number|undefined, banners: string[]}}
 */
export function resolveRedWave({ tddMode, redSection, tasks }) {
  const banners = []
  const marker = Number.isInteger(redSection) ? redSection : null

  if (tddMode === 'no-tdd') {
    if (marker !== null) {
      banners.push(
        `TDD SHAPE REFUSED: tasks.md section ${marker} is marked as a leading failing-test wave, ` +
          `and --no-tdd was passed — its tests defer to the trailing test wave like any other`
      )
    }
    return { group: undefined, banners }
  }

  if (marker !== null) return { group: marker, banners }

  if (tddMode === 'tdd' && Array.isArray(tasks)) {
    const groups = [...new Set(tasks.map(t => t && t.group).filter(Number.isInteger))].sort(
      (a, b) => a - b
    )
    const lowest = groups[0]
    const inLowest = tasks.filter(t => t && t.group === lowest)
    if (lowest !== undefined && inLowest.length && inLowest.every(t => t.isTestTask === true)) {
      banners.push(
        `TDD SHAPE INFERRED: tasks.md carries no "${RED_SECTION_MARKER}" heading, but every task ` +
          `classified in section ${lowest} is a test task, so --tdd is honoured against that section`
      )
      return { group: lowest, banners }
    }
    banners.push(
      `TDD SHAPE UNAVAILABLE: --tdd was passed, but tasks.md has no "${RED_SECTION_MARKER}" ` +
        `heading and the first section is not all test tasks — there is no failing suite to run ` +
        `first, so this run is planned in the ordinary shape`
    )
  }

  return { group: undefined, banners }
}

/**
 * The mechanical work after the classifier: coverage, the planner, the plan
 * file, the run state and the first step.
 *
 * The Workflow driver used to ask the classifying agent to run all four commands
 * itself. Four CLI calls made by the party whose output they check is four
 * chances for a coverage gap to be reported as clean.
 */
export function runClassified(ctx, { classifiedPath }) {
  const { root } = ctx
  const manifest = readManifest(root)
  if (!manifest) return noManifest()
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  const classified = readJson(join(root, classifiedPath)) || readJson(classifiedPath)
  if (!classified) {
    return finishStep(ctx, manifest, haltStep(
      `wave planning failed: no readable ${classifiedPath} from the classify step`
    ))
  }

  const listed = Array.isArray(classified)
    ? classified
    : Array.isArray(classified.tasks)
      ? classified.tasks
      : []
  const inspection = inspectChange(root, manifest.change)
  const coverage = planCoverage(inspection.tasks.items, listed)
  if (!coverage.ok) {
    return finishStep(ctx, manifest, haltStep(
      `plan omitted unchecked tasks: ${(coverage.omitted || []).join(', ') || 'classified.json does not cover remaining checkboxes'}`
    ))
  }

  // Resolved before the planner and reused by the fingerprint, so a cached plan
  // is never reused across a change of shape. Both readers must be given the
  // SAME value — a plan built with a red wave and fingerprinted without one is a
  // plan the next run would reuse for the wrong shape.
  const red = resolveRedWave({
    tddMode: manifest.flags.tddMode || null,
    redSection: inspection.tasks.redSection,
    tasks: listed
  })
  // Deduplicated against what `runStart` already said. The marker and --no-tdd
  // branches are reachable from both sites and produce the same string, so
  // pushing blind would print the same banner twice in one run's close.
  for (const banner of red.banners) {
    if (!manifest.banners.includes(banner)) manifest.banners.push(banner)
  }

  let plan
  try {
    plan = planWaves(classified, {
      maxParallel: numberOrUndefined(manifest.flags.maxParallel),
      mode: manifest.flags.laneMode || undefined,
      redWave: red.group
    })
  } catch (err) {
    return finishStep(ctx, manifest, haltStep(`waves failed: ${(err && err.message) || String(err)}`))
  }
  // The planner adjudicates the claim against the classification and can refuse
  // it (a section with no test task, a section that is not first). Its refusal
  // is in `plan.warnings`; surfaced as a banner too, because a shape the
  // operator asked for and did not get must not be one line in a plan file.
  if (red.group !== undefined && plan.redWave === null) {
    for (const warning of plan.warnings) {
      if (warning.startsWith('red wave refused:')) {
        manifest.banners.push(`TDD SHAPE REFUSED: ${warning.slice('red wave refused: '.length)}`)
      }
    }
  }
  writeWork(root, 'plan.json', plan)

  // Store the fingerprint of the artifacts this plan was derived from, so a
  // later run of the same unedited change reuses this plan instead of re-reading
  // everything. It never fails the run: a fingerprint that could not be written
  // costs the NEXT run a classifier pass, which is what every run used to pay —
  // and the failure is said out loud rather than discovered as a slow run.
  try {
    const written = writeFingerprint(
      root,
      computeFingerprint(root, manifest.change, {
        maxParallel: numberOrUndefined(manifest.flags.maxParallel),
        mode: manifest.flags.laneMode || undefined,
        // The RESOLVED wave, not the requested one: what this plan was actually
        // built under is what a later run has to match to reuse it.
        redWave: plan.redWave === null ? undefined : plan.redWave
      })
    )
    if (!written.written) {
      manifest.banners.push(
        'PLAN FINGERPRINT NOT STORED: this plan cannot be proven current later, so the next run ' +
          `will re-classify every artifact from scratch (${written.reason})`
      )
    }
  } catch (err) {
    manifest.banners.push(
      'PLAN FINGERPRINT NOT STORED: this plan cannot be proven current later, so the next run ' +
        `will re-classify every artifact from scratch (${(err && err.message) || String(err)})`
    )
  }

  return finishStep(ctx, manifest, adoptPlan(ctx, manifest, plan))
}

// --- run record-batch (design D5) -------------------------------------------

/**
 * Fold, adjudicate, record and tick — one CLI call where the loop used to spend
 * three agent turns.
 *
 * A lane with any failed task is neither folded nor ticked, and its worktree is
 * named rather than removed: folding a partial write from a lane that stopped
 * mid-way is exactly the silent-overwrite defect the merge policy refuses.
 */
export function runRecordBatch(ctx, { results }) {
  const { root } = ctx
  const manifest = readManifest(root)
  if (!manifest) return noManifest()
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  const state = readState(root)
  if (!state) return finishStep(ctx, manifest, haltStep('the run state could not be read'))
  const pending = nextStep(state)
  const lanes = lanesOf(pending)
  if (!lanes.length) {
    return finishStep(ctx, manifest, haltStep(
      `record-batch was called while the run state was at "${pending.action}", which dispatches no lanes`
    ))
  }

  const banners = []
  const reported = []
  const unattempted = []
  const laneFoldCandidates = []
  const laneWorktreesPreserved = []
  const isolate = manifest.flags.isolateWaves === true
  const driverWorktrees = isolate && hostCapability(manifest, 'worktree') === 'driver'

  recordUsage(manifest, results, pending.wave)

  lanes.forEach((lane, i) => {
    const outcomes = laneOutcomes(lane, results[i])
    for (const o of outcomes) {
      if (o.outcome === 'not-attempted') unattempted.push(o.id)
      else {
        reported.push({
          id: o.id,
          ok: o.outcome === 'ok',
          error: o.error,
          handoff: o.handoff,
          filesChanged: o.filesChanged
        })
      }
    }
    if (!isolate) return
    const label = laneLabel(lane)
    // On a runner host the path is DERIVED, not read off the result: the driver
    // created that exact directory from the step that named it, so asking the
    // agent where it ran would put the fold at the mercy of a field a vendor CLI
    // has no reason to fill in. The Workflow host still reports its own `pwd`.
    const worktreePath = driverWorktrees
      ? join(root, laneWorktreePath(pending.wave, label))
      : results[i] && typeof results[i].worktreePath === 'string'
        ? results[i].worktreePath.trim()
        : ''
    if (outcomes.some(o => o.outcome === 'failed')) {
      if (worktreePath) laneWorktreesPreserved.push({ label, worktreePath })
      return
    }
    laneFoldCandidates.push({
      label,
      worktreePath: worktreePath || undefined,
      reportedFiles: outcomes.flatMap(o => (Array.isArray(o.filesChanged) ? o.filesChanged : []))
    })
  })

  // A task nobody ran is not a task that failed. It is left unticked and
  // uncounted on purpose — spending the failure budget on the three tasks
  // sitting behind one real blocker would halt a run that has one problem.
  if (unattempted.length) {
    banners.push(
      `LANE STOPPED EARLY: ${unattempted.join(', ')} not attempted after an earlier task in ` +
        `the same lane failed — not counted as failures, and still unchecked in tasks.md`
    )
  }

  // Fold this batch's successful lanes back into the shared tree before moving
  // on — the NEXT batch's merge base is read off this tree.
  if (isolate && laneFoldCandidates.length) {
    // The base the lanes actually forked from, captured at dispatch and carried
    // on the manifest across the driver round trip. `pending` is a pure
    // wave-state step and never carries it. Re-reading HEAD here is the
    // fallback, and it is a DIFFERENT commit whenever anything landed on the
    // shared tree while the batch ran — so it is spoken rather than taken
    // silently.
    const stored = typeof manifest.mergeBase === 'string' && manifest.mergeBase ? manifest.mergeBase : null
    const base = stored || headCommit(ctx)
    if (!stored) {
      banners.push(
        `MERGE BASE RE-READ AFTER THE BATCH: the base captured at dispatch was not carried to the ` +
          `fold, so lane diffs are taken against the post-batch HEAD (${base || 'unreadable'})`
      )
    }
    const merged = base ? ctx.deps.runMergeLanes(root, laneFoldCandidates, base) : null
    if (Array.isArray(merged && merged.cleanupWarnings) && merged.cleanupWarnings.length) {
      banners.push(
        `LANE WORKTREE CLEANUP WARNING: ${JSON.stringify(merged.cleanupWarnings)} — the fold applied, ` +
          `removal of the worktree itself did not`
      )
    }
    if (!merged || merged.status !== 'clean') {
      const survivors = [
        ...(merged && Array.isArray(merged.survivingWorktrees) ? merged.survivingWorktrees : []),
        ...laneWorktreesPreserved
      ]
        .map(w => `${w.label}: ${w.worktreePath}`)
        .join('; ')
      return finishStep(ctx, manifest, haltStep(
        `merge-lanes halted on wave ${pending.wave}: ` +
          (merged
            ? merged.status === 'collision'
              ? `real collision on ${JSON.stringify(merged.collisions)}`
              : `unresolved lane(s) ${JSON.stringify(merged.unresolved)}`
            : 'the shared-tree base commit could not be read, so no fold was attempted') +
          ` — surviving worktrees: ${survivors || '(none)'}`,
        { banners }
      ))
    }
  }
  if (isolate && laneWorktreesPreserved.length) {
    banners.push(
      `LANE WORKTREE PRESERVED: ${laneWorktreesPreserved.map(w => `${w.label} at ${w.worktreePath}`).join('; ')} ` +
        `— the lane failed and its writes were not folded into the shared tree`
    )
  }
  // Spent. The next isolated batch captures its own base at dispatch, and a base
  // left behind would be the previous batch's — older than the tree the next
  // batch's lanes fork from.
  manifest.mergeBase = null

  // Record. The observed path set is read here, never taken from the results
  // file: that file is written by the agent being audited, and an audit whose
  // input its subject supplies is not an audit.
  const after = recordBatchResult(state, { tasks: reported }, {
    changedPaths: ctx.deps.observedChangedPaths(root)
  })
  writeState(root, after)
  const { step: nextRaw, ok: logOk } = ctx.deps.logWaveMutation(root, {
    source: 'record-batch',
    change: manifest.change,
    state: after
  })
  if (!logOk) ctx.warn('the wave-state trajectory append failed on record-batch')
  ctx.deps.logAgentSpawns(root, {
    state: after,
    change: manifest.change,
    step: nextRaw,
    source: 'record-batch'
  })

  // One authority, read once, for the tick and for the tallies alike.
  const verdict = adjudicateBatches([reported], recordedOutcomes(batchOutcomes(state, after)))
  if (verdict.claimDerived) banners.push(claimDerivedBanner())
  if (verdict.overrides.length) banners.push(overrideBanner(verdict.overrides))

  verdict.waves.forEach(counts => {
    manifest.waves.push({
      wave: pending.wave,
      kind: pending.action,
      lanes: lanes.length,
      ok: counts.ok,
      failed: counts.failed,
      failedIds: counts.failedIds,
      // The lane that stopped early, plus anything the recorder found no result
      // for at all. Neither is ticked and neither is a failure.
      notAttempted: [
        ...unattempted,
        ...counts.recordedNotAttempted.filter(id => !unattempted.includes(id))
      ]
    })
  })

  // Ticked from what the run RECORDED, never from what an agent claimed — a box
  // ticked from a claim is how unimplemented work ships behind a "[x]".
  if (verdict.tickIds.length) {
    let ticked
    try {
      ticked = tickTasks(root, manifest.change, verdict.tickIds)
    } catch (err) {
      ticked = { missing: verdict.tickIds, error: (err && err.message) || String(err) }
    }
    if (ticked.missing && ticked.missing.length) {
      banners.push(
        `TASK TICK FAILED: could not mark ${ticked.missing.join(', ')} ` +
          `complete — the work was done, the checkbox was not`
      )
    }
  }

  manifest.banners.push(...banners)
  return finishStep(ctx, manifest, decorate(ctx, nextRaw, manifest, { banners }))
}

// --- run judge --------------------------------------------------------------

/**
 * Judge a verification's reported results and take the branch its verdict
 * implies.
 *
 * The verdict is rendered here and nowhere else. The agent that ran the suites
 * reports exit codes and counts; whether the run may continue is not its
 * question, and both drivers used to let it answer.
 */
export function runJudge(ctx, { context, results }) {
  const { root } = ctx
  const manifest = readManifest(root)
  if (!manifest) return noManifest()
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  // Outside the waves, but not outside the run's spend (design D9).
  recordUsage(manifest, results)

  const state = readState(root)
  const plan = readJson(join(root, WORK_DIR, `vplan-${context}.json`))
  const banners = []

  // Close the interval the verify step opened. This is the other half of the
  // inter-wave verify budget: the step marked when it dispatched, and only this
  // process — the next one — can see how long the agent between them took. An
  // unparseable or negative mark contributes nothing rather than a wrong number,
  // and the mark is cleared either way so it can never be counted twice.
  if (manifest.verifyStartedAt) {
    const spent = Date.now() - Date.parse(manifest.verifyStartedAt)
    if (Number.isFinite(spent) && spent >= 0) {
      manifest.verifyElapsedMs = (numberOrUndefined(manifest.verifyElapsedMs) || 0) + Math.round(spent)
    }
    manifest.verifyStartedAt = null
  }

  // A verification the CLI skipped: no agent ran, so there is nothing to judge.
  // The skip is recorded as the run's own, with the reason the planner gave — a
  // spent budget ahead of whichever kind happens to sit first in `skipped`, so
  // the recorded reason matches the one the step announced.
  const skipped = !plan || !Array.isArray(plan.steps) || !plan.steps.length
  const reason = skipped
    ? (plan && plan.budgetExceeded ? SKIP_REASONS.BUDGET_EXCEEDED : null) ||
      (plan && plan.skipped && plan.skipped[0] && plan.skipped[0].reason) ||
      'no detectable commands'
    : null

  let verdict = null
  if (!skipped) {
    const reportedSteps = flattenVerifyResults(results)
    // A planned step nobody reported on is NOT VERIFIED, and not verified is
    // not a pass. The judge scores what it is given, so an empty or partial
    // report would otherwise come back clean — which is the completion gate's
    // one failure direction: an absent verdict read as a passing one.
    const unreported = plan.steps
      .map(s => s.kind)
      .filter(kind => !reportedSteps.some(r => r && r.kind === kind))
    if (unreported.length) {
      const reason =
        `verification reported no result for ${unreported.join(', ')} — ` +
        `an unverified step is not a passing one, and an unverified run does not commit`
      banners.push(reason)
      manifest.banners.push(...banners)
      return finishStep(ctx, manifest, haltStep(reason, { banners }))
    }
    verdict = judgeVerification(plan, reportedSteps, { context })
    for (const banner of verdict.banners || []) banners.push(banner)
    logCliExit(ctx, manifest, 'verify judge', verdict.halt ? 1 : 0)
  } else {
    banners.push(`VERIFICATION SKIPPED: reason=${reason}`)
  }

  if (context === 'inter-wave') {
    if (!state) return finishStep(ctx, manifest, haltStep('the run state could not be read', { banners }))
    const record = skipped
      ? { skipped: true, reason }
      : {
          ok: !verdict.halt,
          errors: (verdict.signals || []).filter(s => s.level === 'halt').map(s => s.message),
          blocksNextWave: verdict.halt === true
        }
    const after = recordVerifyResult(state, record)
    writeState(root, after)
    const { step: nextRaw, ok } = ctx.deps.logWaveMutation(root, {
      source: 'record-verify',
      change: manifest.change,
      state: after
    })
    if (!ok) ctx.warn('the wave-state trajectory append failed on record-verify')
    manifest.banners.push(...banners)
    return finishStep(ctx, manifest, decorate(ctx, nextRaw, manifest, { banners }))
  }

  // Final. The completion gate: an unverified run does not commit, and an absent
  // verdict is "not verified" rather than a passing one.
  if (verdict && verdict.e2e && verdict.e2e.status === 'failed') {
    banners.push(
      `E2E FAILED (non-blocking by policy): ${verdict.e2e.detail || 'see the run log'}`
    )
  }
  manifest.banners.push(...banners)
  if (verdict && verdict.halt) {
    return finishStep(ctx, manifest, haltStep(
      verdict.reason || 'final verification halted the run',
      { banners }
    ))
  }

  // The handoff artifacts (design D5). They come AFTER final verification and
  // before the commit, exactly where the retired inline tail ran them, and the
  // two decisions they used to ask the agent to make for itself are made here.
  if (manifest.flags.handoff === true || manifest.flags.conformance === true) {
    return finishStep(ctx, manifest, handoffStep(ctx, manifest, banners))
  }

  return finishStep(ctx, manifest, commitStep(ctx, manifest, banners))
}

/**
 * The handoff step: the manual-test-plan decision and the conformance
 * checklist, computed here and inlined (design D5).
 *
 * `interlock surface` and `interlock conformance` used to be commands the
 * handoff agent ran with `--changed <files changed by this run>` — a path list
 * the agent supplied about a diff it was writing artifacts for. Both engines
 * are called in-process now, over the run's OWN observed changed paths, and
 * the agent receives their answers rather than the questions.
 */
function handoffStep(ctx, manifest, banners = []) {
  const { root } = ctx
  const change = manifest.change
  const changedPaths = ctx.deps.observedChangedPaths(root)

  // `null` when `--handoff` is off: the manual test plan, the code explanation
  // and the learnings capture belong to `handoff`, and a conformance-only run
  // asks for none of them (see `assembleHandoffPrompt`).
  let needsManualTestPlan = null
  let testPlanReason
  if (manifest.flags.handoff === true) {
    const surface = classifySurface(changedPaths)
    needsManualTestPlan = surface.needsManualTestPlan
    if (!needsManualTestPlan) {
      testPlanReason = changedPaths.length
        ? `none of the ${changedPaths.length} changed path(s) is a UI-testable surface`
        : 'this run observed no changed paths, so there is no UI surface to test'
    }
  }

  let scenarios = null
  const extra = [...banners]
  if (manifest.flags.conformance === true) {
    const checklist = buildChecklist(root, change, { changed: changedPaths })
    if (checklist.skipped) {
      // Said out loud rather than handed over as an empty checklist: "no
      // scenarios" and "the checklist could not be built" are different facts,
      // and only one of them is about the change.
      extra.push(`CONFORMANCE CHECKLIST UNAVAILABLE: ${checklist.reason}`)
      scenarios = []
    } else {
      scenarios = checklist.scenarios
    }
  }

  return makeStep({
    action: 'handoff',
    banners: extra,
    needsManualTestPlan,
    scenarios: scenarios ? scenarios.length : null,
    then: { argv: ['run', 'commit'] },
    spawns: [
      spawn(root, {
        label: 'handoff',
        kind: 'handoff',
        model: null,
        effort: null,
        schema: HANDOFF_RESULT_SCHEMA,
        prompt: assembleHandoffPrompt({
          change,
          needsManualTestPlan,
          testPlanReason,
          conformance: scenarios,
          learnings: manifest.flags.handoff === true
        })
      })
    ]
  })
}

/** The commit step, or the close a run told not to commit takes instead. */
function commitStep(ctx, manifest, banners = []) {
  const { root } = ctx
  if (manifest.flags.noCommit === true) {
    manifest.notes.push('--no-commit: everything ran, the commit is yours')
    manifest.commitSkipped = true
    return makeStep({
      action: 'close',
      banners,
      then: { argv: ['run', 'close'] }
    })
  }

  return makeStep({
    action: 'commit',
    banners,
    then: { argv: ['run', 'close'] },
    spawns: [
      spawn(root, {
        label: 'commit',
        kind: 'commit',
        model: null,
        effort: null,
        schema: COMMIT_SCHEMA,
        prompt: assembleCommitPrompt({ change: manifest.change, stageIndex: ++manifest.stageIndex })
      })
    ]
  })
}

/**
 * `run commit` — the continuation of the handoff step.
 *
 * It records what the handoff writer reported about the artifacts it authored
 * (the one tail figure the CLI cannot re-derive) and emits the commit. A run
 * with no handoff step never calls it: `run judge --context final` emits the
 * commit directly.
 */
export function runCommit(ctx, { results }) {
  const { root } = ctx
  const manifest = readManifest(root)
  if (!manifest) return noManifest()
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  // Outside the waves, but not outside the run's spend (design D9).
  recordUsage(manifest, results)

  const reported = results && results[0] && typeof results[0] === 'object' ? results[0] : null
  const count = value => (Number.isInteger(value) ? value : undefined)
  manifest.handoff = reported
    ? {
        ok: reported.ok === true,
        manualTestPlan: reported.manualTestPlan === true,
        skipReason: typeof reported.skipReason === 'string' ? reported.skipReason : undefined,
        learnings: count(reported.learnings),
        scenariosChecked: count(reported.scenariosChecked),
        scenariosUnconfirmed: count(reported.scenariosUnconfirmed)
      }
    : null
  if (!manifest.handoff) {
    // The step ran and reported nothing usable. Named, because a summary with
    // no handoff line is indistinguishable from a run that was never asked for
    // one.
    manifest.notes.push('handoff did not complete: the step returned no usable result')
  }

  return finishStep(ctx, manifest, commitStep(ctx, manifest))
}

/** The `results` entries a verify spawn reports, flattened to the judge's shape. */
function flattenVerifyResults(results) {
  const out = []
  for (const entry of Array.isArray(results) ? results : []) {
    if (!entry) continue
    if (Array.isArray(entry.results)) out.push(...entry.results.filter(Boolean))
    else if (typeof entry.kind === 'string') out.push(entry)
  }
  return out
}

// --- run verify-final --------------------------------------------------------

/**
 * Emit final verification directly, without re-reading the wave state.
 *
 * Used to be the continuation a host called after running its own inline tail
 * (design D6, `host-tail`, retired by `emit-strict-tail-from-cli`) — the tail
 * now calls `finalVerifyStep` in-process from `runReviewed`/`runRemediated`
 * instead, so nothing in this module emits `run verify-final` as a
 * continuation any more. Left as a directly-callable entry point rather than
 * removed: `interlock run verify-final` still does exactly what it says.
 */
export function runVerifyFinal(ctx) {
  const { root } = ctx
  const manifest = readManifest(root)
  if (!manifest) return noManifest()
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)
  return finishStep(ctx, manifest, finalVerifyStep(ctx, manifest))
}

// --- run replan -------------------------------------------------------------

/** Apply a revision the replan step produced, or carry on with the next step. */
export function runReplan(ctx, { results }) {
  const { root } = ctx
  const manifest = readManifest(root)
  if (!manifest) return noManifest()
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  // Outside the waves, but not outside the run's spend (design D9).
  recordUsage(manifest, results)

  const state = readState(root)
  if (!state) return finishStep(ctx, manifest, haltStep('the run state could not be read'))

  const revised = results && results[0] && results[0].revised === true
  const groups = revised ? readJson(join(root, REPLAN_PATH)) : null
  if (!revised || !Array.isArray(groups)) {
    // Nothing to revise is the ordinary outcome, and re-reading the state is
    // how the loop moves past a replan offer it declined.
    return finishStep(ctx, manifest, decorate(ctx, nextStep(state), manifest))
  }

  let after
  try {
    after = applyReplan(state, groups)
  } catch (err) {
    return finishStep(ctx, manifest, haltStep(`replan rejected: ${(err && err.message) || String(err)}`))
  }
  writeState(root, after)
  const { step: nextRaw, ok } = ctx.deps.logWaveMutation(root, {
    source: 'replan',
    change: manifest.change,
    state: after
  })
  if (!ok) ctx.warn('the wave-state trajectory append failed on replan')
  return finishStep(ctx, manifest, decorate(ctx, nextRaw, manifest))
}

// --- run next ---------------------------------------------------------------

/** Re-read the state and re-emit its step. A pure re-read; it decides nothing. */
export function runNext(ctx) {
  const { root } = ctx
  const manifest = readManifest(root)
  if (!manifest) return noManifest()
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)
  const state = readState(root)
  if (!state) return finishStep(ctx, manifest, haltStep('the run state could not be read'))
  return finishStep(ctx, manifest, decorate(ctx, nextStep(state), manifest))
}

// --- helpers used by every subcommand ---------------------------------------

function noManifest() {
  return haltStep(
    `no run manifest at ${MANIFEST_PATH} — a run subcommand was reached without \`interlock run start\``
  )
}

/**
 * Persist what this step observed and record the continuation it names.
 *
 * Every step-yielding call goes through here, so a field an earlier step
 * accumulated (a banner, a wave row, the stage index) survives into the next
 * process — each `run` subcommand is its own.
 */
function finishStep(ctx, manifest, step) {
  logSpawns(ctx, manifest, step)
  return recordThen(ctx.root, manifest, step)
}

// --- run close (design D10) -------------------------------------------------

/**
 * Close the run: build the receipt, append the outcome, write the terminal
 * trajectory event, check that the run is reconstructable, and return the
 * summary both hosts print.
 *
 * A halt closes the same way a completion does. The receipt, the outcome record
 * and the terminal event are what a halted run is FOR — it is the most
 * informative record this corpus holds, and a run that stopped without writing
 * one leaves nothing behind to explain why.
 *
 * @returns {Promise<{action: 'complete'|'halt', exitCode: number, summary: string, banners: string[]}>}
 */
export async function runClose(
  ctx,
  { results = [], halt = null, hostBanners = [], hostObserved = null, notify = false, env = process.env } = {}
) {
  const { root } = ctx
  const absRoot = resolve(root)
  const slug = projectSlug(absRoot)
  const manifest = readManifest(root)
  if (!manifest) {
    // A halt BEFORE `run start` — a host that refused its own invocation, or a
    // relay that never reached the first call. There is no run to record, but
    // the reason is the whole content of this close and must not be dropped for
    // the absence of a manifest to file it against.
    const reason = typeof halt === 'string' && halt.trim() ? halt.trim() : null
    const headline = `SHIP HALTED — ${reason || 'the run ended before it started'}`
    // The reader who walked away needs THIS outcome most of all: the run never
    // started, so no trajectory, receipt or outcome record will ever explain it.
    // The change name is unknown here — there is no manifest to read it from —
    // so the message carries the headline and the absent run id alone.
    const push = await attemptPush(notify, env, { headline, change: null, runId: null })
    const rows = [
      '  run: none — the run halted before a plan was adopted',
      `  project: ${slug}`,
      `  cwd: ${absRoot}`
    ]
    if (push && push.sent !== undefined) {
      rows.push(push.sent ? '  push: sent (ntfy)' : `  push: failed — ${push.reason}`)
    }
    return {
      schema: STEP_SCHEMA,
      action: 'halt',
      then: null,
      spawns: [],
      exitCode: 1,
      banners: Array.isArray(hostBanners) ? hostBanners : [],
      summary:
        `${headline}\n\n` +
        `There is no run manifest at ${MANIFEST_PATH}, so nothing was recorded for this run.\n` +
        rows.join('\n')
    }
  }

  const haltReason = typeof halt === 'string' && halt.trim() ? halt.trim() : manifest.halted || null
  if (haltReason) manifest.halted = haltReason

  // The commit result, when the close is the continuation of a commit step.
  const committed = results && results[0] && typeof results[0] === 'object' ? results[0] : null
  if (committed && typeof committed.ok === 'boolean') manifest.commit = committed

  const state = readState(root)
  const closing = closingFromWaveState(state)
  const leftoverTaskIds = readLeftoverIds(root, manifest)

  // What only the host could observe, carried in rather than recorded as
  // unknown: token spend, which comes off the runtime's own counter and which
  // this process — running BETWEEN agent turns — never sees.
  //
  // It used to carry the review, remediation and handoff figures too, because
  // the strict tail ran inside the Workflow host behind the `host-tail` seam.
  // The tail is a CLI-emitted program now (`emit-strict-tail-from-cli`), so
  // those are read off the manifest by `tailFromManifest` and this channel has
  // narrowed back to spend alone.
  const observed = hostObserved && typeof hostObserved === 'object' ? hostObserved : {}

  // The tail's own figures, every one of them adjudicated or counted by this
  // CLI. An absent field stays absent — never zero. `buildReceipt` turns an
  // absent field into `null`, and `null` reads as unknown, which is a different
  // fact from a review that found nothing.
  const tail = tailFromManifest(manifest)

  // Spend, from whichever party actually measured it (design D9). The Workflow
  // runtime counts tokens itself and carries them in through `--host-observed`;
  // a runner host reads them off each vendor CLI's envelope, and the run program
  // summed them as the results arrived. The host's own figures win where it has
  // any, because the runtime's counter sees turns this process never does.
  const counted = summarizeUsage(manifest)
  const hostSpend = Array.isArray(observed.spend) && observed.spend.length ? observed.spend : null
  const hostTotal =
    typeof observed.outputTokens === 'number' || observed.outputTokens === null
      ? observed.outputTokens
      : undefined

  // A host that reports no usage at all records `unknown` everywhere, and says
  // that once rather than leaving a reader to infer it from empty figures — the
  // same reason the degradation block is printed on a clean run.
  if (!hostSpend && hostTotal === undefined && hostCapability(manifest, 'usage') === false) {
    manifest.notes.push(
      `TOKEN USAGE NOT REPORTED: the ${hostId(manifest) || 'run'} host's CLI returns no token ` +
        `accounting, so every wave and the run total are recorded as unknown`
    )
  }

  // The cache figures, folded from the same two sources on the same terms. A
  // host's own numbers win where it has any, because a runtime that counts for
  // itself sees turns this process never does.
  const hostCacheRead =
    typeof observed.cacheReadInputTokens === 'number' || observed.cacheReadInputTokens === null
      ? observed.cacheReadInputTokens
      : undefined
  const hostCacheCreation =
    (observed.cacheCreationInputTokens && typeof observed.cacheCreationInputTokens === 'object') ||
    observed.cacheCreationInputTokens === null
      ? observed.cacheCreationInputTokens
      : undefined

  // Bannered on its own declaration, never on the host's id or name (design D6).
  // An absent metric nobody speaks reads as a measured zero, and the corpus
  // becomes quietly incomparable across hosts — which is the whole reason cache
  // accounting is declared separately from usage at all.
  if (
    hostCacheRead === undefined &&
    hostCacheCreation === undefined &&
    hostCapability(manifest, 'cacheAccounting') === false
  ) {
    manifest.notes.push(
      `CACHE ACCOUNTING NOT REPORTED: the ${hostId(manifest) || 'run'} host's runtime exposes no ` +
        `cache decomposition, so every wave's cache-read and cache-creation figures are recorded ` +
        `as unknown rather than as a measured zero`
    )
  }

  const summary = {
    waves: manifest.waves || [],
    spend: hostSpend || counted.spend,
    outputTokens: hostTotal !== undefined ? hostTotal : counted.outputTokens,
    cacheReadInputTokens: hostCacheRead !== undefined ? hostCacheRead : counted.cacheReadInputTokens,
    cacheCreationInputTokens:
      hostCacheCreation !== undefined ? hostCacheCreation : counted.cacheCreationInputTokens,
    review: tail.review,
    remediation: tail.remediation,
    remediationRounds: tail.remediationRounds,
    handoff: tail.handoff,
    halted: haltReason,
    notes: [...(manifest.notes || []), ...(Array.isArray(observed.notes) ? observed.notes : [])],
    closing,
    plan: manifest.plan,
    commit: manifest.commit,
    commitSkipped: manifest.commitSkipped === true,
    paths: readPathSets(root, manifest)
  }

  const degradations = degradationLines({
    banners: manifest.banners || [],
    closing,
    hostBanners: Array.isArray(hostBanners) ? hostBanners : []
  })

  // The stage marker, on every terminal path: a completion leaves `commit` on
  // disk and a halt leaves `remediation` or `fix-tests`, and the marker's pid is
  // the long-lived session's — so a marker nobody cleared keeps the PreToolUse
  // guards armed for the rest of that session, denying tasks.md checkbox edits
  // and test-file edits in ordinary work after the run is over. A clear that
  // fails is spoken, never an exit code: the marker is a guard input, not a gate.
  const cleared = clearStage(manifest.change, { root })
  if (!cleared.ok) degradations.push(`STAGE MARKER NOT CLEARED: ${cleared.warning}`)

  // The archive reminder's input (design D7, D8). `detectUnarchived` is called
  // directly rather than by re-execing `interlock drift`, which would also run
  // the inferred stale-spec signal and one `git log` per spec for a fact this
  // close already has the reader for.
  //
  // Wrapped exactly as `readLeftoverIds` wraps the same reader: `inspectChange`
  // reads and stats unguarded, so ONE unreadable sibling change must not turn a
  // clean close into exit 1. On failure the reminder is dropped and the reason
  // is spoken as a note — never swallowed.
  let unarchived = null
  try {
    const found = detectUnarchived(root)
    unarchived = {
      thisChange: found.some(u => u.change === manifest.change),
      others: found.filter(u => u.change !== manifest.change).length
    }
  } catch (err) {
    unarchived = null
    const note = `archive check skipped: ${(err && err.message) || String(err)}`
    manifest.notes.push(note)
    // `summary.notes` was snapshotted from `manifest.notes` above; the note has
    // to reach both or it is recorded in the manifest and printed nowhere.
    summary.notes.push(note)
  }

  // The push (design D1, D5). Requested by `--notify` from both drivers; the
  // title is the summary's OWN first line, so the notification and the printed
  // report cannot disagree. A failed push is a degradation banner and never an
  // exit code: the run happened either way.
  const push = await attemptPush(notify, env, {
    headline: summaryHeadline({ change: manifest.change, halted: haltReason, leftoverTaskIds }),
    change: manifest.change,
    runId: manifest.runId
  })
  if (push && push.sent === false) degradations.push(`PUSH FAILED: ${push.reason}`)

  // The plan fingerprint this run adopted, read back from where `run classified`
  // wrote it. Attributed only when the file names THIS change: a fingerprint
  // left by another change's run would otherwise be recorded as this run's, and
  // a wrong hash is worse than an absent one — the whole point of the field is
  // that a reader can check the plan-reuse story off a trajectory.
  const fingerprint = readJson(join(root, FINGERPRINT_PATH))
  const planFingerprint =
    fingerprint && typeof fingerprint.hash === 'string' && fingerprint.change === manifest.change
      ? fingerprint.hash
      : undefined

  const receipt = buildReceipt({
    change: manifest.change,
    summary,
    degradations,
    planFingerprint,
    leftoverTaskIds,
    host: manifest.host
      ? {
          id: hostId(manifest),
          billing: hostCapability(manifest, 'billing'),
          hooks: hostCapability(manifest, 'hooks'),
          usage: hostCapability(manifest, 'usage'),
          cacheAccounting: hostCapability(manifest, 'cacheAccounting')
        }
      : undefined
  })

  if (manifest.runId) {
    const written = appendRunLogEvent(root, {
      ...receipt,
      runId: manifest.runId,
      change: manifest.change
    })
    if (!written.written) ctx.warn(`run-receipt not recorded: ${written.reason}`)

    const terminal = appendRunLogEvent(root, {
      runId: manifest.runId,
      change: manifest.change,
      type: haltReason ? 'run-halt' : 'run-complete',
      reason: haltReason || undefined
    })
    if (!terminal.written) ctx.warn(`${haltReason ? 'run-halt' : 'run-complete'} not recorded: ${terminal.reason}`)
  }

  // The outcome corpus. Its own write failure is reported and never touches the
  // exit code: losing a corpus line must not fail the run that produced it.
  const outcome = appendOutcome(root, {
    change: manifest.change,
    mode: manifest.flags.mode || 'checkpoint',
    observed: observedFromReceipt(receipt)
  })
  if (!outcome.written) ctx.warn(`outcome not recorded: ${outcome.reason}`)

  // Reconstructability. A run nobody can reconstruct defeats the reason the
  // trajectory file exists, so this one IS fatal — the corpus-loss semantics
  // this repository deliberately keeps different per corpus.
  let reconstructable = true
  if (manifest.runId) {
    const check = checkRunLog(root, manifest.runId)
    reconstructable = check.ok !== false
    if (!reconstructable) {
      degradations.push(
        `RUN NOT RECONSTRUCTABLE: ${(check.problems || []).join('; ') || 'the trajectory is incomplete'}`
      )
    }
  }

  // The autonomy ladder's record for this run's review (design D6). It used to
  // ride on the commit prompt, which asked the party being assessed to write
  // the assessment's input — the exact provenance rule
  // `openspec/specs/ship/outcome-provenance` states. The count is the CLI's own
  // last adjudication, and no agent is in its path.
  //
  // Only when an adjudication actually happened: a strict run that halted in
  // the waves never reviewed, and recording zero blockers for it would credit
  // the review path with a clean run it never had. Storage only — nothing here
  // or downstream prints a level.
  if (manifest.flags.strict === true && manifest.review) {
    const blockers = survivingBlockers(manifest)
    try {
      recordAutonomy('review-code', { blockers }, { root })
      manifest.autonomy = { path: 'review-code', blockers }
    } catch (err) {
      degradations.push(
        `AUTONOMY RECORD NOT WRITTEN: ${(err && err.message) || String(err)} — the ladder is ` +
          `experimental and gates nothing, so the run is unaffected`
      )
    }
  }

  manifest.lastThen = null
  writeManifest(root, manifest)

  return {
    schema: STEP_SCHEMA,
    action: haltReason ? 'halt' : 'complete',
    then: null,
    spawns: [],
    exitCode: haltReason || !reconstructable ? 1 : 0,
    banners: degradations,
    summary: formatRunSummary({
      change: manifest.change,
      summary,
      flags: manifest.flags,
      leftoverTaskIds,
      degradations,
      runId: manifest.runId,
      root: absRoot,
      projectSlug: slug,
      push,
      unarchived
    })
  }
}

/**
 * Attempt the close's push, or decide not to. Returns what `formatRunSummary`
 * takes as its `push` input: `null` when no push was attempted at all, or
 * `{sent}` when one was.
 *
 * The three outcomes are deliberately different facts (design D5):
 *
 *   - `--notify` not passed, or no topic configured → `null`. An optional
 *     feature left off is not a degraded run: no summary row, no banner.
 *   - Configured but malformed → a failed push naming the VARIABLE, never its
 *     value; the topic is the only auth a public relay has.
 *   - Configured and attempted → whatever `postNtfy` resolves to, bounded by
 *     `LIMITS.notifyTimeoutMs` and never throwing.
 */
async function attemptPush(notify, env, { headline, change, runId }) {
  if (notify !== true) return null
  const config = readNotifyConfig(env)
  if (config.invalid) return { sent: false, reason: `invalid configuration: ${config.invalid}` }
  if (!config.topic) return null
  return postNtfy({
    url: config.url,
    topic: config.topic,
    ...composeCloseMessage({ headline, change, runId })
  })
}

/**
 * The surviving-blocker count from the LAST adjudication the CLI performed.
 *
 * `remediation.blockersRemaining` is rewritten by every `run remediated`, so it
 * is the latest; the round-one review's count stands in when no remediation
 * round ever ran. Never the agent's report — both figures are `resolveReview`'s
 * own output over files the CLI read.
 */
function survivingBlockers(manifest) {
  const remediation = manifest.remediation
  if (remediation && Number.isInteger(remediation.blockersRemaining)) {
    return remediation.blockersRemaining
  }
  const counts = manifest.review && manifest.review.counts
  return counts && Number.isInteger(counts.blockers) ? counts.blockers : 0
}

/**
 * Every task id still unticked in tasks.md, read at close.
 *
 * "Left behind" is not "failed": a halt at verification leaves whole waves that
 * never ran, and a receipt built from the failure list reported none of them. The
 * failure list stays as the fallback for a run whose change cannot be read.
 */
function readLeftoverIds(root, manifest) {
  try {
    const inspection = inspectChange(root, manifest.change)
    const items = (inspection.tasks && inspection.tasks.items) || []
    return items.filter(t => t && t.done === false).map(t => t.id).filter(Boolean)
  } catch {
    return (manifest.waves || []).flatMap(w => w.failedIds || [])
  }
}

/** The two path sets the receipt records, read here rather than reported by an agent. */
function readPathSets(root, manifest) {
  const sha = manifest.commit && manifest.commit.ok === true ? manifest.commit.sha : null
  const touched = sha ? readTouchedPaths(root, sha) : null
  const predicted = readPredictedPaths(root)
  return {
    touchedPaths: touched && touched.observed ? touched.paths : undefined,
    touchedPathsReason: touched && !touched.observed ? touched.reason : undefined,
    predictedPaths: predicted && predicted.observed ? predicted.paths : undefined,
    predictedPathsComplete: predicted ? predicted.complete === true : undefined,
    predictedPathsReason: predicted && !predicted.observed ? predicted.reason : undefined
  }
}
