#!/usr/bin/env node
// The outcome eval's runner.
//
// It copies a fixture to a scratch root outside this repository, runs the real
// ship loop there against a real model, and then grades what is on disk using
// only decisions the CLI already makes. It grades an OUTCOME — files, ticks, a
// commit, a green suite — which is the thing no eval in this repository graded
// before it. Nothing here reads a transcript, and nothing here defines a new
// judgement.
//
// It draws no conclusion. One run per fixture per arm is a weak signal by
// construction: the row is the deliverable and the committed history is the
// answer. Nothing gates on a result, so a noisy row costs nothing but its price.
//
// The isolation rule is structural rather than a convention (design D3). Every
// run copies a fixture into a fresh directory under the system temporary
// directory and hands that to the loop as `--root`. All run state — the ship
// work directory, the trajectory, the learning corpus, the git repository the
// commit lands in — lives there, and nothing is copied back. The runner REFUSES
// a root inside this repository rather than trusting itself to have passed the
// right one, because this repository's corpora were purged once already after
// exactly that kind of pollution, and a record written by a fixture run is
// indistinguishable from a record written by a real one.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyStartingState, readFixture, readFixtures, listFixtureIds } from './fixtures.mjs'
import { AGENT_IDENTITY } from './agent/main.mjs'
import { DEFAULT_MODEL, MODEL_ENV } from './agent/model.mjs'
import { SHARED_CRITERIA, gradeArm, interlock, runUnitCommand, tallyCriteria } from './graders.mjs'
import { HOST_ID, priceUsage, readAgentUsage, runControlArm, runLoopArm } from './arms.mjs'
import { appendShipOutcome } from '../../lib/eval-history.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The repository that carries the fixtures — the one a run must never touch. */
export const REPO_ROOT = resolve(HERE, '..', '..')

/** The committed agent, used unless the operator names another. */
export const COMMITTED_AGENT_PATH = join(HERE, 'agent', 'main.mjs')

/** Where the ACP host reads an operator-supplied agent command. */
export const ACP_COMMAND_ENV = 'INTERLOCK_ACP_COMMAND'

/**
 * Resolve a path to its real form where it exists, and to its nearest existing
 * ancestor's real form where it does not — so a root that has yet to be created
 * is still judged by where it would land.
 */
function realish(path) {
  let current = resolve(path)
  const seen = new Set()
  while (!existsSync(current) && !seen.has(current)) {
    seen.add(current)
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
  return existsSync(current) ? realpathSync(current) : current
}

/**
 * Refuse a scratch root that resolves inside the repository under test.
 *
 * Returns the resolved root on success; throws with the reason otherwise.
 * Stated, never silent: the caller prints the reason and records no result,
 * because a run that polluted the corpora would be worse than one that never
 * happened.
 *
 * @param {string} root
 * @param {string} [repoRoot]
 * @returns {string}
 */
export function assertScratchRootOutsideRepo(root, repoRoot = REPO_ROOT) {
  if (typeof root !== 'string' || !root.trim()) {
    throw new Error('a scratch root is required')
  }
  const resolved = realish(root)
  const repo = realish(repoRoot)
  if (resolved === repo || resolved.startsWith(repo + sep)) {
    throw new Error(
      `refusing to run a fixture against ${resolved}: it resolves inside ${repo}, the repository ` +
        `under test. Every artefact a run produces — run state, trajectories, outcome records, ` +
        `work files, commits — would land in this repository's own corpora, where a fixture's ` +
        `record is indistinguishable from a real run's. Pass a root under the system temporary ` +
        `directory instead.`
    )
  }
  return resolved
}

/**
 * Which agent drives the run, and where it came from.
 *
 * The committed agent is the default because it is the only one the repository
 * can test, install in a zero-dependency CI job, and version-key a result
 * against. `INTERLOCK_ACP_COMMAND` is honoured when set, because the host
 * already reads that variable and an operator who set it meant it — but the
 * choice is recorded either way, so a row produced by an unpinned external
 * agent can never be compared against one produced by the committed agent
 * without a reader seeing the difference.
 *
 * @param {object} [env]
 * @returns {{ command: string, source: 'operator'|'committed', identity: string }}
 */
export function selectAgent(env = process.env) {
  const override = env[ACP_COMMAND_ENV]
  if (typeof override === 'string' && override.trim()) {
    return {
      command: override.trim(),
      source: 'operator',
      // An external command is not version-keyed: the repository cannot know
      // what it is. Recording the command string is the most that can honestly
      // be said about it, and it is deliberately not dressed up as an identity
      // the way the committed agent's is.
      identity: `operator-supplied:${override.trim()}`
    }
  }
  return {
    command: `${process.execPath} ${COMMITTED_AGENT_PATH}`,
    source: 'committed',
    identity: AGENT_IDENTITY
  }
}

/** Run a command, returning its result. Never throws for a non-zero exit. */
function run(command, args, opts = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...opts })
}

