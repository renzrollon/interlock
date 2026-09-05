// The wave-classification prompt, asserted against its assembled output.
//
// Every other prompt test in this repo used to read `workflows/ship.js` and
// match a sentence against the source bytes. That technique cannot see the
// defect this file exists for: a stray unary `+` in a concatenation chain
// coerces its operand to `NaN`, drops a whole instruction out of the assembled
// string, and leaves the sentence sitting intact in the file. A grep for the
// missing sentence *passes on the broken file*.
//
// So this asserts the string the classifier is actually handed. There is one
// assembler now (`lib/prompts/planner.mjs`) rather than a copy per driver, so
// the cross-host comparison this file used to carry is gone: there is nothing
// left to compare. What remains is the check that matters — that the assembled
// text states the whole ladder, the edge contract and the mode question, and
// states no number the caps module owns.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assemblePlannerPrompt } from '../../lib/prompts/planner.mjs'
import { coercionArtifacts } from '../helpers/ship-harness.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const PROMPT = assemblePlannerPrompt({
  change: 'add-widget',
  classifiedPath: '.claude/ship/classified.json'
})

// The six rules the ladder states: one per tier, plus the routing rule that
// says which model the cheapest tier may use. `clampModel` clamps opus *down*
// and never clamps haiku *up*, so a classifier told only about the expensive
// end of the ladder produces runs that look correctly conservative while being
// under-powered and under-contexted.
const TIER_RULES = [
  [1, /Tier 1[^.]*\btrivial\b/i],
  [2, /Tier 2[^.]*\bsingle-concern\b/i],
  [3, /Tier 3[^.]*\bnew logic\b/i],
  [4, /Tier 4[^.]*\bcross-file\b/i],
  [5, /Tier 5[^.]*\bnovel\b/i],
  ['haiku routing', /\bhaiku\b/]
]

test('the assembled classifier prompt states all six tier rules', () => {
  const missing = TIER_RULES.filter(([, re]) => !re.test(PROMPT)).map(([name]) => name)
  assert.deepEqual(
    missing,
    [],
    `the assembled planner prompt is missing tier rule(s): ${missing.join(', ')}.\n` +
      `The source bytes may still contain them — a concatenation defect drops them from the ` +
      `assembled string. Assembled prompt:\n${PROMPT}`
  )
})

test('the assembled classifier prompt routes only tier 5 to opus and defaults to sonnet', () => {
  assert.match(PROMPT, /only tier 5 may be opus/i)
  assert.match(PROMPT, /When unsure, sonnet\./)
})

test('the assembled classifier prompt carries no coercion artifact', () => {
  const found = coercionArtifacts(PROMPT)
  assert.deepEqual(
    found,
    [],
    `the assembled planner prompt contains ${found.join(', ')} — an operand was coerced ` +
      `rather than concatenated, so whatever it replaced never reaches the classifier`
  )
})

test('a source-text search is not accepted as evidence of prompt correctness', () => {
  // The decisive property, asserted rather than described: the tier sentence is
  // present in the file whether or not it reaches the agent, so only the
  // assembled check is authoritative.
  const source = readFileSync(join(ROOT, 'lib', 'prompts', 'planner.mjs'), 'utf8')
  assert.match(source, /Tier 1 trivial one-file edit/, 'the sentence lives in the source bytes')
  assert.match(
    PROMPT,
    /Tier 1 trivial one-file edit/,
    'the sentence is in the file but not in the assembled prompt — the source search proved nothing'
  )
})

test('the classifier is still told the grouping rules and the paths contract', () => {
  assert.match(PROMPT, /Default group to the numbered tasks\.md section/)
  assert.match(PROMPT, /shared file is NOT a reason for a new group/)
  assert.match(PROMPT, /OMIT the field when you genuinely cannot/)
})

// --- the planner never runs the CLI (design D7) ----------------------------

test('the classifier writes the classification and is told not to run the CLI', () => {
  assert.match(PROMPT, /Write the classification as \{ "tasks": \[\.\.\.\] \} to/)
  assert.match(PROMPT, /\.claude\/ship\/classified\.json/, 'at the path it was handed')
  assert.match(PROMPT, /Do NOT run the interlock CLI yourself/)
})

test('the classifier prompt names no interlock subcommand to run', () => {
  // The Workflow driver's old form asked this same agent to run coverage,
  // waves, plan fingerprint and wave-state create. Those are the CLI's work
  // now; a prompt that still named them would be a second authority for them.
  assert.doesNotMatch(PROMPT, /interlock (tasks coverage|waves|wave-state|plan fingerprint)/)
})

