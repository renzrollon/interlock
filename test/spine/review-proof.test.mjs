// What a review proves it covered (spec: review/review-proof).
//
// The PR #28 round-0 review raised nothing, so the skeptics dismissed nothing
// and every review signal read green: four dimensions answered
// `{ "findings": [] }` with no coverage. These cases drive `lib/review-proof.mjs`
// from that review's own records (test/fixtures/review-proof/pr28/) and pin what
// a ledger must say for the proof to hold. The CLI's write of the record and the
// `review proof` line are driven in test/spine/cli.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  NOT_RECORDED,
  NO_DIFF,
  answersOf,
  computeProof,
  coverageLine,
  mergeRerun,
  notProvenBanner,
  proofAnswer,
  rejectedLines,
  rerunTargets,
  verdictedIds
} from '../../lib/review-proof.mjs'
import { findingId } from '../../lib/findings.mjs'
import { LIMITS } from '../../lib/limits.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PR28 = join(ROOT, 'test', 'fixtures', 'review-proof', 'pr28')
const read = name => readFileSync(join(PR28, name), 'utf8')
const pr28Answers = () => answersOf(JSON.parse(read('answers.json')))
const pr28Changed = () => read('changed.txt').split('\n').filter(Boolean)
const PR28_RAN = ['language', 'technical-lead', 'domain', 'blast-radius']
const PR28_UNCITED = ['hooks/mod.mjs', 'lib/meter-palette.mjs', 'lib/settle-meter.mjs', 'lib/spec-meter.mjs']

const ledger = (checked, unread = []) => ({ checked, unread })
const at = (what, where) => ({ what, at: where })

/** A record as `interlock review` writes it, around a proof. */
const recordOf = (proof, extra = {}) => ({ surviving: [], counts: { raised: 0 }, proof, ...extra })

test('pr28: the round-0 review is unproven, naming the four dimensions and the four uncited source files', () => {
  const proof = computeProof({ ran: PR28_RAN, answers: pr28Answers(), changedPaths: pr28Changed() })
  assert.equal(proof.proven, false)
  assert.deepEqual(proof.unproven.map(u => u.dimension), PR28_RAN)
  for (const u of proof.unproven) assert.equal(u.reason, NOT_RECORDED)
  assert.deepEqual(proof.uncited, PR28_UNCITED)
  assert.equal(proof.changed, 4, 'docs, specs and tests are not demanded')
  assert.equal(proof.cited, 0)
  assert.deepEqual(rerunTargets(proof), PR28_RAN)
  const banner = notProvenBanner(proof)
  for (const name of [...PR28_RAN, ...PR28_UNCITED]) assert.ok(banner.includes(name), `${banner} names ${name}`)
})

test('a dimension that raised nothing and says what it checked is proven, and the record keeps its entries', () => {
  const answers = [
    {
      dimension: 'language',
      findings: [],
      coverage: ledger([at('the settle pane rows', 'lib/settle-meter.mjs:172-177'), at('the reader', 'hooks/mod.mjs:636')])
    }
  ]
  const proof = computeProof({ ran: ['language'], answers, changedPaths: ['lib/settle-meter.mjs', 'hooks/mod.mjs'] })
  assert.equal(proof.proven, true)
  assert.deepEqual(proof.unproven, [])
  assert.deepEqual(proof.unread, [])
  assert.deepEqual(proof.uncited, [])
  assert.equal(proof.reason, null)
  assert.match(coverageLine(proof), /ran language; 2 of 2 changed source file\(s\) cited/)
})

test('a ledger that is not one is rejected aloud and recorded unproven, never fatal', () => {
  const answers = [
    { dimension: 'language', findings: [], coverage: ledger([{ what: 'the meter' }]) },
    { dimension: 'technical-lead', findings: [], coverage: ledger([at('the diff', 'see the diff')]) },
    { dimension: 'regression', findings: [], coverage: { checked: [] } }
  ]
  const proof = computeProof({ ran: ['language', 'technical-lead', 'regression'], answers, changedPaths: ['lib/a.mjs'] })
  assert.equal(proof.proven, false)
  assert.deepEqual(proof.unproven.map(u => u.dimension), ['language', 'technical-lead', 'regression'])
  assert.match(proof.unproven[0].reason, /has no "at"/)
  assert.match(proof.unproven[1].reason, /see the diff.*not a path:line/)
  assert.match(proof.unproven[2].reason, /"unread" must be a list/)
  const lines = rejectedLines(proof.rejected)
  assert.equal(lines.length, 3)
  for (const line of lines) assert.match(line, /^LEDGER REJECTED: \S+: .+; recorded unproven$/)
})

