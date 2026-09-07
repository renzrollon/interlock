// Calibration measures a judge against a human and issues no verdict. The
// tests here are almost entirely about the second half of that sentence: every
// path that could not be measured has to be distinguishable from a path that was
// measured and came out badly, because collapsing the two is how an uncalibrated
// judge ends up trusted.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calibrate, formatCalibration } from '../../lib/evals-calibrate.mjs'

/** A results file with one case, one judged grader, and one run per transcript. */
function resultsFor(caseName, grader, votes) {
  return {
    cases: [
      {
        id: caseName,
        runs: votes.map(([transcript, passed]) => ({
          transcript,
          graders: [{ name: grader, type: 'llm', passed }]
        }))
      }
    ]
  }
}

const label = (caseName, grader, transcript, value) => ({
  case: caseName,
  grader,
  transcript,
  label: value
})

test('agreement is reported with its denominator', () => {
  const results = resultsFor('trampoline-halt', 'halts-and-explains', [
    ['t1', true],
    ['t2', false],
    ['t3', true],
    ['t4', true]
  ])
  const labels = [
    label('trampoline-halt', 'halts-and-explains', 't1', 'pass'),
    label('trampoline-halt', 'halts-and-explains', 't2', 'fail'),
    label('trampoline-halt', 'halts-and-explains', 't3', 'pass'),
    // The judge said pass, the human said fail: one disagreement, and the
    // denominator is what makes it mean anything.
    label('trampoline-halt', 'halts-and-explains', 't4', 'fail')
  ]
  const report = calibrate({ labels, results })
  const g = report.graders.find(x => x.id === 'trampoline-halt/halts-and-explains')
  assert.equal(g.status, 'measured')
  assert.equal(g.agreements, 3)
  assert.equal(g.comparisons, 4)
  assert.equal(g.agreement, 0.75)
  // Both outcomes present, so the set is not one-sided.
  assert.equal(g.oneSided, null)
  assert.match(formatCalibration(report), /3\/4 \(75%\)/)
})

test('a one-sided set is reported as one-sided, not as a complete measurement', () => {
  // A judge that answers "pass" to everything agrees perfectly with a set that
  // holds only passes. Reporting 3/3 without saying so would be a measurement
  // of nothing (calibration spec, "One-sided set is reported as such").
  const results = resultsFor('skill-routing', 'implements-not-replans', [
    ['t1', true],
    ['t2', true],
    ['t3', true]
  ])
  const labels = ['t1', 't2', 't3'].map(t =>
    label('skill-routing', 'implements-not-replans', t, 'pass')
  )
  const report = calibrate({ labels, results })
  const g = report.graders[0]
  assert.equal(g.status, 'measured')
  assert.equal(g.agreement, 1)
  assert.equal(g.oneSided, 'pass')
  assert.match(formatCalibration(report), /one side only/)
  assert.match(formatCalibration(report), /not a complete measurement/)
})

test('a labelled transcript with no judge vote is named and left out of the denominator', () => {
  const results = resultsFor('trampoline-halt', 'halts-and-explains', [
    ['t1', true],
    ['t2', false]
  ])
  const labels = [
    label('trampoline-halt', 'halts-and-explains', 't1', 'pass'),
    label('trampoline-halt', 'halts-and-explains', 't2', 'fail'),
    // No vote for t9 in this results file.
    label('trampoline-halt', 'halts-and-explains', 't9', 'pass')
  ]
  const report = calibrate({ labels, results })
  const g = report.graders[0]
  assert.equal(g.comparisons, 2, 'the unmatched label must not inflate the denominator')
  assert.equal(g.labelled, 3, 'and it must still be visible as a stored label')
  assert.deepEqual(report.unmatchedLabels, ['trampoline-halt/halts-and-explains/t9'])
  assert.match(formatCalibration(report), /unmatched\s+label trampoline-halt\/halts-and-explains\/t9/)
})