/**
 * Copy a fixture into a fresh scratch root and initialize a repository there.
 *
 * The repository matters: the loop's commit step needs somewhere to commit, and
 * the graders read the scratch repository's log. Committing the starting state
 * is what makes the diff a run produces legible — and what gives the unit
 * grader a committed baseline to check a weakened suite against.
 *
 * @param {{ id: string, startDir: string }} fixture
 * @param {object} [options]
 * @param {string} [options.tmpBase] where the scratch root is created
 * @param {string} [options.repoRoot]
 * @returns {{ root: string, commit: string }}
 */
export function prepareScratchRoot(fixture, { tmpBase = tmpdir(), repoRoot = REPO_ROOT } = {}) {
  // Checked before the directory is made, and again after: the first catches an
  // operator pointing `--tmp-base` at the repository, the second catches a
  // symlink that made a safe-looking base land inside it anyway.
  assertScratchRootOutsideRepo(tmpBase, repoRoot)
  const root = mkdtempSync(join(realish(tmpBase), `interlock-eval-${fixture.id}-`))
  try {
    assertScratchRootOutsideRepo(root, repoRoot)
    applyStartingState(fixture, root)

    const git = (...args) => run('git', args, { cwd: root })
    const init = git('-c', 'init.defaultBranch=main', 'init', '-q')
    if (init.status !== 0) {
      throw new Error(`git init failed in the scratch root: ${init.stderr || init.error}`)
    }
    git('add', '-A')
    const committed = git(
      '-c',
      'user.name=Interlock Outcome Eval',
      '-c',
      'user.email=eval@interlock.invalid',
      'commit',
      '-q',
      '-m',
      `fixture ${fixture.id}: starting state`
    )
    if (committed.status !== 0) {
      throw new Error(`git commit failed in the scratch root: ${committed.stderr || committed.error}`)
    }
    const head = git('rev-parse', 'HEAD')
    return { root, commit: head.stdout.trim() }
  } catch (err) {
    rmSync(root, { recursive: true, force: true })
    throw err
  }
}

/** Remove a scratch root. Safe to call twice. */
export function removeScratchRoot(root) {
  if (!root) return
  rmSync(root, { recursive: true, force: true })
}

// --- what the run is measured against ---------------------------------------

/**
 * The published ceiling and price table, read from `interlock limits --json`.
 *
 * Read from the CLI rather than imported, deliberately: the scheduled job reads
 * the same field the same way, and a runner that imported the module while the
 * job parsed the CLI would be two readers of one number that could come apart
 * (design D6). The number appears in neither this file nor the workflow.
 */
export function readPublishedLimits() {
  const limits = interlock(['limits', '--json'])
  const evals = limits.json && limits.json.evals ? limits.json.evals : null
  const prices = limits.json && limits.json.prices ? limits.json.prices : null
  if (!evals || !Number.isFinite(Number(evals.shipEvalCostUsd))) {
    return {
      ceilingUsd: null,
      prices,
      reason:
        'interlock limits --json reported no evals.shipEvalCostUsd — the sweep runs unbounded ' +
        'rather than under a ceiling this file invented'
    }
  }
  return { ceilingUsd: Number(evals.shipEvalCostUsd), prices, reason: null }
}

