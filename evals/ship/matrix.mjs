#!/usr/bin/env node
// The cost-per-task sweep: the committed outcome fixtures, crossed with model
// and effort, priced, and recorded as rows a later limits edit can cite.
//
// NOT THE OUTCOME EVAL, and not a mode of it. The outcome eval holds one model
// constant and varies the loop; this sweep holds the procedure constant and
// varies the model and the effort. Its rows go to their own file under their own
// schema, and nothing here appends to the outcome history.
//
// A cell is one fixture, one API model id and one effort, run by the CONTROL-ARM
// PROCEDURE: the committed agent prompted once per task in `tasks.md` order,
// then the fixture's unit command, then the fixture's graders. No planner, no
// wave loop, no verify step (design D1): the loop arm runs on a host that does
// not route models per tier, and a verify step at a fixed effort inside every
// cell would confound the very cost being compared.
//
// Isolation is the outcome eval's, reused rather than re-implemented: every cell
// runs in a fresh scratch root outside this repository, and a root inside it is
// refused before any cell starts. Nothing a cell writes comes back here except
// the sweep's own row.
//
// It draws no conclusion and moves no dial. A row is evidence that a later edit
// to the effort table or the opus floor may cite; nothing here edits either.

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listFixtureIds, readFixture } from './fixtures.mjs'
import { MODEL_ENV } from './agent/model.mjs'
import { gradeArm, interlock } from './graders.mjs'
import { priceUsage, readAgentUsage, runControlArm } from './arms.mjs'
import {
  assertScratchRootOutsideRepo,
  checkFixtureSolvable,
  preflight,
  prepareScratchRoot,
  removeScratchRoot,
  selectAgent,
  versionUnderTest,
  ACP_COMMAND_ENV,
  REPO_ROOT
} from './run.mjs'
import { appendCostPerTask } from '../../lib/eval-history.mjs'

/**
 * The models a cell may run, as API ids — the strings the price table is keyed
 * by and the row stores — never the planner's `opus` / `sonnet` slugs. Haiku is
 * not a cell (design D2).
 */
export const GRID_MODELS = Object.freeze(['claude-opus-5-5', 'claude-sonnet-5-5'])

/**
 * The efforts a cell may run at. `xhigh` is in, because the edit these rows would
 * inform compares a tier at `high` with today's `xhigh`; `max` is out (design D2).
 */
export const GRID_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh'])

/** The schema of one invocation's report, printed with `--json`. */
export const MATRIX_SWEEP_SCHEMA = 'interlock.cost-per-task-sweep/1'

function messageOf(err) {
  return (err && err.message) || String(err)
}

/**
 * The published ceiling and price table this sweep runs under, read from
 * `interlock limits --json`.
 *
 * Read from the CLI rather than imported, the way the outcome eval reads its
 * own: one number, published once, with the sweep as its reader. The figure
 * appears nowhere in this file. An unreadable ceiling is stated, not invented —
 * the sweep then runs unbounded and says so, the outcome eval's posture.
 *
 * @param {() => {json: object|null}} [read] injected for tests
 * @returns {{ceilingUsd: number|null, prices: object|null, reason: string|null}}
 */
export function readMatrixLimits(read = () => interlock(['limits', '--json'])) {
  const limits = read()
  const json = limits && limits.json ? limits.json : null
  const evals = json && json.evals ? json.evals : null
  const prices = json && json.prices ? json.prices : null
  const cap = evals ? evals.matrixCostUsd : undefined
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0) {
    return {
      ceilingUsd: null,
      prices,
      reason:
        'interlock limits --json reported no evals.matrixCostUsd — the sweep runs unbounded ' +
        'rather than under a ceiling this file invented'
    }
  }
  return { ceilingUsd: cap, prices, reason: null }
}

/**
 * Every cell of the grid, in fixture order, then model, then effort.
 *
 * The fixture set is whatever the outcome set is: a fixture added there joins
 * this grid, and the sweep keeps no private list that could drift from it.
 *
 * @returns {Array<{fixture: string, model: string, effort: string}>}
 */
