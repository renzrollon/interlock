// The run program — every step of the lean ship loop, emitted by the CLI.
//
// Interlock has two drivers of one loop: `workflows/ship.js` on the Claude Code
// Workflow runtime and `cli/interlock-ship-acp` over ACP. Each used to carry its
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
// trajectory loggers and the git readers that live in `cli/interlock` — arrive
// through `ctx.deps` rather than being written a second time here.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LIMITS, EFFORT, RUNTIME } from './limits.mjs'
import { spawnPrefix } from './host.mjs'
import { PLUGIN_ROOT } from './doctor.mjs'
import { RED_SECTION_MARKER, inspectChange, isReviewSource, planCoverage, readLivingSpecs, tickTasks } from './artifacts.mjs'
import {
  FINGERPRINT_PATH,
  REUSE_MATCH,
  REUSE_NO_PLAN,
  computeFingerprint,
  resolvePlanReuse,
  writeFingerprint
} from './plan-fingerprint.mjs'
import { clearStage, stagePath } from './ship-stage.mjs'
import { cliVersion, pluginVersionAt } from './version.mjs'
import { readModelRouting, runtimeSlotsOf, WORKFLOW_MAX_CONCURRENT_RANGE } from './host/claude-env.mjs'
import { modelMatches } from './host/model-map.mjs'
import { readAgentUsage } from './agent-usage.mjs'
import { advisorConfigured, advisorNotes } from './advisor-tool.mjs'
import { resolveStateHome } from './state-home.mjs'
import {
  formatInterruptedBanner,
  formatUnreadableNote,
  isUnspoken,
  markSpoken,
  readInterruptedNotes
} from './interrupted.mjs'
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
import { detectUnarchived, livingSpecEdges, readGraphAt } from './drift.mjs'
import { projectSlug } from './project-slug.mjs'
import { composeCloseMessage, postNtfy, readNotifyConfig } from './notify.mjs'
import {
  BANNERS as VERIFY_BANNERS,
  SKIP_REASONS,
  foldCheckTimings,
  interWaveVerifyBudget,
  planVerification,
  profileProblem,
  judgeVerification
} from './verify.mjs'
import {
  REVIEW_POLICY_FILE,
  composePolicy,
  parseReviewPolicy,
  readReviewPolicy,
  resolveReview
} from './review-core.mjs'
import { applyToleranceBand, carriesFindingsList } from './findings.mjs'
import { runProofRecord } from './review-proof.mjs'
import { citedSelectionInputs, domainPartialReason } from './prompts/domain-context.mjs'
import { canonicalizePath } from './risk.mjs'
import { capabilityOf, parseSpec } from './spec-text.mjs'
import { writeReviewMetrics } from './metrics.mjs'
import { NOTES_PATH, appendNotes, deriveNotes, parseNotes } from './notes.mjs'
import { planRemediation } from './remediate.mjs'
import { classifySurface } from './surface.mjs'
import { buildChecklist, buildLivingChecklist } from './conformance.mjs'
import { assessMergeConfidence, combineSignals, mergeConfidenceHeadline } from './merge-confidence.mjs'
import { buildRunEvidence, gatherMergeEvidence } from './merge-evidence.mjs'
import { getState as autonomyState, record as recordAutonomy } from './autonomy.mjs'
import { writeResumeCard } from './resume-card.mjs'
import { summarizePlan } from './plan-summary.mjs'
import {
  applyReplan,
  batchOutcomes,
  createRunState,
  laneEffort,
  laneLabel,
  laneTitle,
  laneModel,
  nextStep,
  planWaves,
  recordBatchResult,
  recordVerifyResult,
  runRejectedReports
} from './waves.mjs'
import {
  assembleCommitPrompt,
  assembleDomainContext,
  assembleHandoffPrompt,
  assembleImplementerPrompt,
  assemblePlannerPrompt,
  assembleRemediatePrompt,
  assembleReplanPrompt,
  assembleReviewPrompt,
  assembleVerdictPrompt,
  assembleVerifyPrompt,
  publishStageLine,
  selectDimensions,
  selectDomainCapabilities
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

import { recordUsage, summarizeUsage } from './run-usage.mjs'
import {
  adjudicateBatches,
  claimDerivedBanner,
  laneOutcomes,
  overrideBanner,
  recordedOutcomes,
  rejectedBanner,
  rejectedReportReader
} from './lane-outcomes.mjs'

// Re-exported from the modules that hold them (moved out for size, not for a new
// seam): cli/interlock and the tests keep one import path for the run program.
export { recordUsage, summarizeUsage } from './run-usage.mjs'
export {
  adjudicateBatches,
  claimDerivedBanner,
  laneOutcomes,
  overrideBanner,
  recordedOutcomes,
  rejectedBanner,
  rejectedReportReader
} from './lane-outcomes.mjs'

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
// The exact bytes the last `run` subcommand printed. The Workflow host's relay
// is a model retyping stdout, and when its copy does not parse, this is the
// only record of what the CLI actually said — the halt names it rather than
// leaving the reader to dig the relay out of a transcript.
export const LAST_STEP_PATH = join(WORK_DIR, 'last-step.json')
// The close's own copy. The close never writes LAST_STEP_PATH — a halt names
// that file — so a driver whose relay garbled the close reads this one instead.
export const LAST_CLOSE_PATH = join(WORK_DIR, 'last-close.json')
// One line per `interlock verify exec`: the planned check it ran, its exit code
// and how long it took, measured by the CLI around the command itself. `run
// judge` folds these into the inter-wave verify budget and clears the file.
export const VERIFY_TIMINGS_PATH = join(WORK_DIR, 'verify-timings.jsonl')

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
  // Merge default only. A Workflow run does not keep it: `interlock run start
  // --host workflow` replaces it with the `claude --help` probe before the
  // manifest is written. A runner manifest written before the key existed also
  // reads `flag` here, although that run applied no effort at all. Nothing
  // reads the key from an old manifest — a receipt without the field is null.
  effort: 'flag',
  billing: 'claude-subscription-programmatic'
})