/** The version under test, read from the package the plugin ships as. */
export function versionUnderTest(repoRoot = REPO_ROOT) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Which model a row should name.
 *
 * An operator-supplied agent chooses its own model and cannot be asked which; a
 * row that named this repository's default anyway would be a claim the eval
 * never observed, and would pair in a comparison with rows that mean something
 * else.
 */
export function modelUnderTest(agent, env = process.env) {
  if (agent.source !== 'committed') {
    return 'unknown (an operator-supplied agent chooses its own model)'
  }
  return env[MODEL_ENV] || DEFAULT_MODEL
}

/**
 * Can this eval produce a signal at all?
 *
 * A run that could not happen and a run that went badly are different outcomes,
 * and only one of them is a measurement. Checked before anything is spent.
 */
export function preflight(agent, { env = process.env } = {}) {
  if (agent.source === 'committed') {
    if (!existsSync(COMMITTED_AGENT_PATH)) {
      return { ok: false, reason: `the committed eval agent is missing at ${COMMITTED_AGENT_PATH}` }
    }
    if (!env.ANTHROPIC_API_KEY) {
      return {
        ok: false,
        reason:
          'no model credential is available (ANTHROPIC_API_KEY is unset), so the eval agent cannot ' +
          'reach a model'
      }
    }
  }
  return { ok: true, reason: null }
}

/**
 * A fixture's own solvability check, run offline before anything is spent.
 *
 * `npm test` proves every fixture solvable by applying its reference
 * implementation; this is the cheap half of that, repeated here so a rotted
 * fixture is reported as no signal rather than spending money to produce what
 * would read as a loop failure.
 */
export function checkFixtureSolvable(fixture, root) {
  const validated = interlock(['validate', fixture.change, '--root', root, '--json'])
  const report = validated.json
  if (!report || report.ready !== true) {
    return {
      ok: false,
      reason:
        `${fixture.id}: interlock validate does not report ${fixture.change} implementable ` +
        `(${report && Array.isArray(report.problems) ? report.problems.join('; ') : 'no readable report'})`,
      baselineCounts: null
    }
  }
  const before = runUnitCommand(fixture, root)
  if (before.exitCode === 0) {
    return {
      ok: false,
      reason:
        `${fixture.id}: the starting suite is already green, so a run that changed nothing would ` +
        `grade as a success`,
      baselineCounts: null
    }
  }
  // The committed baseline the weakened-suite check is measured against: the
  // counts the fixture's own suite reports before anything has touched it.
  return {
    ok: true,
    reason: null,
    baselineCounts: {
      kind: 'unit',
      command: before.command,
      exitCode: before.exitCode,
      total: before.total,
      passed: before.passed,
      failed: before.failed,
      skipped: before.skipped
    }
  }
}

// --- one arm, end to end -----------------------------------------------------

/**
 * The measures block.
 *
 * Every figure is a value-with-reason pair, and an unmeasured one is recorded
 * absent WITH THAT REASON rather than as zero. The two token fields stay
 * separate: `receiptOutputTokens` is the loop's own accounting (absent on this
 * host, by the host's own written refusal to estimate), `agentOutputTokens` is
 * what the eval's agent read off its own API responses. Nothing here
 * reconstructs a figure by arithmetic over agent counts or any other proxy.
 */
