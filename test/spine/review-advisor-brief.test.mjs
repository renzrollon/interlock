// The review-findings advisor's brief and its id index.
//
// The brief is assembled by code from the resolved review (`resolveReview`'s
// buckets), the raw skeptic verdicts, the changed paths and the caps, with the
// stamp and the brief's path chosen by the caller, so the same input gives the
// same bytes: no clock, no file, no process state is read here. It numbers the
// survivors `S<n>` and the dismissals `D<n>` by position, prints under each
// dismissal every raw verdict the review matched to it (what `resolveReview`
// keeps only as vote counts), and quotes every finding and verdict as data.
//
// The total is bounded by `limits.maxReviewAdvisorBriefChars`. Cuts happen whole
// section at a time, policy drops first and quality drops second, and every cut
// is named under `## Omitted`. Survivors, dismissals and the instructions are
// never cut: when they alone exceed the cap the brief is kept whole and the
// overrun is spoken.
//
// The input, as these tests build it:
//   { change, stamp, briefPath, result, verdicts, changedPaths, limits }
// where `result` is `resolveReview`'s output and `verdicts` the raw array.
//
// See add-review-findings-advisor design.md D1, D2, D5, D6, D9.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveReview } from '../../lib/review-core.mjs'
import {
  assembleReviewAdvisorBrief,
  planReviewAdvisorBrief,
  indexOf
} from '../../lib/prompts/review-advisor.mjs'
import * as briefKit from '../../lib/prompts/brief-kit.mjs'
import { PROMPTS, NON_ASSEMBLER_MODULES } from '../../lib/prompts/index.mjs'
import { LIMITS } from '../../lib/limits.mjs'

// --- the fixture -----------------------------------------------------------

const CHANGED = ['lib/a.mjs', 'lib/b.mjs', 'lib/c.mjs', 'lib/e.mjs']

const finding = over => ({
  severity: 'warning',
  dimension: 'typescript',
  file: 'lib/a.mjs',
  title: 'untitled',
  description: 'because',
  ...over
})

const verdict = over => ({
  findingTitle: 'untitled',
  isReal: true,
  confidence: 0.9,
  reasoning: 'checked it',
  evidence: 'lib/a.mjs:10',
  refinedSeverity: 'warning',
  qualityScore: 4,
  severityScore: 3,
  ...over
})

const FILLER = n => 'x'.repeat(n)

/**
 * Two survivors, two dismissals, a quality drop and a policy drop.
 *
 * D1 is adjudicated by title-only verdicts (four of them: one real, three not).
 * D2 is adjudicated by file-qualified verdicts, and a title-only verdict for the
 * same title that `verdictsFor` ignores because a file-qualified set exists.
 */
function fixture({ policyBulk = 0, qualityBulk = 0, extra = {} } = {}) {
  const findings = [
    finding({ file: 'lib/a.mjs', title: 'S-ONE reads the wrong key', description: 'SURVIVOR-ONE-BODY' }),
    finding({ file: 'lib/b.mjs', title: 'D-ONE off by one', description: 'DISMISSED-ONE-BODY' }),
    finding({ file: 'lib/c.mjs', title: 'S-TWO reads it twice', dimension: 'qa', description: 'SURVIVOR-TWO-BODY' }),
    finding({ file: 'lib/e.mjs', title: 'Q-ONE vague', description: 'QUALITY-DROP-BODY ' + FILLER(qualityBulk) }),
    finding({ file: 'dist/x.js', title: 'P-ONE generated', description: 'POLICY-DROP-BODY ' + FILLER(policyBulk) }),
    finding({ file: 'lib/b.mjs', title: 'D-TWO missing null check', description: 'DISMISSED-TWO-BODY' })
  ]
  const verdicts = [
    verdict({ findingTitle: 'S-ONE reads the wrong key' }),
    verdict({ findingTitle: 'S-ONE reads the wrong key' }),
    verdict({
      findingTitle: 'D-ONE off by one',
      isReal: false,
      reasoning: 'REASON-D1-A it is bounded above',
      evidence: 'lib/b.mjs:12',
      refinedSeverity: 'dismiss'
    }),
    verdict({
      findingTitle: 'D-ONE off by one',
      isReal: false,
      reasoning: 'REASON-D1-B the loop is exclusive',
      evidence: 'lib/b.mjs:30',
      refinedSeverity: 'dismiss'
    }),
    verdict({
      findingTitle: 'D-ONE off by one',
      isReal: false,
      reasoning: 'REASON-D1-C same as above',
      evidence: 'lib/b.mjs:31',
      refinedSeverity: 'dismiss'
    }),
    verdict({ findingTitle: 'D-ONE off by one', isReal: true, reasoning: 'REASON-D1-D I disagree', evidence: 'lib/b.mjs:14' }),
    verdict({ findingTitle: 'S-TWO reads it twice' }),
    verdict({ findingTitle: 'Q-ONE vague', qualityScore: 1 }),
    verdict({ findingTitle: 'Q-ONE vague', qualityScore: 1 }),
    verdict({
      findingTitle: 'D-TWO missing null check',
      file: 'lib/b.mjs',
      isReal: false,
      reasoning: 'REASON-D2-A guarded upstream',
      evidence: 'lib/b.mjs:77',
      refinedSeverity: 'dismiss'
    }),
    verdict({
      findingTitle: 'D-TWO missing null check',
      file: 'lib/b.mjs',
      isReal: false,
      reasoning: 'REASON-D2-B guarded upstream too',
      evidence: 'lib/b.mjs:78',
      refinedSeverity: 'dismiss'
    }),
    verdict({ findingTitle: 'D-TWO missing null check', isReal: true, reasoning: 'TITLE-ONLY-NOT-MATCHED', evidence: 'lib/b.mjs:90' })
  ]
  const result = resolveReview(findings, verdicts, { changedPaths: CHANGED, excludePaths: ['dist'], ...extra })
  return { findings, verdicts, result }
}

