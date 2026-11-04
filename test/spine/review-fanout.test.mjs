// The pure module behind the strict ship review's fan-out (change
// fan-out-the-strict-ship-review, design "The pure module"): the fold of the
// reviewers' answers, the fold of the skeptics' verdicts, the cap allocation and
// the two banners. Each function takes already-read contents, so none of these
// tests touches a disk. Written before lib/review-fanout.mjs exists; red until
// task 2.1 lands it.
//
// Contract these tests fix (the change's design leaves the argument shapes open):
//   foldDimensionAnswers({ expected: string[], answers: { [dimension]: string|null|undefined } })
//     `answers` holds each answer file's raw text, absent or null when no file exists.
//   foldSkepticVerdicts({ expected: [{ label, role, findingIds }], files: { [label]: string|null|undefined } })
//     `files` holds each verdict file's raw text; `setAside` names the labels whose file was unreadable.
//   allocateSkeptics({ prompts, findings, cap })
//     `prompts` is assembleSkepticPrompts' per-finding list over `findings` (flat, in finding order).
//   reviewWaveBanner({ reviewers, reviewerRouting, skeptics, skepticRouting })
//   skepticCapBanner({ perFinding, perReview })

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleSkepticPrompts } from '../../lib/prompts/review-skeptics.mjs'
import { findingId } from '../../lib/findings.mjs'

const mod = await import('../../lib/review-fanout.mjs')
const { foldDimensionAnswers, foldSkepticVerdicts, allocateSkeptics, reviewWaveBanner, skepticCapBanner } = mod

const finding = (over = {}) => ({
  dimension: 'qa',
  severity: 'warning',
  file: 'lib/a.mjs',
  line: 3,
  title: 'a finding',
  description: 'because',
  ...over
})
const ledger = (dimension, findings = [], coverage = []) => ({ dimension, findings, coverage })
const text = v => JSON.stringify(v)

// ---------------------------------------------------------------------------
// the dimension fold
// ---------------------------------------------------------------------------

test('dimension fold: every expected answer present folds the ledgers in selection order and completes', () => {
  const expected = ['security', 'qa', 'architecture']
  const answers = {
    // written in a different order than the selection, to prove the order is the selection's
    architecture: text(ledger('architecture', [finding({ dimension: 'architecture', title: 'x' })])),
    qa: text(ledger('qa')),
    security: text(ledger('security', [finding({ dimension: 'security', severity: 'blocker', title: 'y' })]))
  }
  const out = foldDimensionAnswers({ expected, answers })
  assert.deepEqual(out.ledgers.map(l => l.dimension), expected)
  assert.deepEqual(out.ran, expected)
  assert.deepEqual(out.notRun, [])
  assert.equal(out.completed, true)
  assert.equal(out.ledgers[0].findings[0].title, 'y')
})

test('dimension fold: an absent answer is not run with a reason that names the missing file', () => {
  const out = foldDimensionAnswers({
    expected: ['security', 'qa'],
    answers: { security: text(ledger('security')) }
  })
  assert.deepEqual(out.ran, ['security'])
  assert.deepEqual(out.ledgers.map(l => l.dimension), ['security'])
  assert.equal(out.completed, false)
  assert.equal(out.notRun.length, 1)
  assert.equal(out.notRun[0].name, 'qa')
  assert.match(out.notRun[0].reason, /no answer file/)
})

test('dimension fold: a null answer reads as absent, never as a clean review', () => {
  const out = foldDimensionAnswers({ expected: ['qa'], answers: { qa: null } })
  assert.deepEqual(out.ran, [])
  assert.deepEqual(out.ledgers, [])
  assert.equal(out.completed, false)
  assert.equal(out.notRun[0].name, 'qa')
})

test('dimension fold: an unparseable answer is not run, the rest still fold', () => {
  const out = foldDimensionAnswers({
    expected: ['security', 'qa', 'architecture'],
    answers: {
      security: text(ledger('security')),
      qa: '{ "dimension": "qa", "findings": [',
      architecture: text(ledger('architecture'))
    }
  })
  assert.deepEqual(out.ran, ['security', 'architecture'])
  assert.deepEqual(out.ledgers.map(l => l.dimension), ['security', 'architecture'])
  assert.deepEqual(out.notRun.map(n => n.name), ['qa'])
  assert.match(out.notRun[0].reason, /parse|JSON/i)
  assert.equal(out.completed, false)
})

