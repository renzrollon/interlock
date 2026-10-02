// The cost-per-task sweep (spec: evals/cost-per-task).
//
// Everything here runs with no network, no credential and no model call. The
// model client is driven by a stub `fetch`; the sweep is driven by an injected
// cell runner that returns fixture usage, so what is proved is the grid, the
// isolation refusal, the pricing classification, the ceiling and the record —
// not what a model would say, which cannot be asserted offline anyway.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createModelClient, DEFAULT_MODEL, EFFORT_ENV, MODEL_ENV } from '../../evals/ship/agent/model.mjs'
import { clientOptionsFromEnv, AGENT_IDENTITY } from '../../evals/ship/agent/main.mjs'
import { armEnv, priceUsage } from '../../evals/ship/arms.mjs'
import { modelUnderTest, selectAgent, REPO_ROOT } from '../../evals/ship/run.mjs'
import { readFixture } from '../../evals/ship/fixtures.mjs'
import {
  appendCostPerTask,
  costPerTaskPath,
  readCostPerTask,
  shipOutcomesPath,
  COST_PER_TASK_FIELDS,
  COST_PER_TASK_SCHEMA
} from '../../lib/eval-history.mjs'
import { EVAL_CAPS, MODEL_PRICES } from '../../lib/limits.mjs'
import {
  cellEnv,
  committedAgent,
  matrixCeilingStop,
  matrixExitCode,
  planCells,
  readMatrixLimits,
  runMatrix,
  runMatrixCell,
  GRID_EFFORTS,
  GRID_MODELS
} from '../../evals/ship/matrix.mjs'

/** A scratch directory under the system temp dir, removed by the caller. */
function scratch(prefix = 'interlock-cost-per-task-test-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** A stub `fetch` that replays canned Messages API responses in order and records each body. */
function stubFetch(responses) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    const next = responses.shift()
    if (!next) throw new Error('stub fetch ran out of responses')
    return { ok: true, status: 200, json: async () => next }
  }
  return { impl, calls }
}

/** One finished turn, so a client's `run` returns after a single request. */
const DONE = () => ({
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  content: [{ type: 'text', text: 'done' }]
})

async function oneRequestBody(options) {
  const { impl, calls } = stubFetch([DONE()])
  const client = createModelClient({ apiKey: 'test-key', fetchImpl: impl, ...options })
  await client.run({ prompt: 'p', system: 's', tools: [], executeTool: () => ({ content: '', isError: false }) })
  assert.equal(calls.length, 1)
  return { body: calls[0].body, client }
}

// --- 1.1 the model client's optional effort -----------------------------------

