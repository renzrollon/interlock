// The routing resolver (spec: spawn-routing). The table and the depth table are
// published by `lib/limits.mjs`; `lib/routing.mjs` looks them up, applies a row's
// strict override and speaks the two environment overrides. These tests pin the
// lookup, the vocabulary the first requirement names, and the two banners.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { EFFORT, SPAWN_ROUTING, REVIEW_DEPTH } from '../../lib/limits.mjs'
import { ROUTING_ROLES, REVIEW_DEPTHS, resolveRouting, listRouting } from '../../lib/routing.mjs'

const MODELS = ['haiku', 'sonnet', 'opus', null]
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', null]

const ROLES = [
  'explore-investigator',
  'review-dimension',
  'review-skeptic',
  'settle-fixer',
  'settle-conformance'
]

test('the table holds the five roles and the depth table the two depths', () => {
  assert.deepEqual([...ROUTING_ROLES].sort(), [...ROLES].sort())
  assert.deepEqual([...REVIEW_DEPTHS].sort(), ['lean', 'strict'])
})

test('every role resolves to its table row at the default depth', () => {
  for (const role of ROUTING_ROLES) {
    const got = resolveRouting(role, {})
    assert.equal(got.role, role)
    assert.equal(got.depth, REVIEW_DEPTH.default, `${role}: depth`)
    assert.equal(got.model, SPAWN_ROUTING[role].model, `${role}: model`)
    assert.equal(got.effort, SPAWN_ROUTING[role].effort, `${role}: effort`)
    assert.deepEqual(got.banners, [], `${role}: banners`)
    assert.deepEqual(got.overrides, { effortLevel: null, subagentModelForce: null }, `${role}: overrides`)
  }
})

test('review-dimension at strict resolves to the override, and every other role is the same at both depths', () => {
  const override = SPAWN_ROUTING['review-dimension'].strict
  assert.ok(override, 'review-dimension carries a strict override')
  const strict = resolveRouting('review-dimension', {}, { depth: 'strict' })
  assert.equal(strict.depth, 'strict')
  assert.equal(strict.model, override.model)
  assert.equal(strict.effort, override.effort)

  const lean = resolveRouting('review-dimension', {}, { depth: 'lean' })
  assert.equal(lean.model, SPAWN_ROUTING['review-dimension'].model)
  assert.equal(lean.effort, SPAWN_ROUTING['review-dimension'].effort)

  for (const role of ROUTING_ROLES) {
    if (role === 'review-dimension') continue
    const a = resolveRouting(role, {}, { depth: 'lean' })
    const b = resolveRouting(role, {}, { depth: 'strict' })
    assert.equal(b.model, a.model, `${role}: model differs between depths`)
    assert.equal(b.effort, a.effort, `${role}: effort differs between depths`)
  }
})

test('a null field stays null and is never replaced by a default', () => {
  const got = resolveRouting('review-skeptic', {})
  assert.equal(SPAWN_ROUTING['review-skeptic'].model, null)
  assert.strictEqual(got.model, null)
  const strict = resolveRouting('review-dimension', {}, { depth: 'strict' })
  assert.strictEqual(strict.model, null)
  assert.strictEqual(strict.effort, null)
  assert.strictEqual(resolveRouting('settle-conformance', {}).effort, null)
})

test('the review-skeptic and settle-fixer effort is EFFORT.skeptic by identity', () => {
  assert.ok(typeof EFFORT.skeptic === 'string' && EFFORT.skeptic.length > 0)
  assert.strictEqual(SPAWN_ROUTING['review-skeptic'].effort, EFFORT.skeptic)
  assert.strictEqual(SPAWN_ROUTING['settle-fixer'].effort, EFFORT.skeptic)
  assert.strictEqual(resolveRouting('review-skeptic', {}).effort, EFFORT.skeptic)
  assert.strictEqual(resolveRouting('settle-fixer', {}).effort, EFFORT.skeptic)
})

