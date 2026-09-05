// The outcome eval's committed record, and the report reading it as a fourth
// corpus (spec: evals/outcome-history, report/corpus-reading).
//
// Two properties carry everything here.
//
// The WRITER copies fields by name, so a caller who hands it a whole run summary
// — suite output, agent messages, a diff — writes only the named fields. This
// file is committed and grows without bound; a transcript in it would make it
// unreadable within a year and would put trace content into version control on a
// schedule.
//
// The READER never throws and never lets a fixture result into a figure about
// real work. An absent, unreadable or torn record is a reported condition, the
// report still exits zero, and a change filter that cannot apply to this corpus
// excludes it and says so rather than returning it unfiltered.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARMS,
  EVAL_HISTORY_DIR,
  MEASURE_FIELDS,
  SHIP_OUTCOMES_FILE,
  SHIP_OUTCOME_SCHEMA,
  appendShipOutcome,
  readShipOutcomes,
  shipOutcomesPath
} from '../../lib/eval-history.mjs'
import { buildReport, formatReport, SOURCES } from '../../lib/report.mjs'
import { renderReportHtml } from '../../lib/report-html.mjs'
import { recordResults, sweepExitCode } from '../../evals/ship/run.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'bin', 'interlock')

const roots = []
function scratch(name) {
  const dir = mkdtempSync(join(tmpdir(), `interlock-eval-history-${name}-`))
  roots.push(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // A temp directory that outlives the run costs nothing.
    }
  }
})

/** A well-formed result, as the runner assembles one. */
function result(overrides = {}) {
  return {
    version: '0.2.0',
    fixture: 'docs-and-code',
    arm: 'loop',
    host: 'acp',
    model: 'claude-opus-5',
    evalAgent: 'interlock-eval-acp-agent/1',
    priceTable: 'anthropic-list-2026-09',
    node: 'v22.0.0',
    criteria: [
      { id: 'unit-suite-green', status: 'pass', exitCode: 0 },
      { id: 'receipt-observed', status: 'unobserved', exitCode: 0 }
    ],
    tally: { met: 5, applicable: 6, notApplicable: 0, unobserved: 1 },
    measures: {
      agentsSpawned: { value: 6, reason: null },
      wallClockMs: { value: 91_000, reason: null },
      receiptOutputTokens: { value: null, reason: 'the host has no token accounting' },
      agentOutputTokens: { value: 42_000, reason: null }
    },
    ...overrides
  }
}

// --- the writer -------------------------------------------------------------

test('a fat run summary yields only the named fields', () => {
  const root = scratch('fat')
  const written = appendShipOutcome(root, {
    ...result(),
    // Everything below is what a caller might have lying around on the object
    // it happens to be holding. None of it may reach the file.
    stdout: 'x'.repeat(50_000),
    suiteLog: 'not ok 1 - everything\n'.repeat(500),
    diff: '--- a/src/format.mjs\n+++ b/src/format.mjs\n@@ -1 +1 @@\n',
    agentMessages: [{ role: 'assistant', content: 'I have implemented the thing.' }],
    commitMessage: 'feat: the whole change'
  })
  assert.equal(written.written, true, written.reason)

  const line = readFileSync(written.path, 'utf8').trim()
  const record = JSON.parse(line)
  assert.deepEqual(Object.keys(record).sort(), [
    'arm',
    'criteria',
    'evalAgent',
    'fixture',
    'host',
    'measures',
    'model',
    'node',
    'priceTable',
    'schema',
    'tally',
    'ts',
    'version'
  ])
  for (const leaked of ['stdout', 'suiteLog', 'diff', 'agentMessages', 'commitMessage']) {
    assert.ok(!(leaked in record), `${leaked} reached the committed record`)
  }
  assert.ok(!line.includes('not ok 1'), 'suite output reached the record')
  assert.ok(!line.includes('+++ b/src'), 'diff content reached the record')
  assert.ok(!line.includes('I have implemented'), 'an agent message reached the record')
  // Bounded: the whole point of holding counts and measures only.
  assert.ok(line.length < 2000, `one record is ${line.length} bytes — the record must stay small`)
})