export function measuresFor({ armResult, receipt, usage, priced }) {
  const receiptTokens =
    receipt && receipt.outputTokens !== null && receipt.outputTokens !== undefined
      ? { value: receipt.outputTokens, reason: null }
      : {
          value: null,
          reason: receipt
            ? 'the host running the loop has no token accounting and refuses to estimate one'
            : 'the run wrote no receipt'
        }

  return {
    agentsSpawned: armResult.agentsSpawned || { value: null, reason: 'no agent count was recorded' },
    wallClockMs: { value: armResult.wallClockMs, reason: null },
    remediationRounds:
      receipt && receipt.remediationRounds !== null && receipt.remediationRounds !== undefined
        ? { value: receipt.remediationRounds, reason: null }
        : {
            value: null,
            reason: receipt
              ? 'the receipt did not observe a remediation count'
              : 'the run wrote no receipt, and this arm has no other record of a remediation round'
          },
    agentInputTokens:
      usage.inputTokens === null
        ? { value: null, reason: usage.reason }
        : { value: usage.inputTokens, reason: null },
    agentOutputTokens:
      usage.outputTokens === null
        ? { value: null, reason: usage.reason }
        : { value: usage.outputTokens, reason: null },
    receiptOutputTokens: receiptTokens,
    spendUsd: priced.usd === null ? { value: null, reason: priced.reason } : { value: priced.usd, reason: null }
  }
}

/**
 * Prepare, run and grade one arm of one fixture.
 *
 * Returns either a graded result or a no-signal one. A no-signal result records
 * no criteria and writes no history row: an eval that could not run has not
 * measured a regression, and recording one would be the loudest possible lie
 * this apparatus can tell.
 */
export async function runArm({
  fixture,
  arm,
  agent,
  model,
  prices,
  tmpBase,
  keep,
  env = process.env,
  timeoutMs,
  onLog = () => {}
}) {
  const usageBase = mkdtempSync(join(realish(tmpBase || tmpdir()), `interlock-eval-usage-`))
  const usageFile = join(usageBase, 'usage.jsonl')
  let prepared = null

  try {
    prepared = prepareScratchRoot(fixture, { tmpBase })
    const { root, commit } = prepared

    const solvable = checkFixtureSolvable(fixture, root)
    if (!solvable.ok) {
      return { fixture: fixture.id, arm, signal: 'none', reason: solvable.reason, root: keep ? root : null }
    }

    onLog(`  ${fixture.id} / ${arm}: running against ${root}`)
    const armResult =
      arm === 'control'
        ? await runControlArm({ fixture, root, agent, usageFile, env, timeoutMs, onLog })
        : runLoopArm({ fixture, root, agent, usageFile, env, timeoutMs })

    const usage = readAgentUsage(usageFile)
    const priced = priceUsage(usage, model, prices)

    // No signal, decided after the fact and only where it is honestly the
    // apparatus: the arm could not reach an agent at all, or the eval's own
    // agent recorded no model request. Either way nothing about the loop was
    // observed, so nothing about the loop is recorded.
    if (!armResult.ran) {
      return {
        fixture: fixture.id,
        arm,
        signal: 'none',
        reason: armResult.reason || 'the arm did not run',
        spendUsd: priced.usd,
        root: keep ? root : null
      }
    }
    if (agent.source === 'committed' && usage.requests === null) {
      return {
        fixture: fixture.id,
        arm,
        signal: 'none',
        reason:
          `the eval's agent recorded no model request (${usage.reason}) — the model was never ` +
          `reached, so nothing about the loop was measured`,
        spendUsd: priced.usd,
        root: keep ? root : null
      }
    }

    const graded = gradeArm({
      root,
      fixture,
      arm,
      runId: armResult.runId,
      baselineCommit: commit,
      baselineCounts: solvable.baselineCounts,
      expectCommit: true,
      workDir: usageBase
    })

    return {
      fixture: fixture.id,
      arm,
      signal: 'graded',
      reason: null,
      command: armResult.command,
      exitCode: armResult.exitCode,
      runId: armResult.runId,
      criteria: graded.criteria,
      tally: tallyCriteria(graded.criteria),
      measures: measuresFor({ armResult, receipt: graded.receipt, usage, priced }),
      spendUsd: priced.usd,
      root: keep ? root : null
    }
  } catch (err) {
    return {
      fixture: fixture.id,
      arm,
      signal: 'none',
      reason: `the arm could not be prepared or graded: ${(err && err.message) || err}`,
      root: null
    }
  } finally {
    if (!keep) {
      if (prepared) removeScratchRoot(prepared.root)
      rmSync(usageBase, { recursive: true, force: true })
    }
  }
}

