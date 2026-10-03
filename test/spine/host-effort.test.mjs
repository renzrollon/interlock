// The one effort resolver every adapter shares (design D18, D19, D21, D29, D32).
//
// The adapters supply the facts and the runner prints them; the verdict and its
// reason are decided here, once, so no driver words a reason of its own. Every
// reason is true of the host that gives it — a host with no effort channel, a
// host whose channel is not routed, and a CLI that lacks the flag each say a
// different thing — and an unknown capability fails open, as not applied, with
// a reason.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EFFORT_LEVEL_ENV,
  EFFORT_REASONS,
  effortLevelOverride,
  findEffortOption,
  pickEffortValue,
  resolveEffort
} from '../../lib/host/effort.mjs'

// The reasons table in design.md, verbatim. The docs carry each of these too.
const NO_CONTROL = 'host has no effort control'
const NOT_ROUTED = 'effort is not routed on this host'
const NO_FLAG = 'this claude CLI has no --effort flag'
const PROBE_FAILED = 'could not establish whether this claude CLI accepts --effort'
const NO_OPTION = 'no effort option advertised'
const NOT_ADVERTISED = 'level not among advertised values'
const REJECTED = 'agent rejected the effort option'

/** An advertised effort select, flat, with the given values. */
function effortOption(values, extra = {}) {
  return {
    id: 'effort',
    category: 'thought_level',
    type: 'select',
    currentValue: 'default',
    options: values.map(value => ({ value, name: value })),
    ...extra
  }
}

const MODEL_OPTION = {
  id: 'model',
  category: 'model',
  type: 'select',
  currentValue: 'sonnet',
  options: [{ value: 'sonnet', name: 'Sonnet' }, { value: 'high', name: 'High' }]
}

// --- the reasons ------------------------------------------------------------

test('the module exports every reason in the design, and nothing else as a reason', () => {
  assert.equal(typeof EFFORT_REASONS, 'object')
  assert.deepEqual(
    Object.values(EFFORT_REASONS).sort(),
    [NO_CONTROL, NOT_ROUTED, NO_FLAG, PROBE_FAILED, NO_OPTION, NOT_ADVERTISED, REJECTED].sort()
  )
})

test('the Codex reason is not the Qwen reason', () => {
  // Codex has a real knob the adapter does not route; saying it has no effort
  // control would be false of it.
  const codex = resolveEffort('low', 'unsupported', NOT_ROUTED)
  const qwen = resolveEffort('low', 'unsupported', NO_CONTROL)
  assert.equal(codex.reason, NOT_ROUTED)
  assert.equal(qwen.reason, NO_CONTROL)
  assert.notEqual(codex.reason, qwen.reason)
})

// --- resolveEffort ----------------------------------------------------------

test('a flag host applies the level by flag, unchanged', () => {
  const r = resolveEffort('low', 'flag')
  assert.equal(r.applied, true)
  assert.equal(r.via, 'flag')
  assert.equal(r.value, 'low')
  assert.equal(r.requested, 'low')
  assert.equal(r.reason, null)
})

test('the level is passed through unvalidated: the table is the authority', () => {
  const r = resolveEffort('some-future-level', 'flag')
  assert.equal(r.applied, true)
  assert.equal(r.value, 'some-future-level')
})

test('an unsupported host applies nothing, with the reason it was given', () => {
  const r = resolveEffort('low', 'unsupported', NO_FLAG)
  assert.equal(r.applied, false)
  assert.equal(r.value, null)
  assert.equal(r.requested, 'low', 'the level is reported as requested, never as run')
  assert.equal(r.reason, NO_FLAG)
})

test('an unsupported host given no reason says it has no effort control', () => {
  const r = resolveEffort('low', 'unsupported')
  assert.equal(r.applied, false)
  assert.equal(r.reason, NO_CONTROL)
})