test('a row records the instrument as well as the measurement', () => {
  const root = scratch('instrument')
  appendShipOutcome(root, result())
  const [record] = readShipOutcomes(root).records
  assert.equal(record.schema, SHIP_OUTCOME_SCHEMA)
  for (const field of ['version', 'fixture', 'arm', 'host', 'model', 'evalAgent', 'priceTable', 'node']) {
    assert.ok(record[field] && record[field] !== 'unknown', `the row carries no ${field}`)
  }
  // Every measure travels as a value-with-reason pair, and one that was not
  // measured is absent WITH its reason rather than zero.
  assert.deepEqual(Object.keys(record.measures).sort(), [...MEASURE_FIELDS].sort())
  assert.deepEqual(record.measures.agentsSpawned, { value: 6, reason: null })
  assert.equal(record.measures.receiptOutputTokens.value, null)
  assert.match(record.measures.receiptOutputTokens.reason, /no token accounting/)
  // A measure the caller never mentioned is absent with a reason, never zero.
  assert.deepEqual(record.measures.remediationRounds, { value: null, reason: 'not measured' })
})

test('a measured zero stays distinguishable from an absence', () => {
  const root = scratch('zero')
  appendShipOutcome(root, result({ measures: { remediationRounds: { value: 0, reason: null } } }))
  const [record] = readShipOutcomes(root).records
  assert.deepEqual(record.measures.remediationRounds, { value: 0, reason: null })
  assert.equal(record.measures.agentsSpawned.value, null)
  assert.ok(record.measures.agentsSpawned.reason)
})

test('a row must name its arm and its fixture, and neither is guessed', () => {
  const root = scratch('arm')
  const noArm = appendShipOutcome(root, result({ arm: 'sideways' }))
  assert.equal(noArm.written, false)
  assert.match(noArm.reason, new RegExp(ARMS.join(', ')))

  const noFixture = appendShipOutcome(root, result({ fixture: '' }))
  assert.equal(noFixture.written, false)
  assert.match(noFixture.reason, /fixture identity is required/)

  assert.equal(readShipOutcomes(root).records.length, 0, 'a refused row must write nothing')
})

test('an earlier line survives a later run, and a torn line costs one record', () => {
  const root = scratch('torn')
  appendShipOutcome(root, result({ fixture: 'first' }))
  appendShipOutcome(root, result({ fixture: 'second', arm: 'control' }))

  // Torn mid-write, as a crash or a full disk leaves it.
  appendFileSync(shipOutcomesPath(root), '{"schema":"interlock.ship-outcome-eval/1","fixt')
  // And the next run appends anyway: the writer heals the seam rather than
  // splicing a new record onto the broken one and losing two.
  appendShipOutcome(root, result({ fixture: 'third' }))

  const read = readShipOutcomes(root)
  assert.deepEqual(read.records.map(r => r.fixture), ['first', 'second', 'third'])
  assert.equal(read.skipped.length, 1, 'the torn line must cost exactly one record')
})

test('a line of an unrecognized schema is excluded and counted, never interpreted', () => {
  const root = scratch('schema')
  appendShipOutcome(root, result())
  appendFileSync(
    shipOutcomesPath(root),
    `${JSON.stringify({ schema: 'interlock.outcome/2', change: 'a-real-run', mode: 'continue' })}\n`
  )
  const read = readShipOutcomes(root)
  assert.equal(read.records.length, 1, 'a foreign schema must contribute no record')
  assert.deepEqual(read.unrecognized, [{ line: 2, schema: 'interlock.outcome/2' }])
})

test('a failed append is reported, never thrown, and exits the eval run non-zero', () => {
  const root = scratch('unwritable')
  const dir = join(root, EVAL_HISTORY_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, SHIP_OUTCOMES_FILE), '')
  chmodSync(join(dir, SHIP_OUTCOMES_FILE), 0o444)

  const written = appendShipOutcome(root, result())
  // The module never throws — the runner decides what a failure costs.
  assert.equal(written.written, false)
  assert.ok(written.reason, 'a failed append must name its reason')

  const recorded = recordResults({
    results: [{ ...result(), signal: 'graded' }],
    historyRoot: root,
    identity: { version: '0.2.0', host: 'acp', model: 'm', evalAgent: 'a', priceTable: 'p', node: 'v22' }
  })
  assert.equal(recorded.recorded, 0)
  assert.equal(recorded.failures.length, 1)

  // And THAT is fatal to the eval run: a metered run whose result nobody can
  // read has defeated the reason the run exists.
  assert.equal(sweepExitCode({ failures: recorded.failures }), 1)
  // A graded failure, by contrast, is a measurement and exits zero.
  assert.equal(sweepExitCode({ failures: [] }), 0)
})