/**
 * Whether the published ceiling stops the next arm from starting.
 *
 * A BOUNDARY DECISION, and only that. It is never consulted mid-run: a run
 * killed halfway cannot be graded, and recording it would book a failure the
 * loop did not earn. A sweep stopped here is PARTIAL — the fixtures that did not
 * run are named as not run, never as failures (design D6).
 *
 * An unavailable ceiling does not stop anything, and neither does unmeasured
 * spend. Both are the eval failing to know its own cost, which is a reason to
 * say so rather than a reason to refuse to run.
 */
export function ceilingStop({ spentUsd, ceilingUsd, fixture, arm }) {
  if (ceilingUsd === null || ceilingUsd === undefined) return { stop: false, reason: null }
  if (!(spentUsd >= ceilingUsd)) return { stop: false, reason: null }
  return {
    stop: true,
    reason:
      `the published ceiling (evals.shipEvalCostUsd = $${ceilingUsd}) was reached after ` +
      `$${spentUsd} of measured spend; ${fixture}/${arm} and everything after it did not run ` +
      `and is not recorded as a failure`
  }
}

// --- the arm-to-arm difference ----------------------------------------------

/**
 * The per-fixture difference between the arms.
 *
 * Over the criteria BOTH arms can be graded on, and over every measure. Values
 * and denominators; no verdict, no label, no threshold. The asymmetry — the
 * control arm has no state machine, so three criteria do not apply to it — is
 * stated here rather than averaged away, because averaging over an inapplicable
 * criterion would manufacture the difference the eval exists to measure.
 *
 * An arm that could not run makes the difference UNAVAILABLE rather than
 * computed against a missing arm.
 */
export function differenceFor(loop, control) {
  const unavailable = which => ({
    available: false,
    reason: `the ${which} arm produced no graded result, so there is nothing to difference against`,
    criteria: [],
    measures: []
  })
  if (!loop || loop.signal !== 'graded') return unavailable('loop')
  if (!control || control.signal !== 'graded') return unavailable('control')

  const statusOf = (result, id) => {
    const found = (result.criteria || []).find(c => c.id === id)
    return found ? found.status : 'absent'
  }
  const criteria = SHARED_CRITERIA.map(id => ({
    criterion: id,
    loop: statusOf(loop, id),
    control: statusOf(control, id)
  }))

  const measures = Object.keys(loop.measures || {}).map(field => {
    const a = loop.measures[field]
    const b = control.measures[field]
    const both = a && b && a.value !== null && b.value !== null
    return {
      measure: field,
      loop: a ? a.value : null,
      control: b ? b.value : null,
      difference: both ? Math.round((a.value - b.value) * 10000) / 10000 : null,
      reason: both ? null : 'one arm did not measure this figure, so no difference is computed'
    }
  })

  return {
    available: true,
    reason: null,
    over:
      'the criteria both arms can be graded on, and every measure. The tick, trajectory, ' +
      'receipt and process criteria are not applicable to the control arm and are excluded ' +
      'rather than counted against it.',
    criteria,
    measures,
    note: 'values and denominators only — no arm is labelled better, acceptable, degraded or passing'
  }
}

// --- recording -----------------------------------------------------------

/**
 * Append one row per graded result.
 *
 * A no-signal result writes nothing. The record is a measurement log, and a row
 * for a run that never happened would be read as one that did.
 *
 * @returns {{recorded: number, path: string|null, failures: string[]}}
 */