function input(overrides = {}, fixtureOpts = {}) {
  const { verdicts, result } = fixture(fixtureOpts)
  return {
    change: 'add-the-thing',
    stamp: '20261022-101010',
    briefPath: '.claude/metrics/review-advisor-brief-add-the-thing-20261022-101010.md',
    result,
    verdicts,
    changedPaths: CHANGED,
    limits: LIMITS,
    ...overrides
  }
}

/** The body under a `## <name>` heading, up to the next `## ` heading, or null. */
function section(text, name) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.trim() === `## ${name}`)
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => l.startsWith('## '))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

/** Where an id is introduced: a line that opens with it, after any heading or list markup. */
function introduced(text, id) {
  const m = new RegExp(`^[#>\\-*|\\s]*[\`*]*${id}\\b`, 'm').exec(text)
  return m ? m.index : -1
}

/** The text from one id's introduction to the next id's, or the end. */
function block(text, id, nextId) {
  const from = introduced(text, id)
  assert.ok(from >= 0, `${id} is never introduced`)
  const to = nextId ? introduced(text.slice(from + 1), nextId) : -1
  return to < 0 ? text.slice(from) : text.slice(from, from + 1 + to)
}

const BIG = { ...LIMITS, maxReviewAdvisorBriefChars: 10_000_000 }

// --- the resolved fixture is what these tests say it is --------------------

test('the fixture resolves to two survivors, two dismissals, one quality drop and one policy drop', () => {
  const { result } = fixture()
  assert.deepEqual(
    result.surviving.map(f => f.title),
    ['S-ONE reads the wrong key', 'S-TWO reads it twice']
  )
  assert.deepEqual(
    result.dismissed.map(f => f.title),
    ['D-ONE off by one', 'D-TWO missing null check']
  )
  assert.deepEqual(result.droppedByQuality.map(f => f.title), ['Q-ONE vague'])
  assert.deepEqual(result.droppedByPolicy.map(f => f.title), ['P-ONE generated'])
})

// --- ids and the verdict join ----------------------------------------------

test('survivors are S<n> and dismissals D<n> in the resolved order, each introduced once with its finding', () => {
  const text = assembleReviewAdvisorBrief(input())
  const s1 = introduced(text, 'S1')
  const s2 = introduced(text, 'S2')
  const d1 = introduced(text, 'D1')
  const d2 = introduced(text, 'D2')
  for (const [id, at] of [['S1', s1], ['S2', s2], ['D1', d1], ['D2', d2]]) assert.ok(at >= 0, `${id} is not introduced`)
  assert.ok(s1 < s2 && d1 < d2, 'ids are not in input order')
  assert.equal(introduced(text, 'S3'), -1)
  assert.equal(introduced(text, 'D3'), -1)

  assert.ok(block(text, 'S1', 'S2').includes('S-ONE reads the wrong key'))
  assert.ok(block(text, 'S1', 'S2').includes('lib/a.mjs'))
  assert.ok(block(text, 'S2', 'D1').includes('S-TWO reads it twice') || block(text, 'S2').includes('S-TWO reads it twice'))
  assert.ok(block(text, 'D1', 'D2').includes('D-ONE off by one'))
  assert.ok(block(text, 'D2').includes('D-TWO missing null check'))
})