test('an answer with no coverage key is unproven because its coverage was not recorded', () => {
  const proof = computeProof({
    ran: ['language'],
    answers: [{ dimension: 'language', findings: [{ severity: 'warning', file: 'lib/a.mjs', title: 't', description: 'd' }] }],
    changedPaths: ['lib/a.mjs']
  })
  assert.deepEqual(proof.unproven, [{ dimension: 'language', reason: NOT_RECORDED }])
  assert.deepEqual(proof.rejected, [], 'an absent ledger is not a rejected one')
})

test('what counts: an unread input, a citation outside the diff, a carried entry on a file changed since its head', () => {
  // An unread input lands in proof.unread.
  const unread = computeProof({
    ran: ['technical-lead'],
    answers: [
      {
        dimension: 'technical-lead',
        findings: [],
        coverage: ledger([at('scope', 'lib/a.mjs:1')], [{ input: 'delta specs', reason: 'not opened' }])
      }
    ],
    changedPaths: ['lib/a.mjs']
  })
  assert.equal(unread.proven, false)
  assert.deepEqual(unread.unread, [{ dimension: 'technical-lead', entries: [{ input: 'delta specs', reason: 'not opened' }] }])

  // A cited path outside the diff counts as checked and covers nothing.
  const outside = computeProof({
    ran: ['blast-radius'],
    answers: [{ dimension: 'blast-radius', findings: [], coverage: ledger([at('a caller', 'lib/elsewhere.mjs:9')]) }],
    changedPaths: ['lib/a.mjs']
  })
  assert.deepEqual(outside.unproven, [])
  assert.deepEqual(outside.uncited, ['lib/a.mjs'])

  // A carried ledger's entry on a file changed since its head covers nothing.
  const carried = computeProof({
    ran: ['technical-lead'],
    answers: [{ dimension: 'technical-lead', findings: [], coverage: ledger([at('the fix', 'lib/b.mjs:3')]) }],
    changedPaths: ['lib/a.mjs', 'lib/b.mjs', 'lib/c.mjs'],
    carried: { language: { ...ledger([at('a', 'lib/a.mjs:1'), at('c', 'lib/c.mjs:2')]), staleFiles: ['lib/a.mjs'] } }
  })
  assert.deepEqual(carried.uncited, ['lib/a.mjs'], 'the stale entry covers nothing; the unchanged one still counts')
  assert.deepEqual(carried.carried, ['language'])
  assert.deepEqual(carried.unproven, [], 'a carried dimension is not unproven for not running')
})

test('the changed list given is the one counted: a file git listed is uncited unless cited', () => {
  // The CLI hands the union of --changed and git's list; the module counts every path it is given.
  const proof = computeProof({
    ran: ['language'],
    answers: [{ dimension: 'language', findings: [], coverage: ledger([at('a', 'lib/a.mjs:1')]) }],
    changedPaths: ['lib/a.mjs', 'lib/b.mjs']
  })
  assert.deepEqual(proof.uncited, ['lib/b.mjs'])
})

test('neither --changed nor --base: the proof does not hold, with the reason that no diff was given', () => {
  for (const changedPaths of [null, []]) {
    const proof = computeProof({
      ran: ['language'],
      answers: [{ dimension: 'language', findings: [], coverage: ledger([at('a', 'lib/a.mjs:1')]) }],
      changedPaths
    })
    assert.equal(proof.proven, false)
    assert.equal(proof.reason, NO_DIFF)
  }
})

test('the re-run answer: re-run, proven, the cap, and a broken record', () => {
  const unproven = computeProof({
    ran: ['language', 'technical-lead'],
    answers: [
      { dimension: 'language', findings: [] },
      {
        dimension: 'technical-lead',
        findings: [],
        coverage: ledger([at('scope', 'lib/a.mjs:1')], [{ input: 'delta specs', reason: 'not opened' }])
      }
    ],
    changedPaths: ['lib/a.mjs']
  })
  const rerun = proofAnswer(recordOf(unproven))
  assert.equal(rerun.exit, 1)
  assert.equal(rerun.first, 're-run: language, technical-lead')
  assert.ok(rerun.reasons.some(r => r.startsWith('language: unproven')))
  assert.ok(rerun.reasons.some(r => r.startsWith('technical-lead: unread delta specs')))

  // No proof.reruns reads 0, so an older draft is never capped.
  const { reruns: _r, ...noCount } = unproven
  assert.equal(proofAnswer(recordOf(noCount)).exit, 1)

  const capped = proofAnswer(recordOf({ ...unproven, reruns: LIMITS.maxProofReruns }))
  assert.equal(capped.exit, 0)
  assert.equal(capped.first, 'PROOF CAP REACHED: language, technical-lead')

  // Proven wins at the cap.
  const proven = proofAnswer(recordOf({ ...unproven, proven: true, reruns: LIMITS.maxProofReruns }))
  assert.deepEqual([proven.exit, proven.first], [0, 'proven'])

  // A file that is not an adjudicated review, or carries no proof, is exit 2.
  assert.equal(proofAnswer({ findings: [] }).exit, 2)
  assert.equal(proofAnswer(null).exit, 2)
  assert.equal(proofAnswer({ surviving: [] }).exit, 2)
})