export function recordResults({ results, historyRoot, identity }) {
  let recorded = 0
  let path = null
  const failures = []
  for (const result of results) {
    if (result.signal !== 'graded') continue
    const written = appendShipOutcome(historyRoot, {
      ...identity,
      fixture: result.fixture,
      arm: result.arm,
      criteria: result.criteria,
      tally: result.tally,
      measures: result.measures
    })
    if (written.written) {
      recorded++
      path = written.path
    } else {
      failures.push(`${result.fixture}/${result.arm}: ${written.reason}`)
    }
  }
  return { recorded, path, failures }
}

/**
 * The eval run's exit status.
 *
 * Non-zero on a failed append, and that is the only thing here that is fatal. A
 * metered run whose result nobody can read has defeated the reason the run
 * exists, and silence would be indistinguishable from a run that was never
 * scheduled — so this record belongs to the fatal class, unlike the outcome
 * corpus and the review metrics, which report a lost line and never touch an
 * exit code (design D7).
 *
 * A GRADED FAILURE IS NOT AN ERROR. A fixture the loop failed to ship exits
 * zero: the eval measured something, and turning a measurement into a non-zero
 * status is the first step toward something gating on it.
 */
export function sweepExitCode(sweep) {
  return sweep && Array.isArray(sweep.failures) && sweep.failures.length ? 1 : 0
}

// --- the command ------------------------------------------------------------

const USAGE = `interlock outcome eval — ship a committed fixture and grade what is on disk

Usage:
  node evals/ship/run.mjs [flags]

Flags:
  --fixture <id>     only this fixture (repeatable); default: every fixture
  --arm <name>       loop | control | both  (default: both)
  --tmp-base <dir>   where scratch roots are created (default: the system temp dir)
  --keep             leave the scratch roots on disk and print their paths
  --json             print one JSON object instead of prose
  --no-history       grade and print, but append no row to the committed record
  --history-root <d> where the record is appended (default: this repository)
  --timeout-ms <n>   per-agent transport budget
  --prepare-only     prepare and discard each scratch root; no model call, no spend
  --help

METERED. Every arm but --prepare-only makes real model calls, bounded by the
ceiling \`interlock limits --json\` publishes as evals.shipEvalCostUsd. The
ceiling is enforced at fixture and arm boundaries only: it stops the next arm
from starting and never kills one in flight, because a half-killed run cannot be
graded and would be recorded as a failure it did not earn.

Exit codes:
  0  the sweep ran and every result it produced was recorded
  1  a result could not be recorded, or a fixture was named that does not exist
`

function parseArgv(argv) {
  const flags = { fixture: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--fixture') flags.fixture.push(argv[++i])
    else if (arg === '--arm') flags.arm = argv[++i]
    else if (arg === '--tmp-base') flags.tmpBase = argv[++i]
    else if (arg === '--history-root') flags.historyRoot = argv[++i]
    else if (arg === '--timeout-ms') flags.timeoutMs = Number.parseInt(argv[++i], 10)
    else if (arg === '--keep') flags.keep = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--no-history') flags.noHistory = true
    else if (arg === '--prepare-only') flags.prepareOnly = true
    else if (arg === '--help' || arg === '-h') flags.help = true
    else throw new Error(`unknown flag: ${arg}`)
  }
  return flags
}

/** The model-free path: prepare each scratch root, prove it landed outside, discard it. */
function prepareOnly(fixtures, flags, agent) {
  const prepared = []
  let failed = false
  for (const fixture of fixtures) {
    try {
      const { root, commit } = prepareScratchRoot(fixture, { tmpBase: flags.tmpBase })
      prepared.push({ fixture: fixture.id, change: fixture.change, root, baseline: commit })
      if (!flags.keep) removeScratchRoot(root)
    } catch (err) {
      failed = true
      prepared.push({ fixture: fixture.id, error: (err && err.message) || String(err) })
    }
  }
  const report = {
    schema: 'interlock.ship-eval-preparation/1',
    repoRoot: REPO_ROOT,
    agent,
    kept: Boolean(flags.keep),
    fixtures: prepared
  }
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(`agent: ${agent.identity} (${agent.source})\n`)
    for (const entry of prepared) {
      if (entry.error) process.stdout.write(`  ${entry.fixture}: FAILED — ${entry.error}\n`)
      else {
        process.stdout.write(
          `  ${entry.fixture}: ${entry.change} prepared at ${entry.root}` +
            `${flags.keep ? '' : ' (removed)'}\n`
        )
      }
    }
  }
  return failed ? 1 : 0
}