export function planCells({ fixtureIds = listFixtureIds(), models = GRID_MODELS, efforts = GRID_EFFORTS } = {}) {
  const cells = []
  for (const fixture of fixtureIds) {
    for (const model of models) {
      for (const effort of efforts) cells.push({ fixture, model, effort })
    }
  }
  return cells
}

/**
 * The agent every cell runs: always the committed one.
 *
 * Never an operator `INTERLOCK_ACP_COMMAND` — an external command is not
 * version-keyed and may ignore the effort a cell hands it, which would record a
 * level the cell never ran at (design D3).
 */
export function committedAgent() {
  return selectAgent({})
}

/**
 * Why the price table rules a model out before any request, or `null` where it
 * prices it.
 *
 * The exact string and an own key only: `claude-opus-5-5 ` with a trailing
 * space is not `claude-opus-5-5`. The reason names the table id, so a reader can
 * see which table the model was absent from.
 */
export function unpricedModel(model, prices) {
  const table = prices && prices.perMillionTokens ? prices.perMillionTokens : null
  if (!table) {
    return 'no price table was available from interlock limits --json, so no model can be confirmed priced'
  }
  if (typeof model === 'string' && Object.prototype.hasOwnProperty.call(table, model)) return null
  return (
    `${prices.id} prices no model named ${JSON.stringify(model)} — the cell is not run, and no ` +
    `request was made, rather than run on a guessed id`
  )
}

/**
 * The environment one cell's agent is started with: the caller's, with the
 * cell's model as the model override. The effort is not set here — it goes
 * through `runControlArm`, which is the only path that sets it.
 *
 * A copy, never a mutation: the process environment, and with it the outcome
 * eval's model resolution, is untouched by any cell.
 */
export function cellEnv(cell, env = process.env) {
  return { ...env, [MODEL_ENV]: cell.model }
}

/**
 * What the graders concluded, as the row's pass or fail.
 *
 * `pass` only when every applicable criterion passed. An unobserved criterion
 * is not a pass, and a not-applicable one is not counted either way.
 */
export function judgeOf(criteria) {
  const applicable = (Array.isArray(criteria) ? criteria : []).filter(c => c && c.met !== null)
  return applicable.length > 0 && applicable.every(c => c.met === true) ? 'pass' : 'fail'
}

/**
 * Run one cell end to end, by the control-arm procedure, and grade it.
 *
 * Never throws. A cell that could not be prepared, reached no model or could
 * not be graded comes back `not-run` with its reason — never as a failed judge,
 * which would be a measurement the cell did not make. Its usage travels back
 * either way, so spend that did happen is not hidden from the caller.
 */
export async function runMatrixCell({
  cell,
  fixture,
  agent,
  tmpBase = tmpdir(),
  repoRoot = REPO_ROOT,
  env = process.env,
  timeoutMs,
  keep = false,
  onLog = () => {}
}) {
  let usageBase = null
  let prepared = null
  try {
    // Outside the scratch root, so the bookkeeping file is not in the cell's diff.
    usageBase = mkdtempSync(join(existsSync(tmpBase) ? realpathSync(tmpBase) : tmpBase, 'interlock-matrix-usage-'))
    const usageFile = join(usageBase, 'usage.jsonl')
    prepared = prepareScratchRoot(fixture, { tmpBase, repoRoot })
    const { root, commit } = prepared

    const solvable = checkFixtureSolvable(fixture, root)
    if (!solvable.ok) return { status: 'not-run', reason: solvable.reason, usage: null }

    onLog(`  ${cell.fixture} / ${cell.model} / ${cell.effort}: running against ${root}`)
    const armResult = await runControlArm({
      fixture,
      root,
      agent,
      usageFile,
      effort: cell.effort,
      env: cellEnv(cell, env),
      timeoutMs,
      onLog
    })
    const usage = readAgentUsage(usageFile)
    if (!armResult.ran) {
      return { status: 'not-run', reason: armResult.reason || 'the control procedure did not run', usage }
    }
    if (usage.requests === null) {
      return {
        status: 'not-run',
        reason: `the eval's agent recorded no model request (${usage.reason}) — the model was never reached`,
        usage
      }
    }

    const graded = gradeArm({
      root,
      fixture,
      arm: 'control',
      baselineCommit: commit,
      baselineCounts: solvable.baselineCounts,
      expectCommit: true,
      workDir: usageBase
    })
    return { status: 'ran', judge: judgeOf(graded.criteria), usage, durationMs: armResult.wallClockMs }
  } catch (err) {
    return { status: 'not-run', reason: `the cell could not be prepared or graded: ${messageOf(err)}`, usage: null }
  } finally {
    if (!keep) {
      if (prepared) removeScratchRoot(prepared.root)
      if (usageBase) rmSync(usageBase, { recursive: true, force: true })
    }
  }
}