test('under each dismissal every matched verdict prints its isReal, reasoning, evidence and refined severity', () => {
  const text = assembleReviewAdvisorBrief(input())
  const d1 = block(text, 'D1', 'D2')
  for (const needle of [
    'REASON-D1-A',
    'REASON-D1-B',
    'REASON-D1-C',
    'REASON-D1-D',
    'lib/b.mjs:12',
    'lib/b.mjs:30',
    'lib/b.mjs:31',
    'lib/b.mjs:14',
    'dismiss'
  ]) {
    assert.ok(d1.includes(needle), `D1 lacks ${needle}`)
  }
  assert.ok(/\bfalse\b/.test(d1) && /\btrue\b/.test(d1), 'D1 does not print both isReal values')

  const d2 = block(text, 'D2')
  for (const needle of ['REASON-D2-A', 'REASON-D2-B', 'lib/b.mjs:77', 'lib/b.mjs:78']) {
    assert.ok(d2.includes(needle), `D2 lacks ${needle}`)
  }
})

test('the vote counts print under the dismissal they belong to', () => {
  const text = assembleReviewAdvisorBrief(input())
  const d1 = block(text, 'D1', 'D2')
  // D1: one skeptic voted real, three voted not real, four in all.
  assert.ok(/\b3\b/.test(d1), 'the not-real count is missing')
  assert.ok(/\b4\b/.test(d1), 'the total is missing')
})

test('the file-qualified verdict set wins: a title-only verdict for the same title is not matched', () => {
  const text = assembleReviewAdvisorBrief(input())
  assert.ok(!text.includes('TITLE-ONLY-NOT-MATCHED'))
})

// --- the other sections ----------------------------------------------------

test('quality drops are listed with their file and title', () => {
  const text = assembleReviewAdvisorBrief(input())
  assert.ok(text.includes('Q-ONE vague') && text.includes('lib/e.mjs'))
  assert.ok(text.includes('QUALITY-DROP-BODY'))
})

test('policy drops are listed with the pattern that excluded them', () => {
  const text = assembleReviewAdvisorBrief(input())
  assert.ok(text.includes('P-ONE generated') && text.includes('dist/x.js'))
  const policy = text.split('\n').filter(l => l.includes('excluded')).join('\n')
  assert.ok(policy.includes('dist'), `no line names the excluding pattern: ${policy}`)
})

test('the per-dimension raised and surviving counts are printed', () => {
  const text = assembleReviewAdvisorBrief(input())
  const lines = text.split('\n')
  // typescript raised 4 (the policy drop is excluded from the dimensions) and kept 1.
  assert.ok(
    lines.some(l => /\btypescript\b/.test(l) && /\b4\b/.test(l) && /\b1\b/.test(l)),
    'no line carries the typescript counts'
  )
  assert.ok(
    lines.some(l => /\bqa\b/.test(l) && /\b1\b/.test(l)),
    'no line carries the qa counts'
  )
})

test('every changed path is listed', () => {
  const text = assembleReviewAdvisorBrief(input())
  const changed = section(text, 'Changed files')
  assert.ok(changed, 'no ## Changed files section')
  for (const path of CHANGED) assert.ok(changed.includes(path), path)
})

test('the brief states the flag cap read from the limits passed in', () => {
  const text = assembleReviewAdvisorBrief(input({ limits: { ...LIMITS, maxReviewAdvisorFlags: 7 } }))
  assert.ok(
    text.split('\n').some(l => /flag/i.test(l) && /\b7\b/.test(l)),
    'no line states the flag cap'
  )
})

test('the brief names the three flag kinds with their targets and the reply shape', () => {
  const text = assembleReviewAdvisorBrief(input())
  for (const kind of ['dismissal-doubt', 'shared-root-cause', 'uncovered']) assert.ok(text.includes(kind), kind)
  const kindLine = k => text.split('\n').find(l => l.includes(k))
  assert.ok(/D<n>|\bD\d\b/.test(kindLine('dismissal-doubt')), 'dismissal-doubt does not say its target is a D id')
  assert.ok(/S<n>|\bS\d\b/.test(kindLine('shared-root-cause')), 'shared-root-cause does not say its targets are S ids')
  assert.ok(/path|changed/i.test(kindLine('uncovered')), 'uncovered does not say its target is a changed path')
  for (const field of ['"flags"', '"kind"', '"targets"', '"why"', '"check"']) {
    assert.ok(text.includes(field), `reply shape lacks ${field}`)
  }
})