test('an unknown or missing capability resolves as unsupported does: not applied, and spoken', () => {
  for (const capability of ['bogus', undefined, null, '', 42]) {
    const bare = resolveEffort('low', capability)
    assert.equal(bare.applied, false, `${String(capability)} must not apply`)
    assert.equal(bare.value, null)
    assert.equal(bare.reason, NO_CONTROL, `${String(capability)} must say why`)

    const given = resolveEffort('low', capability, PROBE_FAILED)
    assert.equal(given.applied, false)
    assert.equal(given.reason, PROBE_FAILED)
  }
})

test('an empty level applies nothing', () => {
  for (const level of ['', undefined, null]) {
    const r = resolveEffort(level, 'flag')
    assert.ok(!r || r.applied !== true, `${String(level)} must apply nothing`)
    assert.equal(r ? r.value ?? null : null, null, `${String(level)} must carry no value`)
  }
})

// --- findEffortOption -------------------------------------------------------

test('the effort option is found by its conventional id', () => {
  const option = effortOption(['low', 'high'])
  assert.equal(findEffortOption([MODEL_OPTION, option]), option)
})

test('the effort option is found by the thought_level category under another id', () => {
  const option = effortOption(['low', 'high'], { id: 'reasoning_effort' })
  assert.equal(findEffortOption([MODEL_OPTION, option]), option)
})

test('a model option is never returned as the effort option', () => {
  assert.equal(findEffortOption([MODEL_OPTION]), null)
  assert.equal(findEffortOption([{ id: 'mode', category: 'mode', type: 'select', options: [] }]), null)
})

test('a non-array input returns null', () => {
  for (const input of [undefined, null, {}, 'effort', 7, { id: 'effort' }]) {
    assert.equal(findEffortOption(input), null, `${JSON.stringify(input)} must find nothing`)
  }
})

// --- pickEffortValue --------------------------------------------------------

test('an exactly advertised level is selected', () => {
  const r = pickEffortValue('low', effortOption(['default', 'low', 'medium', 'high', 'xhigh']))
  assert.equal(r.value, 'low')
  assert.equal(r.reason, null)
})

test('a level is never matched as a substring of another level', () => {
  // `high` is inside `xhigh`, and an agent rejects a wrong value outright.
  const r = pickEffortValue('high', effortOption(['xhigh']))
  assert.equal(r.value, null)
  assert.equal(r.reason, NOT_ADVERTISED)
})

test('a display name that contains the level does not match', () => {
  const option = {
    id: 'effort',
    category: 'thought_level',
    type: 'select',
    options: [{ value: 'deep', name: 'high effort' }]
  }
  const r = pickEffortValue('high', option)
  assert.equal(r.value, null)
  assert.equal(r.reason, NOT_ADVERTISED)
})

test('only a flat list is read: grouped values are not among the advertised values', () => {
  const option = {
    id: 'effort',
    category: 'thought_level',
    type: 'select',
    options: [{ group: 'levels', name: 'Levels', options: [{ value: 'low', name: 'low' }] }]
  }
  const r = pickEffortValue('low', option)
  assert.equal(r.value, null)
  assert.equal(r.reason, NOT_ADVERTISED)
})

test('no option advertised says so', () => {
  for (const option of [null, undefined]) {
    const r = pickEffortValue('low', option)
    assert.equal(r.value, null)
    assert.equal(r.reason, NO_OPTION)
  }
})

// --- the environment override -----------------------------------------------

test('the override variable is the one the Claude CLI reads', () => {
  assert.equal(EFFORT_LEVEL_ENV, 'CLAUDE_CODE_EFFORT_LEVEL')
})

test('the override helper returns the trimmed value, and an empty string when unset or blank', () => {
  assert.equal(effortLevelOverride({ CLAUDE_CODE_EFFORT_LEVEL: '  medium \n' }), 'medium')
  assert.equal(effortLevelOverride({ CLAUDE_CODE_EFFORT_LEVEL: 'high' }), 'high')
  assert.equal(effortLevelOverride({}), '')
  assert.equal(effortLevelOverride({ CLAUDE_CODE_EFFORT_LEVEL: '   ' }), '')
  assert.equal(effortLevelOverride({ CLAUDE_CODE_EFFORT_LEVEL: '' }), '')
  assert.equal(effortLevelOverride(undefined), '')
})