/**
 * Whether the published ceiling stops the next cell from starting.
 *
 * A BOUNDARY DECISION, consulted before a cell and never during one: a cell
 * already started is allowed to finish, because a half-killed cell could not be
 * graded and would book a failure it did not earn. `spentUsd` is the priced
 * dollars of rows already recorded in this invocation — an unpriced row adds
 * nothing, which is why a sweep whose spend cannot be priced says so rather than
 * claiming to be under budget.
 *
 * An unavailable ceiling stops nothing; the sweep has already said it is
 * unbounded.
 */
export function matrixCeilingStop({ spentUsd, ceilingUsd, cell }) {
  if (ceilingUsd === null || ceilingUsd === undefined) return { stop: false, reason: null }
  if (!(spentUsd >= ceilingUsd)) return { stop: false, reason: null }
  const name = cell ? `${cell.fixture}/${cell.model}/${cell.effort}` : 'the next cell'
  return {
    stop: true,
    reason:
      `the published ceiling (evals.matrixCostUsd = $${ceilingUsd}) was reached after $${spentUsd} of ` +
      `priced spend; ${name} and every cell after it did not start and none is a grader failure`
  }
}

/**
 * The sweep.
 *
 * Refuses a scratch base inside the repository before any cell starts. Then, cell
 * by cell in grid order: a model the price table does not contain is not run and
 * makes no request; a missing credential is not run; once the priced total of
 * recorded rows has reached the published ceiling no further cell starts and the
 * sweep is partial; everything else runs the control-arm procedure and, when it
 * ran, is priced and recorded as one row.
 *
 * Every dependency that touches a model, a disk or a clock is injectable, so the
 * grid, the refusal and the recording are tested with no network.
 */
