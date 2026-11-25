// The bundled artifact rubric and lenses, pinned by token (change
// `brief-and-record-the-artifact-gate`, spec `spec/artifact-review-brief`:
// the base rubric and the agentic-harness lens requirements). Tokens, not
// sentences, so a reword that keeps the question keeps the pin.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIR = join(ROOT, 'skills', 'review-artifacts')
const read = rel => readFileSync(join(DIR, rel), 'utf8')
const lower = rel => read(rel).toLowerCase()
const LENSES = ['agentic-harness', 'web-ui']

function assertTokens(text, tokens, where) {
  for (const token of tokens) assert.ok(text.includes(token), `${where} must carry ${token}`)
}

test('rubric.md carries the scenario-truth, observable, traceability, omission, one-meaning and proportionality questions', () => {
  const text = lower('rubric.md')
  assertTokens(text, [
    'each given produce', 'its then', 'observable', 'traceability', 'omissions', 'exactly, and only',
    'one term, one meaning', 'proportionate', 'non-goals', 'alternatives', 'rollback',
    'each task states its own verification', 'staircase', 'modified requirement keeps every living scenario title'
  ], 'skills/review-artifacts/rubric.md')
})

test('rubric.md carries the invariant check with interlock-graph consumers and the decision-ledger rule', () => {
  const text = read('rubric.md')
  assertTokens(text, ['interlock-graph consumers', 'INVARIANT-SWEEP.md', '`needs_human`', '`agent_resolved`', '`design.md`'], 'skills/review-artifacts/rubric.md')
})

test('rubric.md ends with "What a blocker is", which decides every finding including a lens\'s', () => {
  const text = read('rubric.md')
  const headings = [...text.matchAll(/^## (.+)$/gm)].map(m => m[1])
  assert.equal(headings.at(-1), 'What a blocker is', 'skills/review-artifacts/rubric.md must end on the blocker definition')
  const last = text.slice(text.lastIndexOf('## What a blocker is'))
  assertTokens(last, ['every finding', "a lens's findings included", 'fail its own verification', 'bounded pin rule', 'never a blocker'], 'the blocker section')
})

test('rubric.md never asks for a test task per feature task', () => {
  for (const rel of ['rubric.md', ...LENSES.map(n => `lenses/${n}.md`)]) {
    assert.doesNotMatch(lower(rel), /pairs? a test task|test task with every feature/, `skills/review-artifacts/${rel} asks for a paired test task`)
  }
})

test('accessibility and loading appear in the web-ui lens and in neither base file', () => {
  const ui = lower('lenses/web-ui.md')
  assertTokens(ui, ['accessibility', 'loading', 'keyboard', 'focus order', 'responsive', 'permission denied'], 'skills/review-artifacts/lenses/web-ui.md')
  for (const rel of ['rubric.md', 're-gate.md', 'lenses/agentic-harness.md']) {
    assert.doesNotMatch(lower(rel), /accessib|loading/, `skills/review-artifacts/${rel} holds a UI line`)
  }
})

test('re-gate.md holds the three --since steps', () => {
  assertTokens(read('re-gate.md'), ['--since', 'Re-check each earlier blocker', 'changed hunk', 'untracked', 'Emit and gate'], 'skills/review-artifacts/re-gate.md')
})

const TOPICS = [
  'decision boundary', 'shared state', 'provenance', 'absent is not zero', 're-run, resume, stop', 'tool and permission bounds',
  'prose is an api', 'version and host skew', 'offline tests', 'context and cost', 'checkpoint and halt', 'untrusted input'
]

test('the agentic-harness lens carries the perspective, three walks, the table and questions 1 to 12 with their topics', () => {
  const text = read('lenses/agentic-harness.md')
  const where = 'skills/review-artifacts/lenses/agentic-harness.md'
  assertTokens(text, ['**Perspective.**', 'clean', 'interrupted at the worst point', 'parallel sibling', 'produce the table', 'One row per step'], where)
  assert.ok(text.indexOf('produce the table') < text.indexOf('\n1. '), 'the table comes before the questions')
  TOPICS.forEach((topic, i) => {
    const line = text.split('\n').find(l => l.startsWith(`${i + 1}. `))
    assert.ok(line, `${where} has no question ${i + 1}`)
    assert.ok(line.toLowerCase().includes(topic), `${where} question ${i + 1} must name ${topic}`)
  })
  assert.ok(!text.split('\n').some(l => l.startsWith('13. ')), 'exactly twelve questions')
})

test('question 5 asks for "the same result", not a word the risk classifier reads as critical', () => {
  const line = read('lenses/agentic-harness.md').split('\n').find(l => l.startsWith('5. '))
  assert.ok(line.includes('the same result'))
  assert.doesNotMatch(line, /exactly once|idempoten/i)
})

test('each lens defers to the blocker definition, opens with no role line and states no cap value', () => {
  for (const name of LENSES) {
    const rel = `lenses/${name}.md`
    const text = read(rel)
    const where = `skills/review-artifacts/${rel}`
    assertTokens(text, ['Severity follows the blocker definition in `rubric.md`'], where)
    assert.doesNotMatch(text.trimStart(), /^You are\b/, `${where} opens with a role line`)
    assert.doesNotMatch(text, /\bmaxArtifact\w*\W*\d/, `${where} states a cap's value`)
    assert.doesNotMatch(text, /\b(?:cap|capped at|at most)\s+(?:of\s+)?\d+\b/i, `${where} states a cap's value`)
  }
  assert.doesNotMatch(read('rubric.md'), /\bmaxArtifact\w*\W*\d/, 'rubric.md states a cap value')
})