test('every row, override included, is inside the model and effort vocabulary, naming the role and field', () => {
  for (const [role, row] of Object.entries(SPAWN_ROUTING)) {
    const pairs = [[role, row]]
    if (row.strict) pairs.push([`${role} (strict)`, row.strict])
    for (const [label, pair] of pairs) {
      assert.ok(MODELS.includes(pair.model), `${label}: model ${JSON.stringify(pair.model)} is outside the vocabulary`)
      assert.ok(EFFORTS.includes(pair.effort), `${label}: effort ${JSON.stringify(pair.effort)} is outside the vocabulary`)
    }
  }
})

test('CLAUDE_CODE_EFFORT_LEVEL produces its banner and overrides entry', () => {
  const got = resolveRouting('review-skeptic', { CLAUDE_CODE_EFFORT_LEVEL: 'high' })
  assert.equal(got.effort, EFFORT.skeptic, 'the table value is still printed')
  assert.equal(got.overrides.effortLevel, 'high')
  assert.equal(got.overrides.subagentModelForce, null)
  assert.equal(got.banners.length, 1)
  assert.ok(got.banners[0].startsWith('EFFORT ROUTING OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=high'), got.banners[0])
})

test('CLAUDE_CODE_SUBAGENT_MODEL_FORCE produces its banner and overrides entry', () => {
  const got = resolveRouting('review-dimension', { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' })
  assert.equal(got.overrides.subagentModelForce, '1')
  assert.equal(got.overrides.effortLevel, null)
  assert.equal(got.banners.length, 1)
  assert.ok(got.banners[0].startsWith('MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1'), got.banners[0])
})

test('both overrides at once produce both banners, and the environment is left untouched', () => {
  const env = { CLAUDE_CODE_EFFORT_LEVEL: 'max', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }
  const before = { ...env }
  const got = resolveRouting('settle-fixer', env)
  assert.equal(got.banners.length, 2)
  assert.deepEqual(env, before)
})

test('an unset or blank variable produces no banner', () => {
  for (const env of [
    {},
    { CLAUDE_CODE_EFFORT_LEVEL: '', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '' },
    { CLAUDE_CODE_EFFORT_LEVEL: '   ', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '  ' }
  ]) {
    const got = resolveRouting('explore-investigator', env)
    assert.deepEqual(got.banners, [], JSON.stringify(env))
    assert.deepEqual(got.overrides, { effortLevel: null, subagentModelForce: null }, JSON.stringify(env))
  }
})

test('an unknown role throws naming the five roles', () => {
  assert.throws(
    () => resolveRouting('not-a-role', {}),
    err => {
      for (const role of ROLES) assert.ok(err.message.includes(role), `message must name ${role}: ${err.message}`)
      return true
    }
  )
})

test('an unknown depth throws naming lean and strict', () => {
  assert.throws(
    () => resolveRouting('review-dimension', {}, { depth: 'deep' }),
    err => err.message.includes('lean') && err.message.includes('strict')
  )
  assert.throws(
    () => listRouting({}, { depth: 'deep' }),
    err => err.message.includes('lean') && err.message.includes('strict')
  )
})

test('listRouting returns the depth, one entry per role and the depth\'s review row', () => {
  for (const depth of REVIEW_DEPTHS) {
    const got = listRouting({}, { depth })
    assert.equal(got.depth, depth)
    assert.deepEqual(Object.keys(got.roles).sort(), [...ROLES].sort())
    for (const role of ROUTING_ROLES) {
      const one = resolveRouting(role, {}, { depth })
      assert.equal(got.roles[role].model, one.model, `${role}: model at ${depth}`)
      assert.equal(got.roles[role].effort, one.effort, `${role}: effort at ${depth}`)
    }
    assert.deepEqual(got.review.dimensions, [...REVIEW_DEPTH[depth].dimensions])
    assert.equal(got.review.skeptics, REVIEW_DEPTH[depth].skeptics)
    assert.deepEqual(got.banners, [])
  }
  assert.equal(listRouting({}).depth, REVIEW_DEPTH.default)
})