export async function runMatrix({
  fixtureIds = listFixtureIds(),
  models = GRID_MODELS,
  efforts = GRID_EFFORTS,
  prices = null,
  ceilingUsd = null,
  ceilingReason = null,
  tmpBase = tmpdir(),
  repoRoot = REPO_ROOT,
  historyRoot = repoRoot,
  env = process.env,
  agent = committedAgent(),
  version = versionUnderTest(repoRoot),
  timeoutMs,
  keep = false,
  runCell = runMatrixCell,
  append = appendCostPerTask,
  onLog = () => {}
} = {}) {
  const sweep = {
    schema: MATRIX_SWEEP_SCHEMA,
    version,
    procedure: 'control',
    evalAgent: agent.identity,
    priceTable: prices && prices.id ? prices.id : 'unavailable',
    ceilingUsd,
    ceilingReason,
    refused: null,
    partial: false,
    partialReason: null,
    spentUsd: 0,
    cells: [],
    recorded: 0,
    historyPath: null,
    failures: []
  }

  // Before any cell, and stated: a run that polluted this repository's corpora
  // would be worse than one that never happened.
  try {
    assertScratchRootOutsideRepo(tmpBase, repoRoot)
  } catch (err) {
    sweep.refused = messageOf(err)
    return sweep
  }

  const ready = preflight(agent, { env })
  const fixtures = new Map(fixtureIds.map(id => [id, readFixture(id)]))

  let ceilingReached = null
  for (const cell of planCells({ fixtureIds, models, efforts })) {
    const notRun = reason => sweep.cells.push({ ...cell, status: 'not-run', reason })

    const absent = unpricedModel(cell.model, prices)
    if (absent) {
      notRun(absent)
      continue
    }
    if (!ready.ok) {
      notRun(ready.reason)
      continue
    }

    // Before the cell, never during it. Once reached, every remaining cell is
    // not run for that reason and the invocation is partial — not a completed
    // grid, and not a failing one.
    if (!ceilingReached) {
      const stop = matrixCeilingStop({ spentUsd: sweep.spentUsd, ceilingUsd, cell })
      if (stop.stop) {
        ceilingReached = stop.reason
        sweep.partial = true
        sweep.partialReason = stop.reason
      }
    }
    if (ceilingReached) {
      notRun(ceilingReached)
      continue
    }

    const result = await runCell({
      cell,
      fixture: fixtures.get(cell.fixture),
      agent,
      tmpBase,
      repoRoot,
      env,
      timeoutMs,
      keep,
      onLog
    })
    if (!result || result.status !== 'ran') {
      notRun((result && result.reason) || 'the cell did not run')
      continue
    }

    // Priced by the outcome eval's own pricer, with the cell's own model id and
    // the usage exactly as the agent's records summed it — cache reads and the
    // tier-keyed write record included. No second table, no second conversion:
    // a measured zero is priced as zero, and an absent count comes back unpriced
    // with its reason rather than priced on the terms that happened to be there.
    const usage = result.usage || null
    const priced = priceUsage(usage, cell.model, prices)
    const row = {
      version,
      fixture: cell.fixture,
      model: cell.model,
      effort: cell.effort,
      evalAgent: agent.identity,
      // A red grader is a field on the row, not a failure of the sweep.
      judge: result.judge,
      inputTokens: usage ? usage.inputTokens : null,
      outputTokens: usage ? usage.outputTokens : null,
      cacheReadInputTokens: usage ? usage.cacheReadInputTokens : null,
      cacheCreationInputTokens: usage ? usage.cacheCreationInputTokens : null,
      usd: priced.usd,
      pricesId: priced.priceTable || (prices && prices.id) || null,
      usdReason: priced.reason,
      durationMs: result.durationMs
    }
    const written = append(historyRoot, row)
    const recorded = Boolean(written && written.written)
    sweep.cells.push({ ...cell, status: 'ran', judge: row.judge, usd: row.usd, usdReason: row.usdReason, recorded })
    if (recorded) {
      sweep.recorded++
      sweep.historyPath = written.path
      // Only a priced, recorded row counts toward the ceiling.
      if (typeof row.usd === 'number') sweep.spentUsd = Math.round((sweep.spentUsd + row.usd) * 10000) / 10000
    } else {
      // The only durable product of a metered cell could not be kept. Stop
      // spending: every cell after this one would be lost the same way.
      sweep.failures.push(
        `${cell.fixture}/${cell.model}/${cell.effort}: ${(written && written.reason) || 'the row was not written'}`
      )
      break
    }
  }

  // Cells never reached because the record failed are named, never dropped.
  const reached = sweep.cells.length
  for (const cell of planCells({ fixtureIds, models, efforts }).slice(reached)) {
    sweep.cells.push({ ...cell, status: 'not-run', reason: 'the sweep stopped: a result row could not be written' })
  }
  return sweep
}

/**
 * The sweep's exit status.
 *
 * Non-zero only when the sweep itself could not proceed: the scratch root was
 * refused, or a row could not be written. A failed judge is a field on a row and
 * exits zero, and so does a partial sweep — turning a measurement into a
 * non-zero status is the first step toward something gating on it.
 */
export function matrixExitCode(sweep) {
  if (!sweep) return 1
  if (sweep.refused) return 1
  return Array.isArray(sweep.failures) && sweep.failures.length ? 1 : 0
}

// --- the command ------------------------------------------------------------

const USAGE = `interlock cost-per-task sweep — the committed fixtures × model × effort, priced

Usage:
  node evals/ship/matrix.mjs [flags]

Flags:
  --fixture <id>     only this fixture (repeatable); default: every outcome fixture
  --tmp-base <dir>   where scratch roots are created (default: the system temp dir)
  --history-root <d> where the record is appended (default: this repository)
  --keep             leave the scratch roots on disk
  --timeout-ms <n>   per-agent transport budget
  --json             print one JSON object instead of prose
  --help

Not the outcome eval. Each cell runs the control-arm procedure — one prompt per
task with the committed agent, then the fixture's graders — at one model and one
effort, and appends one row to evals/history/cost-per-task.jsonl. It runs no
wave loop, issues no verdict and changes no routing default.

METERED. Bounded by the ceiling \`interlock limits\` publishes for this sweep,
checked between cells only: it stops the next cell from starting and never kills
one in flight. A sweep stopped there is partial, and exits zero.

Exit codes:
  0  the sweep ran (complete or partial) and every row it produced was recorded
  1  the scratch root was refused, a row could not be written, or a fixture was
     named that does not exist
`

