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
  gapLines,
  mergeRerun,
  notProvenBanner,
  proofAnswer,
  proofCounts,
  keptLedgerLines,
  rejectedLines,
  rerunTargets,
  runProofRecord,
  verdictedIds
} from '../../lib/review-proof.mjs'
import { isReviewSource } from '../../lib/artifacts.mjs'
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
  assert.equal(rerun.first, 're-run: language', 'technical-lead has an unread entry and nothing else: it is not on the list')
  assert.ok(rerun.reasons.some(r => r.startsWith('language: unproven')))
  assert.ok(rerun.reasons.some(r => r.startsWith('technical-lead: unread delta specs')))

  // No proof.reruns reads 0, so an older draft is never capped.
  const { reruns: _r, ...noCount } = unproven
  assert.equal(proofAnswer(recordOf(noCount)).exit, 1)

  const capped = proofAnswer(recordOf({ ...unproven, reruns: LIMITS.maxProofReruns }))
  assert.equal(capped.exit, 0)
  assert.equal(capped.first, 'PROOF CAP REACHED: language')

  // Proven wins at the cap.
  const proven = proofAnswer(recordOf({ ...unproven, proven: true, reruns: LIMITS.maxProofReruns }))
  assert.deepEqual([proven.exit, proven.first], [0, 'proven'])

  // A file that is not an adjudicated review, or carries no proof, is exit 2.
  assert.equal(proofAnswer({ findings: [] }).exit, 2)
  assert.equal(proofAnswer(null).exit, 2)
  assert.equal(proofAnswer({ surviving: [] }).exit, 2)
})

// --- stop-proof-re-runs-for-unread-inputs: an unread input names no re-run ----------

const UNREAD_FIVE = ['language', 'technical-lead', 'regression', 'security', 'domain']

/** A ran dimension whose ledger cites `lib/a.mjs` and declares one unread input. */
const unreadAnswer = (dimension, input = 'delta specs') => ({
  dimension,
  findings: [],
  coverage: ledger([at('scope', 'lib/a.mjs:1')], [{ input, reason: 'not opened' }])
})
/** A ran dimension whose ledger cites `lib/a.mjs` with nothing unread. */
const cleanAnswer = dimension => ({ dimension, findings: [], coverage: ledger([at('scope', 'lib/a.mjs:1')]) })

test('the repro: five ran dimensions with only unread entries answer PROOF LEFT UNREAD, exit 0, and no line begins re-run:', () => {
  const proof = computeProof({
    ran: UNREAD_FIVE,
    answers: UNREAD_FIVE.map(d => unreadAnswer(d, `${d} input`)),
    changedPaths: ['lib/a.mjs']
  })
  assert.equal(proof.proven, false)
  assert.deepEqual(proof.unproven, [])
  assert.deepEqual(proof.uncited, [])
  assert.deepEqual(proof.unread.map(u => u.dimension), UNREAD_FIVE)
  const answer = proofAnswer(recordOf(proof))
  assert.equal(answer.exit, 0)
  assert.equal(answer.first, 'PROOF LEFT UNREAD: language, technical-lead, regression, security, domain')
  assert.ok(![answer.first, ...answer.reasons].some(l => l.startsWith('re-run:')), 'no line asks for a re-run')
  assert.equal(answer.reasons.length, 5, 'each unread entry follows on a reason line')
  for (const d of UNREAD_FIVE) assert.ok(answer.reasons.some(r => r.startsWith(`${d}: unread ${d} input`)), d)
  assert.equal(proof.proven, false, 'the proof still does not hold: D2')
})

test('two dimensions with unread entries are named in ran order, each entry on a reason line, at any rerun count', () => {
  const proof = computeProof({
    ran: ['language', 'technical-lead', 'security'],
    answers: [cleanAnswer('language'), unreadAnswer('technical-lead'), unreadAnswer('security', 'REVIEW_CONTEXT')],
    changedPaths: ['lib/a.mjs']
  })
  for (const reruns of [undefined, 0, LIMITS.maxProofReruns]) {
    const answer = proofAnswer(recordOf(reruns === undefined ? proof : { ...proof, reruns }))
    assert.deepEqual([answer.exit, answer.first], [0, 'PROOF LEFT UNREAD: technical-lead, security'], `reruns ${reruns}`)
    assert.ok(answer.reasons.some(r => r.startsWith('technical-lead: unread delta specs')))
    assert.ok(answer.reasons.some(r => r.startsWith('security: unread REVIEW_CONTEXT')))
  }
})

test('an unproven dimension beside an unread one: re-run names the unproven alone, and the cap line does too, each with the unread reason line', () => {
  const proof = computeProof({
    ran: ['language', 'technical-lead'],
    answers: [{ dimension: 'language', findings: [] }, unreadAnswer('technical-lead')],
    changedPaths: ['lib/a.mjs']
  })
  const under = proofAnswer(recordOf(proof))
  assert.deepEqual([under.exit, under.first], [1, 're-run: language'])
  assert.ok(under.reasons.some(r => r.startsWith('technical-lead: unread delta specs')), 'the unread entry is still listed')
  const capped = proofAnswer(recordOf({ ...proof, reruns: LIMITS.maxProofReruns }))
  assert.deepEqual([capped.exit, capped.first], [0, 'PROOF CAP REACHED: language'])
  assert.ok(capped.reasons.some(r => r.startsWith('technical-lead: unread delta specs')))
})

