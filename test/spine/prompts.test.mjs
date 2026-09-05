// The briefing assemblers, checked as a set.
//
// `test/spine/implementer-prompt.test.mjs` pins one assembler byte for byte
// against fixtures, and `test/spine/prompt-integrity.test.mjs` enumerates the
// registry so no assembler escapes coverage. This file covers the properties
// that sit between the two: that an assembler is a pure function of its input,
// that the verify briefing names what it plans and nothing it does not, that
// the stage line is rendered from `lib/ship-stage.mjs` rather than restated, and
// that the schemas table exports every name the run program refers to.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MARKER_FIELDS, STAGES, stagePath } from '../../lib/ship-stage.mjs'
import { PROMPTS, SCHEMAS } from '../../lib/prompts/index.mjs'
import { assembleVerifyPrompt } from '../../lib/prompts/verify.mjs'
import { assembleReplanPrompt } from '../../lib/prompts/replan.mjs'
import { assembleCommitPrompt } from '../../lib/prompts/commit.mjs'
import { assembleReviewPrompt } from '../../lib/prompts/review.mjs'
import { assembleRemediatePrompt, assembleVerdictPrompt } from '../../lib/prompts/remediate.mjs'
import { assembleHandoffPrompt } from '../../lib/prompts/handoff.mjs'
import { selectDimensions, ALWAYS_ON_DIMENSIONS } from '../../lib/prompts/dimensions.mjs'
import { publishStageLine } from '../../lib/prompts/stage.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// --- determinism ------------------------------------------------------------
//
// A briefing is written to a file and hashed; the host reports the hash back and
// a mismatch fails the task closed (design D2). An assembler that folded a
// timestamp or a random id into its text would make every acknowledgement a
// coin flip, so purity is not a style preference here — it is what makes the
// hash mean anything.

test('every assembler returns the same bytes for the same input, called repeatedly', () => {
  for (const [name, entry] of Object.entries(PROMPTS)) {
    for (const [i, input] of entry.inputs.entries()) {
      const first = entry.assemble(input)
      for (let n = 0; n < 3; n++) {
        assert.equal(entry.assemble(input), first, `${name}[${i}] is not deterministic`)
      }
    }
  }
})

test('an assembler does not mutate the input it was handed', () => {
  for (const [name, entry] of Object.entries(PROMPTS)) {
    for (const [i, input] of entry.inputs.entries()) {
      const before = JSON.stringify(input)
      entry.assemble(input)
      assert.equal(JSON.stringify(input), before, `${name}[${i}] mutated its input`)
    }
  }
})

// --- the verify briefing ----------------------------------------------------

const STEPS = [
  { kind: 'typecheck', command: 'npm run typecheck' },
  { kind: 'unit', command: 'npm test' }
]

test('the verify briefing names every planned step and its command', () => {
  const prompt = assembleVerifyPrompt({
    change: 'add-widget',
    context: 'final',
    steps: STEPS,
    runId: 'run-7',
    statePath: '.claude/ship/state.json'
  })
  for (const step of STEPS) {
    assert.ok(prompt.includes(step.kind), `the briefing omits the ${step.kind} step`)
    assert.ok(prompt.includes(step.command), `the briefing omits the ${step.kind} command`)
  }
  assert.match(prompt, /Run ONLY these steps/, 'and forbids inventing others')
})

test('the verify briefing names the spill command with the run id it was given', () => {
  const prompt = assembleVerifyPrompt({
    change: 'add-widget',
    context: 'final',
    steps: STEPS,
    runId: 'run-7',
    statePath: '.claude/ship/state.json'
  })
  assert.match(prompt, /interlock verify spill --run-id run-7 --kind <kind> --input <raw-output-file>/)
})

test('a verify briefing with no run id points at the state file rather than inventing one', () => {
  const prompt = assembleVerifyPrompt({
    change: 'add-widget',
    context: 'inter-wave',
    steps: STEPS,
    runId: null,
    statePath: '.claude/ship/state.json'
  })
  assert.match(prompt, /--run-id <the "runId" in \.claude\/ship\/state\.json>/)
  assert.doesNotMatch(prompt, /--run-id null/, 'a null run id must never reach the spill command')
})