function parseArgv(argv) {
  const flags = { fixture: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--fixture') flags.fixture.push(argv[++i])
    else if (arg === '--tmp-base') flags.tmpBase = argv[++i]
    else if (arg === '--history-root') flags.historyRoot = argv[++i]
    else if (arg === '--timeout-ms') flags.timeoutMs = Number.parseInt(argv[++i], 10)
    else if (arg === '--keep') flags.keep = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--help' || arg === '-h') flags.help = true
    else throw new Error(`unknown flag: ${arg}`)
  }
  return flags
}

function formatSweep(sweep) {
  const lines = []
  lines.push(
    `INTERLOCK COST-PER-TASK SWEEP — ${sweep.version}, ${sweep.procedure} procedure, agent ${sweep.evalAgent}`
  )
  if (sweep.refused) {
    lines.push(`  REFUSED — ${sweep.refused}`)
    return lines.join('\n') + '\n'
  }
  lines.push(
    `  ceiling ${sweep.ceilingUsd === null ? `unavailable — ${sweep.ceilingReason}` : `$${sweep.ceilingUsd}`}` +
      ` (interlock limits), price table ${sweep.priceTable}, priced spend $${sweep.spentUsd}` +
      (sweep.partial ? `  — PARTIAL: ${sweep.partialReason}` : '')
  )
  lines.push('')
  for (const cell of sweep.cells) {
    const name = `${cell.fixture} / ${cell.model} / ${cell.effort}`
    if (cell.status !== 'ran') {
      lines.push(`  ${name}: NOT RUN — ${cell.reason}`)
      continue
    }
    lines.push(
      `  ${name}: judge ${cell.judge}, ` +
        (cell.usd === null ? `unpriced — ${cell.usdReason}` : `$${cell.usd}`)
    )
  }
  lines.push('')
  lines.push(
    `  ${sweep.recorded} row(s) appended to ${sweep.historyPath || 'nowhere'}. ` +
      `No routing default was changed; a limits edit may cite these rows.`
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

  // Spoken, never silent: an operator agent is not what this sweep runs.
  const override = process.env[ACP_COMMAND_ENV]
  if (typeof override === 'string' && override.trim()) {
    process.stderr.write(
      `interlock cost-per-task sweep: ${ACP_COMMAND_ENV} is set and is ignored — every cell runs ` +
        `the committed eval agent, the only one that is version-keyed and honours a cell's effort\n`
    )
  }

  const { ceilingUsd, prices, reason: ceilingReason } = readMatrixLimits()
  const log = line => {
    if (!flags.json) process.stdout.write(`${line}\n`)
  }
  const sweep = await runMatrix({
    fixtureIds: flags.fixture.length ? flags.fixture : listFixtureIds(),
    prices,
    ceilingUsd,
    ceilingReason,
    tmpBase: flags.tmpBase || tmpdir(),
    historyRoot: flags.historyRoot || REPO_ROOT,
    timeoutMs: Number.isInteger(flags.timeoutMs) ? flags.timeoutMs : undefined,
    keep: Boolean(flags.keep),
    onLog: log
  })

  if (flags.json) process.stdout.write(`${JSON.stringify(sweep, null, 2)}\n`)
  else process.stdout.write(formatSweep(sweep))

  if (sweep.refused) process.stderr.write(`interlock cost-per-task sweep: ${sweep.refused}\n`)
  if (sweep.failures.length) {
    process.stderr.write(
      `interlock cost-per-task sweep: ${sweep.failures.length} row(s) could not be recorded:\n` +
        `  ${sweep.failures.join('\n  ')}\n`
    )
  }
  return matrixExitCode(sweep)
}

if (process.argv[1] && process.argv[1].endsWith('matrix.mjs')) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    err => {
      process.stderr.write(`${messageOf(err)}\n`)
      process.exit(1)
    }
  )
}