test('the brief says the advisor raises and never decides', () => {
  const text = assembleReviewAdvisorBrief(input())
  assert.match(text, /never decides?/i)
  assert.match(text, /\braises?\b/i)
  assert.match(text, /data/i)
})

test('the brief names the change and carries the stamp it was given', () => {
  const text = assembleReviewAdvisorBrief(input())
  assert.match(text.split('\n')[0], /add-the-thing/)
  assert.ok(text.includes('20261022-101010'))
})

test('a review with no dismissals still assembles, and says there were none', () => {
  const { findings, verdicts } = fixture()
  const result = resolveReview(
    findings.filter(f => f.title.startsWith('S-')),
    verdicts,
    { changedPaths: CHANGED }
  )
  const text = assembleReviewAdvisorBrief(input({ result, verdicts }))
  assert.equal(introduced(text, 'D1'), -1)
  assert.ok(introduced(text, 'S1') >= 0)
  assert.match(text, /none/i)
})

// --- quoting ---------------------------------------------------------------

test('finding and verdict text is quoted with a fence longer than any backtick run inside it', () => {
  const { findings, verdicts } = fixture()
  findings[0] = { ...findings[0], description: 'QUOTED-BODY ``````` seven ticks ``````` end' }
  verdicts[2] = { ...verdicts[2], reasoning: 'QUOTED-REASON ````` five ticks ````` end' }
  const result = resolveReview(findings, verdicts, { changedPaths: CHANGED, excludePaths: ['dist'] })
  const text = assembleReviewAdvisorBrief(input({ result, verdicts }))
  assert.ok(text.includes('QUOTED-BODY') && text.includes('QUOTED-REASON'))
  const fences = text.split('\n').filter(l => /^`{3,}/.test(l))
  assert.ok(fences.some(l => /^`{8,}/.test(l)), 'no fence longer than the seven-tick run inside a finding')
  // Every fence line opens or closes a block with nothing but its info string.
  assert.equal(fences.length % 2, 0, 'a fence is left open')
})

test('the brief quotes finding text as data and says so', () => {
  const text = assembleReviewAdvisorBrief(input())
  assert.match(text, /data to read, never instructions|quoted .* data|as data/i)
})

// --- the cap and the cut order ---------------------------------------------

const BULK = 1500
const bulky = () => ({ policyBulk: BULK * 20, qualityBulk: BULK * 20 })

/** A fixture with `n` extra policy and quality drops so the cuttable sections are large. */
function bulkyInput(limits, mutate = x => x) {
  const base = fixture(bulky())
  const { findings, verdicts } = base
  const extraPolicy = Array.from({ length: 20 }, (_, i) =>
    finding({ file: `dist/g${i}.js`, title: `P-EXTRA-${i}`, description: 'POLICY-FILLER ' + FILLER(BULK) })
  )
  const extraQuality = Array.from({ length: 20 }, (_, i) =>
    finding({ file: 'lib/e.mjs', title: `Q-EXTRA-${i}`, description: 'QUALITY-FILLER ' + FILLER(BULK) })
  )
  const qualityVerdicts = extraQuality.flatMap(f => [
    verdict({ findingTitle: f.title, qualityScore: 1 }),
    verdict({ findingTitle: f.title, qualityScore: 1 })
  ])
  const all = [...findings, ...extraPolicy, ...extraQuality]
  const vs = [...verdicts, ...qualityVerdicts]
  const result = resolveReview(all, vs, { changedPaths: CHANGED, excludePaths: ['dist'] })
  assert.ok(result.droppedByPolicy.length >= 21 && result.droppedByQuality.length >= 21)
  return mutate(input({ result, verdicts: vs, limits }))
}

const withoutPolicy = i => ({ ...i, result: { ...i.result, droppedByPolicy: [] } })
const withoutBoth = i => ({ ...withoutPolicy(i), result: { ...withoutPolicy(i).result, droppedByQuality: [] } })