test('dimension fold: an answer with no findings list is not run, whatever else it carries', () => {
  for (const body of [{}, { dimension: 'qa' }, { dimension: 'qa', findings: 'none' }, 'null', '7', '"ok"']) {
    const out = foldDimensionAnswers({
      expected: ['qa'],
      answers: { qa: typeof body === 'string' ? body : text(body) }
    })
    assert.deepEqual(out.ran, [], JSON.stringify(body))
    assert.equal(out.completed, false, JSON.stringify(body))
    assert.equal(out.notRun[0].name, 'qa', JSON.stringify(body))
    assert.match(out.notRun[0].reason, /findings list/i, JSON.stringify(body))
  }
})

test('dimension fold: a bare list is not a ledger and is not run', () => {
  // A reviewer asked for { dimension, findings, coverage } that writes `[]` has said nothing
  // the fold can attribute to its dimension: the briefing says never a bare [].
  const out = foldDimensionAnswers({ expected: ['qa'], answers: { qa: '[]' } })
  assert.deepEqual(out.ran, [])
  assert.equal(out.completed, false)
})

test('dimension fold: an answer whose dimension names another is mismatched and not folded', () => {
  const out = foldDimensionAnswers({
    expected: ['security', 'architecture'],
    answers: {
      security: text(ledger('architecture', [finding({ dimension: 'architecture', title: 'borrowed' })])),
      architecture: text(ledger('architecture'))
    }
  })
  assert.deepEqual(out.ran, ['architecture'])
  assert.deepEqual(out.ledgers.map(l => l.dimension), ['architecture'])
  assert.equal(out.ledgers[0].findings.length, 0, 'the mismatched file contributes no finding')
  assert.equal(out.notRun.length, 1)
  assert.equal(out.notRun[0].name, 'security')
  assert.match(out.notRun[0].reason, /security/)
  assert.match(out.notRun[0].reason, /architecture/)
  assert.equal(out.completed, false)
})

test('dimension fold: an empty findings list is a dimension that ran and found nothing', () => {
  const out = foldDimensionAnswers({
    expected: ['qa'],
    answers: { qa: text(ledger('qa', [], ['lib/a.mjs']) ) }
  })
  assert.deepEqual(out.ran, ['qa'])
  assert.deepEqual(out.notRun, [])
  assert.equal(out.completed, true)
  assert.equal(out.ledgers.length, 1)
  assert.deepEqual(out.ledgers[0].findings, [])
})

test('dimension fold: an answer that omits its dimension field is attributed to the name it was read under', () => {
  const out = foldDimensionAnswers({
    expected: ['qa'],
    answers: { qa: text({ findings: [finding({ title: 'z' })], coverage: [] }) }
  })
  assert.deepEqual(out.ran, ['qa'])
  assert.equal(out.completed, true)
  assert.equal(out.ledgers[0].dimension, 'qa')
  assert.equal(out.ledgers[0].findings[0].title, 'z')
})

test('dimension fold: nothing readable records every dimension not run and the review not completed', () => {
  const out = foldDimensionAnswers({ expected: ['security', 'qa'], answers: {} })
  assert.deepEqual(out.ledgers, [])
  assert.deepEqual(out.ran, [])
  assert.deepEqual(out.notRun.map(n => n.name), ['security', 'qa'])
  assert.equal(out.completed, false)
})

test('dimension fold: an answer file for a dimension nobody selected is never read', () => {
  const out = foldDimensionAnswers({
    expected: ['qa'],
    answers: { qa: text(ledger('qa')), stale: text(ledger('stale', [finding({ title: 'left over' })])) }
  })
  assert.deepEqual(out.ledgers.map(l => l.dimension), ['qa'])
  assert.deepEqual(out.ran, ['qa'])
})

// ---------------------------------------------------------------------------
// the verdict fold
// ---------------------------------------------------------------------------

const verdict = (id, isReal = true, over = {}) => ({ findingId: id, findingTitle: 't', file: 'lib/a.mjs', isReal, ...over })
const pair = id => [
  { label: `skeptic-${id}-refute`, role: 'refute', findingIds: [id] },
  { label: `skeptic-${id}-second-opinion`, role: 'second-opinion', findingIds: [id] }
]