test('uncited files alone re-run regression when it ran, else the first ran dimension of a scoped review', () => {
  const answers = dims => dims.map(d => ({ dimension: d, findings: [], coverage: ledger([at('x', 'lib/a.mjs:1')]) }))
  const withRegression = computeProof({
    ran: ['language', 'technical-lead', 'regression'],
    answers: answers(['language', 'technical-lead', 'regression']),
    changedPaths: ['lib/a.mjs', 'hooks/mod.mjs']
  })
  const answer = proofAnswer(recordOf(withRegression))
  assert.equal(answer.first, 're-run: regression')
  assert.ok(answer.reasons.some(r => r.includes('hooks/mod.mjs')))

  const scoped = computeProof({ ran: ['technical-lead'], answers: answers(['technical-lead']), changedPaths: ['lib/a.mjs', 'lib/b.mjs'] })
  assert.equal(proofAnswer(recordOf(scoped)).first, 're-run: technical-lead')
})

test('the merge: a replaced answer, an append for uncited files, the draft verdicts kept, and the count', () => {
  const blocker = { severity: 'blocker', file: 'lib/a.mjs', line: 3, title: 'never ends', description: 'd' }
  const draftAnswers = [
    { dimension: 'language', findings: [] },
    { dimension: 'regression', findings: [blocker], coverage: ledger([at('a', 'lib/a.mjs:3')]) }
  ]
  const draftVerdicts = [
    { findingTitle: 'never ends', file: 'lib/a.mjs', isReal: true },
    { findingTitle: 'never ends', file: 'lib/a.mjs', isReal: true }
  ]
  const draftProof = computeProof({ ran: ['language', 'regression'], answers: draftAnswers, changedPaths: ['lib/a.mjs', 'hooks/mod.mjs'] })
  assert.deepEqual(draftProof.uncited, ['hooks/mod.mjs'])
  const draft = { inputs: { answers: draftAnswers, verdicts: draftVerdicts }, proof: draftProof }

  const warning = { severity: 'warning', file: 'lib/a.mjs', line: 9, title: 'leaks', description: 'd' }
  const merged = mergeRerun(draft, {
    answers: [
      { dimension: 'language', findings: [warning], coverage: ledger([at('a', 'lib/a.mjs:9')]) },
      { dimension: 'regression', findings: [blocker], coverage: ledger([at('reader', 'hooks/mod.mjs:636')]) }
    ],
    verdicts: [{ findingTitle: 'leaks', file: 'lib/a.mjs', isReal: true }, { findingTitle: 'leaks', file: 'lib/a.mjs', isReal: true }]
  })
  const language = merged.answers.find(a => a.dimension === 'language')
  assert.deepEqual(language.findings, [warning], 'an unproven dimension has its answer replaced')
  const regression = merged.answers.find(a => a.dimension === 'regression')
  assert.deepEqual(regression.findings, [blocker], 'the first-pass blocker survives the uncited re-run, not duplicated')
  assert.deepEqual(regression.coverage.checked.map(c => c.at), ['lib/a.mjs:3', 'hooks/mod.mjs:636'])
  assert.equal(merged.verdicts.length, 4, 'the draft verdicts are kept and the new ones appended')
  assert.equal(merged.reruns, 1)

  const after = computeProof({ ran: ['language', 'regression'], answers: merged.answers, changedPaths: ['lib/a.mjs', 'hooks/mod.mjs'] })
  assert.equal(after.proven, true)

  // The promote write carries no answer and leaves the count where it was.
  assert.equal(mergeRerun({ ...draft, proof: { ...draftProof, reruns: 1 } }, {}).reruns, 1)
  assert.equal(mergeRerun(draft, {}).reruns, 0)
})

test('the skeptics are not asked twice: the draft verdicts name the ids they adjudicate', () => {
  const f1 = { severity: 'warning', file: 'lib/a.mjs', title: 'one', description: 'd' }
  const f2 = { severity: 'warning', file: 'lib/a.mjs', title: 'two', description: 'd' }
  const draft = {
    inputs: {
      answers: [{ dimension: 'language', findings: [f1, f2] }],
      verdicts: [{ findingTitle: 'one', file: 'lib/a.mjs', isReal: true }]
    }
  }
  assert.deepEqual([...verdictedIds(draft)], [findingId(f1)])
})