test('under the cap nothing is cut and nothing is omitted', () => {
  const plan = planReviewAdvisorBrief(bulkyInput(BIG))
  assert.deepEqual(plan.omitted, [])
  assert.equal(plan.overrun, 0)
  assert.equal(plan.chars, plan.text.length)
  assert.equal(section(plan.text, 'Omitted'), null)
  assert.equal(assembleReviewAdvisorBrief(bulkyInput(BIG)), plan.text)
})

test('over the cap policy drops are cut first, whole, and named under ## Omitted', () => {
  const noPolicy = planReviewAdvisorBrief(withoutPolicy(bulkyInput(BIG))).chars
  const cap = noPolicy + 600
  const plan = planReviewAdvisorBrief(bulkyInput({ ...LIMITS, maxReviewAdvisorBriefChars: cap }))
  assert.equal(plan.omitted.length, 1)
  assert.match(plan.omitted[0], /polic/i)
  assert.equal(plan.overrun, 0)
  assert.ok(plan.chars <= cap, `${plan.chars} > ${cap}`)
  assert.equal(plan.chars, plan.text.length)

  const omitted = section(plan.text, 'Omitted')
  assert.ok(omitted, 'no ## Omitted section')
  assert.match(omitted, /polic/i)
  assert.ok(!/quality/i.test(omitted), 'quality drops were cut before they had to be')
  assert.ok(!plan.text.includes('POLICY-FILLER') && !plan.text.includes('POLICY-DROP-BODY'))
  assert.ok(plan.text.includes('QUALITY-FILLER'), 'quality drops were cut')
  assert.ok(!plan.text.includes('cap exceeded'))
})

test('still over the cap quality drops are cut second, and the survivors and dismissals stay', () => {
  const noBoth = planReviewAdvisorBrief(withoutBoth(bulkyInput(BIG))).chars
  const cap = noBoth + 600
  const plan = planReviewAdvisorBrief(bulkyInput({ ...LIMITS, maxReviewAdvisorBriefChars: cap }))
  assert.equal(plan.omitted.length, 2)
  assert.match(plan.omitted[0], /polic/i)
  assert.match(plan.omitted[1], /quality/i)
  assert.equal(plan.overrun, 0)
  assert.ok(plan.chars <= cap, `${plan.chars} > ${cap}`)

  const omitted = section(plan.text, 'Omitted')
  assert.ok(omitted && /polic/i.test(omitted) && /quality/i.test(omitted), omitted)
  assert.ok(!plan.text.includes('POLICY-FILLER') && !plan.text.includes('QUALITY-FILLER'))
  for (const kept of ['SURVIVOR-ONE-BODY', 'SURVIVOR-TWO-BODY', 'DISMISSED-ONE-BODY', 'DISMISSED-TWO-BODY', 'REASON-D1-A', 'REASON-D2-B']) {
    assert.ok(plan.text.includes(kept), `${kept} was cut`)
  }
})

test('when survivors, dismissals and instructions alone exceed the cap all are kept and the overrun is spoken', () => {
  const cap = 1000
  const plan = planReviewAdvisorBrief(bulkyInput({ ...LIMITS, maxReviewAdvisorBriefChars: cap }))
  assert.equal(plan.omitted.length, 2)
  assert.ok(plan.overrun > 0)
  assert.equal(plan.overrun, plan.chars - cap)
  assert.equal(plan.chars, plan.text.length)
  for (const kept of ['SURVIVOR-ONE-BODY', 'SURVIVOR-TWO-BODY', 'DISMISSED-ONE-BODY', 'DISMISSED-TWO-BODY', 'REASON-D1-A', 'REASON-D1-D', 'REASON-D2-A']) {
    assert.ok(plan.text.includes(kept), `${kept} was cut`)
  }
  for (const kind of ['dismissal-doubt', 'shared-root-cause', 'uncovered']) assert.ok(plan.text.includes(kind), 'the instructions were cut')
  const omitted = section(plan.text, 'Omitted')
  assert.ok(omitted && omitted.includes(`cap exceeded by ${plan.overrun} chars`), omitted)
})

test('the cap is read from the limits passed in, not a literal', () => {
  const small = planReviewAdvisorBrief(bulkyInput({ ...LIMITS, maxReviewAdvisorBriefChars: 1000 }))
  const big = planReviewAdvisorBrief(bulkyInput(BIG))
  assert.ok(small.chars < big.chars)
})

// --- determinism and the index ---------------------------------------------