test('verdict fold: readable files are concatenated in the expected order', () => {
  const expected = [...pair('F-aaaaaaaa'), ...pair('F-bbbbbbbb')]
  const files = {
    'skeptic-F-bbbbbbbb-second-opinion': text([verdict('F-bbbbbbbb', true, { reasoning: 'd' })]),
    'skeptic-F-aaaaaaaa-refute': text([verdict('F-aaaaaaaa', true, { reasoning: 'a' })]),
    'skeptic-F-aaaaaaaa-second-opinion': text([verdict('F-aaaaaaaa', true, { reasoning: 'b' })]),
    'skeptic-F-bbbbbbbb-refute': text([verdict('F-bbbbbbbb', true, { reasoning: 'c' })])
  }
  const out = foldSkepticVerdicts({ expected, files })
  assert.deepEqual(out.verdicts.map(v => v.reasoning), ['a', 'b', 'c', 'd'])
  assert.deepEqual(out.setAside, [])
})

test('verdict fold: an absent file sets aside both verdicts of its pair, including the sibling that answered', () => {
  const expected = [...pair('F-aaaaaaaa'), ...pair('F-bbbbbbbb')]
  const files = {
    // the refute skeptic for A wrote nothing; its sibling voted the finding not real, with evidence
    'skeptic-F-aaaaaaaa-second-opinion': text([verdict('F-aaaaaaaa', false, { evidence: 'lib/a.mjs:1-4' })]),
    'skeptic-F-bbbbbbbb-refute': text([verdict('F-bbbbbbbb', true, { reasoning: 'kept' })]),
    'skeptic-F-bbbbbbbb-second-opinion': text([verdict('F-bbbbbbbb', true, { reasoning: 'kept too' })])
  }
  const out = foldSkepticVerdicts({ expected, files })
  assert.deepEqual(out.setAside, ['skeptic-F-aaaaaaaa-refute'])
  assert.deepEqual(out.verdicts.map(v => v.findingId), ['F-bbbbbbbb', 'F-bbbbbbbb'])
  assert.ok(!out.verdicts.some(v => v.findingId === 'F-aaaaaaaa'), 'a finding is never dismissed on one verdict')
})

test('verdict fold: a file that is not a list sets aside its pair, as an absent one does', () => {
  for (const body of [text({ verdicts: [] }), text({}), 'null', '3', '"done"', '[ {', '']) {
    const out = foldSkepticVerdicts({
      expected: pair('F-aaaaaaaa'),
      files: {
        'skeptic-F-aaaaaaaa-refute': body,
        'skeptic-F-aaaaaaaa-second-opinion': text([verdict('F-aaaaaaaa')])
      }
    })
    assert.deepEqual(out.setAside, ['skeptic-F-aaaaaaaa-refute'], JSON.stringify(body))
    assert.deepEqual(out.verdicts, [], JSON.stringify(body))
  }
})

test('verdict fold: both skeptics of a pair silent names both labels', () => {
  const out = foldSkepticVerdicts({ expected: pair('F-aaaaaaaa'), files: {} })
  assert.deepEqual(out.setAside.slice().sort(), ['skeptic-F-aaaaaaaa-refute', 'skeptic-F-aaaaaaaa-second-opinion'])
  assert.deepEqual(out.verdicts, [])
})

test('verdict fold: the per-review pair is one pair over all its findings', () => {
  const ids = ['F-cccccccc', 'F-dddddddd']
  const expected = [
    { label: 'skeptic-review-refute', role: 'refute', findingIds: ids },
    { label: 'skeptic-review-second-opinion', role: 'second-opinion', findingIds: ids }
  ]
  const out = foldSkepticVerdicts({
    expected,
    files: { 'skeptic-review-second-opinion': text(ids.map(i => verdict(i))) }
  })
  assert.deepEqual(out.setAside, ['skeptic-review-refute'])
  assert.deepEqual(out.verdicts, [])
})

test('verdict fold: an empty list is an answer, not a silence', () => {
  const out = foldSkepticVerdicts({
    expected: pair('F-aaaaaaaa'),
    files: { 'skeptic-F-aaaaaaaa-refute': '[]', 'skeptic-F-aaaaaaaa-second-opinion': '[]' }
  })
  assert.deepEqual(out.setAside, [])
  assert.deepEqual(out.verdicts, [])
})