test('a no-signal result writes no row', () => {
  const root = scratch('no-signal')
  const recorded = recordResults({
    results: [
      { fixture: 'docs-and-code', arm: 'loop', signal: 'none', reason: 'no credential' },
      { ...result(), signal: 'graded' }
    ],
    historyRoot: root,
    identity: { version: '0.2.0', host: 'acp', model: 'm', evalAgent: 'a', priceTable: 'p', node: 'v22' }
  })
  assert.equal(recorded.recorded, 1, 'only the graded result may be recorded')
  const read = readShipOutcomes(root)
  assert.equal(read.records.length, 1)
  assert.equal(read.records[0].arm, 'loop')
})

// --- the report reads it as a fourth corpus ---------------------------------

/** A repository root with only the outcome-eval history in it. */
function historyRoot(name, rows = []) {
  const root = scratch(name)
  for (const row of rows) appendShipOutcome(root, row)
  return root
}

test('the report exits zero with the history absent, unreadable and torn', () => {
  // Absent.
  const absent = buildReport(scratch('report-absent'))
  assert.equal(absent.coverage.evalHistory.exists, false)
  assert.equal(absent.indicators.shipOutcomeEval.records, 0)
  assert.ok(formatReport(absent).includes('outcome evals'))

  // Torn.
  const torn = historyRoot('report-torn', [result()])
  appendFileSync(shipOutcomesPath(torn), '{"schema":"interlock.ship-out')
  const tornReport = buildReport(torn)
  assert.equal(tornReport.coverage.evalHistory.records, 1)
  assert.equal(tornReport.coverage.evalHistory.skippedLines, 1)

  // Unreadable: a directory where the file should be.
  const unreadable = scratch('report-unreadable')
  mkdirSync(join(unreadable, EVAL_HISTORY_DIR, SHIP_OUTCOMES_FILE), { recursive: true })
  const unreadableReport = buildReport(unreadable)
  assert.ok(unreadableReport.coverage, 'the report must still compute')
  assert.ok(unreadableReport.coverage.evalHistory.reason, 'the unreadable corpus must name its reason')

  // And every one of them exits zero through the CLI, which is the contract the
  // report keeps whatever the corpora look like.
  for (const root of [absent.root, torn, unreadable]) {
    const run = spawnSync(process.execPath, [BIN, 'report', '--root', root], {
      cwd: ROOT,
      encoding: 'utf8'
    })
    assert.equal(run.status, 0, `interlock report exited ${run.status} for ${root}: ${run.stderr}`)
  }
})

test('history-derived indicators name their own source and carry their own denominators', () => {
  const root = historyRoot('report-indicators', [
    result(),
    result({ arm: 'control', tally: { met: 2, applicable: 3, notApplicable: 3, unobserved: 0 } })
  ])
  const report = buildReport(root)
  const s = report.indicators.shipOutcomeEval

  assert.equal(s.records, 2)
  assert.equal(s.byArm.loop.criteriaMet.source, SOURCES.EVAL_HISTORY)
  assert.equal(s.byArm.loop.criteriaMet.observedOf, 6)
  // Rounded to four places by `share`, like every other rate in the report.
  assert.equal(s.byArm.loop.criteriaMet.value, 0.8333)
  assert.equal(s.byArm.control.criteriaMet.observedOf, 3)
  // The control arm's inapplicable criteria are excluded from its denominator,
  // not counted against it.
  assert.equal(s.byArm.control.notApplicable, 3)
  assert.deepEqual(s.fixtures, ['docs-and-code'])
  assert.deepEqual(s.versions, { '0.2.0': 2 })

  // No verdict, and the thinness of the record is stated rather than left for a
  // reader to discover.
  const text = JSON.stringify(s).toLowerCase()
  for (const word of ['pass', 'fail', 'healthy', 'degraded', 'blocking', 'threshold']) {
    assert.doesNotMatch(text, new RegExp(`"${word}"`), `a history figure was labelled "${word}"`)
  }
  assert.match(s.note, /licenses no conclusion/)
})