test('a judge vote with no stored label is named and left out of the denominator', () => {
  const results = resultsFor('trampoline-halt', 'halts-and-explains', [
    ['t1', true],
    ['t2', false]
  ])
  const labels = [label('trampoline-halt', 'halts-and-explains', 't1', 'pass')]
  const report = calibrate({ labels, results })
  assert.equal(report.graders[0].comparisons, 1)
  assert.deepEqual(report.unmatchedVotes, ['trampoline-halt/halts-and-explains/t2'])
  assert.match(formatCalibration(report), /unmatched\s+vote trampoline-halt\/halts-and-explains\/t2/)
})

test('a judged grader with no calibration set is named as unmeasured, never as agreeing', () => {
  const results = resultsFor('trampoline-halt', 'halts-and-explains', [['t1', true]])
  const report = calibrate({ labels: [], results })
  const g = report.graders[0]
  assert.equal(g.status, 'no_calibration_set')
  assert.equal(g.agreement, null, 'an unmeasured grader must carry no agreement figure')
  assert.deepEqual(report.unmeasured, ['trampoline-halt/halts-and-explains'])
  const text = formatCalibration(report)
  assert.match(text, /unmeasured trampoline-halt\/halts-and-explains\s+no calibration set stored/)
  // Distinct from a judge that disagreed with every label — the two must never
  // be told apart only by reading a number that one of them does not have.
  assert.doesNotMatch(text, /0\/0/)
})

test('a grader named by the caller but absent from the results is still reported', () => {
  // "Not measured" and "not mentioned" are different facts. A grader that never
  // ran must not vanish from the report just because this results file has no
  // vote for it.
  const report = calibrate({
    labels: [],
    results: { cases: [] },
    graders: ['skill-routing/implements-not-replans']
  })
  assert.deepEqual(report.unmeasured, ['skill-routing/implements-not-replans'])
})

test('every item unmatched reports that agreement could not be measured', () => {
  const results = resultsFor('trampoline-halt', 'halts-and-explains', [['run-a', true]])
  const labels = [label('trampoline-halt', 'halts-and-explains', 'run-z', 'pass')]
  const report = calibrate({ labels, results })
  const g = report.graders[0]
  assert.equal(g.status, 'no_matches')
  assert.equal(g.comparisons, 0)
  assert.equal(g.agreement, null, 'no agreement figure may be presented')
  assert.equal(g.labelled, 1)
  const text = formatCalibration(report)
  assert.match(text, /agreement could not be measured/)
  // A grader with labels that matched nothing is not the same as one with no
  // labels at all: the first is a matching problem, the second is a missing set.
  assert.doesNotMatch(text, /no calibration set stored/)
})

test('a deterministic grader is never calibrated', () => {
  const results = {
    cases: [
      {
        id: 'tier-read-scope',
        runs: [{ transcript: 't1', graders: [{ name: 'no-design-read', type: 'tool_used', passed: true }] }]
      }
    ]
  }
  const report = calibrate({ labels: [], results })
  assert.deepEqual(report.graders, [], 'only judged graders are calibration subjects')
  assert.match(formatCalibration(report), /no judged grader was found to calibrate/)
})

test('the same inputs yield the same report', () => {
  const results = resultsFor('c', 'g', [['t1', true], ['t2', false]])
  const labels = [label('c', 'g', 't1', 'pass'), label('c', 'g', 't2', 'pass')]
  assert.deepEqual(calibrate({ labels, results }), calibrate({ labels, results }))
})

test('the report classifies nothing', () => {
  // The contract that keeps this module from becoming a gate: no grader is named
  // acceptable or unacceptable anywhere in the output, and the text says the
  // floor belongs elsewhere.
  const results = resultsFor('c', 'g', [['t1', true]])
  const labels = [label('c', 'g', 't1', 'fail')]
  const text = formatCalibration(calibrate({ labels, results }))
  assert.doesNotMatch(text, /\b(fails? calibration|passes calibration|acceptable|unacceptable)\b/i)
  assert.match(text, /classifies nothing/)
})