test('verdict fold: nothing expected folds to an empty list and sets nothing aside', () => {
  const out = foldSkepticVerdicts({ expected: [], files: {} })
  assert.deepEqual(out.verdicts, [])
  assert.deepEqual(out.setAside, [])
})

test('verdict fold: a file nobody expected is never read', () => {
  const out = foldSkepticVerdicts({
    expected: pair('F-aaaaaaaa'),
    files: {
      'skeptic-F-aaaaaaaa-refute': text([verdict('F-aaaaaaaa')]),
      'skeptic-F-aaaaaaaa-second-opinion': text([verdict('F-aaaaaaaa')]),
      'skeptic-F-zzzzzzzz-refute': text([verdict('F-zzzzzzzz', false, { evidence: 'lib/a.mjs:1' })])
    }
  })
  assert.ok(!out.verdicts.some(v => v.findingId === 'F-zzzzzzzz'))
})

// ---------------------------------------------------------------------------
// the cap allocation
// ---------------------------------------------------------------------------

const many = (blockers, warnings) => {
  const out = []
  for (let i = 0; i < blockers; i++) out.push(finding({ severity: 'blocker', title: `blocker ${i}`, file: `lib/b${i}.mjs` }))
  for (let i = 0; i < warnings; i++) out.push(finding({ severity: 'warning', title: `warning ${i}`, file: `lib/w${i}.mjs` }))
  return out
}
const allocate = (findings, cap) =>
  allocateSkeptics({
    prompts: assembleSkepticPrompts({ findings, skeptics: 'per-finding' }).prompts,
    findings,
    cap
  })
const idsOf = spawns => [...new Set(spawns.flatMap(s => s.findingIds))]

test('cap allocation: under the cap every finding gets its pair and nothing is reached', () => {
  const findings = many(3, 2)
  const out = allocate(findings, 16)
  assert.equal(out.spawns.length, 10)
  assert.equal(out.capReached, false)
  assert.equal(out.perFinding, 5)
  assert.equal(out.perReview, 0)
  for (const f of findings) {
    const mine = out.spawns.filter(s => s.findingIds.length === 1 && s.findingIds[0] === findingId(f))
    assert.deepEqual(mine.map(s => s.skeptic).sort(), ['refute', 'second-opinion'])
  }
})

test('cap allocation: exactly at the cap is not over it', () => {
  const out = allocate(many(2, 2), 8)
  assert.equal(out.spawns.length, 8)
  assert.equal(out.capReached, false)
  assert.equal(out.perReview, 0)
})

test('cap allocation: over the cap, blockers first then warnings, one per-review pair reserved inside the cap', () => {
  const findings = many(4, 7)
  const out = allocate(findings, 16)
  assert.equal(out.capReached, true)
  assert.equal(out.spawns.length, 16)
  assert.equal(out.perFinding, 7)
  assert.equal(out.perReview, 4)
  // the first seven findings in blocker-then-warning order are judged per finding
  const first = findings.slice(0, 7).map(findingId)
  const rest = findings.slice(7).map(findingId)
  const single = out.spawns.filter(s => s.findingIds.length === 1)
  assert.deepEqual(idsOf(single), first)
  const shared = out.spawns.filter(s => s.findingIds.length > 1)
  assert.equal(shared.length, 2)
  assert.deepEqual(shared.map(s => s.skeptic).sort(), ['refute', 'second-opinion'])
  for (const s of shared) assert.deepEqual(s.findingIds, rest)
})

test('cap allocation: the order is blockers before warnings whatever order the findings arrived in', () => {
  const warnings = many(0, 3)
  const blockers = many(2, 0)
  const findings = [...warnings, ...blockers] // warnings first in finding order
  const out = allocate(findings, 6) // room for two pairs plus the reserved per-review pair
  assert.equal(out.capReached, true)
  assert.equal(out.spawns.length, 6)
  const single = out.spawns.filter(s => s.findingIds.length === 1)
  assert.deepEqual(idsOf(single), blockers.map(findingId), 'both blockers are judged per finding')
  const shared = out.spawns.filter(s => s.findingIds.length > 1)
  assert.deepEqual(shared[0].findingIds, warnings.map(findingId), 'warnings share the per-review pair, in finding order')
})