test('the verify briefing never asks for a suite log in a result field', () => {
  for (const context of ['inter-wave', 'final']) {
    const prompt = assembleVerifyPrompt({
      change: 'add-widget',
      context,
      steps: STEPS,
      runId: 'run-7',
      statePath: null
    })
    assert.match(prompt, /Never paste a suite log into a result field/)
    assert.match(prompt, /report that step's locator and preview instead of the text/)
    // The threshold is cited, never restated: `interlock limits` publishes it.
    assert.match(prompt, /spill threshold \(`interlock limits`\)/)
    assert.doesNotMatch(prompt, /\b8192\b/, 'the spill threshold is a published cap, not prompt text')
  }
})

test('the verify briefing leaves the verdict to the CLI', () => {
  const prompt = assembleVerifyPrompt({
    change: 'add-widget',
    context: 'final',
    steps: STEPS,
    runId: 'run-7',
    statePath: null
  })
  assert.match(prompt, /that verdict is not yours to render/)
  assert.doesNotMatch(
    prompt,
    /interlock verify (judge|plan|cluster|repair)/,
    'the agent runs the planned steps; the CLI plans and judges'
  )
})

test('the verify briefing never weakens a test as a way to go green', () => {
  const prompt = assembleVerifyPrompt({
    change: 'add-widget',
    context: 'final',
    steps: STEPS,
    runId: 'run-7',
    statePath: null
  })
  assert.match(prompt, /Never weaken a test, loosen an assertion or narrow the suite/)
})

// --- the stage line (design D8) ---------------------------------------------

test('the stage line renders the marker path from lib/ship-stage.mjs', () => {
  const line = publishStageLine('implement', 'add-widget', 1)
  assert.ok(
    line.includes(stagePath('add-widget')),
    `the stage line must name ${stagePath('add-widget')} — the path lib/ship-stage.mjs derives`
  )
})

test('the stage line renders every field the marker carries, in order', () => {
  const line = publishStageLine('commit', 'add-widget', 4)
  const json = /\{"[^\n]*\}/.exec(line)
  assert.ok(json, 'the stage line must contain the one-line JSON the guard reads')
  const keys = [...json[0].matchAll(/"(\w+)":/g)].map(m => m[1])
  assert.deepEqual(
    keys,
    [...MARKER_FIELDS],
    'the rendered marker must carry exactly the fields lib/ship-stage.mjs declares, in its order'
  )
  assert.match(json[0], /"stage":"commit"/)
  assert.match(json[0], /"change":"add-widget"/)
  assert.match(json[0], /"index":4/)
  assert.match(json[0], /"pid":<PID>/, 'the pid is the agent\'s own process, substituted by it')
})

test('the stage line refuses a stage the guards do not recognise', () => {
  // A marker holding an unknown stage reads back as `unknown` and the guards
  // fail open — so a typo would silently disarm the guard for that window.
  // Refusing at assembly is the one place it can still be caught.
  assert.throws(() => publishStageLine('reviewing', 'add-widget', 1), /unknown ship stage/)
  for (const stage of STAGES) {
    assert.equal(typeof publishStageLine(stage, 'add-widget', 1), 'string')
  }
})

test('the commit briefing publishes the commit stage, which is what unblocks the commit', () => {
  const prompt = assembleCommitPrompt({ change: 'add-widget', stageIndex: 3 })
  assert.match(prompt, /"stage":"commit"/)
  assert.match(prompt, /ONE feature-level commit/)
  assert.match(prompt, /never `git add -A`, never amend, never push/)
})

test('the lean commit briefing carries no autonomy-ladder line', () => {
  // The ladder record belongs to the strict tail, which this program does not
  // emit. A lean run that recorded it would be writing a ladder entry for a run
  // that never reviewed anything.
  const prompt = assembleCommitPrompt({ change: 'add-widget', stageIndex: 1 })
  assert.doesNotMatch(prompt, /autonomy|L2|L3|ladder/i)
})

test('the replan briefing bounds the revision to groups that have not executed', () => {
  const prompt = assembleReplanPrompt({ change: 'add-widget', replanPath: '.claude/ship/replan.json' })
  assert.match(prompt, /Revise ONLY groups that have not executed yet/)
  assert.match(prompt, /\.claude\/ship\/replan\.json/)
  assert.match(prompt, /do not run interlock/, 'the CLI applies the revision, not the agent')
})

// --- the strict tail briefings (review, remediation, handoff) --------------
//
// These moved off `workflows/ship.js` verbatim in behaviour (design D3-D5):
// criteria arrive inlined rather than fetched, the CLI's own decisions
// (dimension selection, the manual-test-plan and conformance calls) arrive
// inlined rather than re-derived by the agent, and the agent never shells
// out to the CLI subcommands that used to adjudicate its own output.

const REVIEW_DIMENSIONS = [
  { name: 'language', rubric: 'Check idiomatic usage, type safety and error handling.' },
  { name: 'devops', rubric: null }
]

test('the review briefing inlines each dimension\'s criteria under its own heading', () => {
  const prompt = assembleReviewPrompt({
    change: 'add-widget',
    dimensions: REVIEW_DIMENSIONS,
    policyProse: '',
    findingsPath: '.claude/ship/add-widget/review/findings.json',
    verdictsPath: '.claude/ship/add-widget/review/verdicts.json',
    stageLine: ''
  })
  assert.match(prompt, /## language\nCheck idiomatic usage, type safety and error handling\./)
})

test('a null rubric renders the works-from-the-name-alone sentence, never an empty heading', () => {
  const prompt = assembleReviewPrompt({
    change: 'add-widget',
    dimensions: REVIEW_DIMENSIONS,
    policyProse: '',
    findingsPath: '.claude/ship/add-widget/review/findings.json',
    verdictsPath: '.claude/ship/add-widget/review/verdicts.json',
    stageLine: ''
  })
  assert.match(prompt, /## devops\nNo criteria could be read for "devops" — this reviewer works from the dimension name alone\./)
})

test('the policy prose is prepended before every dimension\'s criteria', () => {
  const prompt = assembleReviewPrompt({
    change: 'add-widget',
    dimensions: REVIEW_DIMENSIONS,
    policyProse: 'Cite evidence for every blocker.',
    findingsPath: '.claude/ship/add-widget/review/findings.json',
    verdictsPath: '.claude/ship/add-widget/review/verdicts.json',
    stageLine: ''
  })
  const policyAt = prompt.indexOf('Cite evidence for every blocker.')
  const firstDimensionAt = prompt.indexOf('## language')
  assert.ok(policyAt !== -1, 'the policy prose must appear in the briefing')
  assert.ok(policyAt < firstDimensionAt, 'the policy block must sit before the first dimension\'s criteria')
})

test('no tail briefing shells out to the CLI subcommand that used to adjudicate it', () => {
  const reviewPrompt = assembleReviewPrompt({
    change: 'add-widget',
    dimensions: REVIEW_DIMENSIONS,
    policyProse: 'policy prose',
    findingsPath: '.claude/ship/add-widget/review/findings.json',
    verdictsPath: '.claude/ship/add-widget/review/verdicts.json',
    stageLine: ''
  })
  const remediatePrompt = assembleRemediatePrompt({
    change: 'add-widget',
    round: 1,
    plan: {
      fix: { byFile: [{ file: 'lib/db.mjs', findings: [] }], unscoped: [] },
      reReviewDimensions: ['language']
    },
    dimensions: [{ name: 'language', rubric: 'criteria' }],
    policyProse: '',
    stageLine: ''
  })
  const verdictPrompt = assembleVerdictPrompt({ change: 'add-widget', round: 2 })
  const handoffPrompt = assembleHandoffPrompt({
    change: 'add-widget',
    needsManualTestPlan: true,
    conformance: [{ id: 'S1', artifact: 'openspec/specs/x/spec.md', line: 1, title: 'does the thing' }],
    learnings: true
  })
  for (const prompt of [reviewPrompt, remediatePrompt, verdictPrompt, handoffPrompt]) {
    assert.doesNotMatch(
      prompt,
      /interlock (review|remediate|surface|conformance)\b/,
      'a tail briefing must never ask the agent to run the subcommand that used to adjudicate it'
    )
  }
})

test('the verdict round fixes nothing and only reports the surviving count', () => {
  const prompt = assembleVerdictPrompt({ change: 'add-widget', round: 4 })
  assert.match(prompt, /fixes nothing/)
  assert.doesNotMatch(prompt, /Fan out|byFile|fixer/i, 'the verdict round runs no fixer')
})

test('the handoff omits the manual test plan when it is not needed', () => {
  const prompt = assembleHandoffPrompt({
    change: 'add-widget',
    needsManualTestPlan: false,
    testPlanReason: 'a backend-only change touches no UI surface',
    conformance: null,
    learnings: false
  })
  assert.match(prompt, /Skip the manual test plan/)
  assert.match(prompt, /a backend-only change touches no UI surface/)
  assert.doesNotMatch(prompt, /manual-test-plan\.md covering every touched file/)
})

// --- dimension selection (design D4) ----------------------------------------

test('selectDimensions always returns the four always-on dimensions', () => {
  for (const paths of [[], ['docs/04-when-it-stops.md'], ['lib/anything.mjs']]) {
    const { dimensions } = selectDimensions(paths)
    for (const name of ALWAYS_ON_DIMENSIONS) {
      assert.ok(dimensions.includes(name), `${name} is missing for ${JSON.stringify(paths)}`)
    }
  }
})

test('a CI workflow path adds devops, with a reason recorded', () => {
  const { dimensions, reasons } = selectDimensions(['.github/workflows/ci.yml'])
  assert.ok(dimensions.includes('devops'))
  assert.ok(reasons.devops, 'an added dimension must carry a reason')
  assert.ok(!dimensions.includes('security'))
})

test('an auth path adds security, with a reason recorded', () => {
  const { dimensions, reasons } = selectDimensions(['src/auth/login.ts'])
  assert.ok(dimensions.includes('security'))
  assert.ok(reasons.security, 'an added dimension must carry a reason')
  assert.ok(!dimensions.includes('devops'))
})

test('a docs-only path adds neither devops nor security', () => {
  const { dimensions, reasons } = selectDimensions(['docs/04-when-it-stops.md', 'README.md'])
  assert.deepEqual(dimensions, [...ALWAYS_ON_DIMENSIONS])
  assert.deepEqual(reasons, {})
})

// --- the schemas table ------------------------------------------------------

test('the schemas table exports every name the run program refers to', () => {
  const expected = [
    'SINGLE_TASK_SCHEMA',
    'LANE_SCHEMA',
    'PLANNER_SCHEMA',
    'VERIFY_RESULT_SCHEMA',
    'REPLAN_SCHEMA',
    'COMMIT_SCHEMA',
    'REVIEW_RESULT_SCHEMA',
    'REMEDIATE_RESULT_SCHEMA',
    'VERDICT_RESULT_SCHEMA',
    'HANDOFF_RESULT_SCHEMA'
  ]
  assert.deepEqual(Object.keys(SCHEMAS).sort(), [...expected].sort())
  for (const name of expected) {
    const schema = SCHEMAS[name]
    assert.equal(schema.type, 'object', `${name} must describe an object result`)
    assert.ok(Array.isArray(schema.required) && schema.required.length, `${name} requires nothing`)
  }
})

test('every schema the run program names is one the schemas table exports', () => {
  // The other direction: a step that declared a schema name nothing exports
  // would hand a host `undefined` and silently drop schema enforcement.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  // What it IMPORTS from the schemas table, not every SCREAMING_CASE token: the
  // module also declares its own `RUN_SCHEMA` and `STEP_SCHEMA`, which name the
  // manifest and the step record rather than an agent's result.
  const imported = /import \{([^}]*)\} from '\.\/prompts\/schemas\.mjs'/.exec(run)
  assert.ok(imported, 'lib/run.mjs must import its result schemas from the schemas table')
  for (const name of imported[1].split(',').map(s => s.trim()).filter(Boolean)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(SCHEMAS, name),
      `lib/run.mjs names ${name}, which lib/prompts/schemas.mjs does not export`
    )
  }
})