// --- the dependency edge guidance (spec: waves MODIFIED) -------------------
//
// The `waves` spec anchors the edge guidance to the PROMPT TEXT, so this is the
// surface that has to carry it — and it is asserted against the assembled
// string for the reason the top of this file gives: the sentence can sit intact
// in the module while never reaching the classifier.

test('the assembled classifier prompt tells the model to emit dependsOn', () => {
  assert.match(PROMPT, /isTestTask, paths, and dependsOn/, 'dependsOn is in the field list')
  assert.match(
    PROMPT,
    /`dependsOn` is the array of ids of EARLIER tasks whose output this task needs/,
    'and the prompt says what an edge means'
  )
})

test('the assembled classifier prompt prefers an edge over a new group', () => {
  assert.match(
    PROMPT,
    /dependency on a task editing a DIFFERENT file is a reason for a `dependsOn` EDGE, not a reason to increment `group`/,
    'a cross-file dependency must be described as an edge, not as a new section'
  )
  assert.match(
    PROMPT,
    /independent siblings keep sharing a batch|independent of it/,
    'and the prompt must say why: a new group serializes the tasks independent of the dependency'
  )
})

test('the assembled classifier prompt states that a malformed edge fails the plan', () => {
  // The planner rejects a dangling id, a backward edge and a cycle fail-closed.
  // A classifier told to emit edges but not told what makes one well-formed
  // produces plans that halt, which costs a whole classifier pass.
  assert.match(PROMPT, /must name a task in this same classification/)
  assert.match(PROMPT, /must not point at a later numbered section/)
  assert.match(PROMPT, /FAILS the plan rather than being dropped/)
})

// --- the prose mirror (spec: waves MODIFIED, task 1.4) ---------------------
//
// `skills/spec/SKILL.md` tells the AUTHOR how to shape tasks.md; the prompt
// tells the CLASSIFIER how to read it. If the two disagree, the author writes a
// section boundary the classifier was told to express as an edge. Asserted
// together, in one test, so neither can be changed without the other.

test('the spec skill mirrors the prompt: a cross-file dependency is an edge', () => {
  const skill = readFileSync(join(ROOT, 'skills', 'spec', 'SKILL.md'), 'utf8')
  assert.match(
    skill,
    /`dependsOn` edge, not a new section/,
    'the task-shape rules must name the edge as the alternative to a new section'
  )
  assert.match(
    skill,
    /Incrementing the section to order one cross-file dependency serializes every task in the new section that is independent of it/,
    'and must give the same reason the classifier prompt gives'
  )
  assert.match(
    skill,
    /a cross-file dependency is an edge \(`dependsOn`\) — neither is a reason to increment the section number/,
    'the closing rule must cover edges beside path collisions, not just paths'
  )
})

// --- the mode recommendation (spec: waves MODIFIED, solo-mode ADDED) --------
//
// The classifier is asked for a SHAPE judgement and nothing else. The envelope
// that bounds it is a published cap read by the planner (lib/limits.mjs SOLO),
// and a prompt restating its number would be the same cap written twice — the
// drift the caps module exists to end.

test('the assembled classifier prompt asks for recommendedMode and modeReason', () => {
  assert.match(PROMPT, /"recommendedMode" of "solo" or "waves"/, 'the field and its two values')
  assert.match(PROMPT, /"modeReason"/, 'and the one-line reason beside it')
  assert.match(PROMPT, /top-level/, 'both sit beside the task array, not inside a task')
})

test('the assembled classifier prompt describes solo as one agent in order', () => {
  assert.match(
    PROMPT,
    /one agent implements this whole change by itself, task by task in the planned order/,
    'solo has to be described, or the recommendation is a guess about a word'
  )
  assert.match(PROMPT, /no parallel waves and no isolation between tasks/)
})

test('the assembled classifier prompt names the envelope without stating its number', async () => {
  const { SOLO } = await import('../../lib/limits.mjs')
  assert.match(
    PROMPT,
    /the planner enforces the published envelope/,
    'the classifier must be told the bound exists and is enforced elsewhere'
  )
  assert.doesNotMatch(
    PROMPT,
    new RegExp(`\\b${SOLO.maxTasks}\\b[^.]*task`, 'i'),
    `the prompt states ${SOLO.maxTasks} as a task bound — the envelope lives in lib/limits.mjs ` +
      `and is published by \`interlock limits\`; a number copied into prompt text is a number ` +
      `that drifts`
  )
})