test('cap allocation: warnings keep finding order inside their tier', () => {
  const findings = many(0, 6)
  const out = allocate(findings, 6) // two per-finding pairs, then the reserved pair over the other four
  const single = out.spawns.filter(s => s.findingIds.length === 1)
  assert.deepEqual(idsOf(single), findings.slice(0, 2).map(findingId))
  const shared = out.spawns.filter(s => s.findingIds.length > 1)
  assert.deepEqual(shared[0].findingIds, findings.slice(2).map(findingId))
})

test('cap allocation: a cap of 2 is one per-review pair over everything', () => {
  const findings = many(2, 3)
  const out = allocate(findings, 2)
  assert.equal(out.spawns.length, 2)
  assert.equal(out.capReached, true)
  assert.equal(out.perFinding, 0)
  assert.equal(out.perReview, 5)
  assert.deepEqual(out.spawns.map(s => s.skeptic).sort(), ['refute', 'second-opinion'])
  for (const s of out.spawns) assert.deepEqual(s.findingIds, findings.map(findingId))
})

test('cap allocation: a cap of 2 with one finding fits as a per-finding pair and reaches nothing', () => {
  const findings = many(1, 0)
  const out = allocate(findings, 2)
  assert.equal(out.spawns.length, 2)
  assert.equal(out.capReached, false)
  assert.equal(out.perFinding, 1)
  assert.equal(out.perReview, 0)
})

test('cap allocation: the step never exceeds the cap, odd caps included', () => {
  for (const cap of [2, 3, 4, 5, 6, 7, 9, 16]) {
    for (const [b, w] of [[1, 0], [0, 1], [3, 0], [2, 4], [5, 9], [8, 8]]) {
      const out = allocate(many(b, w), cap)
      assert.ok(out.spawns.length <= cap, `cap ${cap}, ${b}+${w}: ${out.spawns.length} spawns`)
      assert.equal(out.spawns.length % 2, 0, 'spawns come in pairs')
      assert.equal(out.perFinding + out.perReview, b + w, `cap ${cap}, ${b}+${w}: every finding is judged one way`)
    }
  }
})

test('cap allocation: an odd cap leaves one slot unused', () => {
  const out = allocate(many(0, 6), 5)
  assert.equal(out.spawns.length, 4)
  assert.equal(out.capReached, true)
  assert.equal(out.perFinding, 1)
  assert.equal(out.perReview, 5)
})

test('cap allocation: no judged finding allocates nothing', () => {
  const out = allocateSkeptics({ prompts: [], findings: [], cap: 16 })
  assert.deepEqual(out.spawns, [])
  assert.equal(out.capReached, false)
  assert.equal(out.perFinding, 0)
  assert.equal(out.perReview, 0)
})

test('cap allocation: a suggestion is never judged and never counts against the cap', () => {
  const findings = [...many(1, 0), finding({ severity: 'suggestion', title: 'nit', file: 'lib/n.mjs' })]
  const out = allocate(findings, 2)
  assert.equal(out.spawns.length, 2)
  assert.equal(out.capReached, false)
  assert.ok(!idsOf(out.spawns).includes(findingId(findings[1])))
})

test('cap allocation: every spawn carries a prompt', () => {
  const out = allocate(many(2, 3), 6)
  for (const s of out.spawns) {
    assert.equal(typeof s.prompt, 'string')
    assert.ok(s.prompt.length > 0)
  }
  // the per-review pair is briefed on the findings it carries
  const shared = out.spawns.filter(s => s.findingIds.length > 1)
  for (const s of shared) for (const id of s.findingIds) assert.ok(s.prompt.includes(id), `${id} is in the shared prompt`)
})

// ---------------------------------------------------------------------------
// the banners
// ---------------------------------------------------------------------------

test('REVIEW WAVE text names the counts and each routing', () => {
  assert.equal(
    reviewWaveBanner({
      reviewers: 6,
      reviewerRouting: { model: 'opus', effort: 'high' },
      skeptics: 4,
      skepticRouting: { model: 'sonnet', effort: 'medium' }
    }),
    'REVIEW WAVE: 6 reviewers (opus/high), 4 skeptics (sonnet/medium)'
  )
})