function formatSweep(sweep) {
  const lines = []
  lines.push(
    `INTERLOCK OUTCOME EVAL — ${sweep.version} on the ${sweep.host} host, model ${sweep.model}, ` +
      `agent ${sweep.evalAgent}`
  )
  lines.push(
    `  ceiling ${sweep.ceilingUsd === null ? 'unavailable' : `$${sweep.ceilingUsd}`} ` +
      `(evals.shipEvalCostUsd), price table ${sweep.priceTable}` +
      (sweep.partial ? `  — PARTIAL: ${sweep.partialReason}` : '')
  )
  lines.push('')
  for (const result of sweep.results) {
    if (result.signal !== 'graded') {
      lines.push(`  ${result.fixture} / ${result.arm}: NO SIGNAL — ${result.reason}`)
      continue
    }
    const t = result.tally
    lines.push(
      `  ${result.fixture} / ${result.arm}: ${t.met} of ${t.applicable} applicable criteria met` +
        (t.notApplicable ? `, ${t.notApplicable} not applicable` : '') +
        (t.unobserved ? `, ${t.unobserved} unobserved` : '')
    )
    for (const c of result.criteria) {
      lines.push(
        `      ${String(c.status).padEnd(10)} ${c.id}` +
          (c.exitCode === null ? '' : `  (exit ${c.exitCode})`) +
          (c.detail ? `\n                 ${c.detail}` : '')
      )
    }
    for (const [field, m] of Object.entries(result.measures)) {
      lines.push(
        `      measure    ${field}: ${m.value === null ? `absent — ${m.reason}` : m.value}`
      )
    }
  }
  for (const entry of sweep.differences) {
    lines.push('')
    lines.push(`  ${entry.fixture}: loop vs control`)
    if (!entry.difference.available) {
      lines.push(`      unavailable — ${entry.difference.reason}`)
      continue
    }
    for (const c of entry.difference.criteria) {
      lines.push(`      ${c.criterion}: loop ${c.loop}, control ${c.control}`)
    }
    for (const m of entry.difference.measures) {
      lines.push(
        `      ${m.measure}: loop ${m.loop === null ? 'absent' : m.loop}, ` +
          `control ${m.control === null ? 'absent' : m.control}` +
          (m.difference === null ? `  (no difference: ${m.reason})` : `  (difference ${m.difference})`)
      )
    }
    lines.push(`      ${entry.difference.note}`)
  }
  lines.push('')
  lines.push(
    `  ${sweep.recorded} row(s) appended to ${sweep.historyPath || 'nowhere (--no-history)'}. ` +
      `Nothing reads them but a human and \`interlock report\`.`
  )
  return lines.join('\n') + '\n'
}