test('a client given an effort sends output_config.effort at that level on every request', async () => {
  const { impl, calls } = stubFetch([
    {
      stop_reason: 'tool_use',
      usage: { input_tokens: 5, output_tokens: 1 },
      content: [{ type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a' } }]
    },
    DONE()
  ])
  const client = createModelClient({ apiKey: 'k', fetchImpl: impl, effort: 'low' })
  assert.equal(client.effort, 'low')
  await client.run({ prompt: 'p', executeTool: () => ({ content: 'x', isError: false }) })
  assert.equal(calls.length, 2)
  for (const { body } of calls) {
    assert.deepEqual(body.output_config, { effort: 'low' })
  }
})

test('a client given no effort sends no output_config at all', async () => {
  const { body, client } = await oneRequestBody({})
  assert.equal(client.effort, null)
  assert.ok(!('output_config' in body), 'an omitted effort must not put output_config in the body')
  // null is omission too, never a level the API is asked to read.
  const { body: nulled } = await oneRequestBody({ effort: null })
  assert.ok(!('output_config' in nulled))
})

test('an effort the API could not read as a level is refused before any request', () => {
  for (const bad of ['', ' low', 'low ', 3, {}]) {
    assert.throws(
      () => createModelClient({ apiKey: 'k', fetchImpl: async () => assert.fail('no request expected'), effort: bad }),
      /effort must be/
    )
  }
})

test('loading the client with an effort leaves the outcome eval’s default model unchanged', async () => {
  const { body, client } = await oneRequestBody({ effort: 'low' })
  // A client given an effort and no model still calls the eval's own default …
  assert.equal(DEFAULT_MODEL, 'claude-opus-5-5')
  assert.equal(client.model, DEFAULT_MODEL)
  assert.equal(body.model, DEFAULT_MODEL)
  // … and the outcome eval, resolving its model with no override after the
  // client was built with an effort, still resolves that same default.
  assert.equal(modelUnderTest(selectAgent({}), {}), DEFAULT_MODEL)
})

// --- 2.1 the cost-per-task record ---------------------------------------------

/** A row as the sweep would hand it over, padded with everything the record must NOT keep. */
function fatRow(over = {}) {
  return {
    version: '9.9.9',
    fixture: 'docs-and-code',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    evalAgent: 'interlock-eval-acp-agent/2',
    judge: 'pass',
    inputTokens: 1200,
    outputTokens: 300,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: { ephemeral_5m: 800, ephemeral_1h: 0 },
    usd: 0.0123,
    pricesId: 'anthropic-list-2026-10',
    usdReason: null,
    durationMs: 4567,
    // None of this may reach the file.
    transcript: 'the whole conversation',
    prompt: 'implement task 1.1',
    diff: 'diff --git a/x b/x',
    stdout: 'npm test output',
    criteria: [{ id: 'unit-suite-green', status: 'pass' }],
    arm: 'loop',
    ...over
  }
}

test('a fat input writes only the named fields, under the cost-per-task schema', () => {
  const root = scratch()
  try {
    const written = appendCostPerTask(root, fatRow())
    assert.equal(written.written, true, written.reason)
    assert.equal(written.path, costPerTaskPath(root))
    const lines = readFileSync(written.path, 'utf8').split('\n').filter(Boolean)
    assert.equal(lines.length, 1)
    const row = JSON.parse(lines[0])
    assert.deepEqual(Object.keys(row), [...COST_PER_TASK_FIELDS])
    assert.equal(row.schema, COST_PER_TASK_SCHEMA)
    assert.equal(row.schema, 'interlock.cost-per-task/1')
    assert.equal(row.procedure, 'control', 'the row is labelled as the control procedure, never as a loop run')
    for (const leaked of ['transcript', 'prompt', 'diff', 'stdout', 'criteria', 'arm']) {
      assert.ok(!(leaked in row), `${leaked} must not be written`)
    }
    assert.ok(!lines[0].includes('the whole conversation'))
    // A measured zero stays a zero; the tier object is kept tier by tier.
    assert.equal(row.cacheReadInputTokens, 0)
    assert.deepEqual(row.cacheCreationInputTokens, { ephemeral_5m: 800, ephemeral_1h: 0 })
    assert.equal(row.usdReason, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the record never touches ship-outcomes.jsonl', () => {
  const root = scratch()
  try {
    const outcomes = shipOutcomesPath(root)
    mkdirSync(join(root, 'evals', 'history'), { recursive: true })
    const before = '{"schema":"interlock.ship-outcome-eval/1","fixture":"docs-and-code"}\n'
    writeFileSync(outcomes, before)
    assert.equal(appendCostPerTask(root, fatRow()).written, true)
    assert.equal(appendCostPerTask(root, fatRow({ judge: 'fail' })).written, true)
    assert.equal(readFileSync(outcomes, 'utf8'), before, 'the outcome history must be byte-identical')
    assert.notEqual(costPerTaskPath(root), outcomes)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a second append does not rewrite the first line', () => {
  const root = scratch()
  try {
    appendCostPerTask(root, fatRow({ now: '2026-10-01T00:00:00.000Z' }))
    const first = readFileSync(costPerTaskPath(root), 'utf8')
    appendCostPerTask(root, fatRow({ effort: 'xhigh', now: '2026-10-01T00:01:00.000Z' }))
    const after = readFileSync(costPerTaskPath(root), 'utf8')
    assert.ok(after.startsWith(first), 'the first line must survive the second append byte for byte')
    assert.equal(after.split('\n').filter(Boolean).length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a torn last line is skipped and counted, and costs only that line', () => {
  const root = scratch()
  try {
    appendCostPerTask(root, fatRow())
    // A crashed append: half a record, no newline.
    appendFileSync(costPerTaskPath(root), '{"schema":"interlock.cost-per-task/1","fixture":"dep')
    appendCostPerTask(root, fatRow({ effort: 'high' }))
    const read = readCostPerTask(root)
    assert.equal(read.reason, null)
    assert.equal(read.records.length, 2, 'both whole rows survive the torn one between them')
    assert.deepEqual(read.records.map(r => r.effort), ['medium', 'high'])
    assert.equal(read.skipped.length, 1, 'the torn line is counted, not silently dropped')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed append fails the caller with a reason, and an unjudged or inexact row is refused', () => {
  const root = scratch()
  try {
    // A file where the history directory must go: the directory cannot be made.
    writeFileSync(join(root, 'evals'), 'not a directory')
    const failed = appendCostPerTask(root, fatRow())
    assert.equal(failed.written, false)
    assert.ok(failed.reason)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const clean = scratch()
  try {
    assert.match(appendCostPerTask(clean, fatRow({ judge: undefined })).reason, /judge/)
    assert.match(appendCostPerTask(clean, fatRow({ model: 'claude-opus-5-5 ' })).reason, /model id/)
    // An unpriced row always says why.
    const unpriced = appendCostPerTask(clean, fatRow({ usd: null, usdReason: 'no cache-read count was measured' }))
    assert.equal(unpriced.written, true)
    const [row] = readCostPerTask(clean).records
    assert.equal(row.usd, null)
    assert.match(row.usdReason, /cache-read/)
  } finally {
    rmSync(clean, { recursive: true, force: true })
  }
})

// --- 3.1 the published ceiling ------------------------------------------------

test('the sweep reads its ceiling and price table from interlock limits --json', () => {
  const read = readMatrixLimits()
  assert.equal(read.reason, null)
  assert.equal(read.ceilingUsd, EVAL_CAPS.matrixCostUsd)
  assert.equal(read.prices.id, MODEL_PRICES.id)
  // Not the outcome eval's ceiling: two runs, two budgets.
  assert.notEqual(read.ceilingUsd, undefined)
})

test('an unpublished ceiling is stated, never invented', () => {
  const read = readMatrixLimits(() => ({ json: { evals: { shipEvalCostUsd: 20 }, prices: null } }))
  assert.equal(read.ceilingUsd, null, 'the outcome eval\u2019s ceiling must not stand in for this one')
  assert.match(read.reason, /evals\.matrixCostUsd/)
  assert.equal(readMatrixLimits(() => ({ json: null })).ceilingUsd, null)
})

// --- 3.2 the sweep: the grid, the procedure, the isolation --------------------

/** Usage as the eval agent's usage file would sum it: every count measured. */
function measuredUsage(over = {}) {
  return {
    requests: 4,
    inputTokens: 20_000,
    outputTokens: 5_000,
    cacheReadInputTokens: 60_000,
    cacheCreationInputTokens: { ephemeral_5m: 10_000, ephemeral_1h: 0 },
    reason: null,
    ...over
  }
}

/** A cell runner that records what it was asked to run and makes no request. */
function fakeCells(outcome = () => ({ status: 'ran', judge: 'pass', usage: measuredUsage(), durationMs: 1000 })) {
  const calls = []
  const runCell = async ({ cell, fixture, agent, env }) => {
    calls.push({ cell, fixture, agent, env })
    return outcome(cell, calls.length)
  }
  return { runCell, calls }
}

/** Sweep options that touch nothing real: a scratch history root, a credential, the current table. */
function offline(historyRoot, over = {}) {
  return {
    fixtureIds: ['docs-and-code'],
    prices: MODEL_PRICES,
    ceilingUsd: null,
    historyRoot,
    env: { ANTHROPIC_API_KEY: 'test-key' },
    version: '0.0.0-test',
    ...over
  }
}

test('the grid is the two API model ids by the four efforts, with no haiku and no max', () => {
  assert.deepEqual([...GRID_MODELS], ['claude-opus-5-5', 'claude-sonnet-5-5'])
  assert.deepEqual([...GRID_EFFORTS], ['low', 'medium', 'high', 'xhigh'])
  assert.ok(!GRID_MODELS.some(m => /haiku/.test(m)))
  assert.ok(!GRID_EFFORTS.includes('max'))
  // Every grid model is a key in the table it is priced by — the exact string.
  for (const model of GRID_MODELS) {
    assert.ok(Object.prototype.hasOwnProperty.call(MODEL_PRICES.perMillionTokens, model), model)
  }
})

test('one fixture yields eight cells, and the sweep runs each with its own model and effort', async () => {
  const cells = planCells({ fixtureIds: ['docs-and-code'] })
  assert.equal(cells.length, 8)
  assert.equal(new Set(cells.map(c => `${c.model}|${c.effort}`)).size, 8)

  const root = scratch()
  try {
    const { runCell, calls } = fakeCells()
    const sweep = await runMatrix({ ...offline(root), runCell })
    assert.equal(sweep.refused, null)
    assert.equal(calls.length, 8, 'one control-procedure run per cell')
    assert.deepEqual(
      calls.map(c => [c.cell.model, c.cell.effort]),
      GRID_MODELS.flatMap(m => GRID_EFFORTS.map(e => [m, e]))
    )
    for (const call of calls) {
      assert.equal(call.fixture.id, 'docs-and-code')
      assert.equal(call.agent.source, 'committed', 'every cell runs the committed agent')
      assert.equal(call.agent.identity, AGENT_IDENTITY)
    }
    assert.equal(sweep.recorded, 8)
    assert.equal(readCostPerTask(root).records.length, 8)
    assert.equal(matrixExitCode(sweep), 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the sweep never writes the outcome history and never runs the wave loop', async () => {
  const root = scratch()
  try {
    const { runCell } = fakeCells()
    await runMatrix({ ...offline(root), runCell })
    assert.ok(!existsSync(shipOutcomesPath(root)), 'no row may land in ship-outcomes.jsonl')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const source = readFileSync(join(REPO_ROOT, 'evals', 'ship', 'matrix.mjs'), 'utf8')
  for (const forbidden of ['appendShipOutcome', 'runLoopArm', 'SHIP_ACP_BIN', 'interlock-ship-acp', 'lib/run.mjs']) {
    assert.ok(!source.includes(forbidden), `the sweep must not reference ${forbidden}`)
  }
  assert.match(source, /runControlArm\(/, 'a cell runs the control-arm procedure')
})

test('a trailing-space model id is not called, and is not read as the grid model', async () => {
  const root = scratch()
  try {
    const { runCell, calls } = fakeCells()
    const sweep = await runMatrix({ ...offline(root), models: ['claude-opus-5-5 '], runCell })
    assert.equal(calls.length, 0, 'no request may be made for a model the table does not contain')
    assert.equal(sweep.cells.length, 4)
    for (const cell of sweep.cells) {
      assert.equal(cell.status, 'not-run')
      assert.equal(cell.model, 'claude-opus-5-5 ')
      assert.match(cell.reason, new RegExp(MODEL_PRICES.id))
    }
    assert.equal(sweep.recorded, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a scratch root inside this repository is refused, with the reason, before any cell starts', async () => {
  const root = scratch()
  try {
    const { runCell, calls } = fakeCells()
    const sweep = await runMatrix({ ...offline(root), tmpBase: join(REPO_ROOT, 'evals'), runCell })
    assert.equal(calls.length, 0)
    assert.match(sweep.refused, /refusing to run a fixture against .* inside/)
    assert.equal(sweep.cells.length, 0, 'no cell starts once the root is refused')
    assert.equal(matrixExitCode(sweep), 1)
    assert.ok(!existsSync(costPerTaskPath(root)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a missing credential is not run with that reason, never a graded failure', async () => {
  const root = scratch()
  try {
    const { runCell, calls } = fakeCells()
    const sweep = await runMatrix({ ...offline(root), env: {}, runCell })
    assert.equal(calls.length, 0)
    assert.ok(sweep.cells.every(c => c.status === 'not-run' && /ANTHROPIC_API_KEY/.test(c.reason)))
    assert.equal(sweep.recorded, 0)
    assert.equal(matrixExitCode(sweep), 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a cell’s request carries that cell’s model and effort, through the agent’s own option reader', async () => {
  const agent = committedAgent()
  for (const cell of planCells({ fixtureIds: ['docs-and-code'] })) {
    const env = armEnv({ agent, usageFile: '/dev/null', effort: cell.effort, env: cellEnv(cell, { ANTHROPIC_API_KEY: 'k' }) })
    const { body } = await oneRequestBody(clientOptionsFromEnv(env))
    assert.equal(body.model, cell.model)
    assert.deepEqual(body.output_config, { effort: cell.effort })
  }
})

test('the sweep and the outcome eval imported together each resolve only their own model', async () => {
  const before = process.env[MODEL_ENV]
  const root = scratch()
  try {
    const { runCell, calls } = fakeCells()
    await runMatrix({ ...offline(root), runCell })
    // The outcome eval, with no override, still resolves its single default …
    assert.equal(process.env[MODEL_ENV], before, 'no cell may set the model in the process environment')
    assert.equal(modelUnderTest(selectAgent({}), {}), DEFAULT_MODEL)
    // … and each cell resolves only its own.
    for (const call of calls) {
      assert.equal(clientOptionsFromEnv(cellEnv(call.cell, {})).model, call.cell.model)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- 3.3 pricing each finished cell -------------------------------------------

/** Run a one-cell sweep (opus, low) whose cell finishes with the given result; return the sweep and its row. */
async function oneCell(result, over = {}) {
  const root = scratch()
  try {
    const { runCell, calls } = fakeCells(() => result)
    const sweep = await runMatrix({
      ...offline(root),
      models: ['claude-opus-5-5'],
      efforts: ['low'],
      runCell,
      ...over
    })
    return { sweep, calls, rows: readCostPerTask(root).records }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a priced cell stores the judge, the token counts, the dollars and the table id', async () => {
  const usage = measuredUsage()
  const { sweep, rows } = await oneCell({ status: 'ran', judge: 'pass', usage, durationMs: 2500 })
  assert.equal(rows.length, 1)
  const [row] = rows
  assert.equal(row.fixture, 'docs-and-code')
  assert.equal(row.model, 'claude-opus-5-5')
  assert.equal(row.effort, 'low')
  assert.equal(row.judge, 'pass')
  assert.equal(row.inputTokens, usage.inputTokens)
  assert.equal(row.outputTokens, usage.outputTokens)
  assert.equal(row.cacheReadInputTokens, usage.cacheReadInputTokens)
  assert.deepEqual(row.cacheCreationInputTokens, usage.cacheCreationInputTokens)
  // The one pricer, with the cell's own model id — not a figure computed here.
  assert.equal(row.usd, priceUsage(usage, 'claude-opus-5-5', MODEL_PRICES).usd)
  assert.ok(row.usd > 0)
  assert.equal(row.pricesId, MODEL_PRICES.id)
  assert.equal(row.usdReason, null)
  assert.equal(row.durationMs, 2500)
  assert.equal(matrixExitCode(sweep), 0)
})

test('a measured zero cache read is a priced row; an absent one is unpriced and keeps its judge', async () => {
  const zero = measuredUsage({ cacheReadInputTokens: 0 })
  const priced = await oneCell({ status: 'ran', judge: 'pass', usage: zero, durationMs: 1 })
  const [pricedRow] = priced.rows
  assert.equal(pricedRow.cacheReadInputTokens, 0, 'a measured zero stays zero')
  assert.equal(typeof pricedRow.usd, 'number')
  assert.equal(pricedRow.usd, priceUsage(zero, 'claude-opus-5-5', MODEL_PRICES).usd)
  assert.equal(pricedRow.usdReason, null)

  const absent = measuredUsage({ cacheReadInputTokens: null })
  const unpriced = await oneCell({ status: 'ran', judge: 'pass', usage: absent, durationMs: 1 })
  const [unpricedRow] = unpriced.rows
  assert.equal(unpricedRow.cacheReadInputTokens, null, 'an absent count stays absent, never zero')
  assert.equal(unpricedRow.usd, null)
  assert.match(unpricedRow.usdReason, /cacheReadInputTokens/)
  assert.equal(unpricedRow.judge, 'pass', 'an unpriced row still carries the judge result')
  assert.equal(matrixExitCode(unpriced.sweep), 0)
})

test('a failed grader is a failed row, and the sweep still exits success', async () => {
  const { sweep, rows } = await oneCell({ status: 'ran', judge: 'fail', usage: measuredUsage(), durationMs: 1 })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].judge, 'fail')
  assert.equal(typeof rows[0].usd, 'number', 'a red cell is still priced')
  assert.deepEqual(sweep.failures, [])
  assert.equal(matrixExitCode(sweep), 0)
})

test('an unwritable row fails the sweep, distinct from a red grader, and stops the spend', async () => {
  let n = 0
  const append = () => (++n === 1 ? { written: true, path: '/x' } : { written: false, path: null, reason: 'disk full' })
  const root = scratch()
  try {
    const { runCell, calls } = fakeCells((cell, i) => ({
      status: 'ran',
      judge: i === 1 ? 'fail' : 'pass',
      usage: measuredUsage(),
      durationMs: 1
    }))
    const sweep = await runMatrix({ ...offline(root), runCell, append })
    assert.equal(calls.length, 2, 'no cell starts after a row could not be written')
    assert.equal(sweep.recorded, 1)
    assert.equal(sweep.cells[0].judge, 'fail', 'the red cell was recorded as a failure …')
    assert.match(sweep.failures[0], /disk full/, '… and the unwritable record is the failure')
    assert.equal(sweep.cells.length, 8, 'the cells never reached are named')
    assert.ok(sweep.cells.slice(2).every(c => c.status === 'not-run' && /could not be written/.test(c.reason)))
    assert.equal(matrixExitCode(sweep), 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a model the current table does not contain is not run, names the table id, and makes no request', async () => {
  const withoutSonnet = {
    ...MODEL_PRICES,
    id: 'a-table-without-sonnet',
    perMillionTokens: { 'claude-opus-5-5': MODEL_PRICES.perMillionTokens['claude-opus-5-5'] }
  }
  const root = scratch()
  try {
    const { runCell, calls } = fakeCells()
    const sweep = await runMatrix({ ...offline(root), prices: withoutSonnet, runCell })
    assert.ok(calls.every(c => c.cell.model === 'claude-opus-5-5'), 'no request for a model the table lacks')
    assert.equal(calls.length, 4)
    const sonnet = sweep.cells.filter(c => c.model === 'claude-sonnet-5-5')
    assert.equal(sonnet.length, 4)
    for (const cell of sonnet) {
      assert.equal(cell.status, 'not-run')
      assert.match(cell.reason, /a-table-without-sonnet/)
    }
    assert.ok(readCostPerTask(root).records.every(r => r.model === 'claude-opus-5-5'))
    assert.equal(matrixExitCode(sweep), 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- 3.4 the ceiling, between cells -------------------------------------------

test('a priced total already at the ceiling does not start the next cell, and is no grader failure', async () => {
  const usage = measuredUsage()
  const perCell = priceUsage(usage, 'claude-opus-5-5', MODEL_PRICES).usd
  const root = scratch()
  try {
    const { runCell, calls } = fakeCells(() => ({ status: 'ran', judge: 'pass', usage, durationMs: 1 }))
    // The first cell's priced dollars reach the ceiling exactly.
    const sweep = await runMatrix({ ...offline(root), models: ['claude-opus-5-5'], ceilingUsd: perCell, runCell })
    assert.equal(calls.length, 1, 'the cell after the total met the ceiling must not start')
    assert.equal(sweep.partial, true)
    assert.match(sweep.partialReason, /evals\.matrixCostUsd/)
    const unstarted = sweep.cells.slice(1)
    assert.equal(unstarted.length, 3)
    for (const cell of unstarted) {
      assert.equal(cell.status, 'not-run')
      assert.match(cell.reason, /ceiling/)
      assert.ok(!('judge' in cell), 'an unstarted cell carries no judge, and so no failure')
    }
    const rows = readCostPerTask(root).records
    assert.equal(rows.length, 1, 'no row is written for a cell that never started')
    assert.ok(!rows.some(r => r.judge === 'fail'))
    assert.equal(matrixExitCode(sweep), 0, 'partial is not a failing sweep')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a started cell is never killed: the one that crosses the ceiling is recorded in full', async () => {
  const root = scratch()
  try {
    const usage = measuredUsage({ outputTokens: 5_000_000 })
    const { runCell, calls } = fakeCells(() => ({ status: 'ran', judge: 'pass', usage, durationMs: 1 }))
    const sweep = await runMatrix({ ...offline(root), models: ['claude-opus-5-5'], ceilingUsd: 1, runCell })
    assert.equal(calls.length, 1)
    const [row] = readCostPerTask(root).records
    assert.ok(row.usd > 1, 'the crossing cell finished and was priced past the ceiling')
    assert.equal(sweep.spentUsd, row.usd)
    assert.equal(sweep.partial, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unpriced row adds nothing to the total the ceiling is checked against', async () => {
  const root = scratch()
  try {
    const usage = measuredUsage({ cacheReadInputTokens: null })
    const { runCell, calls } = fakeCells(() => ({ status: 'ran', judge: 'pass', usage, durationMs: 1 }))
    const sweep = await runMatrix({ ...offline(root), models: ['claude-opus-5-5'], ceilingUsd: 0.0001, runCell })
    assert.equal(calls.length, 4, 'unpriced cells never reach the ceiling')
    assert.equal(sweep.spentUsd, 0)
    assert.equal(sweep.partial, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the ceiling check is a boundary decision with nothing to stop when no ceiling was published', () => {
  assert.equal(matrixCeilingStop({ spentUsd: 1e9, ceilingUsd: null }).stop, false)
  assert.equal(matrixCeilingStop({ spentUsd: 4, ceilingUsd: 5 }).stop, false)
  assert.equal(matrixCeilingStop({ spentUsd: 5, ceilingUsd: 5 }).stop, true, 'meeting the ceiling stops, not only passing it')
})

// --- the real cell runner, end to end, with an agent that calls no model ------
//
// The cells above are injected. This one runs the real path — scratch root,
// solvability check, the control-arm procedure over the ACP host, the usage
// file, the graders — against an agent that speaks the committed agent's wire
// and writes a usage record but calls no model. It proves the cell's model and
// effort reach the agent process, and that an effort the caller's environment
// happened to carry does not.

const FAKE_AGENT = `
import { appendFileSync } from 'node:fs'
import { createAgent, createLineReader } from ${JSON.stringify(join(REPO_ROOT, 'evals', 'ship', 'agent', 'wire.mjs'))}
const send = m => process.stdout.write(JSON.stringify(m) + '\\n')
const { handle } = createAgent({
  send,
  async onPrompt({ sessionId, emit }) {
    appendFileSync(process.env.FAKE_SEEN_FILE, JSON.stringify({
      model: process.env.INTERLOCK_EVAL_MODEL || null,
      effort: process.env.INTERLOCK_EVAL_EFFORT || null
    }) + '\\n')
    appendFileSync(process.env.INTERLOCK_EVAL_USAGE_FILE, JSON.stringify({
      schema: 'interlock.ship-eval-agent-usage/3', sessionId, requests: 1,
      inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 0,
      cacheCreationInputTokens: { ephemeral_5m: 0, ephemeral_1h: 0 }
    }) + '\\n')
    emit('{}')
    return { stopReason: 'end_turn' }
  }
})
const feed = createLineReader(handle, () => {})
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { feed(chunk) })
process.stdin.on('end', () => process.exit(0))
`

test('a real cell hands its model and effort to the agent, and grades a cell that did nothing as failed', async () => {
  const base = scratch()
  try {
    const agentPath = join(base, 'fake-agent.mjs')
    writeFileSync(agentPath, FAKE_AGENT)
    const seenFile = join(base, 'seen.jsonl')
    const cell = { fixture: 'docs-and-code', model: 'claude-sonnet-5-5', effort: 'low' }
    const result = await runMatrixCell({
      cell,
      fixture: readFixture(cell.fixture),
      agent: { command: `${process.execPath} ${agentPath}`, source: 'committed', identity: 'fake' },
      tmpBase: base,
      // A stray effort and model in the caller's environment must not reach the agent.
      env: { ...process.env, FAKE_SEEN_FILE: seenFile, [EFFORT_ENV]: 'max', [MODEL_ENV]: 'claude-haiku-4-5' }
    })
    assert.equal(result.status, 'ran', result.reason)
    // The agent wrote nothing, so the fixture's suite is still red: a failed judge, not a not-run.
    assert.equal(result.judge, 'fail')
    assert.ok(result.usage.requests > 0)
    assert.equal(result.usage.cacheReadInputTokens, 0, 'a measured zero survives the usage sum')
    const seen = readFileSync(seenFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    assert.equal(seen.length, result.usage.requests, 'one agent session per fixture task')
    for (const entry of seen) assert.deepEqual(entry, { model: cell.model, effort: cell.effort })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

// --- 4.1 the page that documents the sweep ------------------------------------

test('docs/14 documents the sweep, names interlock limits, and never states its ceiling or a dial', () => {
  const page = readFileSync(join(REPO_ROOT, 'docs', '14-evals.md'), 'utf8')
  const flat = page.replace(/\s+/g, ' ')
  // What it runs, that it is not the outcome eval, and that a dial change cites its rows.
  assert.match(flat, /node evals\/ship\/matrix\.mjs/)
  assert.match(flat, /control-arm procedure/)
  assert.match(flat, /It is not the outcome eval/i)
  assert.match(flat, /cost-per-task\.jsonl/)
  assert.match(flat, /A dial change cites its rows/i)
  assert.match(flat, /interlock limits/, 'the ceiling is named by where to read it')
  // The ceiling's digits appear nowhere on the page, and neither do the dials.
  assert.doesNotMatch(
    page,
    new RegExp(`(?<![\\w.])${EVAL_CAPS.matrixCostUsd}(?![\\w.])`),
    'docs/14 states the sweep ceiling; name interlock limits instead'
  )
  for (const token of ['matrixCostUsd', 'opusMinTier', 'byTier', 'EFFORT.']) {
    assert.ok(!page.includes(token), `docs/14 must not state ${token}`)
  }
})

// --- 1.2 the outcome eval's request, after the argument exists ----------------

test('an outcome-eval request built the way run.mjs builds one carries no effort field', async () => {
  // The chain run.mjs uses: selectAgent → armEnv (no effort) → the agent's own
  // option reader → the model client. Even an effort exported in the operator's
  // shell is not inherited by that chain.
  for (const shell of [{ ANTHROPIC_API_KEY: 'k' }, { ANTHROPIC_API_KEY: 'k', [EFFORT_ENV]: 'xhigh' }]) {
    const agent = selectAgent(shell)
    const env = armEnv({ agent, usageFile: '/dev/null', env: shell })
    assert.ok(!(EFFORT_ENV in env), 'the outcome eval must not hand its agent an effort')
    const options = clientOptionsFromEnv(env)
    assert.ok(!('effort' in options))
    const { body, client } = await oneRequestBody(options)
    assert.ok(!('output_config' in body), 'an outcome-eval request must have no output_config')
    assert.equal(client.effort, null)
    assert.equal(body.model, modelUnderTest(agent, shell))
    assert.equal(body.model, DEFAULT_MODEL)
  }
})

// --- 4.2 the sweep stays off every workflow ------------------------------------

test('no workflow starts the cost-per-task sweep, on a pull request or otherwise', () => {
  const dir = join(REPO_ROOT, '.github', 'workflows')
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const text = readFileSync(join(dir, name), 'utf8')
    for (const token of ['matrix.mjs', 'cost-per-task', 'matrixCostUsd']) {
      assert.ok(!text.includes(token), `${name} references ${token}: the sweep is run by hand and gates nothing`)
    }
  }
})