test('REVIEW WAVE text prints inherit for a null model or effort', () => {
  assert.equal(
    reviewWaveBanner({
      reviewers: 6,
      reviewerRouting: { model: null, effort: null },
      skeptics: 0,
      skepticRouting: { model: null, effort: null }
    }),
    'REVIEW WAVE: 6 reviewers (inherit/inherit), 0 skeptics (inherit/inherit)'
  )
  assert.equal(
    reviewWaveBanner({
      reviewers: 5,
      reviewerRouting: { model: 'opus', effort: null },
      skeptics: 2,
      skepticRouting: { model: null, effort: 'low' }
    }),
    'REVIEW WAVE: 5 reviewers (opus/inherit), 2 skeptics (inherit/low)'
  )
})

test('REVIEW WAVE text prints zero skeptics on the review step, before run found has counted them', () => {
  const text0 = reviewWaveBanner({
    reviewers: 6,
    reviewerRouting: { model: null, effort: null },
    skeptics: 0,
    skepticRouting: { model: null, effort: null }
  })
  assert.match(text0, /^REVIEW WAVE: 6 reviewers \(.+\), 0 skeptics \(.+\)$/)
})

test('SKEPTIC CAP REACHED text names the findings judged each way', () => {
  assert.equal(
    skepticCapBanner({ perFinding: 7, perReview: 4 }),
    'SKEPTIC CAP REACHED: 7 of 11 findings judged per finding, 4 judged per review'
  )
  assert.equal(
    skepticCapBanner({ perFinding: 0, perReview: 5 }),
    'SKEPTIC CAP REACHED: 0 of 5 findings judged per finding, 5 judged per review'
  )
})

test('the banner an allocation feeds is the one the spec prints for 4 blockers and 7 warnings under 16', () => {
  const out = allocate(many(4, 7), 16)
  assert.equal(
    skepticCapBanner(out),
    'SKEPTIC CAP REACHED: 7 of 11 findings judged per finding, 4 judged per review'
  )
})

// ---- stepWidthBanner, boundedValue, fold kinds, notRunBanner ----

const { stepWidthBanner, boundedValue, notRunBanner } = mod

test('stepWidthBanner is null unless maxParallel is a positive integer below the spawn count', () => {
  for (const maxParallel of [undefined, null, 0, -1, 2.5, '2']) {
    assert.equal(stepWidthBanner({ action: 'review', spawns: 9, maxParallel }), null, String(maxParallel))
  }
  assert.equal(stepWidthBanner({ action: 'review', spawns: 4, maxParallel: 4 }), null)
  assert.equal(stepWidthBanner({ action: 'review', spawns: 3, maxParallel: 4 }), null)
})

test('stepWidthBanner names the step, the width and the flag when spawns exceed maxParallel', () => {
  for (const action of ['review', 'skeptics']) {
    assert.equal(
      stepWidthBanner({ action, spawns: 7, maxParallel: 3 }),
      `REVIEW WIDER THAN MAX PARALLEL: the ${action} step spawns 7 agents and --max-parallel is 3 — ` +
        'the flag bounds implementer batches only; this step is not chunked, so a runner host starts all 7 at once'
    )
  }
})

test('boundedValue passes a string, stringifies other values, collapses whitespace and cuts past max', () => {
  assert.equal(boundedValue('qa'), 'qa')
  assert.equal(boundedValue(42), '42')
  assert.equal(boundedValue({ a: 1 }), '{"a":1}')
  assert.equal(boundedValue('a\n\n  b\t c'), 'a b c')
  assert.equal(boundedValue('x'.repeat(80)), 'x'.repeat(80))
  assert.equal(boundedValue('x'.repeat(81)), `${'x'.repeat(80)}…`)
  assert.equal(boundedValue('x'.repeat(10), 10), 'x'.repeat(10))
  assert.equal(boundedValue('x'.repeat(11), 10), `${'x'.repeat(10)}…`)
})

test('foldDimensionAnswers gives each notRun entry its kind', () => {
  const out = foldDimensionAnswers({
    expected: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    answers: {
      a: null,
      b: '   \n\t',
      c: '{nope',
      d: '[]',
      e: '{"dimension":"e"}',
      f: '{"dimension":"other","findings":[]}',
      g: '{"findings":[]}'
    }
  })
  assert.deepEqual(out.notRun.map(n => [n.name, n.kind]), [
    ['a', 'missing'],
    ['b', 'empty'],
    ['c', 'unparseable'],
    ['d', 'bare-list'],
    ['e', 'no-findings'],
    ['f', 'mismatch'],
    ['h', 'missing']
  ])
  assert.deepEqual(out.ran, ['g'])
  assert.equal(out.completed, false)
})