async function main(argv) {
  const flags = parseArgv(argv)
  if (flags.help) {
    process.stdout.write(USAGE)
    return 0
  }

  const known = new Set(listFixtureIds())
  for (const id of flags.fixture) {
    if (!known.has(id)) {
      process.stderr.write(`no such fixture: ${id} (known: ${[...known].join(', ')})\n`)
      return 1
    }
  }
  const fixtures = flags.fixture.length ? flags.fixture.map(readFixture) : readFixtures()

  const arms =
    flags.arm === undefined || flags.arm === 'both' ? ['loop', 'control'] : [String(flags.arm)]
  for (const arm of arms) {
    if (arm !== 'loop' && arm !== 'control') {
      process.stderr.write(`unknown arm: ${arm} (expected loop, control or both)\n`)
      return 1
    }
  }

  const agent = selectAgent()
  if (flags.prepareOnly) return prepareOnly(fixtures, flags, agent)

  const { ceilingUsd, prices, reason: ceilingReason } = readPublishedLimits()
  const model = modelUnderTest(agent)
  const version = versionUnderTest()
  const historyRoot = flags.historyRoot || REPO_ROOT

  const sweep = {
    schema: 'interlock.ship-eval-sweep/1',
    version,
    host: HOST_ID,
    model,
    evalAgent: agent.identity,
    agentSource: agent.source,
    node: process.version,
    ceilingUsd,
    ceilingReason,
    priceTable: prices && prices.id ? prices.id : 'unavailable',
    partial: false,
    partialReason: null,
    spentUsd: 0,
    spendMeasured: true,
    results: [],
    differences: [],
    recorded: 0,
    historyPath: null,
    failures: []
  }

  const ready = preflight(agent)
  if (!ready.ok) {
    // No signal for the whole sweep, and no row for any of it. Distinct from a
    // graded failure and reported as such.
    for (const fixture of fixtures) {
      for (const arm of arms) {
        sweep.results.push({ fixture: fixture.id, arm, signal: 'none', reason: ready.reason })
      }
    }
  } else {
    const log = line => {
      if (!flags.json) process.stdout.write(`${line}\n`)
    }
    outer: for (const fixture of fixtures) {
      for (const arm of arms) {
        // The ceiling stops the NEXT arm from starting. It never kills one in
        // flight: a half-killed run cannot be graded, and recording it would
        // book a failure the loop did not earn (design D6).
        const stop = ceilingStop({
          spentUsd: sweep.spentUsd,
          ceilingUsd,
          fixture: fixture.id,
          arm
        })
        if (stop.stop) {
          sweep.partial = true
          sweep.partialReason = stop.reason
          break outer
        }
        const result = await runArm({
          fixture,
          arm,
          agent,
          model,
          prices,
          tmpBase: flags.tmpBase,
          keep: flags.keep,
          timeoutMs: Number.isInteger(flags.timeoutMs) ? flags.timeoutMs : undefined,
          onLog: log
        })
        sweep.results.push(result)
        if (typeof result.spendUsd === 'number') sweep.spentUsd += result.spendUsd
        else sweep.spendMeasured = false
      }
    }
  }

  sweep.spentUsd = Math.round(sweep.spentUsd * 10000) / 10000

  for (const fixture of fixtures) {
    const loop = sweep.results.find(r => r.fixture === fixture.id && r.arm === 'loop')
    const control = sweep.results.find(r => r.fixture === fixture.id && r.arm === 'control')
    if (!loop && !control) continue
    sweep.differences.push({ fixture: fixture.id, difference: differenceFor(loop, control) })
  }

  if (!flags.noHistory) {
    const written = recordResults({
      results: sweep.results,
      historyRoot,
      identity: {
        version,
        host: HOST_ID,
        model,
        evalAgent: agent.identity,
        priceTable: sweep.priceTable,
        node: process.version
      }
    })
    sweep.recorded = written.recorded
    sweep.historyPath = written.path
    sweep.failures = written.failures
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(sweep, null, 2)}\n`)
  } else {
    process.stdout.write(formatSweep(sweep))
  }

  // A metered run whose result nobody can read has defeated the reason the run
  // exists, and silence would be indistinguishable from a run that was never
  // scheduled. So a failed append exits non-zero and names the reason — and
  // affects nothing else: no ship run is in this path, and no reader of the
  // record changes its exit status because of it.
  if (sweep.failures.length) {
    process.stderr.write(
      `interlock outcome eval: ${sweep.failures.length} result(s) could not be appended to the ` +
        `committed record:\n  ${sweep.failures.join('\n  ')}\n`
    )
  }
  return sweepExitCode(sweep)
}

if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    err => {
      process.stderr.write(`${(err && err.message) || err}\n`)
      process.exit(1)
    }
  )
}