test('unread inputs left after a re-run at the cap are not the cap\'s: PROOF LEFT UNREAD, never PROOF CAP REACHED', () => {
  const proof = computeProof({
    ran: ['language', 'technical-lead'],
    answers: [cleanAnswer('language'), unreadAnswer('technical-lead')],
    changedPaths: ['lib/a.mjs']
  })
  const answer = proofAnswer(recordOf({ ...proof, reruns: LIMITS.maxProofReruns }))
  assert.deepEqual([answer.exit, answer.first], [0, 'PROOF LEFT UNREAD: technical-lead'])
})

test('a record with no diff still exits 2 when a dimension also recorded an unread input, and so does a record that ran nothing', () => {
  for (const changedPaths of [null, []]) {
    const proof = computeProof({ ran: ['language'], answers: [unreadAnswer('language')], changedPaths })
    assert.equal(proof.reason, NO_DIFF)
    assert.deepEqual(proof.unread.map(u => u.dimension), ['language'])
    const answer = proofAnswer(recordOf(proof))
    assert.equal(answer.exit, 2, JSON.stringify(changedPaths))
    assert.equal(answer.first, undefined, 'nothing on standard output')
    assert.ok(answer.error)
  }
  const none = computeProof({ ran: [], answers: [], changedPaths: ['lib/a.mjs'] })
  assert.equal(proofAnswer(recordOf({ ...none, unread: [{ dimension: 'language', entries: [{ input: 'x', reason: 'y' }] }] })).exit, 2, 'no dimension ran')
})

test('a proof that carries no reason, as an older or hand-made record may, answers PROOF LEFT UNREAD for its unread entries', () => {
  const proof = computeProof({ ran: ['language'], answers: [unreadAnswer('language')], changedPaths: ['lib/a.mjs'] })
  const { reason: _reason, ...bare } = proof
  const answer = proofAnswer(recordOf(bare))
  assert.deepEqual([answer.exit, answer.first], [0, 'PROOF LEFT UNREAD: language'])
})