test('foldDimensionAnswers treats whitespace-only text as empty, never missing, and names the file', () => {
  const out = foldDimensionAnswers({ expected: ['qa'], answers: { qa: '  \n' }, fileOf: n => `out/${n}.json` })
  assert.equal(out.notRun[0].kind, 'empty')
  assert.equal(out.notRun[0].reason, 'out/qa.json is empty')
})

test('foldDimensionAnswers names a custom fileOf path in every reason', () => {
  const fileOf = n => `custom/${n}.json`
  const answers = { a: null, b: ' ', c: '{x', d: '[]', e: '{}', f: '{"dimension":"z","findings":[]}' }
  const out = foldDimensionAnswers({ expected: Object.keys(answers), answers, fileOf })
  assert.equal(out.notRun.length, 6)
  for (const n of out.notRun) assert.ok(n.reason.includes(`custom/${n.name}.json`), n.reason)
})

test('foldDimensionAnswers bounds a mismatched dimension and never prints [object Object]', () => {
  const long = foldDimensionAnswers({
    expected: ['qa'],
    answers: { qa: JSON.stringify({ dimension: 'y'.repeat(200), findings: [] }) }
  })
  assert.equal(long.notRun[0].got, `${'y'.repeat(80)}…`)
  const obj = foldDimensionAnswers({
    expected: ['qa'],
    answers: { qa: JSON.stringify({ dimension: { a: 1 }, findings: [] }) }
  })
  assert.equal(obj.notRun[0].got, '{"a":1}')
  assert.doesNotMatch(obj.notRun[0].reason, /\[object Object\]/)
})

test('foldDimensionAnswers is completed only when nothing is notRun', () => {
  const ok = foldDimensionAnswers({ expected: ['qa'], answers: { qa: '{"findings":[]}' } })
  assert.equal(ok.completed, true)
  const mixed = foldDimensionAnswers({ expected: ['qa', 'dx'], answers: { qa: '{"findings":[]}' } })
  assert.equal(mixed.completed, false)
})

test('notRunBanner prints each form exactly', () => {
  assert.equal(notRunBanner({ name: 'qa', kind: 'missing', reason: 'no answer file at x' }), 'REVIEW INCOMPLETE: qa — no answer file')
  assert.equal(notRunBanner({ name: 'qa', kind: 'empty', reason: 'x.json is empty' }), 'REVIEW INCOMPLETE: qa — x.json is empty')
  assert.equal(notRunBanner({ name: 'qa', kind: 'unparseable', reason: 'bad json' }), 'REVIEW INCOMPLETE: qa — bad json')
  assert.equal(notRunBanner({ name: 'qa', kind: 'mismatch', got: 'dx', reason: 'r' }), 'REVIEW ANSWER MISMATCHED: qa wrote dx')
})

test('notRunBanner appends a non-blank string detail and ignores any other', () => {
  const entry = { name: 'qa', kind: 'missing', reason: 'r' }
  assert.equal(notRunBanner(entry, 'ran out of turns'), 'REVIEW INCOMPLETE: qa — no answer file; the reviewer reported: ran out of turns')
  assert.equal(notRunBanner({ name: 'qa', kind: 'mismatch', got: 'dx', reason: 'r' }, 'oops'), 'REVIEW ANSWER MISMATCHED: qa wrote dx; the reviewer reported: oops')
  for (const detail of ['', '   \n', undefined, null, 7, { a: 1 }, ['x']]) {
    assert.equal(notRunBanner(entry, detail), 'REVIEW INCOMPLETE: qa — no answer file', String(detail))
  }
})

test('notRunBanner cuts a long detail to 160 characters plus an ellipsis', () => {
  const out = notRunBanner({ name: 'qa', kind: 'missing', reason: 'r' }, 'z'.repeat(500))
  assert.equal(out, `REVIEW INCOMPLETE: qa — no answer file; the reviewer reported: ${'z'.repeat(160)}…`)
})