export const FLAG_FIELDS = Object.freeze([
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
 * Look at the run manifest and say what is there (design D11).
 *
 *   ok          a manifest this CLI reads: `manifest` is set
 *   absent      no file: a `run` subcommand reached without `run start`
 *   unparseable a file that is not JSON, or not an object: named unreadable
 *   foreign     an object whose `schema` is not the one this CLI reads (a newer
 *               or older release started the run): `schema` is what it carries
 *
 * `readManifest` keeps its null contract over this, for the callers that only
 * need "a manifest I can use". The two places that must tell the cases apart
 * (`noManifest` and the close) call this.
 *
 * @returns {{status: 'ok'|'absent'|'unparseable'|'foreign', manifest?: object, schema?: string|null, change?: string|null, reason?: string}}
 */
export function inspectManifest(root) {
  let raw
  try {
    raw = readFileSync(join(root, MANIFEST_PATH), 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return { status: 'absent' }
    return { status: 'unparseable', reason: (err && err.message) || String(err) }
  }
  let value
  try {
    value = JSON.parse(raw)
  } catch (err) {
    return { status: 'unparseable', reason: (err && err.message) || String(err) }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'unparseable', reason: 'the file does not hold a JSON object' }
  }
  if (value.schema === RUN_SCHEMA) return { status: 'ok', manifest: value }
  return {
    status: 'foreign',
    schema: typeof value.schema === 'string' ? value.schema : value.schema === undefined ? null : JSON.stringify(value.schema),
    change: typeof value.change === 'string' && value.change ? value.change : null
  }
}

/**
 * Read the run manifest. Returns null when there is none — a `run` subcommand
 * reached without a `run start` — so the caller can say that rather than
 * defaulting to a run shape nobody asked for. A foreign or unparseable file
 * reads as null here too; `inspectManifest` is how a caller tells them apart.
 */
export function readManifest(root) {
  const inspected = inspectManifest(root)
  return inspected.status === 'ok' ? inspected.manifest : null
}

const BIN_INTERLOCK = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'interlock')

/** `{ version, path }` of the CLI this module belongs to; `path` is the realpath of its `cli/interlock`. */
function cliLocation() {
  let path = BIN_INTERLOCK
  try {
    path = realpathSync(BIN_INTERLOCK)
  } catch {
    // A bundle that ships no cli/ next to lib/ keeps the unresolved location.
  }
  return { version: cliVersion(), path }
}

/** `{ version, root }` of the plugin a run was started under, or null when none was named. */
function pluginRecord(pluginRoot) {
  if (typeof pluginRoot !== 'string' || !pluginRoot.trim()) return null
  const root = resolve(pluginRoot.trim())
  return { version: pluginVersionAt(root), root }
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
export function newManifest({ change, flags, host, hostCapabilities, pluginRoot }) {
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
    // Which release produced this run (design D17): the CLI that wrote the
    // manifest and, when `run start` was given a plugin root, the plugin it was
    // started under. Additive, so the manifest stays `interlock.run/1`.
    cli: cliLocation(),
    plugin: pluginRecord(pluginRoot),
    // Fields an earlier release's manifest lacked that this one defaulted, each
    // raised once per run (design D36).
    defaultedFields: [],
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
    // The `seq` of the last step emitted in this root, and the first one this
    // run emitted. `run start` carries the count over from the manifest it
    // replaces, so an input written for an earlier run never answers a step of
    // this one; `seqStart` stays null until the start's own step is stamped.
    seq: 0,
    seqStart: null,
    // The shared-tree snapshot captured when an isolated batch was dispatched
    // (HEAD itself on a clean tree), held across the driver round trip so
    // `record-batch` folds against the base the lanes actually forked from. The emitted step carries it for the driver;
    // this is where the CLI reads it back, because the driver returns only
    // results and the wave state has no such field.
    mergeBase: null,
    // The commit the run started on, recorded once at `run start` and never
    // moved. The enforced `REVIEW.md` lists and the living requirements the
    // `domain` review judges against are read from it, so a change cannot edit
    // the copy that is applied to it. Null in a repository with no commit, and
    // absent on a manifest written before this field existed: both read the
    // working tree and say so (`REVIEW BASE NOT PINNED`).
    startSha: null,
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
    autonomy: null,
    // Every briefed spawn this run dispatched once it had an id — wave, label,
    // kind, routed model and briefing sha — which is the table `run close` joins
    // the recorder's sidecar against (ship/agent-results).
    dispatched: [],
    // The runner lanes whose host recorded a session, for the resume card's
    // `claude --resume` lines. Empty on the Workflow host, which has none.
    laneSessions: []
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
 * (D11): `workflows/ship.js` has no shell or filesystem, and `cli/interlock-run`
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

/**
 * The fields of a step the Workflow host's interpreter reads, and no others.
 *
 * On that host a step reaches `workflows/ship.js` through a relay — a model that
 * runs the command and RETYPES its stdout into a result field. A 23 KB step was
 * retyped with a duplicated key run and two dropped brackets, did not parse, and
 * halted a healthy run at wave 6. Nearly all of those bytes were things the
 * interpreter never reads: each spawn's inline `prompt` (the worker is handed
 * `promptPath` and `promptSha256` instead), and the carried wave state —
 * `remainingBatches`, `previousHandoffs`, `changed` — which the next `run`
 * subcommand reads back from `state.json`, never from the step.
 *
 * A whitelist rather than a list of what to drop, so a field added to the step
 * later cannot quietly grow the relay again. The other direction — the
 * interpreter starting to read a field this drops — is pinned by a scan of
 * ship.js in test/workflows.test.mjs.
 */
export const RELAY_STEP_FIELDS = Object.freeze([
  'schema',
  'action',
  'then',
  'spawns',
  'banners',
  'change',
  'wave',
  'reason',
  // The control-plane ping model `run start` decided (design D3). The driver
  // sets its relay pings' model from this field and from nothing else.
  'pingModel',
  // The step's number in this root (`stampStep`). The driver names it in every
  // input it writes and compares it with LAST_STEP_PATH when a copy is lost.
  'seq',
  // For a second reader, the ship meter's wave board, and read by neither
  // driver (draw-the-wave-board-in-the-meter-pane design D1): the step's wave
  // and batch positions, a verify step's skip flag, the ids a recorded batch
  // names, and the plan summary the adoption and replan steps carry.
  'waveIndex',
  'batchIndex',
  'batchCount',
  'skipped',
  'recorded',
  'plan',
  // The CLI's version (design D17/D18): the driver compares it with what it
  // expected and banners a CLI that predates version reporting.
  'cliVersion'
])

/**
 * The step as the run's host should receive it.
 *
 * Branches on the host id for the reason `hostSessionId` does: "stdout is
 * copied by a model" is a property of the Workflow runtime alone — the runner
 * refuses that id and reads stdout as a process. Every other host, and a run
 * that named none, gets the whole step: `cli/interlock-run` sends `prompt`
 * inline and needs it.
 */
export function relayStep(manifest, step) {
  if (hostId(manifest) !== WORKFLOW_HOST || !step || typeof step !== 'object') return step
  const out = {}
  for (const field of RELAY_STEP_FIELDS) {
    if (step[field] !== undefined) out[field] = step[field]
  }
  if (Array.isArray(step.spawns)) {
    out.spawns = step.spawns.map(s => {
      if (!s || typeof s !== 'object') return s
      const { prompt, ...rest } = s
      return rest
    })
  }
  return out
}

// --- step numbers and the inputs that answer them ----------------------------

/**
 * Number a step as it is printed: one past the last step emitted in this root.
 *
 * Called by `cli/interlock` where a `run` subcommand prints its step, and only
 * there, so a call refused before it printed anything leaves the count where it
 * was — which is how a driver tells "the call never took effect" (its record
 * still carries the step it last read) from "only the copy was lost". A step
 * with no manifest behind it is printed unnumbered.
 */
export function stampStep(root, step) {
  if (!step || typeof step !== 'object') return step
  // A refusal of a closed run wrote nothing and is not numbered: the count
  // stays where the last real step left it (design D15).
  if (isRefusal(step) || isCloseReplay(step)) return step
  const manifest = readManifest(root)
  if (!manifest) return step
  manifest.seq = (Number.isInteger(manifest.seq) ? manifest.seq : 0) + 1
  if (!Number.isInteger(manifest.seqStart)) manifest.seqStart = manifest.seq
  writeManifest(root, manifest)
  step.seq = manifest.seq
  return step
}

/** `{ answers, value }` and nothing else, with an integer `answers`. */
export function isAnswerEnvelope(input) {
  return (
    !!input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Object.keys(input).length === 2 &&
    Number.isInteger(input.answers) &&
    Object.prototype.hasOwnProperty.call(input, 'value')
  )
}

/**
 * The payload of a driver's input, or the reason it answers some other step.
 *
 * A relay can run its command before it writes the file, or run it twice; the
 * file it reads is then one written for an earlier call, and its bytes are
 * valid. The envelope names the step it was written for, and anything but the
 * current step is refused before a subcommand reads it into the run. The close
 * accepts any step of the current run: it is exempt from the sequence guard, and
 * a driver closing after a lost copy is one step behind the CLI. A bare input —
 * the runner host, `wave-state`, a person — is read as it always was.
 *
 * @returns {{ value: unknown } | { problem: string }}
 */
export function answeredInput(manifest, input, { what, close = false } = {}) {
  if (!isAnswerEnvelope(input)) return { value: input }
  const current = manifest && Number.isInteger(manifest.seq) ? manifest.seq : null
  const first = manifest && Number.isInteger(manifest.seqStart) ? manifest.seqStart : current
  const answers = input.answers
  const fits = current !== null && (close ? answers >= first && answers <= current : answers === current)
  if (fits) return { value: input.value }
  const at =
    current === null
      ? 'the run has no numbered step'
      : close
        ? `this run's steps are ${first}–${current}`
        : `the run is at step ${current}`
  return {
    problem:
      `stale input: ${what} answers step ${answers}, ${at} — it was written for another call, ` +
      'so nothing was recorded; write it for this step and run the command again'
  }
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
//
// The fold lives in lib/run-usage.mjs and is re-exported below, so a caller
// keeps importing it from here.

// --- what the host observed about each agent (ship/agent-results) -----------
//
// Two hosts, two channels, one set of verdicts. On a runner the adapter reads
// each lane's `claude -p` envelope and its session transcript and forwards a
// host record beside the result (`--host-records`); on the Workflow host the
// recorder hooks leave one sidecar file per agent, which the close joins to the
// spawns this program dispatched. Either way the CLI decides here, in the words
// below, and a driver decides none of it.

/** The one wording both hosts print for a lane a different model ran (design D6). */
export function modelSubstitutedBanner(label, routed, ran) {
  return `MODEL SUBSTITUTED: ${label} routed ${routed}, ran ${ran.join(', ')}`
}

/** A lane the host ended with an error or a non-zero exit, named by what it reported. */
export function laneStoppedBanner(label, how) {
  return `LANE STOPPED BY HOST: ${label} ${how}`
}

/** A success with no structured result: the open vendor bug this adapter's configuration triggers. */
export function schemaResultMissingBanner(label) {
  return (
    `SCHEMA RESULT MISSING (claude): ${label} — success without structured_output ` +
    `(anthropics/claude-code#82258)`
  )
}

/** The host denied tool calls inside a lane. A count the reader interprets, never a verdict. */
export function toolsDeniedBanner(label, count, tools) {
  return `TOOLS DENIED IN LANE: ${label} ${count}${tools.length ? ` (${tools.join(', ')})` : ''}`
}

/**
 * Whether a spawn ran on a model other than the one it was routed to (design D6).
 *
 * The matcher compares; what it is fed decides what a mismatch MEANS, and the
 * two observations do not mean the same thing. `servedModels` is turn-scoped —
 * the model of every assistant turn the agent itself took, read from its own
 * transcript — so ANY unmatched id is a model the plan did not choose, a
 * fallback that served one turn included. `sessionModels` is session-scoped —
 * the `claude -p` envelope's per-model breakdown, which also lists the host's
 * internal calls (every captured envelope carried a haiku entry the session was
 * not routed to) — so there only a session the routed model NEVER served is
 * established. The strongest observation present decides; neither, or no
 * routed model, decides nothing.
 *
 * The only caller of `modelMatches`; called from the runner's record path and
 * the Workflow close, and nowhere else (`test/spine/host-adapters.test.mjs`).
 *
 * @param {string|null|undefined} routed
 * @param {{servedModels?: string[]|null, sessionModels?: string[]|null}} [observed]
 * @returns {{substituted: boolean|null, scope: 'turns'|'session'|null, ran: string[]}}
 */
export function modelSubstitution(routed, { servedModels, sessionModels } = {}) {
  const want = typeof routed === 'string' ? routed.trim() : ''
  const ids = value => (Array.isArray(value) ? value.filter(m => typeof m === 'string' && m.trim()) : [])
  const served = ids(servedModels)
  const session = ids(sessionModels)
  if (!want) return { substituted: null, scope: null, ran: [] }
  if (served.length) {
    return { substituted: served.some(m => modelMatches(want, m) === false), scope: 'turns', ran: served }
  }
  if (session.length) {
    return { substituted: !session.some(m => modelMatches(want, m) === true), scope: 'session', ran: session }
  }
  return { substituted: null, scope: null, ran: [] }
}

/** The most recent spawn this run dispatched under a label, or null. */
function dispatchedSpawn(manifest, label) {
  const list = Array.isArray(manifest.dispatched) ? manifest.dispatched : []
  for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i].label === label) return list[i]
  return null
}

/** The receipt's runner counts, created on the first host record and never before. */
function agentCounts(manifest) {
  if (!manifest.agentCounts || typeof manifest.agentCounts !== 'object') {
    manifest.agentCounts = { lanesStoppedByHost: 0, schemaResultsMissing: 0, toolsDeniedInLanes: 0, modelSubstitutions: 0 }
  }
  return manifest.agentCounts
}

/**
 * Every record path's bookkeeping for the spawns it received: the usage the
 * results carry, as before, and — on a runner — what the host observed about
 * each one (design D9).
 *
 * For each host record it raises the lane banners, stores the lane's session for
 * the resume card, increments the receipt's counts, and appends one
 * `agent-result` to the trajectory. That append is the trajectory's fatal class:
 * the failure is returned for the caller to halt on BEFORE anything is ticked.
 * A step with no host records — a Workflow run, a host that sent none — raises
 * nothing and counts nothing: absence stays unknown.
 *
 * @returns {{failure: string|null}}
 */
function recordSpawnObservations(ctx, manifest, { results, hostRecords, wave = null } = {}) {
  recordUsage(manifest, results, wave)
  const records = Array.isArray(hostRecords) ? hostRecords.filter(r => r && typeof r === 'object') : []
  if (!records.length) return { failure: null }
  const counts = agentCounts(manifest)
  if (!Array.isArray(manifest.laneSessions)) manifest.laneSessions = []
  if (!Array.isArray(manifest.banners)) manifest.banners = []
  let failure = null

  for (const record of records) {
    const label = typeof record.label === 'string' && record.label ? record.label : 'agent'
    const subtype = typeof record.subtype === 'string' && record.subtype ? record.subtype : null
    const exitCode = Number.isInteger(record.exitCode) ? record.exitCode : null
    const stopped = record.isError === true || record.timedOut === true || (exitCode !== null && exitCode !== 0)

    let outcome = 'returned'
    if (stopped) {
      const how =
        subtype && subtype !== 'success'
          ? subtype
          : record.timedOut === true
            ? 'timed out'
            : exitCode !== null && exitCode !== 0
              ? `exit ${exitCode}`
              : subtype || 'error'
      manifest.banners.push(laneStoppedBanner(label, how))
      counts.lanesStoppedByHost++
      outcome = `stopped by the host (${how})`
    }
    if (record.resultMissing === true) {
      manifest.banners.push(schemaResultMissingBanner(label))
      counts.schemaResultsMissing++
      if (!stopped) outcome = 'returned no structured result'
    }
    const denials = record.permissionDenials && typeof record.permissionDenials === 'object' ? record.permissionDenials : null
    const denied = denials && Number.isInteger(denials.count) ? denials.count : null
    if (denied !== null && denied > 0) {
      const tools = [...new Set((Array.isArray(denials.tools) ? denials.tools : []).filter(t => typeof t === 'string' && t))]
      manifest.banners.push(toolsDeniedBanner(label, denied, tools))
      counts.toolsDeniedInLanes++
    }
    const verdict = modelSubstitution(record.modelRouted, record)
    if (verdict.substituted === true) {
      manifest.banners.push(modelSubstitutedBanner(label, record.modelRouted.trim(), verdict.ran))
      counts.modelSubstitutions++
    }
    if (typeof record.sessionId === 'string' && record.sessionId) {
      manifest.laneSessions.push({ label, sessionId: record.sessionId, outcome })
    }

    if (!manifest.runId) continue
    const spawned = dispatchedSpawn(manifest, label)
    const written = appendRunLogEvent(stateHomeOf(ctx, manifest), {
      runId: manifest.runId,
      change: manifest.change,
      type: 'agent-result',
      label,
      kind: spawned ? spawned.kind : undefined,
      source: 'envelope',
      subtype: record.subtype,
      isError: record.isError,
      terminalReason: record.terminalReason,
      errors: record.errors,
      permissionDenials: record.permissionDenials,
      sessionId: record.sessionId,
      numTurns: record.numTurns,
      modelRouted: record.modelRouted,
      servedModels: record.servedModels,
      sessionModels: record.sessionModels,
      modelScope: verdict.scope,
      substituted: verdict.substituted,
      resultMissing: record.resultMissing,
      usage: record.usage,
      hostCostUsd: record.hostCostUsd
    })
    if (!written.written) {
      ctx.warn(`agent-result not recorded: ${written.reason}`)
      if (!failure) failure = `${label}: ${written.reason}`
    }
  }
  return { failure }
}

/** One wave's or the run's cache figures, summed over joined agents, unknown-contagious. */
function sumJoinedCache(agents) {
  let read = 0
  let tiers = { ephemeral_5m: 0, ephemeral_1h: 0 }
  let total = 0
  for (const agent of agents) {
    const usage = agent.usage
    read = read === null || !Number.isFinite(usage.cacheReadInputTokens) ? null : read + usage.cacheReadInputTokens
    const creation = usage.cacheCreationInputTokens
    const split =
      creation && Number.isFinite(creation.ephemeral_5m) && Number.isFinite(creation.ephemeral_1h)
        ? creation
        : null
    const known = split ? split.ephemeral_5m + split.ephemeral_1h : creation && Number.isFinite(creation.total) ? creation.total : null
    total = total === null || known === null ? null : total + known
    // One agent recorded only a total: the wave's split is unknown, its total is not.
    tiers = tiers === null || !split ? null : { ephemeral_5m: tiers.ephemeral_5m + split.ephemeral_5m, ephemeral_1h: tiers.ephemeral_1h + split.ephemeral_1h }
  }
  return {
    cacheReadInputTokens: read,
    cacheCreationInputTokens: tiers !== null ? tiers : total !== null ? { total } : null
  }
}

/**
 * The close's advisor-consults line and its `--json` field, or `null` when
 * neither prints (design "Counting consults"). It prints only when the manifest
 * recorded a configured advisor or the lanes' sum is above zero.
 *
 * A recognized zero is NEVER printed as a count. No transcript on record holds
 * an advisor block yet, so the reader is written against binary-derived shapes;
 * a block type it does not know would still parse, and a configured run that
 * consulted would read 0. Unknown is not zero, following `TOKEN USAGE NOT
 * REPORTED`.
 *
 * @param {object} manifest
 * @param {{advisor: {sum: number, lanes: number, unrecorded: number}}} joined
 * @returns {{line: string, field: {count: number|null, lanes: number, unrecorded: number}}|null}
 */
function advisorCloseLine(manifest, joined) {
  const { sum, lanes, unrecorded } = joined.advisor
  const configured = advisorConfigured(manifest.hostEnv && manifest.hostEnv.advisor)
  if (!configured && !(sum > 0)) return null
  if (unrecorded > 0) {
    return {
      line: `advisor consults: not established (${unrecorded} of ${lanes} lanes unrecorded)`,
      field: { count: null, lanes, unrecorded }
    }
  }
  if (sum > 0) {
    return { line: `advisor consults: ${sum} across ${lanes} lanes`, field: { count: sum, lanes, unrecorded: 0 } }
  }
  return {
    line: `advisor consults: not established (none recognized in ${lanes} lanes)`,
    field: { count: null, lanes, unrecorded: 0 }
  }
}

/**
 * Join what the recorder hooks wrote for this run to the spawns it dispatched
 * (design D5), by the briefing sha256 every bootstrap carries.
 *
 * The denominator is the briefed spawns dispatched once the run had an id: the
 * recorder writes nothing without one, so a spawn dispatched before it (the
 * planner) could never join, and counting it would make every run partial. A
 * spawn that did not join, or joined a transcript with no usage, makes its
 * wave's figures unknown. A recorded agent nobody dispatched — a relay ping,
 * which carries no briefing, or any other workflow the matcher admitted — is
 * counted apart and attributed nowhere.
 */
function joinAgentUsage(root, manifest) {
  const read = manifest.runId
    ? readAgentUsage(root, manifest.runId)
    : { present: false, agents: [], permissions: [], unreadable: [] }
  const briefed = (Array.isArray(manifest.dispatched) ? manifest.dispatched : []).filter(
    d => d && typeof d.sha === 'string' && d.sha
  )
  const pool = new Map()
  for (const agent of read.agents) {
    const key = typeof agent.briefingSha === 'string' && agent.briefingSha ? agent.briefingSha : null
    if (!key) continue
    if (!pool.has(key)) pool.set(key, [])
    pool.get(key).push(agent)
  }

  const joined = []
  const waves = new Map()
  let unrecorded = 0
  for (const spawned of briefed) {
    const candidates = pool.get(spawned.sha) || []
    const agent = candidates.shift() || null
    const usable = Boolean(agent && agent.usage && typeof agent.usage === 'object')
    if (!usable) unrecorded++
    if (agent) joined.push({ spawned, agent })
    const wave = Number.isInteger(spawned.wave) ? spawned.wave : null
    if (!waves.has(wave)) waves.set(wave, { agents: [], complete: true })
    const entry = waves.get(wave)
    if (usable) entry.agents.push(agent)
    else entry.complete = false
  }
  const leftover = [...pool.values()].flat().length
  const noKey = read.agents.filter(a => !(typeof a.briefingSha === 'string' && a.briefingSha)).length

  const cacheByWave = new Map()
  for (const [wave, entry] of waves) {
    cacheByWave.set(
      wave,
      entry.complete ? sumJoinedCache(entry.agents) : { cacheReadInputTokens: null, cacheCreationInputTokens: null }
    )
  }
  const complete = read.present && briefed.length > 0 && unrecorded === 0

  // Advisor consults, summed over the joined lanes. A lane counts only when its
  // record carries a number: the reader returns null for a transcript that did
  // not parse, and a record written before the field existed carries none.
  // Unknown is never zero, so one such lane makes the sum unknown.
  let advisorSum = 0
  let advisorUnrecorded = 0
  for (const spawned of briefed) {
    const agent = joined.find(j => j.spawned === spawned)?.agent
    if (agent && Number.isFinite(agent.advisorConsults)) advisorSum += agent.advisorConsults
    else advisorUnrecorded++
  }
  return {
    advisor: { sum: advisorSum, lanes: briefed.length, unrecorded: advisorUnrecorded },
    present: read.present,
    // Read before the close refines it: only a host that declared it cannot
    // account for cache has its figures supplied by the hooks.
    cacheFromHooks: hostCapability(manifest, 'cacheAccounting') === false,
    briefed: briefed.length,
    unrecorded,
    complete,
    joined,
    cacheByWave,
    runCache: complete
      ? sumJoinedCache(joined.map(j => j.agent))
      : { cacheReadInputTokens: null, cacheCreationInputTokens: null },
    unjoined: { noKey, unknownKey: leftover },
    permissions: read.permissions,
    unreadable: read.unreadable
  }
}

// --- the state home (ship/state-home) ----------------------------------------
//
// Corpora — the trajectory, the outcome line, the metrics, the resume card, the
// interrupted notes, the autonomy ledger — go to the state home, which is the
// main checkout when the run is in a linked worktree; per-run working state —
// this manifest, the wave state, briefings, spill, the marker, the sidecar —
// stays in `ctx.root`. `run start` resolves the home once and records it; every
// later subcommand reads it back from here and never resolves again.

/** Where this run's corpora are written: the recorded home, or the root for a manifest without one. */
export function stateHomeOf(ctx, manifest) {
  return manifest && typeof manifest.stateHome === 'string' && manifest.stateHome ? manifest.stateHome : ctx.root
}

/** The test profile and the graph, located root-first then home (design D16). */
export const TEST_PROFILE_PATH = join('.claude', 'testing', 'profile.json')
export const GRAPH_FILE_PATH = join('.claude', 'graph', 'graph.json')

/** The graph line raised at start when neither the root nor the home has one. */
export const GRAPH_UNAVAILABLE_BANNER =
  'GRAPH UNAVAILABLE: never built — implementer and reviewer agents fall back to grep and will be slower'

/** Root first, then the home, never written: the inputs a worktree run reads through. */
export function locateInput(root, home, relative) {
  const atRoot = resolve(root, relative)
  if (existsSync(atRoot)) return { path: atRoot, source: 'root' }
  const atHome = resolve(home, relative)
  if (resolve(home) !== resolve(root) && existsSync(atHome)) return { path: atHome, source: 'state-home' }
  return { path: null, source: 'none' }
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
 * The file name a label's briefing is written under. A lane's label is built
 * from task ids the planner returned, and nothing upstream checks their shape,
 * so one carrying a separator or a leading dot would write outside the
 * briefings directory. Such a label is cleaned the way a lane worktree's is and
 * suffixed with a short hash of itself, so two labels that clean alike still
 * write two files. Every label the program mints (`1.1+2`, `plan-waves`) is
 * already a safe name and passes unchanged.
 */
function briefingName(label) {
  const text = String(label)
  if (/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(text)) return text
  const safe = text.replace(/[^A-Za-z0-9._+-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'briefing'
  return `${safe}-${briefingHash(text).slice(0, 8)}`
}

/**
 * Write one briefing and return what a spawn carries: its path, its hash and
 * its text.
 *
 * The Workflow host cannot hold a briefing — it has no filesystem, and asking a
 * ping to copy several kilobytes into a result field would breach the published
 * result-field cap — so it spawns the worker with a fixed bootstrap naming this
 * path and requires the hash back — and never sees `prompt` at all, since
 * `relayStep` drops it from what that host's relay copies. The runner hosts
 * read `prompt` and send it inline. One file serves both.
 */
export function writeBriefing(root, label, text) {
  const promptSha256 = briefingHash(text)
  const promptPath = join(BRIEFINGS_DIR, `${briefingName(label)}.md`)
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
function spawn(root, { label, title, kind, model, effort, schema, prompt, isolation, worktree }) {
  return {
    label,
    // What a person sees the agent as. `label` stays the key every record joins
    // on; a spawn with nothing to add is shown under its label.
    title: title || label,
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
  // The CLI that produced the step (design D17), so a relay that never sees the
  // manifest still shows which release is driving. A caller's own value wins.
  return { schema: STEP_SCHEMA, action, then, spawns, cliVersion: cliVersion(), ...rest }
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
  'previousRejectedReports',
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
    const previousRejectedReports = Array.isArray(step.previousRejectedReports)
      ? step.previousRejectedReports
      : []
    // The stage line rides on the batch's briefings rather than on a step of its
    // own: the agent doing the work is the one with a filesystem, and a marker
    // written by anyone else would carry the wrong pid.
    const stage = publishStageLine('implement', change, ++manifest.stageIndex)
    const spawns = lanes.map(lane =>
      spawn(root, {
        label: laneLabel(lane),
        title: laneTitle(lane),
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
            previousRejectedReports,
            unresolvedChecks: step.unresolvedChecks,
            isolateWaves: isolate,
            solo: step.mode === 'solo'
          })
      })
    )
    // The base this batch's lanes fork from: a snapshot of the shared tree as it
    // stands — tracked edits and every untracked file the ignore rules let
    // through — so it includes every earlier fold of this run. Not HEAD: the
    // ship commit is the run's last step, so HEAD never moves while batches
    // fold, and a lane forked from it edits a copy that lacks them; its
    // whole-file fold would then revert the earlier batch with exit 0. A clean
    // tree snapshots to HEAD itself. Captured now, not after, so nothing lands
    // on the shared tree between the capture and the fold. Only under
    // isolation; unset, a batch runs byte-for-byte as it did before worktree
    // isolation existed.
    let mergeBase = null
    if (isolate) {
      mergeBase = ctx.deps.snapshotTree(root, change)
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
      // would re-read HEAD *after* the lanes ran — never the snapshot they
      // forked from.
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
          // effort-routing: "Control-plane and prose spawns SHALL inherit the host's effort".
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
  const profile = readProfile(root, manifest)
  const opts = { context, changed }
  if (context === 'final') {
    opts.e2e = manifest.flags.skipE2e !== true
    opts.coverage = manifest.flags.skipCoverage !== true
  } else {
    // The budget's input: time already spent verifying, compared against the
    // run's inter-wave budget. Accumulated across invocations on the manifest,
    // because this process runs BETWEEN agent turns and never sees the interval
    // a verify agent spends; without it the comparison would be `0 >= budget`
    // forever and the budget would bound nothing.
    opts.elapsedMs = numberOrUndefined(manifest.verifyElapsedMs) || 0
    // The budget fixed when the run started (`settleStateHome`), never re-derived
    // from a profile an agent in the tree may have edited since. A manifest
    // written before the field existed carries none and gets the published
    // default, and says nothing about its absence.
    const fixed = manifest.verifyBudget && manifest.verifyBudget.ms
    if (Number.isSafeInteger(fixed) && fixed > 0) opts.budgetMs = fixed
  }
  const plan = planVerification(profile, opts)
  writeWork(root, `vplan-${context}.json`, plan)
  // A timing left by an earlier checkpoint is not this one's, and the judge
  // cannot tell them apart — so the slate is cleared where the checks are named.
  clearVerifyTimings(root)

  // The one case where the run can name the cause and the remedy: a check was
  // dropped because the budget ran out while sitting at the published floor,
  // and it sat there because the profile carried no usable `unit.timeout_ms`.
  // A budget at the floor because the profile's own allowance is small raises
  // nothing — that profile had its say. Decided before the branch below, because
  // a checkpoint cut to typecheck alone is reduced exactly as one cut to nothing
  // is: a profile with a typecheck command never produces an empty plan, and
  // would otherwise never be told. Once per run, so the second reduced
  // checkpoint is not the same line again.
  let floor = null
  if (
    interWave &&
    plan.budgetExceeded &&
    plan.skipped.some(s => s && s.reason === SKIP_REASONS.BUDGET_EXCEEDED) &&
    manifest.verifyBudget &&
    manifest.verifyBudget.timeoutMs === null &&
    !manifest.verifyBudgetFloorSpoken
  ) {
    floor =
      'VERIFY BUDGET AT THE PUBLISHED FLOOR: the test profile carries no unit.timeout_ms, so the ' +
      'inter-wave budget was not raised to fit this suite — run /interlock:fix-tests --reconfigure ' +
      'to record one'
    manifest.banners.push(floor)
    manifest.verifyBudgetFloorSpoken = true
  }

  if (!plan.steps.length) {
    // A spent budget is the reason, not whichever kind happens to sit first in
    // `skipped` — typecheck is skipped for its own missing command and would
    // otherwise mask the budget as the cause of an empty plan.
    const reason = plan.budgetExceeded
      ? SKIP_REASONS.BUDGET_EXCEEDED
      : (plan.skipped[0] && plan.skipped[0].reason) || 'no detectable commands'
    const banners = [...(carried.banners || []), `VERIFICATION SKIPPED: reason=${reason}`]
    if (floor) banners.push(floor)
    return makeStep({
      action,
      ...carried,
      context,
      skipped: true,
      reason,
      banners,
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
    // Only when it was raised, so a checkpoint that raised nothing is the step
    // it always was.
    ...(floor ? { banners: [...(carried.banners || []), floor] } : {}),
    context,
    skipped: false,
    then: { argv: ['run', 'judge', '--context', context] },
    spawns: [
      spawn(root, {
        label,
        kind: 'verify',
        model: null,
        effort: EFFORT.verify,
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
 * The run's rejected handoff reports, for the review briefing. A run with no
 * readable wave state has recorded none it can name, and the review is briefed
 * exactly as it was before the list existed.
 */
function rejectedReportsOfRun(root) {
  try {
    return runRejectedReports(readState(root))
  } catch {
    return []
  }
}

// --- the base a review is judged against (judge-against-base-and-living-specs, D3, D4) ---
//
// Two inputs a review reads are enforced, not advisory: the `REVIEW.md` path
// lists and the living requirements the `domain` dimension judges against. A
// change must not be able to edit the copy that is applied to it, so a run reads
// both from the commit it started on (`manifest.startSha`). The policy PROSE
// stays the working tree's: it is advice that cannot relax the gate, and an
// uncommitted edit to it reaching a reviewer is a feature. A run with no start
// commit reads everything from the working tree and says so.

/** The short form of a commit, as banners name it. */
const shortSha = sha => String(sha).slice(0, 7)

/** HEAD when the run starts, or null — never a guess, and never a crash. */
function readStartSha(ctx) {
  try {
    const sha = ctx.deps && typeof ctx.deps.headCommit === 'function' ? ctx.deps.headCommit(ctx.root) : null
    return typeof sha === 'string' && sha ? sha : null
  } catch {
    return null
  }
}

/** The start commit this run pinned, or null (none recorded, or an older manifest). */
function pinnedSha(manifest) {
  return manifest && typeof manifest.startSha === 'string' && manifest.startSha ? manifest.startSha : null
}

/**
 * One repository file, from `ref` or — when `ref` is null — the working tree.
 * `{ text }`, `{ absent: true }`, `{ tooLarge: true, size }` or `{ error }`; it
 * never throws, because the caller decides how each outcome degrades.
 */
function readFileAt(ctx, ref, relative, { maxBytes } = {}) {
  if (ref === null) {
    const path = join(ctx.root, relative)
    try {
      if (!existsSync(path)) return { absent: true }
      const size = statSync(path).size
      if (Number.isFinite(maxBytes) && size > maxBytes) return { tooLarge: true, size }
      return { text: readFileSync(path, 'utf8') }
    } catch (err) {
      return { error: (err && err.message) || String(err) }
    }
  }
  if (!ctx.deps || typeof ctx.deps.readAtRef !== 'function') {
    return { error: 'this host supplies no reader for a commit' }
  }
  try {
    const read = ctx.deps.readAtRef(ctx.root, ref, relative, { maxBytes })
    return read && typeof read === 'object' ? read : { error: 'the reader returned nothing' }
  } catch (err) {
    return { error: (err && err.message) || String(err) }
  }
}

/** Push a banner onto the manifest unless one with the same label is already there. */
function raiseOnce(manifest, banner) {
  if (!Array.isArray(manifest.banners)) manifest.banners = []
  const label = banner.slice(0, banner.indexOf(':') + 1)
  if (!manifest.banners.some(b => typeof b === 'string' && b.startsWith(label))) manifest.banners.push(banner)
}

/** The working tree's `REVIEW.md` as text plus its parsed policy, or null when absent. */
function readWorkingPolicy(root) {
  const path = join(root, REVIEW_POLICY_FILE)
  if (!existsSync(path)) return null
  let text = ''
  try {
    if (statSync(path).size <= LIMITS.maxReviewPolicyBytes) text = readFileSync(path, 'utf8')
  } catch {
    // The policy reader below reports an unreadable file as a problem.
  }
  return { text, policy: readReviewPolicy(root) }
}

/**
 * The policy a review is adjudicated by: prose and owner from the working tree,
 * both enforced path lists from the start commit (`composePolicy`).
 *
 * With no start commit the working tree supplies everything, unchanged from
 * before; `reviewStep` has already said so (`REVIEW BASE NOT PINNED`). A start
 * commit that cannot be read degrades the same way and says so here. A working
 * copy that differs from the start commit's raises `POLICY DIFFERS FROM BASE`.
 *
 * @returns {{ policy: object, banners: string[] }}
 */
function policyForAdjudication(ctx, manifest) {
  const sha = pinnedSha(manifest)
  if (!sha) return { policy: readReviewPolicy(ctx.root), banners: [] }

  const short = shortSha(sha)
  const read = readFileAt(ctx, sha, REVIEW_POLICY_FILE, { maxBytes: LIMITS.maxReviewPolicyBytes })
  if (read.error !== undefined) {
    return {
      policy: readReviewPolicy(ctx.root),
      banners: [
        `REVIEW BASE NOT PINNED: start commit ${short} could not be read (${read.error}); ` +
          `read from the working tree: ${REVIEW_POLICY_FILE} lists`
      ]
    }
  }

  let base = null
  if (typeof read.text === 'string') {
    base = { text: read.text, policy: parseReviewPolicy(read.text) }
  } else if (read.tooLarge) {
    base = {
      text: '',
      policy: {
        prose: '',
        excludePaths: [],
        humanPaths: [],
        owner: null,
        problems: [
          `${REVIEW_POLICY_FILE} is ${read.size} bytes, over the ${LIMITS.maxReviewPolicyBytes}-byte scan ` +
            `cap — not parsed; review proceeds under default policy`
        ]
      }
    }
  }

  const policy = composePolicy({ working: readWorkingPolicy(ctx.root), base, ref: short })
  const banners = []
  if (policy.differsFromBase) {
    banners.push(
      `POLICY DIFFERS FROM BASE: ${REVIEW_POLICY_FILE} differs from ${short}; ` +
        `its Do Not Report paths were read from ${short}`
    )
  }
  return { policy, banners }
}

const SPEC_CITATION_PATH = /^openspec\/specs\/.+\/spec\.md$/

/**
 * What `resolveReview` needs to check requirement citations: for every spec a
 * finding cites, that spec's requirement keys at the base (the start commit, or
 * the working tree for an unpinned run), or `{ unreadable }` when it could not
 * be read. Only canonical `openspec/specs/**\/spec.md` paths are read, so a
 * citation cannot make the run read an arbitrary file.
 */
function requirementHeadingsFor(ctx, manifest, findings) {
  const ref = pinnedSha(manifest)
  const where = ref ? `at ${shortSha(ref)}` : 'in the working tree'
  const headings = new Map()
  for (const finding of applyToleranceBand(findings, null).reportable) {
    const cited = finding && typeof finding.requirement === 'string' ? finding.requirement : ''
    const hash = cited.indexOf('#')
    if (hash === -1) continue
    const path = canonicalizePath(cited.slice(0, hash).trim())
    if (!path || !SPEC_CITATION_PATH.test(path) || headings.has(path)) continue
    const read = readFileAt(ctx, ref, path)
    if (typeof read.text === 'string') {
      headings.set(path, parseSpec(read.text).requirements.map(r => r.key))
    } else if (read.absent) {
      headings.set(path, { unreadable: `${path} does not exist ${where}` })
    } else {
      headings.set(path, { unreadable: read.error || 'unreadable' })
    }
  }
  return headings
}

/** Where a capability's living spec and a change's delta spec live. */
const livingSpecPathOf = capability => `openspec/specs/${capability}/spec.md`
const deltaSpecPathOf = (change, capability) => `openspec/changes/${change}/specs/${capability}/spec.md`

/**
 * The text of the given capabilities' requirements, read from `ref` (null = the
 * working tree), and the change's own delta specs, which are always the working
 * tree's: they ARE the change. `readErrors` names every file that could not be
 * read, so a degraded assembly says why.
 */
function assembleDomainFor(ctx, manifest, capabilities, ref, living = {}) {
  const deltas = {}
  const readErrors = []
  for (const { capability } of capabilities) {
    if (!(capability in living)) {
      const read = readFileAt(ctx, ref, livingSpecPathOf(capability))
      if (typeof read.text === 'string') living[capability] = read.text
      else if (read.error) readErrors.push(`${livingSpecPathOf(capability)}: ${read.error}`)
    }
    const delta = readFileAt(ctx, null, deltaSpecPathOf(manifest.change, capability))
    if (typeof delta.text === 'string') deltas[capability] = delta.text
  }
  const assembled = assembleDomainContext({ capabilities, living, deltas, ref })
  return { assembled, readErrors }
}

/**
 * Decide whether `domain` runs and what it is given (design D4).
 *
 * Capabilities are selected from the run's graph (`manifest.graphPath`) and from
 * the capabilities the change's delta specs declare it modifies, the latter only
 * where a living spec exists at the base. The text is assembled from the start
 * commit. Nothing here is silent: a missing graph is `partial` or `skipped`,
 * a graph that links no changed path is recorded as `notSelected` and nothing
 * else (an unlinked file is a coverage gap, not a degraded review).
 */
function gatherDomain(ctx, manifest, changedPaths) {
  const ref = pinnedSha(manifest)
  const graph = manifest.graphPath
    ? readGraphAt(manifest.graphPath)
    : { links: null, reason: 'no graph has been built — run /interlock:bootstrap once' }
  const edges = Array.isArray(graph.links) ? livingSpecEdges(graph) : null

  const living = {}
  let specFiles = []
  try {
    specFiles = inspectChange(ctx.root, manifest.change).specFiles
  } catch {
    // A change that cannot be inspected declares nothing; the run's own checks say why.
  }
  const declared = []
  for (const rel of specFiles) {
    const capability = capabilityOf(rel)
    if (!capability || declared.includes(capability)) continue
    const read = readFileAt(ctx, ref, livingSpecPathOf(capability))
    if (typeof read.text === 'string') {
      living[capability] = read.text
      declared.push(capability)
    }
  }

  // A changed file the graph lacks selects the capability whose living spec cites it (design D6).
  const cited = edges
    ? citedSelectionInputs({
        graph,
        changedPaths,
        readAll: () => readLivingSpecs(ctx.root, ref, { gitText: ctx.deps?.gitText })
      })
    : {}
  const selection = selectDomainCapabilities({ changedPaths, edges, graphReason: graph.reason, declared, ...cited })
  let assembled = null
  let skipped = selection.skipped
  let readErrors = []
  if (selection.capabilities.length) {
    const result = assembleDomainFor(ctx, manifest, selection.capabilities, ref, living)
    assembled = result.assembled
    readErrors = result.readErrors
    if (assembled.skipped) {
      skipped = result.readErrors.length
        ? `${assembled.skipped} (${result.readErrors.join('; ')})`
        : assembled.skipped
    }
  }
  return { selection, assembled, skipped, readErrors, runs: Boolean(assembled) && !assembled.skipped }
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
  const domain = gatherDomain(ctx, manifest, changedPaths)
  const { dimensions: names, reasons } = selectDimensions(changedPaths, {
    domain: domain.runs ? domain.selection : null
  })
  const dimensions = resolveDimensionRubrics(names)
  const policy = readReviewPolicy(root)

  const banners = [...(carried.banners || [])]
  for (const d of dimensions) {
    if (d.rubric === null) {
      banners.push(`REVIEW RUBRIC UNAVAILABLE: ${d.name} — that reviewer works from the dimension name alone`)
    }
  }

  // What the review reads from the working tree because there is no start
  // commit to read it from, named once (design D3). The lists are always read;
  // the living requirements only when `domain` runs.
  const raised = []
  if (!pinnedSha(manifest)) {
    const unpinned = [`${REVIEW_POLICY_FILE} lists`, ...(domain.runs ? ['living requirements'] : [])]
    raised.push(
      `REVIEW BASE NOT PINNED: this run recorded no start commit; read from the working tree: ${unpinned.join(', ')}`
    )
  }
  if (domain.skipped) {
    raised.push(`DOMAIN REVIEW SKIPPED: ${domain.skipped}`)
  } else if (domain.runs) {
    // Two ways the reviewer is given less than the whole: a selection made
    // without a graph, and a text the size bound cut. One line states both
    // (design D20 of label-and-harden-the-merge-verdict), worded as the CLI verb
    // words it (prove-the-review-covered-the-diff design D6).
    const partial = domainPartialReason(domain.selection, domain.assembled)
    if (partial) raised.push(`DOMAIN REVIEW PARTIAL: ${partial}`)
  }
  if (domain.selection.citedUnread) raised.push(`DOMAIN CITATIONS UNREAD: ${domain.selection.citedUnread}`)

  // A run adjudicates only what THIS review wrote (design D24). The work files
  // sit in a directory no run clears, so a review that writes nothing would
  // otherwise be adjudicated from whatever an earlier run left there. Removed
  // once, when the step is first emitted: `manifest.reviewDimensions` is set a
  // few lines below, and a step derived again by `run next` finds it set and
  // removes nothing, since by then the reviewer may already be writing.
  if (!manifest.reviewDimensions) {
    for (const path of [FINDINGS_PATH, VERDICTS_PATH]) {
      try {
        rmSync(join(root, path), { force: true })
      } catch (err) {
        raised.push(
          `REVIEW WORK FILE NOT CLEARED: ${path} could not be removed (${(err && err.message) || err}) — ` +
            `what an earlier run left there may be adjudicated as this review's`
        )
      }
    }
  }
  for (const banner of raised) {
    raiseOnce(manifest, banner)
    banners.push(banner)
  }

  // Carried across every later `run reviewed`/`run remediated` call in this
  // run, each its own process: what the CLI selected, and why, so an agent-
  // added dimension can be told apart from one the CLI asked for (design D4).
  // `skipped`, `notSelected` and `domain` are recorded only when they apply, so
  // a record without them says `domain` was neither refused nor unlinked.
  manifest.reviewDimensions = { selected: names, reasons }
  // A selected dimension whose criteria could not be read was dispatched on its
  // name alone. The banner above says so once; the record keeps it, because the
  // merge verdict asks which dimensions ran WITH their rubric (design D4 of
  // complete-and-record-the-merge-verdict).
  const unavailable = dimensions.filter(d => d.rubric === null).map(d => d.name)
  if (unavailable.length) manifest.reviewDimensions.unavailable = unavailable
  if (domain.skipped) manifest.reviewDimensions.skipped = [{ name: 'domain', reason: domain.skipped }]
  if (domain.selection.notSelected) manifest.reviewDimensions.notSelected = domain.selection.notSelected
  if (domain.runs) {
    const { superseded, omitted, specifiedByChange, ref } = domain.assembled
    manifest.reviewDimensions.domain = {
      capabilities: domain.selection.capabilities,
      ref,
      superseded,
      omitted,
      specifiedByChange
    }
  }

  // Tasks recorded as done whose handoff packet was rejected. A later wave was
  // told about its predecessor's; the last wave's had nobody to tell. The review
  // reads the whole diff, so it is told about every one the run recorded.
  const rejectedReports = rejectedReportsOfRun(root)

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
          domainContext: domain.runs ? domain.assembled.text : undefined,
          rejectedReports,
          findingsPath: FINDINGS_PATH,
          verdictsPath: VERDICTS_PATH,
          stageLine,
          changedSources: changedPaths.filter(isReviewSource)
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
  // A re-review of `domain` is handed the text the first pass was, re-assembled
  // from the capabilities and the ref it recorded — not re-selected, so the
  // reviewer judges the fix against the same requirements.
  const recordedDomain = manifest.reviewDimensions && manifest.reviewDimensions.domain
  const domainContext =
    plan.reReviewDimensions.includes('domain') &&
    recordedDomain &&
    Array.isArray(recordedDomain.capabilities) &&
    recordedDomain.capabilities.length
      ? assembleDomainFor(
          ctx,
          manifest,
          recordedDomain.capabilities,
          typeof recordedDomain.ref === 'string' && recordedDomain.ref ? recordedDomain.ref : null
        ).assembled.text
      : undefined
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
        prompt: assembleRemediatePrompt({
          change,
          round: plan.round,
          plan,
          dimensions,
          policyProse,
          domainContext,
          findingsPath: FINDINGS_PATH,
          verdictsPath: VERDICTS_PATH,
          stageLine,
          changedSources: ctx.deps.observedChangedPaths(root).filter(isReviewSource)
        })
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
 * The dimension record `review.json` carries (design D4 of
 * complete-and-record-the-merge-verdict), read off the manifest so every
 * adjudication of one run writes the same one:
 *
 *   selected     what the CLI selected
 *   unavailable  selected dimensions whose rubric could not be read
 *   completed    whether the review worker's result was usable and `ok`
 *   ran          selected minus unavailable, plus any dimension the reviewer
 *                added, when the review completed; nothing otherwise
 *   skipped      dimensions refused with a reason (`domain`, for want of a graph)
 *
 * The CLI never watches one dimension run: the worker fans them out in its own
 * context and reports `ok`. So `ran` means "dispatched with its rubric in a
 * review the worker reported complete", and nothing stronger.
 */
function dimensionRecord(manifest) {
  const recorded =
    manifest.reviewDimensions && typeof manifest.reviewDimensions === 'object' ? manifest.reviewDimensions : {}
  const names = value => (Array.isArray(value) ? value.filter(name => typeof name === 'string' && name) : [])
  const selected = names(recorded.selected)
  const unavailable = names(recorded.unavailable).filter(name => selected.includes(name))
  const completed = recorded.completed === true
  const added = names((Array.isArray(recorded.added) ? recorded.added : []).map(d => d && d.name)).filter(
    name => !selected.includes(name)
  )
  return {
    selected,
    ran: completed ? [...selected.filter(name => !unavailable.includes(name)), ...new Set(added)] : [],
    unavailable,
    completed,
    skipped: Array.isArray(recorded.skipped) ? recorded.skipped : [],
    // `domain` ran on a text the size bound cut: a flag on the verdict, not a band.
    ...(recorded.domain?.omitted?.length && completed
      ? { degraded: [{ name: 'domain', reason: `${recorded.domain.omitted.length} requirement(s) left out by the size bound (LIMITS.maxDomainSpecChars)` }] }
      : {})
  }
}

/** Where every adjudication of a run writes its result, and a later round reads the last one back. */
const REVIEW_RECORD = 'review.json'
const REVIEW_RECORD_PATH = join(WORK_DIR, REVIEW_RECORD)

/**
 * The findings work file as a review or a fixer left it: `{ findings }`, or
 * `{ missing }` saying why it carries no findings list. An absent file, one that
 * is not JSON and one holding none of the accepted shapes are the same fact to
 * an adjudication: there is no list this agent wrote (design D10 of
 * label-and-harden-the-merge-verdict). An empty list is a list.
 */
function readFindingsWork(root) {
  let raw
  try {
    raw = readFileSync(join(root, FINDINGS_PATH), 'utf8')
  } catch (err) {
    return { missing: err && err.code === 'ENOENT' ? 'the file is absent' : `the file could not be read (${(err && err.code) || err})` }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { missing: 'the file is not valid JSON' }
  }
  if (!carriesFindingsList(parsed)) return { missing: 'it holds none of the shapes a findings list takes' }
  return { findings: parsed }
}

/** The reason a findings work file could not be adjudicated, as a note or a halt states it. */
const noFindingsList = missing => `${FINDINGS_PATH} carries no findings list (${missing})`

/**
 * Adjudicate the findings a review or fixer just wrote against the verdicts
 * work file, write `review.json` and the metrics file exactly as `interlock
 * review --metrics <change>` would, and record the counts on the manifest
 * (design D2, D7). Every adjudication rewrites `review.json`, so every one
 * writes the dimension record with it. The caller reads the findings work file
 * and decides what a missing list means; this is handed a list.
 */
function adjudicateReview(ctx, manifest, findings, reReviewed = null) {
  const { root } = ctx
  const verdicts = readJson(join(root, VERDICTS_PATH))
  const changedPaths = ctx.deps.observedChangedPaths(root)
  const { policy, banners: policyBanners } = policyForAdjudication(ctx, manifest)

  const result = resolveReview(findings, verdicts, {
    changedPaths,
    excludePaths: policy.excludePaths,
    requirementHeadings: requirementHeadingsFor(ctx, manifest, findings)
  })
  // The proof of coverage, by the rules `interlock review` records it (spec:
  // review/review-proof); a fix round carries what it did not re-review.
  const dimensions = dimensionRecord(manifest)
  const { banner, ...proved } = runProofRecord({
    findings,
    ran: dimensions.ran,
    changedPaths,
    reReviewed,
    previous: reReviewed ? readJson(join(root, REVIEW_RECORD_PATH)) : null,
    hashOf: p => {
      try {
        return createHash('sha256').update(readFileSync(join(root, p))).digest('hex')
      } catch {
        return null
      }
    }
  })
  manifest.reviewProofBanner = banner
  writeWork(root, REVIEW_RECORD, { ...result, dimensions, ...proved })

  // Once per run: a later round adjudicates the same policy against the same
  // base, and `manifest.banners` already holds what the first said.
  const recorded = Array.isArray(manifest.banners) ? manifest.banners : []
  const banners = policyBanners.filter(
    b => !recorded.some(r => typeof r === 'string' && r.startsWith(b.slice(0, b.indexOf(':') + 1)))
  )
  const metrics = writeReviewMetrics(stateHomeOf(ctx, manifest), { change: manifest.change, counts: result.counts })
  if (!metrics.written) {
    banners.push(`REVIEW METRICS NOT WRITTEN: ${metrics.reason}`)
  }
  // Compound notes sit with the metrics: a lost note is spoken, never fatal,
  // and nothing here touches the exit code.
  let notesPath = null
  try {
    const rows = deriveNotes(result.surviving, { change: manifest.change, source: manifest.runId || 'unknown' })
    if (rows.length) {
      const appended = appendNotes(root, rows)
      if (appended.appended > 0 || (appended.skipped > 0 && notesFromRun(root, manifest.runId))) notesPath = appended.path
    }
  } catch (e) {
    banners.push(`COMPOUND NOTES NOT WRITTEN: ${e && e.message ? e.message : String(e)}`)
  }
  if (notesPath) manifest.notesPath = notesPath
  return { result, banners }
}

/**
 * Whether the notes table already holds a row this run appended. A run that
 * appended, halted before its manifest persisted and was resumed dedupes every
 * row as skipped; without this the commit briefing would never name the table
 * the first attempt dirtied. Unreadable reads as no.
 */
function notesFromRun(root, runId) {
  if (!runId) return false
  try {
    return parseNotes(readFileSync(join(root, NOTES_PATH), 'utf8')).rows.some(r => r.source === runId)
  } catch {
    return false
  }
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
export function runReviewed(ctx, { results, hostRecords }) {
  const { root } = ctx
  const opened = openRun(ctx, 'reviewed')
  if (opened.halt) return opened.halt
  const manifest = opened.manifest
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  // Outside the waves, but not outside the run's spend (design D9).
  const observed = recordSpawnObservations(ctx, manifest, { results, hostRecords })
  if (observed.failure) {
    return finishStep(ctx, manifest, trajectoryHaltStep('agent-result', observed.failure))
  }

  // A review step that reported nothing usable still adjudicates — the files
  // are read either way — but "the review did not complete" is a different
  // fact from "the review found nothing", and the summary must not blur them
  // (workflow-host spec, edge case: an agent that returns no findings file).
  const report = results && results[0] && typeof results[0] === 'object' ? results[0] : null
  const reported = Boolean(report) && report.ok === true
  if (!reported) {
    manifest.notes.push(
      `review did not complete: ${(report && report.detail) || 'the step returned no usable result'}`
    )
  }
  // Whatever the step reported about itself, a review that left no findings
  // list did not complete: the work files were removed when the step was
  // emitted, so an absent, unparseable or list-less file is this review's own
  // silence, never a clean result (design D10, D24 of
  // label-and-harden-the-merge-verdict). The run goes on, as it does for a
  // step that returned nothing usable, and adjudicates as with no findings.
  const work = readFindingsWork(root)
  if (work.missing) {
    manifest.notes.push(
      `review did not complete: ${noFindingsList(work.missing)}, so there is nothing this review wrote to adjudicate`
    )
  }
  const reviewCompleted = reported && !work.missing

  // A dimension the reviewer added beyond the CLI's selection (design D4).
  // The CLI cannot know why; the one-line reason is the agent's own report,
  // carried here rather than inferred.
  const selected = new Set((manifest.reviewDimensions && manifest.reviewDimensions.selected) || [])
  const added = Array.isArray(report && report.addedDimensions)
    ? report.addedDimensions.filter(d => d && typeof d.name === 'string' && !selected.has(d.name))
    : []
  // Whether the worker reported that it completed, recorded for every later
  // adjudication of this run: the dimension record on `review.json` reads it,
  // and a fixing round must not turn "did not complete" into "ran".
  manifest.reviewDimensions = {
    ...(manifest.reviewDimensions || { selected: [], reasons: {} }),
    ...(added.length ? { added } : {}),
    completed: reviewCompleted
  }

  // After the two facts above, because the adjudication writes them on `review.json`.
  const { result, banners } = adjudicateReview(ctx, manifest, work.missing ? [] : work.findings)
  banners.push(...stageMarkerBanners(results))

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
export function runRemediated(ctx, { round, results, hostRecords }) {
  const { root } = ctx
  const opened = openRun(ctx, 'remediated')
  if (opened.halt) return opened.halt
  const manifest = opened.manifest
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  // Outside the waves, but not outside the run's spend (design D9).
  const observed = recordSpawnObservations(ctx, manifest, { results, hostRecords })
  if (observed.failure) {
    return finishStep(ctx, manifest, trajectoryHaltStep('agent-result', observed.failure))
  }

  const roundCap = LIMITS.remediationRounds
  const completedRound = Number.isInteger(round) ? round : null
  if (completedRound === null || completedRound < 1 || completedRound > roundCap + 1) {
    return finishStep(ctx, manifest, haltStep(
      `run remediated called with an invalid --round (got ${JSON.stringify(round)}, expected 1-${roundCap + 1})`
    ))
  }

  // A round that leaves no findings list has cleared nothing (design D10 of
  // label-and-harden-the-merge-verdict). Read as an empty review it would
  // clear the very blockers it was asked to fix, and at the verdict round the
  // run would commit. So the round is adjudicated from the surviving findings
  // of the last adjudication, unchanged: `review.json`, which every
  // adjudication of this run writes, read here before anything rewrites it and
  // left as it is. When that cannot be read back either there is nothing to
  // stand on, and the run halts: the one outcome that cannot clear a blocker.
  const work = readFindingsWork(root)
  let result
  let banners
  if (work.missing) {
    const last = readJson(join(root, REVIEW_RECORD_PATH))
    if (!last || typeof last !== 'object' || !Array.isArray(last.surviving)) {
      return finishStep(ctx, manifest, haltStep(
        `round ${completedRound} left no findings to adjudicate and the last adjudication cannot be read back: ` +
          `${noFindingsList(work.missing)}, and ${REVIEW_RECORD_PATH} is absent, unparseable or without its ` +
          `surviving list — nothing here can say a blocker was cleared`,
        { banners: stageMarkerBanners(results) }
      ))
    }
    manifest.notes.push(
      `round ${completedRound} was not re-reviewed: ${noFindingsList(work.missing)}; the ${last.surviving.length} ` +
        `finding(s) that survived the last adjudication stand unchanged`
    )
    result = last
    banners = []
  } else {
    const attempted = readJson(join(root, WORK_DIR, `remediate-${completedRound}.json`))
    ;({ result, banners } = adjudicateReview(ctx, manifest, work.findings, attempted?.reReviewDimensions || []))
  }
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

function readProfileAt(path) {
  if (typeof path !== 'string' || !path) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * The halt reason for a test profile that exists and cannot be used, or null
 * (design D14). "Cannot be used" is three things, and the doctor's
 * `test-profile` row fails every one of them: the file will not read, it does
 * not parse, or it parses and is invalid. The last uses the same validator the
 * doctor and the verify planner use, so the three cannot disagree about what is
 * valid. An ABSENT file is not this check — `planVerification` speaks that in its
 * skip reasons. The path is the one `run start` located, which is the file the
 * run reads.
 */
function profileHalt(root, manifest) {
  const recorded = manifest && Object.prototype.hasOwnProperty.call(manifest, 'testProfilePath')
  const path = recorded ? manifest.testProfilePath : join(root, TEST_PROFILE_PATH)
  if (typeof path !== 'string' || !path) return null
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    return `test profile ${path} is unreadable: ${(err && err.message) || String(err)}`
  }
  let profile
  try {
    profile = JSON.parse(text)
  } catch (err) {
    return `test profile ${path} does not parse: ${(err && err.message) || String(err)}`
  }
  if (profile === null) return `test profile ${path} is invalid: it holds null, not a JSON object`
  const problem = profileProblem(profile)
  return problem ? `test profile ${path} is invalid: ${problem}` : null
}

function readProfile(root, manifest) {
  // The path `run start` located, root first and the state home second (design
  // D16), so a worktree run reads the main checkout's profile without copying
  // it. A manifest written before the field existed reads the root, as before.
  const recorded = manifest && Object.prototype.hasOwnProperty.call(manifest, 'testProfilePath')
  const path = recorded ? manifest.testProfilePath : join(root, TEST_PROFILE_PATH)
  if (typeof path !== 'string' || !path) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // No profile is not a degradation to report here — `planVerification` says
    // so itself, in the skip reasons it returns.
    return null
  }
}

/**
 * The timings `interlock verify exec` appended since the last clear. An
 * unreadable line is skipped rather than fatal: a timing is a budget input, and
 * a kind left without one is charged the round trip, with a banner saying so.
 */
function readVerifyTimings(root) {
  let raw
  try {
    raw = readFileSync(join(root, VERIFY_TIMINGS_PATH), 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // skipped — see above
    }
  }
  return out
}

function clearVerifyTimings(root) {
  try {
    rmSync(join(root, VERIFY_TIMINGS_PATH), { force: true })
  } catch {
    // Nothing to clear, or nothing clearable: the worst case is a stale timing
    // charged to the next checkpoint, which only ever makes the budget tighter.
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
  if (!manifest.runId) return null
  let failure = null
  for (const s of step.spawns || []) {
    if (s.kind === 'implementer') continue // logged by wave-state, at the lane
    const written = appendRunLogEvent(stateHomeOf(ctx, manifest), {
      runId: manifest.runId || undefined,
      change: manifest.change,
      type: 'agent-spawn',
      label: s.label,
      model: s.model || undefined,
      kind: s.kind
    })
    if (!written.written) {
      ctx.warn(`agent-spawn not recorded: ${written.reason}`)
      // The first failure is the one that opened the gap; the rest of the loop
      // still runs so the warnings a reader gets are unchanged.
      if (!failure) failure = `agent-spawn ${s.label}: ${written.reason}`
    }
  }
  return failure
}

function logCliExit(ctx, manifest, command, exitCode) {
  if (!manifest.runId) return null
  const written = appendRunLogEvent(stateHomeOf(ctx, manifest), {
    runId: manifest.runId,
    change: manifest.change,
    type: 'cli-exit',
    command,
    exitCode
  })
  if (written.written) return null
  ctx.warn(`cli-exit not recorded: ${written.reason}`)
  return `cli-exit ${command}: ${written.reason}`
}

/**
 * The halt a failed run-trajectory append owes the run.
 *
 * `.claude/ship/runs` is `fatal: true` in `lib/doctor.mjs`'s STATE_DIRS, and
 * `wave-state` / `verify judge` in `cli/interlock` already `process.exit(1)`
 * when their append does not land. The live `interlock run` path used to warn
 * and walk on — into the task tick and the commit — so a run nobody could
 * reconstruct still ticked boxes and shipped. A warning is not a gate.
 *
 * Caller-side by construction: fatality is a policy of the SITE, not of the
 * shared writer, which is why `appendRunLogEvent` still just reports. The
 * outcome corpus and review metrics keep their deliberately different
 * semantics — a failed write there is reported and never touches the exit code.
 *
 * `site` names where the gap is, so the halt reason is enough to find it.
 */
function trajectoryHaltStep(site, reason, extra = {}) {
  return haltStep(`trajectory append failed: ${site}: ${reason}`, extra)
}

/**
 * The reason to halt with when `logWaveMutation` failed.
 *
 * It returns the filesystem's own reason where it has one. The fallback covers
 * an injected or older dep that reports only the boolean — better a named site
 * with a vague cause than a halt that says nothing at all.
 */
function waveAppendReason(outcome) {
  const reason = outcome && typeof outcome.reason === 'string' ? outcome.reason.trim() : ''
  return reason || 'the wave-action or its paired cli-exit did not land'
}

/** Same, for `logAgentSpawns` — it returns a boolean and reports its reason to stderr. */
const LANE_SPAWN_APPEND_FAILED = 'an implementer lane spawn did not land'

/**
 * Log the implementer lanes a wave-state step dispatches — this batch's, and
 * only this batch's — at the moment the program names them.
 *
 * Every site that turns a wave-state step into a run step calls this, because
 * every one of them can emit a batch. Two used to, and they logged the WHOLE
 * wave at its first batch: a run that halted before a later batch left spawn
 * events for agents that never ran, while a wave entered through `run judge`
 * or `run replan` left none for the agents that did. The `run` program emits
 * one step per batch, so the batch is the unit.
 *
 * Returns false only when the append failed, read with `=== false` as every
 * caller already does — a stub that reports nothing is not a failure.
 */
function logLaneSpawns(ctx, manifest, state, step, source) {
  // Consulted even for a step that dispatches nothing — with no lanes, which it
  // logs as nothing. Whether a step owes the trajectory a line is the writer's
  // question, and a site that skipped the call for some actions would be one
  // more place the answer could drift.
  const dispatching = step && (step.action === 'run-batch' || step.action === 'test-wave')
  return (
    ctx.deps.logAgentSpawns(stateHomeOf(ctx, manifest), {
      state,
      change: manifest.change,
      step,
      lanes: dispatching ? lanesOf(step) : [],
      source
    }) !== false
  )
}

/** The shared tree's HEAD. Never throws: an unreadable base is null, never a guess. */
function headCommit(ctx) {
  return ctx.deps.headCommit(ctx.root)
}

// --- adjudication -------------------------------------------------------------
//
// The recorded-outcome adjudication lives in lib/lane-outcomes.mjs and is
// re-exported below, so a caller keeps importing it from here.

// --- run start (design D4, D2) ----------------------------------------------

/**
 * What the Workflow host's environment means for this run (design D1, D5).
 *
 * `interlock run start --host workflow` reads the model-routing variables from
 * its own environment, the way `hostSessionId` reads the session, and learns the
 * host version from `claude --version`; `cli/interlock` builds the observation
 * and this decides from it, once. The driver forwards what is decided and reads
 * none of these variables itself — `workflows/ship.js` used to, and raised
 * `MODEL ROUTING OVERRIDDEN` for a variable that, from 2.1.251, sets only the
 * default subagent model.
 *
 * Pure. The version-aware reading itself is `readModelRouting`, shared with the
 * doctor's advice row so the two cannot read one environment two ways.
 *
 * @param {object} observation  from `observeClaudeEnv`
 * @returns {{banners: string[], notes: string[], pingModel: string|null,
 *   modelSelect: 'forced'|null, slots: object}}
 */
export function decideHostEnvironment(observation) {
  const o = observation && typeof observation === 'object' ? observation : {}
  const routing = readModelRouting(o)
  const banners = []
  const notes = []
  const unknown = routing.versionKnown ? '' : ' (host version unknown)'

  if (routing.forceEffective) {
    banners.push(
      `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=${o.subagentModelForce} — every agent runs on ` +
        `one model (${o.subagentModel || "the host's default"}), so the per-tier assignment in the plan is not ` +
        `in effect${unknown}`
    )
  }
  if (routing.forceInert) {
    notes.push(
      `MODEL ROUTING NOTE: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=${o.subagentModelForce} has no effect on Claude Code ` +
        `${routing.version}, which predates it; CLAUDE_CODE_SUBAGENT_MODEL is read as on any host of that version`
    )
  }
  if (routing.plainDefaultOnly) {
    notes.push(
      `MODEL ROUTING NOTE: CLAUDE_CODE_SUBAGENT_MODEL=${o.subagentModel} sets only the default subagent model on ` +
        `Claude Code ${routing.version}; the model each spawn names takes precedence`
    )
  }
  if (routing.plainOverrides) {
    banners.push(
      `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=${o.subagentModel} — every agent runs on that model, ` +
        `so the per-tier assignment in the plan is not in effect${unknown}`
    )
  }

  // The control-plane pings ask for haiku only when nothing overrides it and
  // the account can reach it. An override already decides every agent's model;
  // a Bedrock account often cannot reach haiku, and a failed ping halts the loop.
  let pingModel = 'haiku'
  if (routing.forceEffective || routing.plainOverrides) {
    pingModel = null
  } else if (Array.isArray(o.bedrock) && o.bedrock.length) {
    pingModel = null
    notes.push(
      `PING MODEL INHERITED: a Bedrock variable is set (${o.bedrock.join(', ')}), so control-plane pings run on ` +
        'the session model'
    )
  }

  const slots = { ...runtimeSlotsOf(o), vendorDefault: RUNTIME.maxConcurrentAgents }
  if (slots.invalid !== undefined) {
    notes.push(
      `RUNTIME SLOTS OVERRIDE IGNORED: CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=${slots.invalid} is not an ` +
        `integer from ${WORKFLOW_MAX_CONCURRENT_RANGE.min} to ${WORKFLOW_MAX_CONCURRENT_RANGE.max}, so this run ` +
        "reads it as unset; how the runtime reads it is not observed"
    )
  }

  // Claude Code's advisor tool, as `run start` read it from the settings files:
  // spoken as notes and never as a banner, because an unset advisor is the
  // default and a configured one is the operator's choice. Nothing is said when
  // the observation is absent (a manifest or caller that recorded none).
  if (o.advisor && typeof o.advisor === 'object') notes.push(...advisorNotes(o.advisor, { counted: true }))

  return { banners, notes, pingModel, modelSelect: routing.forceEffective ? 'forced' : null, slots }
}

/**
 * Speak every interrupted-run note not yet spoken (design D7), whatever change
 * it names, and mark each spoken. Run start is the moment: the reader is about
 * to spend agents, and the run that was interrupted has no other record of how
 * it ended. Nothing here moves an exit code — the note is outcome-class.
 *
 * @returns {string[]} the banners to carry on the start step
 */
function speakInterruptedNotes(root, manifest) {
  const { notes, unreadable } = readInterruptedNotes(root)
  const banners = []
  for (const note of notes) {
    if (!isUnspoken(note)) continue
    const banner = formatInterruptedBanner(note)
    banners.push(banner)
    manifest.banners.push(banner)
    const marked = markSpoken(root, note.runId)
    if (!marked.marked) {
      manifest.notes.push(
        `INTERRUPTED NOTE NOT MARKED: ${note.file}: ${marked.reason} — it will be spoken again at the next run start`
      )
    }
  }
  for (const entry of unreadable) manifest.notes.push(formatUnreadableNote(entry))
  return banners
}

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
 * @param {{change: string, flags: object, host?: string, hostCapabilities?: object, hostEnv?: object, stateHome?: object, pluginRoot?: string}} input
 *   `pluginRoot` is the plugin directory the host started this run under
 *   (`--plugin-root`); its version is compared with the CLI's (design D18).
 *   `hostEnv` is the Workflow host's observed environment (`observeClaudeEnv`),
 *   passed by `cli/interlock` on that host only. `stateHome` is the state home
 *   `cli/interlock` resolved for this root (`resolveStateHome`, the explicit
 *   `--state-home` applied); resolved here when absent.
 */
export function runStart(ctx, { change, flags, host, hostCapabilities, hostEnv, stateHome, pluginRoot }) {
  const { root } = ctx
  const prior = readManifest(root)
  const manifest = newManifest({ change, flags, host, hostCapabilities, pluginRoot })
  if (prior && Number.isInteger(prior.seq)) manifest.seq = prior.seq
  manifest.banners.push(...versionBanners(manifest))
  const stale = removeStaleClassification(ctx)
  manifest.banners.push(...stale.banners)
  manifest.startSha = readStartSha(ctx)
  // Where this run's corpora go, decided once and recorded (ship/state-home):
  // every later subcommand reads it back off the manifest and never resolves
  // again, so one run uses one home even if git state changes under it.
  const home = settleStateHome(ctx, manifest, stateHome)
  // What the Workflow host's environment means for this run, decided once here
  // and forwarded by the driver (design D2). Only that host's run start passes
  // an observation: a runner's lanes are `claude -p` processes whose top-level
  // model is `--model`, which the subagent-model variables do not govern.
  const carried = { banners: [] }
  if (hostEnv && typeof hostEnv === 'object') {
    const decided = decideHostEnvironment(hostEnv)
    manifest.banners.push(...decided.banners)
    manifest.notes.push(...decided.notes)
    manifest.pingModel = decided.pingModel
    manifest.runtimeSlots = decided.slots
    manifest.hostEnv = hostEnv
    // The same downward-only refinement the effort probe performs. A caller that
    // declared its own model selection keeps it.
    const declared = hostCapabilities && typeof hostCapabilities === 'object' && 'modelSelect' in hostCapabilities
    if (decided.modelSelect === 'forced' && manifest.host && !declared) manifest.host.modelSelect = 'forced'
    carried.banners.push(...decided.banners)
    carried.pingModel = decided.pingModel
  }
  // Said at the start rather than discovered at the first fold. The run still
  // proceeds: on a clean tree with `worktree.baseRef: head`, the first isolated
  // batch forks from HEAD, which is the snapshot, and folds.
  if (manifest.flags.isolateWaves === true && hostCapability(manifest, 'worktree') === 'runtime') {
    manifest.banners.push(ISOLATION_BASE_BANNER)
  }
  carried.banners.push(...home.banners)
  writeManifest(root, manifest)
  carried.banners.push(...speakInterruptedNotes(stateHomeOf(ctx, manifest), manifest))

  return carryStart(startSteps(ctx, manifest, change, stale.halt), carried)
}

/**
 * `CLI VERSION SKEW` and its neighbours (design D18). The skew is a CLI and a
 * plugin that are both readable and differ; a plugin root whose version cannot
 * be read, and a Workflow start handed no plugin root, are checks that could not
 * run, and say so rather than passing.
 */
function versionBanners(manifest) {
  const out = []
  const plugin = manifest.plugin
  if (!plugin) {
    // The Workflow driver forwards the plugin root when it has one; a start
    // without it never compared the two, and a check that did not run is said.
    if (hostId(manifest) === 'workflow') {
      out.push('PLUGIN VERSION NOT CHECKED: run start was given no --plugin-root')
    }
    return out
  }
  const cli = manifest.cli || {}
  if (plugin.version === null) {
    out.push(
      `PLUGIN VERSION UNREADABLE: no version in ${join(plugin.root, '.claude-plugin', 'plugin.json')} — ` +
        'whether this interlock matches the plugin was not checked'
    )
  } else if (typeof cli.version === 'string' && cli.version !== plugin.version) {
    out.push(
      `CLI VERSION SKEW: this run's interlock is ${cli.version} (${cli.path}), the plugin is ` +
        `${plugin.version} (${plugin.root}) — install the matching CLI (npm i -g @renzrollon/interlock@${plugin.version}) ` +
        'or expect behaviour the plugin does not describe'
    )
  }
  return out
}

/**
 * Remove the default classification file a previous run left (design D10).
 *
 * A planner that then writes nothing meets the existing "no readable
 * classified.json" halt, instead of `run classified` reading the old file and
 * dispatching its batches as if this run had planned them. Returns the banner
 * for a removal, or a halt reason when the file cannot be removed.
 */
function removeStaleClassification(ctx) {
  const path = join(ctx.root, CLASSIFIED_PATH)
  const shown = CLASSIFIED_PATH.split(/[\\/]/).join('/')
  let written
  try {
    written = statSync(path).mtime.toISOString()
  } catch (err) {
    if (err && err.code === 'ENOENT') return { banners: [], halt: null }
    written = 'unknown'
  }
  try {
    rmSync(path, { force: true })
  } catch (err) {
    // Not a banner: the run does not start over a file it cannot clear, since
    // `run classified` would read an earlier run's batches as this run's.
    return {
      banners: [],
      halt:
        `stale classification ${shown} (written ${written}) could not be removed ` +
        `(${(err && err.message) || String(err)}) — remove it and run \`interlock run start\` again`
    }
  }
  return {
    banners: [
      `STALE CLASSIFICATION REMOVED: ${shown} (written ${written}) belonged to an earlier run and was removed`
    ],
    halt: null
  }
}

/**
 * Record the state home, the surface, and where the two inputs a worktree run
 * reads through were found (design D14, D16). Returns the banners for the start
 * step; they are on `manifest.banners` as well, so the close carries them.
 *
 * Every input is located root first, then home: a worktree that built its own
 * graph or reconfigured its own profile uses its own, and nothing is ever copied
 * or written into the main checkout. One banner per input at most — the
 * read-through, the absence, or nothing — and the absences are the lines the
 * Workflow driver used to raise from its own `test -f`, which no longer exists:
 * two probes of one file in two places is how a driver and the CLI disagree.
 */
function settleStateHome(ctx, manifest, given) {
  const root = resolve(ctx.root)
  const resolution =
    given && typeof given === 'object' && typeof given.home === 'string' && given.home
      ? given
      : resolveStateHome(root)
  const home = resolve(resolution.home)
  manifest.stateHome = home
  manifest.surface = typeof resolution.surface === 'string' ? resolution.surface : 'unknown'
  manifest.stateHomeReason = typeof resolution.reason === 'string' ? resolution.reason : null
  // How it was decided — the resolver, an explicit setting, a lane worktree or the
  // fallback — so a reader that takes the home off this manifest names it right.
  manifest.stateHomeFrom = typeof resolution.resolvedFrom === 'string' ? resolution.resolvedFrom : null

  const banners = []
  if (manifest.surface === 'unknown' && manifest.stateHomeReason) {
    banners.push(`STATE HOME UNRESOLVED: ${manifest.stateHomeReason}`)
  }
  if (home !== root) {
    manifest.notes.push(
      resolution.resolvedFrom === 'explicit'
        ? `CORPORA IN STATE HOME: ${home} — set by --state-home or INTERLOCK_STATE_HOME; the trajectory, ` +
            `outcome line, metrics and resume card of this run are written there, not in ${root}`
        : `CORPORA IN MAIN CHECKOUT: ${home} — the trajectory, outcome line, metrics and resume card of ` +
            `this run are written there, not in this worktree`
    )
  }

  const profile = locateInput(root, home, TEST_PROFILE_PATH)
  manifest.testProfilePath = profile.path
  manifest.testProfileSource = profile.source
  // The inter-wave verify budget, fixed here and read from the manifest from now
  // on (design D16): a profile an agent in the tree rewrites mid-run moves
  // nothing, in either direction. An unreadable profile derives the published
  // budget, the same as an absent one.
  manifest.verifyBudget = interWaveVerifyBudget(readProfileAt(profile.path))
  if (profile.source === 'state-home') banners.push(`TEST PROFILE FROM MAIN CHECKOUT: ${profile.path}`)
  else if (profile.source === 'none') banners.push(VERIFY_BANNERS.noProfile)

  const graph = locateInput(root, home, GRAPH_FILE_PATH)
  manifest.graphPath = graph.path
  manifest.graphSource = graph.source
  if (graph.source === 'state-home') {
    banners.push(
      `GRAPH FROM MAIN CHECKOUT: ${graph.path} — it may be stale for this worktree; a lane without a ` +
        `graph falls back to grep`
    )
  } else if (graph.source === 'none') {
    banners.push(GRAPH_UNAVAILABLE_BANNER)
  }

  manifest.banners.push(...banners)
  return { home, banners }
}

/**
 * Put what run start decided onto whichever step it returns — a classify, a
 * reused plan's first batch, a close with nothing left, or a halt. The manifest
 * already holds the banners; the step carries them so the driver reports them
 * from the first step on, and carries the ping model so the driver can set it.
 */
function carryStart(step, { banners, pingModel }) {
  if (!step || typeof step !== 'object') return step
  if (banners.length) {
    const rest = (Array.isArray(step.banners) ? step.banners : []).filter(b => !banners.includes(b))
    step.banners = [...banners, ...rest]
  }
  if (pingModel !== undefined) step.pingModel = pingModel
  return step
}

/** Every path out of run start, after the manifest exists. */
function startSteps(ctx, manifest, change, staleHalt = null) {
  const { root } = ctx
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  // A classification that could not be removed would be read as this run's
  // plan, so the run does not start over it (design D10).
  if (staleHalt) return finishStep(ctx, manifest, haltStep(staleHalt))

  // A profile that cannot be used halts here, before a planner is spawned over
  // it (design D14): unreadable, unparseable or invalid, as the doctor's
  // `test-profile` row fails all three. Only an ABSENT profile is not this check;
  // the verify plan speaks that in its skip reasons.
  const invalid = profileHalt(root, manifest)
  if (invalid) return finishStep(ctx, manifest, haltStep(invalid))

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

  // A stored plan that was not reused is named on the start step: the tasks the
  // earlier run finished but did not tick are dispatched again, and a driver or
  // an operator should hear that before the batch, not find it in the summary.
  // A first run (`no-plan`) and a reused plan say nothing here (design D13).
  if (!reuse.reuse && reuse.status !== REUSE_MATCH && reuse.status !== REUSE_NO_PLAN) {
    manifest.banners.push(
      `PLAN REBUILT (${reuse.status}): ${reuse.reason} — tasks the earlier run finished but did not tick ` +
        'are dispatched again'
    )
  }

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
        // effort-routing: "Control-plane and prose spawns SHALL inherit the host's effort".
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
  // On the manifest as well as on the trajectory, so the SessionEnd recorder
  // compares the ending session against one small file (design D7). Absent on a
  // host with no session, which never matches, so that recorder writes nothing.
  const sessionId = hostSessionId(manifest, ctx.env)
  if (sessionId) manifest.sessionId = sessionId
  const slotsBanner = runtimeSlotsBanner(manifest, state)
  if (slotsBanner) manifest.banners.push(slotsBanner)

  const started = appendRunLogEvent(stateHomeOf(ctx, manifest), {
    runId: manifest.runId || undefined,
    change: manifest.change,
    type: 'run-start',
    mode: manifest.flags.mode || 'checkpoint',
    strict: manifest.flags.strict === true,
    host: hostId(manifest) || undefined,
    // `undefined`, not a placeholder: a host with no session records absent, and
    // the run is unaffected either way — nothing downstream reads this to decide
    // anything, and `run-log check` does not require it.
    sessionId: sessionId || undefined,
    // Where this run ran and where its corpora went (ship/state-home). `cwd` is
    // what lets a reader in the main checkout find a worktree run's spill and
    // marker; a manifest written before these existed records none.
    surface: manifest.surface || undefined,
    stateHome: manifest.stateHome || undefined,
    cwd: resolve(root),
    // Which release produced this run (design D17).
    cli: manifest.cli || undefined,
    plugin: manifest.plugin || undefined
  })
  if (!started.written) {
    ctx.warn(`run-start not recorded: ${started.reason}`)
    return trajectoryHaltStep('run-start', started.reason)
  }

  const created = ctx.deps.logWaveMutation(stateHomeOf(ctx, manifest), {
    source: 'create',
    change: manifest.change,
    state
  })
  const { step, ok } = created
  if (!ok) {
    ctx.warn('the wave-state trajectory append failed on run start')
    return trajectoryHaltStep('wave-state create', waveAppendReason(created))
  }
  // The lane spawns, which `logSpawns` deliberately skips (they are logged at
  // the lane, by wave-state). Its verdict is read for the same reason every
  // other append's is: `wave-state next` exits 1 on this exact boolean, and the
  // live path owes the trajectory the same fatality.
  if (!logLaneSpawns(ctx, manifest, state, step, 'next')) {
    ctx.warn('an implementer agent-spawn was not recorded on run start')
    return trajectoryHaltStep('agent-spawn', LANE_SPAWN_APPEND_FAILED)
  }
  const first = decorate(ctx, step, manifest)
  if (slotsBanner && first && typeof first === 'object') {
    first.banners = [...(Array.isArray(first.banners) ? first.banners : []), slotsBanner]
  }
  // The waves that will run, once, for the meter's board (design D3): the
  // state's batches, which a `maxParallel` override re-chunked, with the
  // planner's own deferral records.
  if (first && typeof first === 'object' && first.action !== 'halt') {
    first.plan = summarizePlan(state, { deferred: plan.deferred })
  }
  return first
}

/**
 * `WAVE WIDER THAN RUNTIME SLOTS`, or null (design D5).
 *
 * Raised only against an override the operator set: the vendor's own default is
 * reduced on small machines by an amount it does not publish, and inventing one
 * would be a threshold in prose. The plan is never resized — it is published
 * policy, and the runtime queues the extra lanes — so this only says that lanes
 * will wait, where they would otherwise wait without a word.
 */
function runtimeSlotsBanner(manifest, state) {
  const slots = manifest && manifest.runtimeSlots
  if (!slots || slots.source !== 'env' || !Number.isInteger(slots.observed)) return null
  const waves = state && Array.isArray(state.waves) ? state.waves : []
  let widest = 0
  for (const wave of waves) {
    for (const batch of Array.isArray(wave && wave.batches) ? wave.batches : []) {
      if (Array.isArray(batch) && batch.length > widest) widest = batch.length
    }
  }
  if (widest <= slots.observed) return null
  const queued = widest - slots.observed
  return (
    `WAVE WIDER THAN RUNTIME SLOTS: the widest batch has ${widest} lanes and ` +
    `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=${slots.observed} — ${queued} lane${queued === 1 ? '' : 's'} ` +
    `queue${queued === 1 ? 's' : ''} for a slot; the plan is not resized`
  )
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
  const opened = openRun(ctx, 'classified')
  if (opened.halt) return opened.halt
  const manifest = opened.manifest
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

// A runtime-worktree host forks each isolated lane from `worktree.baseRef`,
// which a plugin can neither read nor set — so the lane's base is whatever that
// names, not the run's snapshot. Bannered at `run start`, named at the halt.
const ISOLATION_BASE_BANNER =
  'ISOLATION BASE NOT CONTROLLED (workflow): the runtime forks lane worktrees from worktree.baseRef, ' +
  "not from the run's snapshot — an isolated batch whose lanes did not fork from the snapshot halts " +
  'with LANE BASE MISMATCH'
const RUNTIME_BASE_HALT =
  'the Workflow runtime chose this base through worktree.baseRef, which a plugin cannot set; ' +
  '--isolate-waves on this host needs the follow-up change that creates lane worktrees from the CLI'

/**
 * The fold candidates whose worktree is not checked out at `base`.
 *
 * Read through git from each worktree, never from the lane's own report: that
 * report is the thing being audited. A lane git cannot answer for is a mismatch
 * only when it reported writes — a clean lane that changed nothing may have had
 * its worktree removed by the runtime, and that is an empty-write lane, not a
 * wrong base. A lane that named no worktree at all is left to `merge-lanes`,
 * which already halts on it as unresolved.
 *
 * @returns {Array<{label: string, head: string|null}>}
 */
function laneBaseMismatches(ctx, candidates, base) {
  const mismatched = []
  for (const lane of candidates) {
    if (!lane.worktreePath) continue
    const head = ctx.deps.worktreeHead(lane.worktreePath)
    if (head === base) continue
    const wrote = Array.isArray(lane.reportedFiles) && lane.reportedFiles.length > 0
    if (!head && !wrote) continue
    mismatched.push({ label: lane.label, head })
  }
  return mismatched
}

/**
 * Fold, adjudicate, record and tick — one CLI call where the loop used to spend
 * three agent turns.
 *
 * A lane with any failed task is neither folded nor ticked, and its worktree is
 * named rather than removed: folding a partial write from a lane that stopped
 * mid-way is exactly the silent-overwrite defect the merge policy refuses.
 */
export function runRecordBatch(ctx, { results, hostRecords }) {
  const { root } = ctx
  const opened = openRun(ctx, 'record-batch')
  if (opened.halt) return opened.halt
  const manifest = opened.manifest
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  // Before anything is recorded (design D14): a profile edited into an invalid
  // shape mid-run used to throw after the state advanced and the boxes were
  // ticked. Now the batch is not recorded, and the run closes naming the file.
  const invalidProfile = profileHalt(root, manifest)
  if (invalidProfile) return finishStep(ctx, manifest, haltStep(invalidProfile))

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

  // Before anything is folded or ticked: an `agent-result` that did not land
  // is a gap in the trajectory, and this batch's ticks must not outrun it.
  const observed = recordSpawnObservations(ctx, manifest, { results, hostRecords, wave: pending.wave })
  if (observed.failure) {
    return finishStep(ctx, manifest, trajectoryHaltStep('agent-result', observed.failure))
  }

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
  // on. The NEXT isolated batch snapshots this tree for its own base — that is
  // how a later batch, and a later wave, sees every fold before it.
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
    // Every lane's base, read from its own worktree before anything folds. A
    // lane forked from anything else reports the difference between the two as
    // its own write, and the whole-file fold silently reverts whatever that
    // difference held — so a wrong base halts the batch, and no lane of it folds.
    const mismatched = base ? laneBaseMismatches(ctx, laneFoldCandidates, base) : []
    if (mismatched.length) {
      const survivors = [
        ...laneFoldCandidates.filter(l => l.worktreePath && existsSync(l.worktreePath)),
        ...laneWorktreesPreserved
      ]
        .map(w => `${w.label}: ${w.worktreePath}`)
        .join('; ')
      return finishStep(ctx, manifest, haltStep(
        'LANE BASE MISMATCH: ' +
          mismatched.map(m => `${m.label} forked from ${m.head || '(unreadable)'}, expected ${base}`).join('; ') +
          ` — no lane of wave ${pending.wave}'s batch was folded` +
          (hostCapability(manifest, 'worktree') === 'runtime' ? ` — ${RUNTIME_BASE_HALT}` : '') +
          ` — surviving worktrees: ${survivors || '(none)'}`,
        { banners }
      ))
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
  const skipped = after.skippedDependents.slice(
    Array.isArray(state.skippedDependents) ? state.skippedDependents.length : 0
  )
  if (skipped.length) {
    banners.push(
      `DEPENDENTS SKIPPED: ${skipped.map(s => `${s.id} (needs ${s.blockedBy.join(', ')})`).join(', ')} — ` +
        `not attempted, not counted as failures, and still unchecked in tasks.md`
    )
  }
  const recorded = ctx.deps.logWaveMutation(stateHomeOf(ctx, manifest), {
    source: 'record-batch',
    change: manifest.change,
    state: after
  })
  const { step: nextRaw, ok: logOk } = recorded
  if (!logOk) {
    // Before the tick and before the commit. The batch result is already on
    // disk (`writeState` above) and there is no undo API for it, so the halt
    // names the gap instead of pretending the state never advanced — close's
    // reconstructability check reads the same trajectory and agrees.
    ctx.warn('the wave-state trajectory append failed on record-batch')
    manifest.banners.push(...banners)
    return finishStep(
      ctx,
      manifest,
      trajectoryHaltStep('wave-state record-batch', waveAppendReason(recorded), { banners })
    )
  }
  // Before the tick and before the commit, exactly like the wave-action above:
  // a batch whose implementer spawns went unrecorded is a batch nobody can
  // attribute, and `emitRecordedState` already exits 1 on this same boolean.
  if (!logLaneSpawns(ctx, manifest, after, nextRaw, 'record-batch')) {
    ctx.warn('an implementer agent-spawn was not recorded on record-batch')
    manifest.banners.push(...banners)
    return finishStep(
      ctx,
      manifest,
      trajectoryHaltStep('agent-spawn', LANE_SPAWN_APPEND_FAILED, { banners })
    )
  }

  // One authority, read once, for the tick and for the tallies alike.
  const verdict = adjudicateBatches([reported], recordedOutcomes(batchOutcomes(state, after)))
  if (verdict.claimDerived) banners.push(claimDerivedBanner())
  if (verdict.overrides.length) banners.push(overrideBanner(verdict.overrides))
  for (const counts of verdict.waves) {
    if (counts.reportRejected) {
      banners.push(
        rejectedBanner(
          counts.reportRejected,
          verdict.rejected,
          rejectedReportReader(state, manifest.flags)
        )
      )
    }
  }

  // The lane that stopped early, plus anything the recorder found no result for
  // at all. Neither is ticked and neither is a failure. One expression for the
  // tally and for the step's `recorded`, so the two cannot disagree (design D2).
  const notAttemptedOf = counts => [
    ...unattempted,
    ...counts.recordedNotAttempted.filter(id => !unattempted.includes(id))
  ]
  verdict.waves.forEach(counts => {
    manifest.waves.push({
      wave: pending.wave,
      kind: pending.action,
      lanes: lanes.length,
      ok: counts.ok,
      failed: counts.failed,
      failedIds: counts.failedIds,
      notAttempted: notAttemptedOf(counts),
      ...(counts.reportRejected ? { reportRejected: counts.reportRejected } : {})
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
  const recordedStep = decorate(ctx, nextRaw, manifest, { banners })
  // What this batch recorded, for the meter's board (design D2): set here, on
  // the step record-batch returns, so no other subcommand can emit it.
  if (recordedStep && typeof recordedStep === 'object') {
    const rejectedIds = verdict.waves.flatMap(counts => counts.reportRejected || [])
    recordedStep.recorded = {
      ok: verdict.tickIds,
      failed: verdict.waves.flatMap(counts => counts.failedIds),
      notAttempted: [...new Set(verdict.waves.flatMap(notAttemptedOf))],
      ...(rejectedIds.length ? { reportRejected: rejectedIds } : {})
    }
  }
  return finishStep(ctx, manifest, recordedStep)
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
export function runJudge(ctx, { context, results, hostRecords }) {
  const { root } = ctx
  const opened = openRun(ctx, 'judge')
  if (opened.halt) return opened.halt
  const manifest = opened.manifest
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  // Outside the waves, but not outside the run's spend (design D9).
  const observed = recordSpawnObservations(ctx, manifest, { results, hostRecords })
  if (observed.failure) {
    return finishStep(ctx, manifest, trajectoryHaltStep('agent-result', observed.failure))
  }

  const state = readState(root)
  const plan = readJson(join(root, WORK_DIR, `vplan-${context}.json`))
  const banners = []

  // Close the interval the verify step opened. This is the other half of the
  // inter-wave verify budget: the step marked when it dispatched, and only this
  // process — the next one — can see how long the agent between them took. An
  // unparseable or negative mark contributes nothing rather than a wrong number,
  // and the mark is cleared either way so it can never be counted twice.
  //
  // What is charged is the checks' own time, as `interlock verify exec` measured
  // it around each command. The interval from dispatch to judgement is only the
  // fallback: it also holds two relays and the verify agent's own turns, and
  // charging those as verification spent the whole budget on the first
  // checkpoint of a Workflow run and left every later one typecheck-only. The
  // fallback is spoken, never silent.
  const timings = readVerifyTimings(root)
  clearVerifyTimings(root)
  if (manifest.verifyStartedAt) {
    const planned = plan && Array.isArray(plan.steps) ? plan.steps : []
    const timed = foldCheckTimings(planned, timings)
    const roundTrip = Date.now() - Date.parse(manifest.verifyStartedAt)
    let charged = null
    if (planned.length && !timed.missing.length) {
      charged = timed.ms
    } else if (Number.isFinite(roundTrip) && roundTrip >= 0) {
      charged = Math.round(roundTrip)
      if (planned.length) {
        banners.push(
          `VERIFY BUDGET CLOCKED BY ROUND TRIP: no \`interlock verify exec\` timing for ` +
            `${timed.missing.join(', ')} — ${charged}ms of relay and agent time counted against ` +
            `the inter-wave verify budget`
        )
      }
    }
    if (charged !== null) {
      manifest.verifyElapsedMs = (numberOrUndefined(manifest.verifyElapsedMs) || 0) + charged
    }
    manifest.verifyStartedAt = null
  }

  // A verification the CLI skipped: no agent ran, so there is nothing to judge.
  // The skip is recorded as the run's own, with the reason the planner gave — a
  // spent budget ahead of whichever kind happens to sit first in `skipped`, so
  // the recorded reason matches the one the step announced.
  let skipped = !plan || !Array.isArray(plan.steps) || !plan.steps.length
  let reason = skipped
    ? (plan && plan.budgetExceeded ? SKIP_REASONS.BUDGET_EXCEEDED : null) ||
      (plan && plan.skipped && plan.skipped[0] && plan.skipped[0].reason) ||
      'no detectable commands'
    : null

  let verdict = null
  const reportedSteps = skipped ? [] : flattenVerifyResults(results)
  // A planned step nobody reported on is NOT VERIFIED, and not verified is
  // not a pass. The judge scores what it is given, so an empty or partial
  // report would otherwise come back clean — which is the completion gate's
  // one failure direction: an absent verdict read as a passing one.
  const unreported = skipped
    ? []
    : plan.steps.map(s => s.kind).filter(kind => !reportedSteps.some(r => r && r.kind === kind))
  if (unreported.length && context !== 'inter-wave') {
    const reason =
      `verification reported no result for ${unreported.join(', ')} — ` +
      `an unverified step is not a passing one, and an unverified run does not commit`
    banners.push(reason)
    manifest.banners.push(...banners)
    return finishStep(ctx, manifest, haltStep(reason, { banners }))
  }
  // At a checkpoint between waves the same absence is a skip, not a stop: the
  // verify agent was lost, not the work, and the final verification still
  // refuses to commit what nobody verified.
  if (unreported.length) {
    skipped = true
    reason =
      `verification reported no result for ${unreported.join(', ')} — the checkpoint is skipped, ` +
      `not passed, and the final verification still gates the commit`
  }
  if (!skipped) {
    verdict = judgeVerification(plan, reportedSteps, { context })
    for (const banner of verdict.banners || []) banners.push(banner)
    if (context === 'final') recordFinalVerdict(root, manifest, verdict, banners)
    const exitFailure = logCliExit(ctx, manifest, 'verify judge', verdict.halt ? 1 : 0)
    if (exitFailure) {
      // The judgement happened; the record of it did not. Halting here is what
      // `verify judge` in cli/interlock already does on the same failure —
      // before the branch into record-verify, the handoff or the commit.
      //
      // A verdict that was ALREADY halting keeps its own reason, the same rule
      // `finishStep` applies below: this run stopped because verification
      // failed, and that reason is what reaches the summary, the push and the
      // resume card. The lost record is a banner beside it, never instead of it.
      banners.push(`TRAJECTORY APPEND FAILED: ${exitFailure}`)
      manifest.banners.push(...banners)
      return finishStep(
        ctx,
        manifest,
        verdict.halt
          ? haltStep(verdict.reason || 'verification halted the run', { banners })
          : trajectoryHaltStep('cli-exit', exitFailure.replace(/^cli-exit /, ''), { banners })
      )
    }
  } else {
    banners.push(`VERIFICATION SKIPPED: reason=${reason}`)
    // Nothing ran, so there is no verdict; what the close reads instead is a
    // verdict-shaped record of WHY, one band per skip reason (design D3 of
    // complete-and-record-the-merge-verdict). Each kind is null, not absent:
    // it did not run.
    if (context === 'final') {
      recordFinalVerdict(
        root,
        manifest,
        {
          context: 'final',
          skipped: plan && Array.isArray(plan.skipped) ? plan.skipped : [],
          unit: null,
          e2e: null,
          coverage: null,
          typecheck: null
        },
        banners
      )
    }
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
    for (const u of after.unresolved.slice(Array.isArray(state.unresolved) ? state.unresolved.length : 0)) {
      banners.push(
        `INTER-WAVE CHECKS UNRESOLVED: ${u.waveKind === 'test' ? 'the test wave' : `wave ${u.wave}`} — ` +
          `${u.errors.length} error(s) still failing after ${u.attempts} fix attempt(s); the run continues, the next ` +
          `wave is told what is failing, and the final verification still gates the commit`
      )
    }
    const verified = ctx.deps.logWaveMutation(stateHomeOf(ctx, manifest), {
      source: 'record-verify',
      change: manifest.change,
      state: after
    })
    const { step: nextRaw, ok } = verified
    manifest.banners.push(...banners)
    if (!ok) {
      ctx.warn('the wave-state trajectory append failed on record-verify')
      return finishStep(
        ctx,
        manifest,
        trajectoryHaltStep('wave-state record-verify', waveAppendReason(verified), { banners })
      )
    }
    // The next wave's first batch is named here, so its lanes are logged here.
    if (!logLaneSpawns(ctx, manifest, after, nextRaw, 'record-verify')) {
      ctx.warn('an implementer agent-spawn was not recorded on record-verify')
      return finishStep(ctx, manifest, trajectoryHaltStep('agent-spawn', LANE_SPAWN_APPEND_FAILED, { banners }))
    }
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

/** The final verdict the run acted on, where the close reads it back. */
const VERIFY_FINAL_FILE = 'verify-final.json'

/**
 * Persist the final verification verdict, stamped with this run's id (design
 * D3, D18 of complete-and-record-the-merge-verdict). It used to be a local of
 * `runJudge`; the close assesses merge confidence from it, in another process.
 * The id is what makes it THIS run's: the working directory is not cleared
 * between runs, and a verdict an earlier run left must not be read as ours.
 *
 * A write that fails loses evidence, not the run: it is spoken and the judge
 * goes on, and the close then reads the verification signals as unobserved.
 */
function recordFinalVerdict(root, manifest, verdict, banners) {
  try {
    writeWork(root, VERIFY_FINAL_FILE, { ...verdict, runId: manifest.runId ?? null })
  } catch (err) {
    banners.push(
      `MERGE EVIDENCE UNAVAILABLE: the final verification verdict — it could not be recorded ` +
        `(${(err && err.message) || String(err)})`
    )
  }
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
  // The living requirements the change is asked to confirm (design D5 of
  // complete-and-record-the-merge-verdict), and how many: `null` when
  // conformance is off, or when no list could be built at all.
  let living = null
  let livingCount = null
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

    // The same selection, base and bound the review step gives the `domain`
    // reviewer, so the two can never disagree about which requirements are in
    // force. Skipped and partial are each said once per run, as the two
    // `DOMAIN REVIEW` banners are; a graph that links nothing is an empty list
    // and says nothing. A living spec the base could not be read for is a list
    // nobody could build, and is said as a skip rather than counted as zero.
    const domain = gatherDomain(ctx, manifest, changedPaths)
    const list = buildLivingChecklist({ selection: domain.selection, assembled: domain.assembled })
    const unread = domain.readErrors.length ? `a living spec could not be read (${domain.readErrors.join('; ')})` : null
    const skipReason = list.skipped || unread
    if (skipReason) {
      const banner = `LIVING CONFORMANCE SKIPPED: ${skipReason}`
      raiseOnce(manifest, banner)
      extra.push(banner)
    } else {
      living = list.requirements
      livingCount = list.requirementsRequired
      if (list.partial) {
        const banner = `LIVING CONFORMANCE PARTIAL: ${list.partial}`
        raiseOnce(manifest, banner)
        extra.push(banner)
      }
    }
  }

  return makeStep({
    action: 'handoff',
    banners: extra,
    needsManualTestPlan,
    scenarios: scenarios ? scenarios.length : null,
    living: livingCount,
    then: { argv: ['run', 'commit'] },
    spawns: [
      spawn(root, {
        label: 'handoff',
        kind: 'handoff',
        model: null,
        // effort-routing: "Control-plane and prose spawns SHALL inherit the host's effort".
        effort: null,
        schema: HANDOFF_RESULT_SCHEMA,
        prompt: assembleHandoffPrompt({
          change,
          needsManualTestPlan,
          testPlanReason,
          conformance: scenarios,
          learnings: manifest.flags.handoff === true,
          ...(living ? { living } : {})
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
        // effort-routing: "Control-plane and prose spawns SHALL inherit the host's effort".
        effort: null,
        schema: COMMIT_SCHEMA,
        prompt: assembleCommitPrompt({
          change: manifest.change,
          stageIndex: ++manifest.stageIndex,
          notesPath: manifest.notesPath || null
        })
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
export function runCommit(ctx, { results, hostRecords }) {
  const { root } = ctx
  const opened = openRun(ctx, 'commit')
  if (opened.halt) return opened.halt
  const manifest = opened.manifest
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  // Outside the waves, but not outside the run's spend (design D9).
  const observed = recordSpawnObservations(ctx, manifest, { results, hostRecords })
  if (observed.failure) {
    return finishStep(ctx, manifest, trajectoryHaltStep('agent-result', observed.failure))
  }

  const reported = results && results[0] && typeof results[0] === 'object' ? results[0] : null
  const count = value => (Number.isInteger(value) ? value : undefined)
  manifest.handoff = reported
    ? {
        ok: reported.ok === true,
        manualTestPlan: reported.manualTestPlan === true,
        skipReason: typeof reported.skipReason === 'string' ? reported.skipReason : undefined,
        learnings: count(reported.learnings),
        scenariosChecked: count(reported.scenariosChecked),
        scenariosUnconfirmed: count(reported.scenariosUnconfirmed),
        // The living requirements, beside the scenarios (design D5 of
        // complete-and-record-the-merge-verdict). Absent stays absent: a count
        // nobody reported is not a count of zero.
        requirementsChecked: count(reported.requirementsChecked),
        requirementsUnconfirmed: count(reported.requirementsUnconfirmed)
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
  const opened = openRun(ctx, 'verify-final')
  if (opened.halt) return opened.halt
  const manifest = opened.manifest
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)
  return finishStep(ctx, manifest, finalVerifyStep(ctx, manifest))
}

// --- run replan -------------------------------------------------------------

/** Apply a revision the replan step produced, or carry on with the next step. */
export function runReplan(ctx, { results, hostRecords }) {
  const { root } = ctx
  const opened = openRun(ctx, 'replan')
  if (opened.halt) return opened.halt
  const manifest = opened.manifest
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)

  // Outside the waves, but not outside the run's spend (design D9).
  const observed = recordSpawnObservations(ctx, manifest, { results, hostRecords })
  if (observed.failure) {
    return finishStep(ctx, manifest, trajectoryHaltStep('agent-result', observed.failure))
  }

  const state = readState(root)
  if (!state) return finishStep(ctx, manifest, haltStep('the run state could not be read'))

  const revised = results && results[0] && results[0].revised === true
  const groups = revised ? readJson(join(root, REPLAN_PATH)) : null
  if (!revised || !Array.isArray(groups)) {
    // Nothing to revise is the ordinary outcome, and re-reading the state is
    // how the loop moves past a replan offer it declined.
    const declined = nextStep(state)
    if (!logLaneSpawns(ctx, manifest, state, declined, 'replan')) {
      ctx.warn('an implementer agent-spawn was not recorded on replan')
      return finishStep(ctx, manifest, trajectoryHaltStep('agent-spawn', LANE_SPAWN_APPEND_FAILED))
    }
    return finishStep(ctx, manifest, decorate(ctx, declined, manifest))
  }

  let after
  try {
    after = applyReplan(state, groups)
  } catch (err) {
    return finishStep(ctx, manifest, haltStep(`replan rejected: ${(err && err.message) || String(err)}`))
  }
  writeState(root, after)
  const replanned = ctx.deps.logWaveMutation(stateHomeOf(ctx, manifest), {
    source: 'replan',
    change: manifest.change,
    state: after
  })
  const { step: nextRaw, ok } = replanned
  if (!ok) {
    ctx.warn('the wave-state trajectory append failed on replan')
    return finishStep(ctx, manifest, trajectoryHaltStep('wave-state replan', waveAppendReason(replanned)))
  }
  if (!logLaneSpawns(ctx, manifest, after, nextRaw, 'replan')) {
    ctx.warn('an implementer agent-spawn was not recorded on replan')
    return finishStep(ctx, manifest, trajectoryHaltStep('agent-spawn', LANE_SPAWN_APPEND_FAILED))
  }
  const revisedStep = decorate(ctx, nextRaw, manifest)
  // The revised waves replace the adopted ones on the meter's board (design D3).
  if (revisedStep && typeof revisedStep === 'object' && revisedStep.action !== 'halt') {
    revisedStep.plan = summarizePlan(after)
  }
  return finishStep(ctx, manifest, revisedStep)
}

// --- run next ---------------------------------------------------------------

/** Re-read the state and re-emit its step. A pure re-read; it decides nothing. */
export function runNext(ctx) {
  const { root } = ctx
  const opened = openRun(ctx, 'next')
  if (opened.halt) return opened.halt
  const manifest = opened.manifest
  const capped = countStep(root, manifest)
  if (capped) return recordThen(root, manifest, capped)
  const state = readState(root)
  if (!state) return finishStep(ctx, manifest, haltStep('the run state could not be read'))
  // A re-read that names a batch is a batch the driver will dispatch again, so
  // those agents are spawns like any other.
  const pending = nextStep(state)
  if (!logLaneSpawns(ctx, manifest, state, pending, 'next')) {
    ctx.warn('an implementer agent-spawn was not recorded on next')
    return finishStep(ctx, manifest, trajectoryHaltStep('agent-spawn', LANE_SPAWN_APPEND_FAILED))
  }
  return finishStep(ctx, manifest, decorate(ctx, pending, manifest))
}

// --- helpers used by every subcommand ---------------------------------------

/**
 * The words for a manifest that exists and is not one this CLI can use
 * (design D11). A foreign manifest is a run another release started; an
 * unparseable one is a file somebody or something damaged. Neither is "no
 * manifest", and saying so sends the operator to look for a missing
 * `run start` that happened.
 */
function describeUnusableManifest(inspected) {
  const file = MANIFEST_PATH
  const cli = cliVersion() || 'unknown'
  if (inspected.status === 'foreign') {
    return (
      `the run manifest ${file} carries schema ${inspected.schema === null ? '(none)' : inspected.schema}, ` +
      `and this interlock (${cli}) reads ${RUN_SCHEMA} — this run was started by a different Interlock CLI; ` +
      'close it with that version, or run `interlock run start` to begin a new run'
    )
  }
  return (
    `the run manifest ${file} is unreadable (${inspected.reason || 'it could not be parsed'}) — ` +
    'it exists, so this is not a missing `interlock run start`; restore it, or run `interlock run start` ' +
    'to begin a new run'
  )
}

function noManifest(ctx, inspected = inspectManifest(ctx.root)) {
  if (inspected.status === 'foreign' || inspected.status === 'unparseable') {
    return haltStep(describeUnusableManifest(inspected))
  }
  const elsewhere = manifestInStateHome(ctx.root)
  if (elsewhere) {
    return haltStep(
      `no run manifest at ${elsewhere.here} — one exists at ${elsewhere.there}; if this session moved into ` +
        `a worktree after run start, the run continues from there`
    )
  }
  return haltStep(
    `no run manifest at ${MANIFEST_PATH} — a run subcommand was reached without \`interlock run start\``
  )
}

// Steps a closed run refused. A refusal writes nothing, so `cli/interlock` must
// not copy it to LAST_STEP_PATH and `stampStep` must not number it: a driver
// that called the wrong subcommand against a finished run changed nothing, and
// the record of the step it last read is still the true one.
const REFUSALS = new WeakSet()

/** Was this step a refusal of a closed run (`refuseClosed`)? */
export function isRefusal(step) {
  return Boolean(step) && typeof step === 'object' && REFUSALS.has(step)
}

/** The state a manifest says its run ended in, or null for a run still in progress (design D15). */
function closedState(manifest) {
  if (typeof manifest.halted === 'string' && manifest.halted) return `halted: ${manifest.halted}`
  if (manifest.halted) return `halted: ${String(manifest.halted)}`
  if (manifest.closedAt) return 'closed'
  return null
}

function refuseClosed(manifest, sub, state) {
  const step = haltStep(
    `run ${sub} refused: run ${manifest.runId || '(no run id)'} already ${state} — ` +
      'start a new run with `interlock run start`'
  )
  REFUSALS.add(step)
  return step
}

/**
 * A manifest field an earlier release did not write, defaulted out loud
 * (design D36). Each field is raised once per run: `defaultedFields` records it
 * on the manifest, which the step that follows persists.
 */
function speakDefaulted(ctx, manifest) {
  const spoken = Array.isArray(manifest.defaultedFields) ? manifest.defaultedFields : []
  const raise = (field, using) => {
    if (spoken.includes(field)) return
    spoken.push(field)
    manifest.banners = Array.isArray(manifest.banners) ? manifest.banners : []
    manifest.banners.push(
      `MANIFEST FIELD DEFAULTED: ${field} absent (written by an earlier release); using ${using}`
    )
  }
  if (!manifest.verifyBudget) {
    raise('verifyBudget', `the published inter-wave verify budget (${LIMITS.interWaveVerifyBudgetMs} ms)`)
  }
  if (typeof manifest.stateHome !== 'string' || !manifest.stateHome) {
    raise('stateHome', `the working root ${resolve(ctx.root)}`)
  }
  manifest.defaultedFields = spoken
}

/**
 * Open the run a non-start, non-close subcommand works on. Returns `{ manifest }`
 * to proceed, or `{ halt }` — a step to return as it is, having written nothing.
 *
 * Refused here, before the subcommand reads or writes anything: no manifest, a
 * manifest this CLI cannot read (named, never "absent"), and a run that already
 * halted or closed.
 */
function openRun(ctx, sub) {
  const inspected = inspectManifest(ctx.root)
  if (inspected.status !== 'ok') return { halt: noManifest(ctx, inspected) }
  const manifest = inspected.manifest
  const state = closedState(manifest)
  if (state) return { halt: refuseClosed(manifest, sub, state) }
  speakDefaulted(ctx, manifest)
  return { manifest }
}

/**
 * A manifest the state home holds when this root holds none (design D18): a
 * session that moved into a worktree after `run start` halts naming both, and
 * one that did not sees today's message. Resolved here because there is no
 * manifest to read a recorded home from.
 */
function manifestInStateHome(root) {
  const here = resolve(root)
  const { home } = resolveStateHome(here)
  if (!home || resolve(home) === here) return null
  const there = join(home, MANIFEST_PATH)
  return existsSync(there) ? { here: join(here, MANIFEST_PATH), there } : null
}

/**
 * Persist what this step observed and record the continuation it names.
 *
 * Every step-yielding call goes through here, so a field an earlier step
 * accumulated (a banner, a wave row, the stage index) survives into the next
 * process — each `run` subcommand is its own.
 */
function finishStep(ctx, manifest, step) {
  carryRaisedBanners(manifest, step)
  recordDispatched(manifest, step)
  const failure = logSpawns(ctx, manifest, step)
  // An agent-spawn nobody recorded is a gap in the trajectory, and the step it
  // belongs to must not run. A step that was ALREADY halting keeps its own
  // reason: replacing it would trade why the run stopped for the bookkeeping
  // failure that followed, and it halts either way.
  const final =
    failure && step.action !== 'halt'
      ? trajectoryHaltStep('agent-spawn', failure.replace(/^agent-spawn /, ''), {
          ...(Array.isArray(step.banners) ? { banners: step.banners } : {})
        })
      : step
  return recordThen(ctx.root, manifest, final)
}

/**
 * Put on the step every banner the run raised since the last step carried one
 * (draw-the-ship-run-live, design D1).
 *
 * A banner pushed onto `manifest.banners` reaches the close summary whatever
 * happens; this makes sure it reaches a step as well, so a reader of the step
 * stream (the ship meter) displays what the CLI named instead of discovering it
 * at close. Derived from the same list the summary prints, in its order, and
 * additive: a step's own banners stay first, nothing already carried is raised
 * again. `bannersCarried` is how far into the list the steps have reached.
 */
function carryRaisedBanners(manifest, step) {
  if (!step || typeof step !== 'object' || !Array.isArray(manifest.banners)) return
  const from = Number.isInteger(manifest.bannersCarried) ? manifest.bannersCarried : 0
  const raised = manifest.banners.slice(from)
  manifest.bannersCarried = manifest.banners.length
  const own = Array.isArray(step.banners) ? step.banners : []
  const missing = raised.filter((b, i) => typeof b === 'string' && !own.includes(b) && raised.indexOf(b) === i)
  if (missing.length) step.banners = [...own, ...missing]
}

/**
 * The join table for the close (design D4): every spawn on the step, lane
 * spawns included, with the sha its bootstrap carries. Only once the run has an
 * id — the same rule `logSpawns` follows — because the recorder writes nothing
 * for a spawn dispatched before one, so it could never join. Bounded by the
 * published step cap times the batch width, so it needs no cap of its own.
 */
function recordDispatched(manifest, step) {
  if (!manifest.runId || !step || !Array.isArray(step.spawns) || !step.spawns.length) return
  if (!Array.isArray(manifest.dispatched)) manifest.dispatched = []
  for (const s of step.spawns) {
    manifest.dispatched.push({
      wave: Number.isInteger(step.wave) ? step.wave : null,
      label: s.label,
      kind: s.kind,
      model: s.model || null,
      sha: typeof s.promptSha256 === 'string' ? s.promptSha256 : null
    })
  }
}

// --- merge confidence at close (complete-and-record-the-merge-verdict) -------
//
// A completed run states its merge verdict once, from facts it observed: the
// input is gathered by the function the `merge-confidence` command calls
// (`lib/merge-evidence.mjs`), so the two cannot assemble it differently. The
// verdict is reported — in the summary, the receipt, the outcome record and an
// evidence file — and never enforced: nothing here touches the exit code.

/** The run's evidence file, beside `review.json` in the working root (design D9). */
const MERGE_EVIDENCE_FILE = 'merge-confidence.json'

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** One thing the gather could not read, as the degradation block says it (design D1). */
function mergeEvidenceBanner(note) {
  if (typeof note === 'string') return `MERGE EVIDENCE UNAVAILABLE: ${note}`
  const what = note && typeof note.what === 'string' && note.what ? note.what : 'a fact'
  const reason = note && typeof note.reason === 'string' && note.reason ? note.reason : 'no reason was given'
  return `MERGE EVIDENCE UNAVAILABLE: ${what} — ${reason}`
}

/**
 * Assess one gathered input. With no start commit the run has no base, and the
 * module's readers say so in the command's words: the `--base` input was not
 * given. A run has no flags, so the close adds what that means here — the base
 * a ship run reads is its start commit, and this one recorded none (design D2).
 * Evidence only: recombining the same bands and flags yields the same verdict
 * and score.
 */
function assessForRun(input, base) {
  const assessed = assessMergeConfidence(input)
  if (base) return assessed
  const line = 'a ship run reads its base from its start commit, and this run recorded no start commit'
  return combineSignals(
    assessed.signals.map(signal =>
      /--base\b/.test(signal.reason) ? { ...signal, evidence: [...signal.evidence, line] } : signal
    )
  )
}

/**
 * Gather and assess at close (design D2). Throws when the gather or the module
 * does; the caller speaks that as `MERGE CONFIDENCE NOT ASSESSED`.
 *
 * What the run hands in is only what THIS run observed (design D18): the
 * working directory is not cleared between runs, so `review.json` is read only
 * when this run adjudicated a review, and `verify-final.json` only when it
 * carries this run's id. No pipeline input, ever: the run is offline and no
 * platform has seen the commit it just made.
 *
 * @returns {{ input: object, assessment: object, notes: Array, base: string|null, headSha: string|null,
 *   committed: boolean, evidence: { review: any, verify: any, handoff: any, coverage: any, run: object } }}
 */
function assessAtClose(ctx, manifest, { touchedPaths, run }) {
  const { root } = ctx
  const deps = ctx.deps && typeof ctx.deps === 'object' ? ctx.deps : {}
  const has = name => typeof deps[name] === 'function'
  const notes = []
  const base = pinnedSha(manifest)

  // The commit the run made. The step reports the sha; HEAD, where this host
  // can read it, supplies the full form of the same commit. A run told not to
  // commit, and one whose commit step failed, are still on their start commit.
  const commit = manifest.commit && manifest.commit.ok === true ? manifest.commit : null
  const committed = Boolean(commit)
  const reported = commit && typeof commit.sha === 'string' && commit.sha ? commit.sha : null
  let head = null
  try {
    head = has('headCommit') ? deps.headCommit(root) : null
  } catch {
    head = null
  }
  if (typeof head !== 'string' || !head) head = null
  const headSha = committed ? (reported && head && head.startsWith(reported) ? head : reported || head) : head || base

  // The commit's own touched paths; the working tree's changed paths when the
  // run made no commit or its commit could not be read (design D14).
  let changedPaths = Array.isArray(touchedPaths) ? touchedPaths : null
  if (!changedPaths) {
    try {
      const observed = has('observedChangedPaths') ? deps.observedChangedPaths(root) : []
      changedPaths = Array.isArray(observed) ? observed : []
    } catch {
      changedPaths = []
    }
  }

  let review = null
  if (manifest.review) {
    review = readJson(join(root, WORK_DIR, 'review.json'))
    if (!isRecord(review)) {
      review = null
      notes.push({
        what: 'the review record',
        reason: `this run adjudicated a review and ${join(WORK_DIR, 'review.json')} could not be read back`
      })
    }
  }

  let verify = null
  const recorded = readJson(join(root, WORK_DIR, VERIFY_FINAL_FILE))
  if (isRecord(recorded) && typeof manifest.runId === 'string' && manifest.runId && recorded.runId === manifest.runId) {
    const { runId: _stamp, ...verdict } = recorded
    verify = verdict
  }

  // Coverage figures, computed where the verdict says the coverage command ran,
  // so the report read is this run's (design D3). A reason is a note; the
  // signal's own fallbacks then apply.
  let coverage = null
  if (verify && isRecord(verify.coverage)) {
    const unavailable = reason => notes.push({ what: 'the coverage figures', reason })
    if (!base) {
      unavailable('this run recorded no start commit to compute them against')
    } else if (!has('coverageInput')) {
      unavailable('no coverageInput function was supplied, so this host has no means of computing them')
    } else {
      try {
        const answer = deps.coverageInput(root, { base })
        if (isRecord(answer) && isRecord(answer.input)) coverage = answer.input
        else {
          unavailable(
            isRecord(answer) && typeof answer.reason === 'string' && answer.reason
              ? answer.reason
              : 'the computation returned neither figures nor a reason'
          )
        }
      } catch (err) {
        unavailable((err && err.message) || String(err))
      }
    }
  }

  // Git, as this host supplies it. A missing function is the gather's to note.
  const git = {}
  for (const name of ['diffShape', 'nameStatus', 'listFiles', 'readAtRef', 'gitText']) {
    if (has(name)) git[name] = deps[name]
  }
  if (!committed && base) {
    // The head is still the start commit, so the diff is empty by construction
    // and says nothing about the change (design D14). Said in the run's terms.
    git.diffShape = () => ({
      base,
      paths: [],
      nothingToDiff:
        `the run made no commit, so ${shortSha(base)}...HEAD is empty by construction and says nothing about the change`
    })
  }

  const evidence = { review, verify, handoff: isRecord(manifest.handoff) ? manifest.handoff : null, coverage, run }
  const gather = has('gatherMergeEvidence') ? deps.gatherMergeEvidence : gatherMergeEvidence
  const gathered = gather(root, {
    change: manifest.change,
    changedPaths,
    base,
    headSha,
    supplied: { ...evidence, pipeline: null },
    deps: git,
    // The graph the run selected living requirements from at the handoff, so
    // the close recounts the same denominator (design D16).
    ...(typeof manifest.graphPath === 'string' && manifest.graphPath ? { graphPath: manifest.graphPath } : {})
  })
  if (!isRecord(gathered) || !isRecord(gathered.input)) throw new Error('the gather returned no input to assess')
  if (Array.isArray(gathered.notes)) notes.push(...gathered.notes)

  return {
    input: gathered.input,
    assessment: assessForRun(gathered.input, base),
    notes,
    base,
    headSha,
    committed,
    evidence
  }
}

// --- run close (design D10) -------------------------------------------------

// Closes that were a replay of the close already on record. Like REFUSALS, a
// replay wrote nothing: `stampStep` must not number it (that would rewrite the
// manifest), and `cli/interlock` need not re-keep it at LAST_CLOSE_PATH.
const CLOSE_REPLAYS = new WeakSet()

/** Was this close a replay of an earlier close (`closeAlreadyOnRecord`)? */
export function isCloseReplay(step) {
  return Boolean(step) && typeof step === 'object' && CLOSE_REPLAYS.has(step)
}

/**
 * The close of a run that already closed: what `run close` returns, having
 * recorded nothing — no manifest, trajectory, outcome row, push or resume card.
 *
 * The copy `cli/interlock` kept at LAST_CLOSE_PATH is returned as it is, so the
 * original exit code, summary and halt reason are what the caller sees. A copy
 * that is missing, unreadable or another run's cannot be returned; the close is
 * then built from the manifest and says so, in a banner and in the summary.
 *
 * The one thing removed is a stage marker that outlived the recorded close: it
 * still denies `git commit`, and `run close --halt` is the documented way to
 * clear it. A removal is said in a banner on the returned copy.
 */
function closeAlreadyOnRecord(ctx, manifest) {
  const closedAt = manifest.closedAt
  const stageBanners = clearLingeringStage(ctx, manifest)
  let reason
  try {
    const recorded = JSON.parse(readFileSync(join(ctx.root, LAST_CLOSE_PATH), 'utf8'))
    const usable =
      recorded &&
      typeof recorded === 'object' &&
      !Array.isArray(recorded) &&
      (recorded.action === 'complete' || recorded.action === 'halt') &&
      Number.isInteger(recorded.exitCode) &&
      typeof recorded.summary === 'string'
    if (!usable) reason = `${LAST_CLOSE_PATH} does not hold a close step`
    else if (manifest.runId && !recorded.summary.includes(manifest.runId)) {
      reason = `${LAST_CLOSE_PATH} belongs to another run than ${manifest.runId}`
    } else {
      const replay = stageBanners.length
        ? { ...recorded, banners: [...(Array.isArray(recorded.banners) ? recorded.banners : []), ...stageBanners] }
        : recorded
      CLOSE_REPLAYS.add(replay)
      return replay
    }
  } catch (err) {
    reason = `${LAST_CLOSE_PATH} could not be read: ${(err && err.code === 'ENOENT') ? 'it is absent' : (err && err.message) || String(err)}`
  }
  const halted = typeof manifest.halted === 'string' && manifest.halted ? manifest.halted : null
  const when = closedAt ? `at ${closedAt}` : 'by an earlier release, which recorded no close time'
  const headline = `run ${manifest.runId || '(no run id)'} was already closed ${when} — this close recorded nothing`
  const banners = [
    `CLOSE ALREADY RECORDED: ${headline}`,
    `ORIGINAL CLOSE UNAVAILABLE: ${reason}; its summary and exit code cannot be shown, so this one exits 1`,
    ...stageBanners
  ]
  const step = {
    schema: STEP_SCHEMA,
    action: halted ? 'halt' : 'complete',
    cliVersion: cliVersion(),
    then: null,
    spawns: [],
    // Unknown is not success: a close nobody can read back is reported failed.
    exitCode: 1,
    banners,
    summary:
      `${headline}.\n\n` +
      (halted ? `The run halted: ${halted}\n` : '') +
      `The original close's summary is not on record (${reason}); the trajectory ` +
      `(interlock run-log show ${manifest.runId || '<runId>'}) holds the run's receipt.\n` +
      `  run: ${manifest.runId || '(none)'}\n  closed: ${closedAt || 'unrecorded'}`
  }
  CLOSE_REPLAYS.add(step)
  return step
}

/** Remove a closed run's stage marker, if one is still there; the banners that say so. */
function clearLingeringStage(ctx, manifest) {
  if (typeof manifest.change !== 'string' || !manifest.change) return []
  const marker = stagePath(manifest.change, ctx.root)
  if (!existsSync(marker)) return []
  const shown = stagePath(manifest.change, '.').split(/[\\/]/).join('/')
  const cleared = clearStage(manifest.change, { root: ctx.root })
  return cleared.ok
    ? [`STAGE MARKER CLEARED: ${shown} outlived the recorded close and no longer arms the commit guard`]
    : [`STAGE MARKER NOT CLEARED: ${cleared.warning}`]
}

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
  {
    results = [],
    halt = null,
    hostBanners = [],
    hostObserved = null,
    hostRecords = [],
    notify = false,
    env = process.env
  } = {}
) {
  const { root } = ctx
  const absRoot = resolve(root)
  const slug = projectSlug(absRoot)
  const inspected = inspectManifest(root)
  const manifest = inspected.status === 'ok' ? inspected.manifest : null
  if (!manifest && (inspected.status === 'foreign' || inspected.status === 'unparseable')) {
    return closeUnusableManifest(ctx, absRoot, slug, inspected, { halt, hostBanners, notify, env })
  }
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
    // Where a record would have gone, so the reader can look there (ship/close-summary).
    const home = resolve(resolveStateHome(absRoot).home)
    const elsewhere = home !== absRoot && existsSync(join(home, MANIFEST_PATH)) ? join(home, MANIFEST_PATH) : null
    const rows = [
      '  run: none — the run halted before a plan was adopted',
      `  project: ${slug}`,
      `  cwd: ${absRoot}`,
      ...(home !== absRoot ? [`  state home: ${home}`] : [])
    ]
    if (push && push.sent !== undefined) {
      rows.push(push.sent ? '  push: sent (ntfy)' : `  push: failed — ${push.reason}`)
    }
    return {
      schema: STEP_SCHEMA,
      action: 'halt',
      cliVersion: cliVersion(),
      then: null,
      spawns: [],
      exitCode: 1,
      banners: Array.isArray(hostBanners) ? hostBanners : [],
      summary:
        `${headline}\n\n` +
        (elsewhere
          ? `There is no run manifest at ${join(absRoot, MANIFEST_PATH)} — one exists at ${elsewhere}; if ` +
            `this session moved into a worktree after run start, the run continues from there.\n`
          : `There is no run manifest at ${MANIFEST_PATH}, so nothing was recorded for this run.\n`) +
        rows.join('\n')
    }
  }

  // A run that already closed is closed once (design D15). A refusal of a
  // closed run names `run close --halt <reason>` as its continuation, so a driver
  // that obeys it lands here; recording a second receipt, run-halt and outcome
  // row, and overwriting the original halt reason, would turn a clean run into
  // two contradictory ones. Nothing is written: the close on record is returned.
  // A halted close by 1.7.0 or earlier recorded no `closedAt`; it is told from a
  // halt still waiting for its close (the run-step cap) by the continuation the
  // close cleared.
  if (manifest.closedAt || (manifest.halted && manifest.lastThen === null)) {
    return closeAlreadyOnRecord(ctx, manifest)
  }

  const haltReason = typeof halt === 'string' && halt.trim() ? halt.trim() : manifest.halted || null
  if (haltReason) manifest.halted = haltReason
  // Corpora go to the home `run start` recorded; the manifest, the state and the
  // sidecar stay in the root (ship/state-home).
  const home = stateHomeOf(ctx, manifest)

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

  // What the recorder hooks wrote for this run, joined to the spawns this program
  // dispatched (ship/agent-results). Decided here, before the summary and the
  // degradation block are assembled, so its banners reach both.
  const joined = joinAgentUsage(root, manifest)
  const closeObserved = observeJoinedAgents(manifest, joined)
  const advisorClose = advisorCloseLine(manifest, joined)
  // The committer's host record, on a runner: the commit step's continuation is
  // this close, so its lane is observed here. Usage is left as it was — the close
  // has never counted the committer's results — and only the host's record is read.
  const committerObserved = recordSpawnObservations(ctx, manifest, { results: [], hostRecords })
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
    hostCapability(manifest, 'cacheAccounting') === false &&
    closeObserved.usable === 0
  ) {
    manifest.notes.push(
      `CACHE ACCOUNTING NOT REPORTED: the ${hostId(manifest) || 'run'} host's runtime exposes no ` +
        `cache decomposition, so every wave's cache-read and cache-creation figures are recorded ` +
        `as unknown rather than as a measured zero`
    )
  }

  const useJoin = joined.present && joined.cacheFromHooks && joined.briefed > 0
  const summary = {
    waves: manifest.waves || [],
    spend: hostSpend || counted.spend,
    outputTokens: hostTotal !== undefined ? hostTotal : counted.outputTokens,
    cacheReadInputTokens:
      hostCacheRead !== undefined
        ? hostCacheRead
        : useJoin
          ? joined.runCache.cacheReadInputTokens
          : counted.cacheReadInputTokens,
    cacheCreationInputTokens:
      hostCacheCreation !== undefined
        ? hostCacheCreation
        : useJoin
          ? joined.runCache.cacheCreationInputTokens
          : counted.cacheCreationInputTokens,
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
    paths: readPathSets(root, manifest),
    // Absent on a run whose manifest predates the field: stays absent, never zero.
    ...(manifest.verifyBudget ? { verifyBudget: manifest.verifyBudget } : {})
  }
  // The join's per-wave cache figures, where the host observed none (design D5).
  if (useJoin) summary.spend = fillJoinedCache(summary.spend, joined.cacheByWave)

  const degradations = degradationLines({
    banners: manifest.banners || [],
    closing,
    hostBanners: Array.isArray(hostBanners) ? hostBanners : []
  })
  // One banner for the last adjudication's proof (N2): spoken, never a second review.
  if (manifest.reviewProofBanner) degradations.push(manifest.reviewProofBanner)

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

  // The six observation counts: absent when the run saw no host record and no
  // sidecar, a measured zero otherwise (design D8).
  const runnerCounts = manifest.agentCounts && typeof manifest.agentCounts === 'object' ? manifest.agentCounts : null
  const observedAny = Boolean(runnerCounts) || joined.present
  const count = (value = 0) => (observedAny ? value : undefined)

  // Merge confidence, once, on a completed run only (design D2): a diff that
  // stopped part-way is not a candidate for merging, and "never assessed" must
  // stay distinguishable from a low score. Before the receipt, which carries
  // the verdict. A failed assessment is spoken and changes no exit code
  // (design D17): it is the outcome-corpus class of failure.
  let merge = null
  if (!haltReason) {
    try {
      merge = assessAtClose(ctx, manifest, {
        touchedPaths: summary.paths.touchedPaths,
        run: {
          halted: false,
          trajectoryComplete: !committerObserved.failure,
          stageMarkerGaps: degradations.filter(b => typeof b === 'string' && b.startsWith('STAGE MARKER NOT PUBLISHED'))
            .length,
          rejectedReports: rejectedReportsOfRun(root).length,
          permissionPrompts: count(closeObserved.permissionPrompts) ?? null,
          autoModeDenials: count(closeObserved.autoModeDenials) ?? null,
          leftoverTasks: leftoverTaskIds.length
        }
      })
      for (const note of merge.notes) degradations.push(mergeEvidenceBanner(note))
    } catch (err) {
      merge = null
      degradations.push(`MERGE CONFIDENCE NOT ASSESSED: ${(err && err.message) || String(err)}`)
    }
  }

  const receipt = buildReceipt({
    change: manifest.change,
    summary,
    degradations,
    planFingerprint,
    leftoverTaskIds,
    mergeConfidence: merge ? merge.assessment : undefined,
    lanesStoppedByHost: count(runnerCounts ? runnerCounts.lanesStoppedByHost : 0),
    schemaResultsMissing: count(runnerCounts ? runnerCounts.schemaResultsMissing : 0),
    toolsDeniedInLanes: count(runnerCounts ? runnerCounts.toolsDeniedInLanes : 0),
    modelSubstitutions: count((runnerCounts ? runnerCounts.modelSubstitutions : 0) + closeObserved.substitutions),
    permissionPrompts: count(closeObserved.permissionPrompts),
    autoModeDenials: count(closeObserved.autoModeDenials),
    surface: manifest.surface,
    stateHome: manifest.stateHome,
    // Which release produced this run (design D17), as `run start` recorded it.
    // Absent on a manifest an earlier release wrote, and the receipt omits the
    // key rather than claim a version nobody recorded.
    cliVersion: manifest.cli && typeof manifest.cli.version === 'string' ? manifest.cli.version : undefined,
    pluginVersion: manifest.plugin && typeof manifest.plugin.version === 'string' ? manifest.plugin.version : undefined,
    host: manifest.host
      ? {
          id: hostId(manifest),
          billing: hostCapability(manifest, 'billing'),
          hooks: hostCapability(manifest, 'hooks'),
          usage: hostCapability(manifest, 'usage'),
          cacheAccounting: hostCapability(manifest, 'cacheAccounting'),
          // The manifest's own field, never `hostCapability`: that falls back to
          // the assumed `flag`, and a run that recorded nothing would then read
          // as one whose effort was applied.
          effort: manifest.host.effort === undefined ? null : manifest.host.effort
        }
      : undefined
  })

  // The trajectory writes this close owes. A failure here is the same fatal
  // class as every other `.claude/ship/runs` append — the close has no tick or
  // commit left to stop, so the halt it can still perform is a spoken
  // degradation and a non-zero exit, exactly what an unreconstructable run gets
  // below. Silence would leave a run that reads complete and cannot be replayed.
  let trajectoryComplete = true
  if (committerObserved.failure) {
    trajectoryComplete = false
    degradations.push(`TRAJECTORY APPEND FAILED: agent-result ${committerObserved.failure}`)
  }
  if (manifest.runId) {
    // One `agent-result` per joined agent, before the receipt: the same fatal
    // class as every other append here (ship/agent-results).
    for (const entry of closeObserved.results) {
      const result = appendRunLogEvent(home, { runId: manifest.runId, change: manifest.change, ...entry })
      if (!result.written) {
        ctx.warn(`agent-result not recorded: ${result.reason}`)
        trajectoryComplete = false
        degradations.push(`TRAJECTORY APPEND FAILED: agent-result ${entry.label}: ${result.reason}`)
        break
      }
    }

    const written = appendRunLogEvent(home, {
      ...receipt,
      runId: manifest.runId,
      change: manifest.change
    })
    if (!written.written) {
      ctx.warn(`run-receipt not recorded: ${written.reason}`)
      trajectoryComplete = false
      degradations.push(`TRAJECTORY APPEND FAILED: run-receipt: ${written.reason}`)
    }

    const terminal = appendRunLogEvent(home, {
      runId: manifest.runId,
      change: manifest.change,
      type: haltReason ? 'run-halt' : 'run-complete',
      reason: haltReason || undefined
    })
    if (!terminal.written) {
      const type = haltReason ? 'run-halt' : 'run-complete'
      ctx.warn(`${type} not recorded: ${terminal.reason}`)
      trajectoryComplete = false
      degradations.push(`TRAJECTORY APPEND FAILED: ${type}: ${terminal.reason}`)
    }
  }

  // The outcome corpus. Its own write failure is reported and never touches the
  // exit code: losing a corpus line must not fail the run that produced it.
  const outcome = appendOutcome(home, {
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
    const check = checkRunLog(home, manifest.runId)
    reconstructable = check.ok !== false
    if (!reconstructable) {
      degradations.push(
        `RUN NOT RECONSTRUCTABLE: ${(check.problems || []).join('; ') || 'the trajectory is incomplete'}`
      )
    }
  }

  // The assessment's last word (design D15). The receipt was built before its
  // own append, so it could not know whether that append, the terminal event or
  // the check above would fail. When one did, the run record's
  // `trajectoryComplete` is no longer true: the close reassesses from the SAME
  // gathered input with that one field changed, and the evidence file and the
  // summary carry the result. The receipt keeps what it was built with. In the
  // ordinary case nothing is computed twice.
  let mergeSummary = null
  if (merge) {
    let assessed = merge.assessment
    let runRecord = merge.evidence.run
    const complete = trajectoryComplete && reconstructable
    if (runRecord.trajectoryComplete !== complete) {
      runRecord = { ...runRecord, trajectoryComplete: complete }
      try {
        assessed = assessForRun({ ...merge.input, run: runRecord }, merge.base)
      } catch (err) {
        assessed = null
        degradations.push(`MERGE CONFIDENCE NOT ASSESSED: ${(err && err.message) || String(err)}`)
      }
    }
    if (assessed) {
      // Per-run working state, so it goes to the working root and never the
      // state home. A file that cannot be written is spoken and is not named.
      let assessmentPath = null
      try {
        writeWork(
          root,
          MERGE_EVIDENCE_FILE,
          buildRunEvidence({
            change: manifest.change,
            runId: manifest.runId,
            base: merge.base,
            headSha: merge.headSha,
            committed: merge.committed,
            evidence: { ...merge.evidence, run: runRecord },
            result: assessed
          })
        )
        assessmentPath = [...WORK_DIR.split(/[\\/]/), MERGE_EVIDENCE_FILE].join('/')
      } catch (err) {
        degradations.push(`MERGE CONFIDENCE NOT WRITTEN: ${(err && err.message) || String(err)}`)
      }
      const driven = kind => assessed.driving.filter(d => d.kind === kind).map(d => d.id)
      mergeSummary = {
        headline: mergeConfidenceHeadline(assessed),
        groups: { fix: driven('finding'), person: driven('person'), evidence: driven('evidence') },
        flags: assessed.flags,
        assessmentPath
      }
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
      // `record` returns its warnings and not whether it wrote, and it does not
      // throw when the ladder's file is unreadable and cannot be moved aside: it
      // leaves the file and records nothing. So the run count is read before and
      // after, and the manifest claims the record only when it moved.
      const runsOf = () => {
        const entry = autonomyState({ root: home })['review-code']
        return entry && Number.isInteger(entry.runs) ? entry.runs : 0
      }
      const before = runsOf()
      const result = recordAutonomy('review-code', { blockers }, { root: home })
      const warnings = (result && Array.isArray(result.warnings) ? result.warnings : []).filter(
        w => typeof w === 'string' && w
      )
      degradations.push(...warnings)
      if (runsOf() > before) {
        manifest.autonomy = { path: 'review-code', blockers }
      } else {
        degradations.push(
          `AUTONOMY RECORD NOT WRITTEN: ${warnings.length ? warnings.join('; ') : 'the record did not change'}` +
            ' — the ladder is experimental and gates nothing, so the run is unaffected'
        )
      }
    } catch (err) {
      degradations.push(
        `AUTONOMY RECORD NOT WRITTEN: ${(err && err.message) || String(err)} — the ladder is ` +
          `experimental and gates nothing, so the run is unaffected`
      )
    }
  }

  // The halt resume card. Only on a halt: a clean close has nothing to resume,
  // and its summary already ends in the archive reminder.
  //
  // Written last, so the card carries every banner this close raised — the
  // reconstructability failure and the autonomy one included. Its own failure is
  // a banner and never an exit code: it is a pointer to records that were
  // already written, so losing it costs a reader convenience, not evidence. That
  // is the outcome-corpus class, not the trajectory's.
  //
  // Nothing reads it back. The next ship still decides whether to skip the
  // classifier from the plan fingerprint, so a card that was never written, or
  // was hand-edited, cannot change what a later run does.
  let resumeCard = null
  if (haltReason) {
    const written = writeResumeCard(home, {
      change: manifest.change,
      runId: manifest.runId,
      halted: haltReason,
      leftoverTaskIds,
      plan: manifest.plan,
      planStored: Boolean(planFingerprint) && existsSync(join(root, PLAN_FILE_PATH)),
      waves: manifest.waves || [],
      degradations,
      projectSlug: slug,
      cwd: absRoot,
      stateHome: home,
      laneSessions: Array.isArray(manifest.laneSessions) ? manifest.laneSessions : []
    })
    if (written.written) resumeCard = written.path
    else degradations.push(`RESUME CARD NOT WRITTEN: ${written.reason}`)
  }

  manifest.lastThen = null
  // The run is over: every other `run` subcommand now refuses it (design D15).
  manifest.closedAt = new Date().toISOString()
  writeManifest(root, manifest)

  return {
    schema: STEP_SCHEMA,
    action: haltReason ? 'halt' : 'complete',
    cliVersion: cliVersion(),
    then: null,
    spawns: [],
    exitCode: haltReason || !reconstructable || !trajectoryComplete ? 1 : 0,
    banners: degradations,
    // Present exactly when the summary prints the advisor line.
    ...(advisorClose ? { advisorConsults: advisorClose.field } : {}),
    summary: formatRunSummary({
      advisorConsultsLine: advisorClose ? advisorClose.line : null,
      change: manifest.change,
      summary,
      flags: manifest.flags,
      leftoverTaskIds,
      degradations,
      runId: manifest.runId,
      root: absRoot,
      stateHome: home,
      projectSlug: slug,
      push,
      unarchived,
      resumeCard,
      mergeConfidence: mergeSummary
    })
  }
}

/**
 * A close against a manifest this CLI cannot interpret (design D11): a run a
 * different release started, or a file that no longer parses. It cannot record
 * the run, so it records nothing — the manifest and the stage marker are left
 * exactly as they were — and says so, naming the marker that still arms the
 * commit guard so the operator knows what to clear and with which CLI.
 */
async function closeUnusableManifest(ctx, absRoot, slug, inspected, { halt, hostBanners, notify, env }) {
  const reason = typeof halt === 'string' && halt.trim() ? halt.trim() : null
  const headline = `SHIP HALTED — ${reason || 'the run was closed without a manifest this interlock can read'}`
  const push = await attemptPush(notify, env, { headline, change: inspected.change || null, runId: null })
  const marker = inspected.change ? stagePath(inspected.change, '.').split(/[\\/]/).join('/') : null
  const rows = [
    `  run: unrecorded — ${MANIFEST_PATH} is ${inspected.status === 'foreign' ? 'a different release\'s manifest' : 'unreadable'}`,
    `  project: ${slug}`,
    `  cwd: ${absRoot}`
  ]
  if (push && push.sent !== undefined) {
    rows.push(push.sent ? '  push: sent (ntfy)' : `  push: failed — ${push.reason}`)
  }
  return {
    schema: STEP_SCHEMA,
    action: 'halt',
    cliVersion: cliVersion(),
    then: null,
    spawns: [],
    exitCode: 1,
    banners: Array.isArray(hostBanners) ? hostBanners : [],
    summary:
      `${headline}\n\n` +
      `${describeUnusableManifest(inspected)}.\n` +
      'This close changed nothing: the manifest was left as it is' +
      (marker
        ? `, and the stage marker ${marker} was not cleared — it keeps blocking \`git commit\` until the run is ` +
          'closed by the CLI that started it, or the marker is removed by hand.\n'
        : ', and no stage marker was touched (the manifest names no change).\n') +
      rows.join('\n')
  }
}

/**
 * Turn the close's join into what a reader sees (ship/agent-results): the
 * partial and unjoined lines, the observed `hook` refinement, the permission
 * counts, a model substitution per joined spawn, and the `agent-result` records
 * the close appends before the receipt. Banners land on `manifest.banners`,
 * notes on `manifest.notes`, before the summary is assembled from them.
 */
function observeJoinedAgents(manifest, joined) {
  const out = { usable: 0, substitutions: 0, permissionPrompts: 0, autoModeDenials: 0, results: [] }
  for (const entry of joined.unreadable) {
    manifest.notes.push(`AGENT USAGE UNREADABLE: ${entry.file}: ${entry.reason}`)
  }
  if (!joined.present) return out

  out.usable = joined.joined.filter(j => j.agent.usage && typeof j.agent.usage === 'object').length
  // The cache half is the hooks standing in for a host that declared it cannot
  // report: on a host that reports its own figures (the runner), a lane is a
  // top-level session no subagent hook ever sees, and a sidecar holding only a
  // permission file must not read as every lane unrecorded.
  if (joined.cacheFromHooks && joined.briefed > 0 && joined.unrecorded > 0) {
    manifest.banners.push(`CACHE ACCOUNTING PARTIAL: ${joined.unrecorded} of ${joined.briefed} agents unrecorded`)
  }
  const unjoined = joined.unjoined.noKey + joined.unjoined.unknownKey
  if (unjoined > 0) {
    manifest.notes.push(
      `AGENT USAGE UNJOINED: ${unjoined} recorded agents matched no dispatched spawn ` +
        `(${joined.unjoined.noKey} without a briefing key, ${joined.unjoined.unknownKey} with a key no spawn dispatched)`
    )
  }
  // Observed only, and only from a declared `false`: no adapter declares `hook`,
  // and a partial join keeps what the host declared.
  if (joined.cacheFromHooks && joined.complete && manifest.host && typeof manifest.host === 'object') {
    manifest.host.cacheAccounting = 'hook'
  }

  for (const { spawned, agent } of joined.joined) {
    const verdict = modelSubstitution(spawned.model, { servedModels: agent.models })
    if (verdict.substituted === true) {
      manifest.banners.push(modelSubstitutedBanner(spawned.label, spawned.model, verdict.ran))
      out.substitutions++
    }
    out.results.push({
      type: 'agent-result',
      label: spawned.label,
      kind: spawned.kind,
      agentId: agent.agentId,
      source: 'transcript',
      numTurns: agent.turns,
      modelRouted: spawned.model || undefined,
      servedModels: agent.models,
      modelScope: verdict.scope,
      substituted: verdict.substituted,
      usage: agent.usage
    })
  }

  const requests = joined.permissions.filter(p => p && p.kind === 'request')
  const denials = joined.permissions.filter(p => p && p.kind === 'denied')
  out.permissionPrompts = requests.length
  out.autoModeDenials = denials.length
  if (requests.length) manifest.banners.push(`PERMISSION PROMPTS DURING RUN: ${requests.length}`)
  if (denials.length) {
    const tools = [...new Set(denials.map(p => p.tool).filter(t => typeof t === 'string' && t))]
    manifest.banners.push(`AUTO MODE DENIED ${denials.length} TOOL CALLS${tools.length ? ` (${tools.join(', ')})` : ''}`)
  }
  return out
}

/**
 * The spend rows with the join's cache figures where the host observed none
 * (design D5's precedence: the host's own figure, then the join, then what the
 * results carried). A wave the join could not complete is recorded unknown.
 */
function fillJoinedCache(rows, cacheByWave) {
  return rows.map(row => {
    if (!row || !Number.isInteger(row.wave) || !cacheByWave.has(row.wave)) return row
    if (Number.isFinite(row.cacheReadInputTokens)) return row
    return { ...row, ...cacheByWave.get(row.wave) }
  })
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