test('the same input gives the same bytes; the stamp is an input, not a clock read', () => {
  assert.equal(assembleReviewAdvisorBrief(input()), assembleReviewAdvisorBrief(input()))
  assert.equal(
    assembleReviewAdvisorBrief(JSON.parse(JSON.stringify(input()))),
    assembleReviewAdvisorBrief(input()),
    'nothing outside the input reaches the bytes'
  )
  const later = assembleReviewAdvisorBrief(input({ stamp: '20301231-235959', briefPath: '.claude/metrics/review-advisor-brief-add-the-thing-20301231-235959.md' }))
  assert.ok(later.includes('20301231-235959'))
  assert.ok(!later.includes('20261022-101010'))
})

test('assembleReviewAdvisorBrief does not mutate its input', () => {
  const i = input()
  const before = JSON.stringify(i)
  assembleReviewAdvisorBrief(i)
  indexOf(i)
  assert.equal(JSON.stringify(i), before)
})

test('indexOf returns the change, stamp, survivors, dismissals and changed paths', () => {
  assert.deepEqual(indexOf(input()), {
    change: 'add-the-thing',
    stamp: '20261022-101010',
    survivors: [
      { id: 'S1', file: 'lib/a.mjs', title: 'S-ONE reads the wrong key' },
      { id: 'S2', file: 'lib/c.mjs', title: 'S-TWO reads it twice' }
    ],
    dismissed: [
      { id: 'D1', file: 'lib/b.mjs', title: 'D-ONE off by one' },
      { id: 'D2', file: 'lib/b.mjs', title: 'D-TWO missing null check' }
    ],
    changed: CHANGED
  })
})

test('the index ids are the ids the brief prints, so a flag the advisor writes resolves', () => {
  const i = input()
  const text = assembleReviewAdvisorBrief(i)
  const idx = indexOf(i)
  for (const row of [...idx.survivors, ...idx.dismissed]) {
    assert.ok(introduced(text, row.id) >= 0, `${row.id} is in the index but not in the brief`)
    assert.ok(text.includes(row.title), row.title)
  }
})

// --- purity and the registry -----------------------------------------------

test('neither prompt module imports node: or reads a clock', () => {
  for (const file of ['review-advisor.mjs', 'brief-kit.mjs']) {
    const src = readFileSync(new URL(`../../lib/prompts/${file}`, import.meta.url), 'utf8')
    assert.ok(!/Date\.now\s*\(|new Date\s*\(/.test(src), `lib/prompts/${file} reads a clock`)
    assert.ok(!/from ['"]node:/.test(src), `lib/prompts/${file} does file or process I/O`)
    assert.ok(!/\bprocess\./.test(src), `lib/prompts/${file} reads process state`)
  }
})

test('brief-kit holds the shared helpers and is not an assembler', () => {
  for (const name of ['oneLine', 'quote', 'fitSections']) assert.equal(typeof briefKit[name], 'function', name)
  assert.equal(briefKit.oneLine('a \n  b\t c '), 'a b c')
  const fenced = briefKit.quote('before ```` after')
  assert.ok(fenced.split('\n').some(l => /^`{5,}/.test(l)), fenced)
  assert.ok(NON_ASSEMBLER_MODULES.includes('brief-kit.mjs'))
})

test('the review-advisor assembler is registered in PROMPTS with the module’s own export and its inputs', async () => {
  const entry = Object.values(PROMPTS).find(e => e.module === 'review-advisor.mjs')
  assert.ok(entry, 'no PROMPTS entry names review-advisor.mjs')
  const mod = await import('../../lib/prompts/review-advisor.mjs')
  assert.equal(entry.assemble, mod.assembleReviewAdvisorBrief, 'the registry must hold the module’s own assembler')
  assert.ok(Array.isArray(entry.inputs) && entry.inputs.length > 0, 'the entry registers no input')
  for (const [n, sample] of entry.inputs.entries()) {
    const first = entry.assemble(sample)
    assert.equal(typeof first, 'string')
    assert.ok(first.length > 0)
    assert.equal(entry.assemble(JSON.parse(JSON.stringify(sample))), first, `inputs[${n}] is not a function of its input`)
  }
})

test('the checkpoint advisor stays registered beside it', () => {
  assert.ok(PROMPTS.advisor, 'PROMPTS.advisor was displaced')
  assert.equal(PROMPTS.advisor.module, 'advisor.mjs')
})