test('rerunTargets is [] for an unread-only proof, and names the unproven dimensions and the uncited target alone', () => {
  const unreadOnly = computeProof({
    ran: ['language', 'regression'],
    answers: [unreadAnswer('language'), unreadAnswer('regression')],
    changedPaths: ['lib/a.mjs']
  })
  assert.deepEqual(rerunTargets(unreadOnly), [])
  const mixed = computeProof({
    ran: ['language', 'technical-lead', 'regression'],
    answers: [{ dimension: 'language', findings: [] }, unreadAnswer('technical-lead'), unreadAnswer('regression')],
    changedPaths: ['lib/a.mjs', 'hooks/mod.mjs']
  })
  assert.deepEqual(rerunTargets(mixed), ['language', 'regression'], 'unproven, then the uncited target; technical-lead is only unread')
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

test('the merge: a re-run of a dimension that had only unread entries keeps the first ledger and appends, so the unread entry stays', () => {
  const draftAnswers = [unreadAnswer('security', 'REVIEW_CONTEXT'), cleanAnswer('language')]
  const draftProof = computeProof({ ran: ['security', 'language'], answers: draftAnswers, changedPaths: ['lib/a.mjs'] })
  assert.deepEqual(draftProof.unread.map(u => u.dimension), ['security'])
  const merged = mergeRerun(
    { inputs: { answers: draftAnswers, verdicts: [] }, proof: draftProof },
    { answers: [{ dimension: 'security', findings: [], coverage: ledger([at('the log call', 'lib/a.mjs:2-3')]) }] }
  )
  const security = merged.answers.find(a => a.dimension === 'security')
  assert.deepEqual(security.coverage.checked.map(c => c.at), ['lib/a.mjs:1', 'lib/a.mjs:2-3'], 'the first pass\'s checked entry and the re-run\'s')
  assert.deepEqual(security.coverage.unread, [{ input: 'REVIEW_CONTEXT', reason: 'not opened' }], 'a clean re-run does not erase a declared gap')
  const after = computeProof({ ran: ['security', 'language'], answers: merged.answers, changedPaths: ['lib/a.mjs'] })
  assert.equal(after.proven, false)
  assert.deepEqual(after.unread.map(u => u.dimension), ['security'])
})

test('the merge: appending keeps the first unread entry per input and the first checked entry per what and at', () => {
  const draftAnswers = [
    {
      dimension: 'regression',
      findings: [],
      coverage: ledger([at('a', 'lib/a.mjs:3')], [{ input: 'REVIEW_CONTEXT', reason: 'absent' }])
    }
  ]
  const changedPaths = ['lib/a.mjs', 'hooks/mod.mjs']
  const draftProof = computeProof({ ran: ['regression'], answers: draftAnswers, changedPaths })
  assert.deepEqual(draftProof.uncited, ['hooks/mod.mjs'])
  const merged = mergeRerun(
    { inputs: { answers: draftAnswers, verdicts: [] }, proof: draftProof },
    {
      answers: [{
        dimension: 'regression',
        findings: [],
        coverage: ledger(
          [at('a', 'lib/a.mjs:3'), at('the reader', 'hooks/mod.mjs:636')],
          [{ input: 'REVIEW_CONTEXT', reason: 'still absent' }, { input: 'delta specs', reason: 'not opened' }]
        )
      }]
    }
  )
  const regression = merged.answers.find(a => a.dimension === 'regression')
  assert.deepEqual(regression.coverage.checked, [
    { what: 'a', at: 'lib/a.mjs:3' },
    { what: 'the reader', at: 'hooks/mod.mjs:636' }
  ], 'the repeated checked entry is kept once, and the new one is appended')
  assert.deepEqual(regression.coverage.unread, [
    { input: 'REVIEW_CONTEXT', reason: 'absent' },
    { input: 'delta specs', reason: 'not opened' }
  ], 'the repeated unread input keeps the first reason, and a new input is appended')
  const after = computeProof({ ran: ['regression'], answers: merged.answers, changedPaths })
  assert.equal(notProvenBanner(after), 'REVIEW NOT PROVEN: unread regression (REVIEW_CONTEXT, delta specs)')
  assert.doesNotMatch(notProvenBanner(after), /REVIEW_CONTEXT, REVIEW_CONTEXT/)
})

test('the merge: a malformed re-run ledger on the append path is not stored, and the first ledger is kept for LEDGER REJECTED', () => {
  const draftAnswers = [
    {
      dimension: 'regression',
      findings: [],
      coverage: ledger([at('a', 'lib/a.mjs:3')], [{ input: 'REVIEW_CONTEXT', reason: 'absent' }])
    }
  ]
  const changedPaths = ['lib/a.mjs', 'lib/b.mjs']
  const draftProof = computeProof({ ran: ['regression'], answers: draftAnswers, changedPaths })
  assert.deepEqual(draftProof.uncited, ['lib/b.mjs'])
  assert.deepEqual(draftProof.unproven, [])
  const merged = mergeRerun(
    { inputs: { answers: draftAnswers, verdicts: [] }, proof: draftProof },
    { answers: [{ dimension: 'regression', findings: [], coverage: { checked: 'x' } }] }
  )
  const regression = merged.answers.find(a => a.dimension === 'regression')
  assert.deepEqual(regression.coverage.checked, [{ what: 'a', at: 'lib/a.mjs:3' }])
  assert.deepEqual(regression.coverage.unread, [{ input: 'REVIEW_CONTEXT', reason: 'absent' }], 'the declared gap survives the bad re-run')
  assert.deepEqual(merged.ledgerKept, [{ dimension: 'regression', problem: 'coverage."checked" must be a list' }])
  assert.deepEqual(keptLedgerLines(merged.ledgerKept), [
    'LEDGER REJECTED: regression: coverage."checked" must be a list; the first ledger was kept'
  ])
  const after = computeProof({ ran: ['regression'], answers: merged.answers, changedPaths })
  assert.deepEqual(after.unproven, [], 'the bad re-run does not record the dimension unproven')
  assert.deepEqual(after.rejected, [])
  assert.deepEqual(after.uncited, ['lib/b.mjs'], 'the file stays uncited, and the rejection line is what says why')
  assert.deepEqual(after.unread.map(u => u.dimension), ['regression'])
})

test('the merge: a re-run of the uncited target with one checked entry on the uncited file leaves both files cited and the first pass\'s unread entry recorded', () => {
  const draftAnswers = [
    { dimension: 'regression', findings: [], coverage: ledger([at('a', 'lib/a.mjs:3')], [{ input: 'REVIEW_CONTEXT', reason: 'absent' }]) }
  ]
  const changedPaths = ['lib/a.mjs', 'hooks/mod.mjs']
  const draftProof = computeProof({ ran: ['regression'], answers: draftAnswers, changedPaths })
  assert.deepEqual(draftProof.uncited, ['hooks/mod.mjs'])
  const merged = mergeRerun(
    { inputs: { answers: draftAnswers, verdicts: [] }, proof: draftProof },
    { answers: [{ dimension: 'regression', findings: [], coverage: ledger([at('the reader', 'hooks/mod.mjs:636')]) }] }
  )
  const regression = merged.answers.find(a => a.dimension === 'regression')
  assert.deepEqual(regression.coverage.checked.map(c => c.at), ['lib/a.mjs:3', 'hooks/mod.mjs:636'])
  assert.deepEqual(regression.coverage.unread, [{ input: 'REVIEW_CONTEXT', reason: 'absent' }])
  const after = computeProof({ ran: ['regression'], answers: merged.answers, changedPaths })
  assert.deepEqual(after.uncited, [])
  assert.equal(after.cited, 2)
  assert.deepEqual(after.unread.map(u => u.dimension), ['regression'], 'the unread entry is still on the record')
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

// --- PR #29 review: the run's rounds, the readers, bin/ (spec: review/review-proof) ---

const hashesOf = files => p => (p in files ? files[p] : null)

test('the verdict round keeps the last fix round\'s proof: re-reviewing nothing and moving no file changes nothing', () => {
  const ran = ['language', 'qa']
  const changedPaths = ['lib/a.mjs', 'lib/b.mjs']
  const files = { 'lib/a.mjs': 'h1', 'lib/b.mjs': 'h2' }
  const round0 = runProofRecord({
    findings: [
      { dimension: 'language', findings: [], coverage: ledger([at('a', 'lib/a.mjs:1')]) },
      { dimension: 'qa', findings: [], coverage: ledger([at('b', 'lib/b.mjs:1')]) }
    ],
    ran,
    changedPaths,
    hashOf: hashesOf(files)
  })
  assert.equal(round0.proof.proven, true)
  const verdict = runProofRecord({ findings: [], ran, changedPaths, reReviewed: [], previous: round0, hashOf: hashesOf(files) })
  assert.deepEqual(verdict.proof, round0.proof, 'the proof is the last round\'s, not "no dimension ran"')
  assert.equal(verdict.banner, null)

  // An unread entry of the last round is not laundered by the verdict round either.
  const unread = runProofRecord({
    findings: [{ dimension: 'language', findings: [], coverage: ledger([at('a', 'lib/a.mjs:1'), at('b', 'lib/b.mjs:1')], [{ input: 'specs', reason: 'not opened' }]) }, { dimension: 'qa', findings: [], coverage: ledger([at('b', 'lib/b.mjs:1')]) }],
    ran,
    changedPaths,
    hashOf: hashesOf(files)
  })
  const kept = runProofRecord({ findings: [], ran, changedPaths, reReviewed: [], previous: unread, hashOf: hashesOf(files) })
  assert.equal(kept.proof.proven, false)
  assert.match(kept.banner, /^REVIEW NOT PROVEN: unread language \(specs\)/)

  // Carried ledgers alone are not "no dimension ran".
  const carriedOnly = computeProof({ ran: [], answers: [], changedPaths: ['lib/a.mjs'], carried: { language: ledger([at('a', 'lib/a.mjs:1')]) } })
  assert.equal(carriedOnly.proven, true, JSON.stringify(carriedOnly))
})

test('a file a fixer edited stays stale for a carried ledger in every later round, not only the next', () => {
  const ran = ['language', 'qa', 'security']
  const changedPaths = ['lib/a.mjs', 'lib/b.mjs']
  let files = { 'lib/a.mjs': 'a0', 'lib/b.mjs': 'b0' }
  const round0 = runProofRecord({
    findings: [
      { dimension: 'language', findings: [], coverage: ledger([at('a', 'lib/a.mjs:1')]) },
      { dimension: 'qa', findings: [], coverage: ledger([at('b', 'lib/b.mjs:1')]) },
      { dimension: 'security', findings: [], coverage: ledger([at('a', 'lib/a.mjs:2')]) }
    ],
    ran,
    changedPaths,
    hashOf: hashesOf(files)
  })
  assert.equal(round0.proof.proven, true)
  // Round 1: the fixer edits lib/b.mjs; only security is re-reviewed and cites lib/a.mjs.
  files = { ...files, 'lib/b.mjs': 'b1' }
  const round1 = runProofRecord({
    findings: [{ dimension: 'security', findings: [], coverage: ledger([at('a', 'lib/a.mjs:2')]) }],
    ran,
    changedPaths,
    reReviewed: ['security'],
    previous: round0,
    hashOf: hashesOf(files)
  })
  assert.deepEqual(round1.proof.uncited, ['lib/b.mjs'])
  // Round 2: the fixer edits lib/a.mjs; only language is re-reviewed and cites it. qa's
  // round-0 ledger on lib/b.mjs is still stale, though lib/b.mjs did not move this round.
  files = { ...files, 'lib/a.mjs': 'a2' }
  const round2 = runProofRecord({
    findings: [{ dimension: 'language', findings: [], coverage: ledger([at('a', 'lib/a.mjs:1')]) }],
    ran,
    changedPaths,
    reReviewed: ['language'],
    previous: round1,
    hashOf: hashesOf(files)
  })
  assert.deepEqual(round2.proof.uncited, ['lib/b.mjs'], JSON.stringify(round2.proof))
  assert.deepEqual(round2.coverage.qa.staleFiles, ['lib/a.mjs', 'lib/b.mjs'], 'both moved since qa\'s ledger was written')
  assert.equal(round2.proof.proven, false)
})

test('the proof readers print, never throw, on a record whose proof lacks a list', () => {
  for (const proof of [{ proven: false }, { proven: false, dimensions: ['qa'], unread: [{ dimension: 'qa' }] }]) {
    assert.match(notProvenBanner(proof), /^REVIEW NOT PROVEN: /)
    assert.match(coverageLine(proof), /^Coverage: ran (none|qa); 0 of 0 changed source file\(s\) cited\.$/)
    assert.ok(Array.isArray(gapLines(proof)))
    assert.match(proofCounts(proof), /^0 unproven, \d with unread inputs, 0 uncited of 0 changed source file\(s\)$/)
    assert.ok(Array.isArray(rerunTargets(proof)))
  }
})

test('an extensionless executable under bin/ is a source file the proof counts; a dotted or vendored one is not', () => {
  const proof = computeProof({
    ran: ['language'],
    answers: [{ dimension: 'language', findings: [], coverage: ledger([at('a', 'lib/a.mjs:1')]) }],
    changedPaths: ['bin/interlock', 'lib/a.mjs', 'bin/run.sh', 'node_modules/x/bin/tool', 'bin/.hidden']
  })
  assert.deepEqual(proof.uncited, ['bin/interlock'])
  assert.equal(proof.changed, 2)
  for (const p of ['bin/interlock', 'tools/bin/deploy', 'lib/a.mjs']) assert.equal(isReviewSource(p), true, p)
  for (const p of ['bin/run.sh', 'bin/sub/tool', 'node_modules/x/bin/tool', 'bin/.hidden', 'README']) assert.equal(isReviewSource(p), false, p)
})

test('an extensionless executable under cli/ is a source file the proof counts, and a changed one nobody cited is listed', () => {
  const proof = computeProof({
    ran: ['language'],
    answers: [{ dimension: 'language', findings: [], coverage: ledger([at('a', 'lib/a.mjs:1')]) }],
    changedPaths: ['cli/interlock', 'lib/a.mjs', 'cli/run.sh', 'node_modules/x/cli/tool', 'cli/.hidden']
  })
  assert.deepEqual(proof.uncited, ['cli/interlock'])
  assert.equal(proof.proven, false)
  assert.equal(proof.changed, 2)
  for (const p of ['cli/interlock', 'tools/cli/deploy', 'lib/a.mjs']) assert.equal(isReviewSource(p), true, p)
  for (const p of ['cli/run.sh', 'cli/sub/tool', 'node_modules/x/cli/tool', 'cli/.hidden']) assert.equal(isReviewSource(p), false, p)

  const cited = computeProof({
    ran: ['language'],
    answers: [{ dimension: 'language', findings: [], coverage: ledger([at('the dispatch', 'cli/interlock:3'), at('a', 'lib/a.mjs:1')]) }],
    changedPaths: ['cli/interlock', 'lib/a.mjs']
  })
  assert.deepEqual(cited.uncited, [])
})

// --- prose unread: an `unread` entry that names the changed prose it did not read ------
//
// Spec: review/review-proof, flag-the-prose-a-reviewer-left-unread. Reached through
// the namespace so a missing export fails only the test that uses it.
import * as proofMod from '../../lib/review-proof.mjs'
import { FINDING_SCHEMA } from '../../lib/findings.mjs'

const PROSE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const entry = (input, reason, paths) => ({ input, reason, ...(paths === undefined ? {} : { paths }) })
const lead = (unread, checked = [at('the reader', 'lib/a.mjs:1')]) => ({
  dimension: 'technical-lead',
  findings: [],
  coverage: ledger(checked, unread)
})
const proofOf = (answers, changedPaths, sourcePaths = [], extra = {}) =>
  computeProof({ ran: answers.map(a => a.dimension), answers, changedPaths, sourcePaths, ...extra })
const DOCS_ENTRY = entry('docs edits', 'prose-only edits, not opened', ['docs/04-when-it-stops.md', 'docs/10-agentic-workflow-ship-and-spec.md'])
const DOCS_CHANGED = ['lib/a.mjs', 'docs/04-when-it-stops.md', 'docs/10-agentic-workflow-ship-and-spec.md']

/** The fixture the three "joined in a fixed order" scenarios share (design D22). */
const ORDER_PROOF = {
  proven: true,
  reason: null,
  dimensions: ['language', 'technical-lead'],
  unproven: [],
  unread: [],
  uncited: [],
  changed: 1,
  cited: 1,
  carried: [],
  reruns: 0,
  proseUnread: [
    { dimension: 'language', entries: [entry('README', 'not opened', ['README.md'])] },
    {
      dimension: 'technical-lead',
      entries: [
        entry('docs a and b', 'prose-only edits, not opened', ['docs/a.md', 'docs/b.md']),
        entry('docs c', 'not opened', ['docs/c.md'])
      ]
    }
  ]
}

test('prose unread: validateLedger keeps a well-formed paths, each string trimmed', () => {
  const read = proofMod.validateLedger({ checked: [], unread: [entry('docs', 'not opened', [' docs/a.md ', 'docs/b.md'])] })
  assert.equal(read.ok, true)
  assert.deepEqual(read.ledger.unread, [{ input: 'docs', reason: 'not opened', paths: ['docs/a.md', 'docs/b.md'] }])
})

test('prose unread: guard: validateLedger drops a paths of the wrong shape and the ledger is still ok', () => {
  for (const bad of ['docs/a.md', [], ['docs/a.md', 3]]) {
    const read = proofMod.validateLedger({ checked: [], unread: [entry('docs', 'not opened', bad)] })
    assert.equal(read.ok, true, JSON.stringify(bad))
    assert.deepEqual(read.ledger.unread, [{ input: 'docs', reason: 'not opened' }], JSON.stringify(bad))
    assert.equal('paths' in read.ledger.unread[0], false, 'no paths key at all')
  }
})

test('prose unread: two changed documentation files are listed apart and the proof holds', () => {
  const proof = proofOf([lead([DOCS_ENTRY])], DOCS_CHANGED)
  assert.deepEqual(proof.proseUnread, [{ dimension: 'technical-lead', entries: [DOCS_ENTRY] }])
  assert.deepEqual(proof.unread, [])
  assert.equal(proof.proven, true)
})

test('prose unread: the change\'s delta specs stay unread', () => {
  const specs = entry('delta specs', 'not opened', ['openspec/changes/a-change/specs/waves/spec.md', 'openspec/changes/a-change/decisions.md'])
  const proof = proofOf([lead([specs])], ['lib/a.mjs', ...specs.paths])
  assert.deepEqual(proof.unread, [{ dimension: 'technical-lead', entries: [specs] }])
  assert.deepEqual(proof.proseUnread, [])
  assert.equal(proof.proven, false)
})

test('prose unread: the PR #43 round-1 record names the docs entry apart and the delta specs entry unread', () => {
  const docs = entry('docs/04-when-it-stops.md and docs/10-agentic-workflow-ship-and-spec.md changed lines', 'prose-only edits, not opened', [
    'docs/04-when-it-stops.md',
    'docs/10-agentic-workflow-ship-and-spec.md'
  ])
  const specs = entry(
    'delta specs under openspec/changes/stop-retrying-expected-red-checks/specs/ and decisions.md',
    'not opened; scenarios judged against design.md and the passing tests only',
    ['openspec/changes/stop-retrying-expected-red-checks/specs/waves/spec.md', 'openspec/changes/stop-retrying-expected-red-checks/decisions.md']
  )
  const proof = proofOf([lead([docs, specs])], ['lib/a.mjs', ...docs.paths, ...specs.paths])
  assert.deepEqual(proof.proseUnread, [{ dimension: 'technical-lead', entries: [docs] }])
  assert.deepEqual(proof.unread, [{ dimension: 'technical-lead', entries: [specs] }])
  assert.equal(proof.proven, false)
})

test('prose unread: the review context, the policy file, a living spec and an archived change are required prose', () => {
  const required = [
    '.claude/graph/REVIEW_CONTEXT.md',
    'REVIEW.md',
    'openspec/specs/review/review-proof/spec.md',
    'openspec/changes/archive/2026-11-13-a-change/design.md'
  ]
  const proof = proofOf([lead(required.map(p => entry(`read ${p}`, 'not opened', [p])))], ['lib/a.mjs', ...required])
  assert.deepEqual(proof.unread[0].entries.map(e => e.paths[0]), required)
  assert.deepEqual(proof.proseUnread, [])
  assert.equal(proof.proven, false)
})

test('prose unread: one file that is not prose keeps the whole entry unread', () => {
  const mixed = entry('docs and a test', 'not opened', ['docs/a.md', 'test/spine/a.test.mjs'])
  const proof = proofOf([lead([mixed])], ['lib/a.mjs', 'docs/a.md', 'test/spine/a.test.mjs'])
  assert.deepEqual(proof.unread, [{ dimension: 'technical-lead', entries: [mixed] }])
  assert.deepEqual(proof.proseUnread, [])
})

test('prose unread: a file the diff does not change, and a directory, stay unread', () => {
  const unchanged = entry('an unchanged doc', 'not opened', ['docs/unchanged.md'])
  const dir = entry('the docs directory', 'not opened', ['docs/'])
  const proof = proofOf([lead([unchanged, dir])], ['lib/a.mjs', 'docs/a.md', 'docs/b.md'])
  assert.deepEqual(proof.unread, [{ dimension: 'technical-lead', entries: [unchanged, dir] }])
  assert.deepEqual(proof.proseUnread, [])
})

test('prose unread: a path is matched in canonical form', () => {
  const dotted = entry('a doc', 'not opened', ['./docs/a.md'])
  const proof = proofOf([lead([dotted])], ['lib/a.mjs', 'docs/a.md'])
  assert.equal(proof.proseUnread.length, 1)
  assert.deepEqual(proof.unread, [])
})

test('prose unread: an entry with no paths reads as it always did', () => {
  const bare = entry('delta specs', 'not opened')
  const proof = proofOf([lead([bare])], ['lib/a.mjs'])
  assert.deepEqual(proof.unread, [{ dimension: 'technical-lead', entries: [bare] }])
  assert.deepEqual(proof.proseUnread, [])
  assert.equal('paths' in proof.unread[0].entries[0], false)
  assert.equal(proof.proven, false)
})

test('prose unread: a prose-only entry is listed apart and the proof holds with nothing else open', () => {
  const proof = proofOf([lead([DOCS_ENTRY])], DOCS_CHANGED)
  assert.deepEqual(proof.unproven, [])
  assert.deepEqual(proof.unread, [])
  assert.deepEqual(proof.uncited, [])
  assert.equal(proof.proseUnread[0].dimension, 'technical-lead')
  assert.equal(proof.proven, true)
})

test('prose unread: a dimension with both kinds of entry is named in both lists', () => {
  const bare = entry('delta specs', 'not opened')
  const proof = proofOf([lead([DOCS_ENTRY, bare])], DOCS_CHANGED)
  assert.deepEqual(proof.proseUnread, [{ dimension: 'technical-lead', entries: [DOCS_ENTRY] }])
  assert.deepEqual(proof.unread, [{ dimension: 'technical-lead', entries: [bare] }])
  assert.equal(proof.proven, false)
})

test('prose unread: a prose-only entry does not make up for an uncited source file', () => {
  const proof = proofOf([lead([DOCS_ENTRY])], [...DOCS_CHANGED, 'lib/b.mjs'])
  assert.deepEqual(proof.uncited, ['lib/b.mjs'])
  assert.equal(proof.proven, false)
  assert.equal(proof.proseUnread.length, 1)
})

test('prose unread: a carried dimension\'s prose-only entry reaches neither list', () => {
  const carried = { 'technical-lead': ledger([at('the reader', 'lib/a.mjs:1')], [DOCS_ENTRY]) }
  const proof = computeProof({
    ran: ['language'],
    answers: [{ dimension: 'language', findings: [], coverage: ledger([at('a', 'lib/a.mjs:2')]) }],
    changedPaths: DOCS_CHANGED,
    sourcePaths: [],
    carried
  })
  assert.deepEqual(proof.carried, ['technical-lead'])
  assert.deepEqual(proof.unread, [])
  assert.deepEqual(proof.proseUnread, [])
})

test('prose unread: proseUnread is an empty list when nothing is listed apart', () => {
  const proof = proofOf([lead([])], ['lib/a.mjs'])
  assert.deepEqual(proof.proseUnread, [])
})

test('prose unread: a sourcePaths that is undefined or null lists nothing apart', () => {
  for (const sourcePaths of [undefined, null]) {
    const proof = computeProof({ ran: ['technical-lead'], answers: [lead([DOCS_ENTRY])], changedPaths: DOCS_CHANGED, sourcePaths })
    assert.deepEqual(proof.proseUnread, [], String(sourcePaths))
    assert.deepEqual(proof.unread, [{ dimension: 'technical-lead', entries: [DOCS_ENTRY] }], String(sourcePaths))
  }
})

test('prose unread: a listed path keeps its entry unread, and with an empty list it is listed apart', () => {
  const skill = entry('the skill', 'not opened', ['skills/settle/SKILL.md'])
  const changed = ['lib/a.mjs', 'skills/settle/SKILL.md']
  const listed = proofOf([lead([skill])], changed, ['skills'])
  assert.deepEqual(listed.unread, [{ dimension: 'technical-lead', entries: [skill] }])
  assert.deepEqual(listed.proseUnread, [])
  const unlisted = proofOf([lead([skill])], changed, [])
  assert.deepEqual(unlisted.proseUnread, [{ dimension: 'technical-lead', entries: [skill] }])
  assert.deepEqual(unlisted.unread, [])
})

test('prose unread: a file that is prose by its extension alone is listed apart until the list names it', () => {
  const req = entry('the requirements', 'not opened', ['requirements.txt'])
  const changed = ['lib/a.mjs', 'requirements.txt']
  assert.equal(proofOf([lead([req])], changed, []).proseUnread.length, 1)
  const listed = proofOf([lead([req])], changed, ['requirements.txt'])
  assert.deepEqual(listed.proseUnread, [])
  assert.equal(listed.unread.length, 1)
})

test('prose unread: with no changed list nothing is listed apart', () => {
  for (const changedPaths of [[], null]) {
    const proof = computeProof({ ran: ['technical-lead'], answers: [lead([DOCS_ENTRY])], changedPaths, sourcePaths: [] })
    assert.deepEqual(proof.proseUnread, [])
    assert.equal(proof.proven, false)
  }
})

test('prose unread: coverageRecord keeps paths on the entry', () => {
  const record = proofMod.coverageRecord([lead([DOCS_ENTRY])])
  assert.deepEqual(record['technical-lead'].unread, [DOCS_ENTRY])
})

test('prose unread: a re-run keeps the first entry for an input, with or without its files', () => {
  const changedPaths = ['lib/a.mjs', 'docs/a.md']
  const run = (first, second) => {
    const draftAnswers = [{ dimension: 'regression', findings: [], coverage: ledger([at('a', 'lib/a.mjs:1')], [first]) }]
    const draftProof = computeProof({ ran: ['regression'], answers: draftAnswers, changedPaths, sourcePaths: [] })
    const merged = mergeRerun(
      { inputs: { answers: draftAnswers, verdicts: [] }, proof: draftProof },
      { answers: [{ dimension: 'regression', findings: [], coverage: ledger([at('a', 'lib/a.mjs:1')], [second]) }] }
    )
    const after = computeProof({ ran: ['regression'], answers: merged.answers, changedPaths, sourcePaths: [] })
    return { merged, after }
  }
  const bare = entry('docs edits', 'not opened')
  const withPaths = entry('docs edits', 'not opened', ['docs/a.md'])
  const one = run(bare, withPaths)
  assert.deepEqual(one.merged.answers[0].coverage.unread, [bare], 'the first entry has no paths and keeps none')
  assert.deepEqual(one.after.unread, [{ dimension: 'regression', entries: [bare] }])
  assert.deepEqual(one.after.proseUnread, [])
  const other = run(withPaths, bare)
  assert.deepEqual(other.merged.answers[0].coverage.unread, [withPaths], 'the first entry keeps its paths')
  assert.deepEqual(other.after.proseUnread, [{ dimension: 'regression', entries: [withPaths] }])
  assert.deepEqual(other.after.unread, [])
})

test('prose unread: runProofRecord passes sourcePaths on, and a record whose only entry is prose-only has no banner', () => {
  const findings = [lead([DOCS_ENTRY])]
  const record = proofMod.runProofRecord({
    findings,
    ran: ['technical-lead'],
    changedPaths: DOCS_CHANGED,
    sourcePaths: [],
    hashOf: () => 'h'
  })
  assert.deepEqual(record.proof.proseUnread, [{ dimension: 'technical-lead', entries: [DOCS_ENTRY] }])
  assert.equal(record.proof.proven, true)
  assert.equal(record.banner, null)
  assert.deepEqual(record.coverage['technical-lead'].unread, [DOCS_ENTRY])
})

test('prose unread: proofAnswer names the prose after proven and still exits 0', () => {
  const answer = proofAnswer(recordOf({ ...ORDER_PROOF, proseUnread: [ORDER_PROOF.proseUnread[1]] }))
  assert.equal(answer.exit, 0)
  assert.equal(answer.first, 'proven')
  assert.equal(answer.reasons.length, 1)
  assert.match(answer.reasons[0], /^technical-lead: prose left unread docs\/a\.md, docs\/b\.md \(prose-only edits, not opened\)/)
})

test('prose unread: several dimensions and entries are joined in a fixed order', () => {
  const answer = proofAnswer(recordOf(ORDER_PROOF))
  assert.equal(answer.first, 'proven')
  assert.deepEqual(answer.reasons, [
    'language: prose left unread README.md (not opened)',
    'technical-lead: prose left unread docs/a.md, docs/b.md (prose-only edits, not opened); docs/c.md (not opened)'
  ])
  assert.deepEqual(proofMod.proseUnreadLines(ORDER_PROOF), answer.reasons)
})

test('prose unread: a gap and prose left unread are both named, the gap first', () => {
  const proof = {
    ...ORDER_PROOF,
    proven: false,
    reason: 'gaps in coverage',
    dimensions: ['technical-lead'],
    unread: [{ dimension: 'technical-lead', entries: [entry('delta specs', 'not opened')] }],
    proseUnread: [ORDER_PROOF.proseUnread[1]]
  }
  const answer = proofAnswer(recordOf(proof))
  assert.equal(answer.exit, 0)
  assert.equal(answer.first, 'PROOF LEFT UNREAD: technical-lead')
  assert.equal(answer.reasons[0], 'technical-lead: unread delta specs (not opened)')
  assert.match(answer.reasons[1], /^technical-lead: prose left unread /)
  assert.equal(answer.reasons.length, 2)
})

test('prose unread: prose left unread names no dimension on the first line and makes no re-run', () => {
  const proof = {
    ...ORDER_PROOF,
    proven: false,
    reason: 'gaps in coverage',
    dimensions: ['security', 'technical-lead'],
    unread: [{ dimension: 'security', entries: [entry('context', 'absent')] }],
    proseUnread: [ORDER_PROOF.proseUnread[1]]
  }
  const answer = proofAnswer(recordOf(proof))
  assert.equal(answer.first, 'PROOF LEFT UNREAD: security')
  assert.equal(answer.reasons.some(line => line.startsWith('re-run:')), false)
  assert.equal(answer.first.includes('technical-lead'), false)
  assert.ok(answer.reasons.some(line => line.startsWith('technical-lead: prose left unread ')), 'the prose line follows the gap lines')
})

test('prose unread: a record with no such list prints as it always did', () => {
  const { proseUnread: _p, ...old } = ORDER_PROOF
  assert.deepEqual(proofAnswer(recordOf(old)), { exit: 0, first: 'proven', reasons: [] })
  assert.deepEqual(proofMod.proseUnreadLines(old), [])
  assert.deepEqual(proofMod.proseUnreadLines({ ...old, proseUnread: 'x' }), [])
  assert.equal(proofMod.proseUnreadClause(old), '')
  assert.equal(proofMod.proseUnreadClause({ ...old, proseUnread: [] }), '')
})

test('prose unread: proseUnreadClause joins dimensions and files in a fixed order, and wraps each file and nothing else', () => {
  assert.equal(
    proofMod.proseUnreadClause(ORDER_PROOF),
    'prose left unread: language (README.md), technical-lead (docs/a.md, docs/b.md, docs/c.md)'
  )
  const wrapped = proofMod.proseUnreadClause(ORDER_PROOF, file => `<<${file}>>`)
  assert.equal(
    wrapped,
    'prose left unread: language (<<README.md>>), technical-lead (<<docs/a.md>>, <<docs/b.md>>, <<docs/c.md>>)'
  )
})

test('prose unread: proseUnreadClause names a file once however many entries name it', () => {
  const twice = {
    ...ORDER_PROOF,
    proseUnread: [{ dimension: 'language', entries: [entry('a', 'r', ['docs/a.md']), entry('b', 'r', ['docs/a.md', 'docs/b.md'])] }]
  }
  assert.equal(proofMod.proseUnreadClause(twice), 'prose left unread: language (docs/a.md, docs/b.md)')
})

test('prose unread: coverageLine ends with the clause when one exists, and is today\'s line without', () => {
  const plain = coverageLine({ ...ORDER_PROOF, proseUnread: [] })
  assert.equal(plain, 'Coverage: ran language, technical-lead; 1 of 1 changed source file(s) cited.')
  const withClause = coverageLine(ORDER_PROOF, { span: file => `\`${file}\`` })
  assert.equal(
    withClause,
    'Coverage: ran language, technical-lead; 1 of 1 changed source file(s) cited; prose left unread: ' +
      'language (`README.md`), technical-lead (`docs/a.md`, `docs/b.md`, `docs/c.md`).'
  )
  assert.ok(coverageLine(ORDER_PROOF).endsWith('technical-lead (docs/a.md, docs/b.md, docs/c.md).'))
})

test('prose unread: the unread item of the answer schema lists paths under properties and not under required', () => {
  const item = FINDING_SCHEMA.properties.coverage.properties.unread.items
  assert.ok('paths' in item.properties, 'paths is a listed property')
  assert.equal(item.properties.paths.type, 'array')
  assert.equal(item.required.includes('paths'), false)
  assert.deepEqual(item.required, ['input', 'reason'])
})

test('prose unread: guard: the proof module imports neither review-core nor a node: module', () => {
  const source = readFileSync(join(PROSE_ROOT, 'lib', 'review-proof.mjs'), 'utf8')
  const imports = source.split('\n').filter(line => /^import\b/.test(line))
  assert.ok(imports.length > 0)
  for (const line of imports) {
    assert.doesNotMatch(line, /review-core\.mjs/, line)
    assert.doesNotMatch(line, /node:/, line)
  }
})