test('a row with no instrument identity is counted incomparable rather than paired', () => {
  const root = historyRoot('report-incomparable', [result(), result({ model: '', evalAgent: '' })])
  const s = buildReport(root).indicators.shipOutcomeEval
  assert.equal(s.records, 2)
  assert.equal(s.incomparable, 1)
})

test('a change filter excludes the history and states the exclusion and its reason', () => {
  const root = historyRoot('report-filtered', [result()])
  const filtered = buildReport(root, { change: 'add-format-summary' })

  assert.equal(filtered.coverage.evalHistory.excluded, true)
  assert.match(filtered.coverage.evalHistory.reason, /keyed by fixture/)
  assert.equal(filtered.indicators.shipOutcomeEval.excluded, true)
  assert.equal(filtered.indicators.shipOutcomeEval.records, 0)

  // Stated in the rendered surfaces too — a corpus that silently vanished from a
  // filtered page is indistinguishable from one holding nothing.
  assert.match(formatReport(filtered), /excluded from this view/)
  assert.match(renderReportHtml(filtered), /EXCLUDED/)

  // A window filter, by contrast, narrows it like any other corpus.
  const windowed = buildReport(root, { since: '2999-01-01T00:00:00.000Z' })
  assert.equal(windowed.coverage.evalHistory.excluded, false)
  assert.equal(windowed.coverage.evalHistory.records, 0)
  assert.equal(windowed.coverage.evalHistory.filteredOut, 1)
})

test('no history record contributes to another corpus’s figure', () => {
  const root = historyRoot('report-isolation', [result(), result({ arm: 'control' })])
  const report = buildReport(root)

  // Every real-run corpus is empty, so every real-run indicator must report
  // itself unobserved. A history row reaching one of them would show up here as
  // a denominator appearing from nowhere.
  assert.equal(report.coverage.trajectories.scanned, 0)
  assert.equal(report.coverage.outcomes.records, 0)
  assert.equal(report.coverage.metrics.recognized, 0)

  const i = report.indicators
  assert.equal(i.firstPassShip.rate.observedOf, 0)
  assert.equal(i.rework.remediationRounds.observedOf, 0)
  assert.equal(i.rework.attemptsPerChange.observedOf, 0)
  assert.equal(i.planFidelity.midRunRevision.observedOf, 0)
  assert.equal(i.planFidelity.diffMatchesPlan.observedOf, 0)
  assert.equal(i.reviewFindings.fromMetrics.dismissalShare.observedOf, 0)
  assert.equal(i.reviewFindings.fromReceipts.survivalShare.observedOf, 0)
  assert.equal(i.gateExitHealth.nonZeroShare.observedOf, 0)

  // While the history's own figures do have a denominator.
  assert.equal(i.shipOutcomeEval.records, 2)
  assert.ok(i.shipOutcomeEval.byArm.loop.criteriaMet.observedOf > 0)
})

test('the report renders the fourth corpus in both output forms', () => {
  const root = historyRoot('report-surfaces', [result()])
  const report = buildReport(root)

  const text = formatReport(report)
  assert.match(text, /outcome evals/)
  assert.match(text, /OUTCOME EVALS \(fixtures, never real runs/)
  assert.match(text, /loop\s+1 result\(s\)/)

  const html = renderReportHtml(report)
  assert.match(html, /Outcome-eval results/)
  assert.match(html, /Outcome evals — loop arm/)
  assert.match(html, /Fixture runs, not real work/)

  // And the exit status is untouched by any of it.
  const run = spawnSync(process.execPath, [BIN, 'report', '--root', root], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(run.status, 0)
  assert.match(run.stdout, /OUTCOME EVALS/)
})
