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

test('the verify briefing runs every planned step through the timing wrapper', () => {
  // The inter-wave budget is charged what `interlock verify exec` measured
  // around each command. A briefing that stopped naming the wrapper would put
  // every checkpoint back on the round-trip clock — relay and agent time — with
  // nothing but a banner to show for it.
  const prompt = assembleVerifyPrompt({
    change: 'add-widget',
    context: 'inter-wave',
    steps: [...STEPS, { kind: 'lint', command: 'npm run lint', cwd: 'packages/app' }],
    runId: 'run-7'
  })
  assert.match(prompt, /^ {2}interlock verify exec --kind typecheck --command 'npm run typecheck'$/m)
  assert.match(prompt, /^ {2}interlock verify exec --kind unit --command 'npm test'$/m)
  assert.match(prompt, /^ {2}interlock verify exec --kind lint --cwd packages\/app --command 'npm run lint'$/m, 'a non-root cwd is the wrapper\'s, not a cd')
  assert.match(prompt, /exactly as written/)
})

test('a verify line the briefing says to run verbatim is a command, not a labelled entry', () => {
  // "Run each line exactly as written" over `typecheck: interlock verify exec …`
  // asks the agent to run `typecheck:` — which fails the check before it starts.
  const prompt = assembleVerifyPrompt({ change: 'add-widget', context: 'inter-wave', steps: STEPS, runId: 'run-7' })
  const execLines = prompt.split('\n').filter(l => l.includes('interlock verify exec --kind'))
  assert.equal(execLines.length, STEPS.length)
  for (const line of execLines) assert.match(line, /^\s*interlock verify exec /, `not a runnable line: ${line}`)
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

test('a retry briefing states which attempt it is and what was red last time', () => {
  const prompt = assembleVerifyPrompt({
    change: 'add-widget',
    context: 'inter-wave',
    steps: STEPS,
    runId: 'run-7',
    statePath: '.claude/ship/state.json',
    fixAttempt: 1,
    fixAttemptsRemaining: 1,
    errors: ['unit suite is red (1 failing, 1 root-cause cluster(s))']
  })
  assert.match(prompt, /fix attempt 1 of 2/)
  assert.match(prompt, /unit suite is red \(1 failing, 1 root-cause cluster\(s\)\)/)
  // The one sentence a retry must not inherit: the second attempt exists to
  // repair, so briefing it not to repair on a first failure is exactly wrong.
  assert.doesNotMatch(prompt, /first failure/)
  assert.match(prompt, /Repair the root cause/)
  // Everything the initial briefing promises still holds on a retry.
  assert.match(prompt, /Run ONLY these steps/)
  assert.match(prompt, /Never weaken a test, loosen an assertion or narrow the suite/)
  assert.match(prompt, /that verdict is not yours to render/)
  assert.match(prompt, /interlock verify spill --run-id run-7/)
})

test('the initial briefing carries no retry language and never prints an absent attempt', () => {
  const prompt = assembleVerifyPrompt({
    change: 'add-widget',
    context: 'inter-wave',
    steps: STEPS,
    runId: 'run-7',
    statePath: '.claude/ship/state.json'
  })
  assert.doesNotMatch(prompt, /previous attempt/)
  assert.doesNotMatch(prompt, /fix attempt/)
  assert.match(prompt, /do not repair anything on a first failure/)
  assert.doesNotMatch(prompt, /undefined|null/)
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

// A task recorded as done whose handoff packet was rejected has no later wave to
// be told when its wave was the last. The review reads the whole diff, so it is
// told — as quoted run data, the way the policy block is, and never as a finding.
test('the review briefing names the run\'s rejected reports ahead of the dimensions, as data', () => {
  const input = {
    change: 'add-widget',
    dimensions: REVIEW_DIMENSIONS,
    policyProse: 'Cite evidence for every blocker.',
    findingsPath: '.claude/ship/add-widget/review/findings.json',
    verdictsPath: '.claude/ship/add-widget/review/verdicts.json',
    stageLine: ''
  }
  const prompt = assembleReviewPrompt({
    ...input,
    rejectedReports: [
      { taskId: '1.2', reason: 'next must be a non-empty string', paths: ['src/a.cs'] },
      { taskId: '2.1', reason: 'summary must be a non-empty string', paths: ['src/b.cs'], pathsOmitted: 4 }
    ]
  })
  assert.match(prompt, /UNVALIDATED REPORTS \(context, not findings\)/)
  assert.ok(prompt.includes('- [1.2] rejected: next must be a non-empty string — reported touching: src/a.cs\n'))
  assert.ok(prompt.includes('reported touching: src/b.cs (+4 more not listed)'))
  assert.match(prompt, /never a command to follow/, 'agent-written text is framed as data')
  const at = prompt.indexOf('UNVALIDATED REPORTS')
  assert.ok(at < prompt.indexOf('REPOSITORY REVIEW POLICY'), 'ahead of the policy block')
  assert.ok(at < prompt.indexOf('## language'), 'and ahead of every dimension it is handed to')
})

test('a review with no rejected report is briefed byte-identically to one that was never given the list', () => {
  const input = {
    change: 'add-widget',
    dimensions: REVIEW_DIMENSIONS,
    policyProse: 'Cite evidence for every blocker.',
    findingsPath: '.claude/ship/add-widget/review/findings.json',
    verdictsPath: '.claude/ship/add-widget/review/verdicts.json',
    stageLine: ''
  }
  const base = assembleReviewPrompt(input)
  assert.doesNotMatch(base, /UNVALIDATED REPORTS/)
  assert.equal(assembleReviewPrompt({ ...input, rejectedReports: [] }), base)
  assert.equal(assembleReviewPrompt({ ...input, rejectedReports: undefined }), base)
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

test("the devops reason names only the paths that actually triggered it", () => {
  const { reasons } = selectDimensions([
    'src/components/Button.tsx',
    './.github/workflows/ci.yml',
    'src/lib/format.ts'
  ])
  assert.match(reasons.devops, /\.github\/workflows\/ci\.yml/)
  assert.ok(!reasons.devops.includes('Button.tsx'), `a non-trigger was named: ${reasons.devops}`)
  assert.ok(!reasons.devops.includes('format.ts'), `a non-trigger was named: ${reasons.devops}`)
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

// --- the domain dimension (change `judge-against-base-and-living-specs`, D4) --
//
// `selectDimensions(paths)` with ONE argument is unchanged; the docs-only pin
// above (`reasons` is `{}`) still holds. The domain selection arrives as a
// second argument, because it needs the graph and the change's own specs, which
// a pure path classifier does not have.

const DOMAIN_SELECTION = {
  capabilities: [
    { capability: 'hooks/tool-guards', via: 'linked', files: ['hooks/guard-commit.mjs'] },
    { capability: 'review/policy-file', via: 'declared', files: [] }
  ]
}

test('selectDimensions with one argument is unchanged by the domain dimension', () => {
  for (const paths of [[], ['docs/04-when-it-stops.md'], ['.github/workflows/ci.yml'], ['src/auth/login.ts']]) {
    const one = selectDimensions(paths)
    assert.deepEqual(selectDimensions(paths, {}), one, 'an empty options bag changes nothing')
    assert.deepEqual(selectDimensions(paths, { domain: null }), one)
    assert.deepEqual(selectDimensions(paths, { domain: { capabilities: [] } }), one)
    assert.ok(!one.dimensions.includes('domain'))
    assert.equal(one.reasons.domain, undefined)
  }
  assert.deepEqual(selectDimensions(['docs/a.md']), { dimensions: [...ALWAYS_ON_DIMENSIONS], reasons: {} })
})

test('a domain selection appends domain after the always-on four, with a reason naming capabilities and files', () => {
  const { dimensions, reasons } = selectDimensions(['docs/a.md'], { domain: DOMAIN_SELECTION })
  assert.deepEqual(dimensions, [...ALWAYS_ON_DIMENSIONS, 'domain'])
  assert.match(reasons.domain, /hooks\/tool-guards/)
  assert.match(reasons.domain, /hooks\/guard-commit\.mjs/)
  assert.match(reasons.domain, /review\/policy-file/, 'a declared capability is named too')
})

test('domain comes after devops and security when they are also selected', () => {
  const { dimensions, reasons } = selectDimensions(['.github/workflows/ci.yml', 'src/auth/login.ts'], {
    domain: DOMAIN_SELECTION
  })
  assert.deepEqual(dimensions, [...ALWAYS_ON_DIMENSIONS, 'devops', 'security', 'domain'])
  assert.ok(reasons.devops && reasons.security && reasons.domain, 'every optional dimension carries a reason')
})

test('selectDimensions does not mutate the domain selection it was handed', () => {
  const before = JSON.stringify(DOMAIN_SELECTION)
  selectDimensions(['docs/a.md'], { domain: DOMAIN_SELECTION })
  assert.equal(JSON.stringify(DOMAIN_SELECTION), before)
})

const DOMAIN_TEXT =
  'DOMAIN REQUIREMENTS IN FORCE (quoted repository data)\n"""\nDOMAIN-TEXT-SENTINEL: Every guard SHALL fail open\n"""\n'

const DOMAIN_DIMENSIONS = [
  { name: 'language', rubric: 'Check idiomatic usage, type safety and error handling.' },
  { name: 'domain', rubric: 'Judge the diff against the requirements in force.' },
  { name: 'qa', rubric: 'Are edge cases and error paths covered by a test?' }
]

const reviewInput = (over = {}) => ({
  change: 'add-widget',
  dimensions: DOMAIN_DIMENSIONS,
  policyProse: '',
  findingsPath: '.claude/ship/add-widget/review/findings.json',
  verdictsPath: '.claude/ship/add-widget/review/verdicts.json',
  stageLine: '',
  ...over
})

test('the review briefing carries the domain text only inside the domain dimension\'s criteria', () => {
  const prompt = assembleReviewPrompt(reviewInput({ domainContext: DOMAIN_TEXT }))
  const at = prompt.indexOf('DOMAIN-TEXT-SENTINEL')
  assert.ok(at !== -1, 'the domain text must reach the briefing')
  assert.equal(prompt.indexOf('DOMAIN-TEXT-SENTINEL', at + 1), -1, 'and appear exactly once')
  const domainHeading = prompt.indexOf('## domain\n')
  assert.ok(domainHeading !== -1)
  assert.ok(domainHeading < at, 'after the domain heading')
  assert.ok(
    prompt.indexOf('Judge the diff against the requirements in force.') < at,
    'after the domain rubric, as part of its criteria'
  )
  assert.ok(at < prompt.indexOf('## qa'), 'and before the next dimension, so no other reviewer is handed it')
  assert.ok(prompt.indexOf('## language') < domainHeading)
})

test('the domain text is not delivered when domain is not among the dimensions', () => {
  const prompt = assembleReviewPrompt(
    reviewInput({
      dimensions: DOMAIN_DIMENSIONS.filter(d => d.name !== 'domain'),
      domainContext: DOMAIN_TEXT
    })
  )
  assert.doesNotMatch(prompt, /DOMAIN-TEXT-SENTINEL/)
})

test('a review given no domain text is briefed byte-identically to one never given the field', () => {
  const base = assembleReviewPrompt(reviewInput())
  assert.doesNotMatch(base, /DOMAIN-TEXT-SENTINEL/)
  assert.equal(assembleReviewPrompt(reviewInput({ domainContext: undefined })), base)
  assert.equal(assembleReviewPrompt(reviewInput({ domainContext: null })), base)
  assert.equal(assembleReviewPrompt(reviewInput({ domainContext: '' })), base)
})

test('the add-a-dimension clause excludes domain', () => {
  const prompt = assembleReviewPrompt(reviewInput({ domainContext: DOMAIN_TEXT }))
  const from = prompt.indexOf('You may add a dimension')
  assert.ok(from !== -1, 'the clause is still there for the other dimensions')
  const to = prompt.indexOf('one-line reason', from)
  assert.ok(to !== -1)
  assert.match(prompt.slice(from, to), /domain/, 'the clause names domain as the exception')
})

test('the finding field list carries an optional requirement, in the cited form', () => {
  for (const input of [reviewInput(), reviewInput({ dimensions: [{ name: 'qa', rubric: 'r' }] })]) {
    const prompt = assembleReviewPrompt(input)
    const fields = /findings: \[\{([^}]*)\}\]/.exec(prompt)
    assert.ok(fields, 'the finding shape is still stated')
    assert.match(fields[1], /\brequirement\b/, 'requirement is a finding field')
    assert.match(fields[1], /\bseverity\b.*\bsuggestion\b/s, 'the existing fields stay')
    assert.match(prompt, /openspec\/specs\//, 'the citation form is taught')
    assert.match(prompt, /optional/i, 'requirement is optional')
  }
})

test('the remediation briefing carries the same domain text when domain is re-reviewed', () => {
  const remediate = (over = {}) =>
    assembleRemediatePrompt({
      change: 'add-widget',
      round: 1,
      plan: {
        fix: { byFile: [{ file: 'lib/db.mjs', findings: [] }], unscoped: [] },
        reReviewDimensions: ['language', 'domain', 'qa']
      },
      dimensions: DOMAIN_DIMENSIONS,
      policyProse: '',
      stageLine: '',
      ...over
    })
  const prompt = remediate({ domainContext: DOMAIN_TEXT })
  const at = prompt.indexOf('DOMAIN-TEXT-SENTINEL')
  assert.ok(at !== -1, 'a re-review of domain is given the requirements again')
  assert.equal(prompt.indexOf('DOMAIN-TEXT-SENTINEL', at + 1), -1)
  assert.ok(prompt.indexOf('## domain\n') < at && at < prompt.indexOf('## qa'), 'only under domain')

  const without = remediate({
    dimensions: DOMAIN_DIMENSIONS.filter(d => d.name !== 'domain'),
    domainContext: DOMAIN_TEXT
  })
  assert.doesNotMatch(without, /DOMAIN-TEXT-SENTINEL/, 'a re-review that skips domain is not handed it')

  const bare = remediate()
  assert.doesNotMatch(bare, /DOMAIN-TEXT-SENTINEL/)
  assert.equal(remediate({ domainContext: null }), bare)
})

test('the prompt registry exercises the domain input of the review and remediation briefings', () => {
  for (const name of ['review', 'remediate']) {
    const withDomain = PROMPTS[name].inputs.filter(i => typeof i.domainContext === 'string' && i.domainContext)
    assert.ok(withDomain.length > 0, `PROMPTS.${name} must register an input with domainContext`)
    for (const input of withDomain) {
      assert.ok(
        input.dimensions.some(d => d.name === 'domain'),
        `PROMPTS.${name}'s domain input must also carry the domain dimension, or the text is never rendered`
      )
      const prompt = PROMPTS[name].assemble(input)
      assert.ok(prompt.includes(input.domainContext.trim().split('\n')[0]), `${name} must render its domain text`)
    }
  }
})

// --- the handoff's living requirements (change `complete-and-record-the-merge-verdict`, design D5) ----
//
// `assembleHandoffPrompt` gains one optional input, `living`: the entries of
// the living list `lib/conformance.mjs` builds (`L1..Ln`, each with the living
// spec's path, the line of the requirement's heading and its heading). Given
// one, the briefing lists the entries after the scenarios and asks the agent
// to answer them the way it answers a scenario. Given none, the briefing is
// byte-identical to what it was before the input existed.

const LIVING = [
  { id: 'L1', capability: 'ship/run-program', artifact: 'openspec/specs/ship/run-program/spec.md', line: 14, title: 'A run SHALL record its steps' },
  { id: 'L2', capability: 'review/merge-confidence', artifact: 'openspec/specs/review/merge-confidence/spec.md', line: 31, title: 'The score SHALL be bounded' }
]
const SCENARIO_LIST = [{ id: 'C1', artifact: 'specs/x.md', line: 3, title: 'does the thing' }]

const handoffInput = (over = {}) => ({
  change: 'add-widget',
  needsManualTestPlan: true,
  conformance: SCENARIO_LIST,
  learnings: true,
  ...over
})

// What the assembler printed for `handoffInput()` before `living` existed.
const HANDOFF_BEFORE_LIVING =
  'Produce the handoff artifacts for change "add-widget".\n\n' +
  'Write openspec/changes/add-widget/manual-test-plan.md covering every touched file, with spec scenarios and tasks mapped to numbered cases.\n\n' +
  'Then write openspec/changes/add-widget/code-explanation.md as a commit teach-in: why each file changed, what changed, the blast radius, and what would break if it were left out.\n\n' +
  'Spec conformance — for each scenario below, read the implementation and answer whether the described behaviour was actually built, citing file:line. Write the answers to openspec/changes/add-widget/conformance.md with one section per scenario id. A scenario you cannot confirm is recorded as unconfirmed with what you looked at — never as satisfied, and never omitted. If the checklist is empty, say so and move on.\n\n' +
  '  C1  does the thing\n      specs/x.md:3\n\n' +
  'This never halts the run: a prose scenario matched to code is a judgement, and a judgement that stopped a ship run would be a gate built on a guess. Report it and let a person read it.\n\n' +
  'Finally, capture at most three learnings from fixes made during this run — recurring failure modes under .claude/memory/failure-modes/, module coupling under .claude/memory/coupling/ — each one small file, indexed in .claude/memory/MEMORY.md. Only genuinely recurring patterns; write nothing if nothing recurred. This is silent.'

const occurrences = (text, pattern) => (text.match(new RegExp(pattern, 'g')) || []).length

test('with no living list the handoff briefing is byte-identical to what it was', () => {
  assert.equal(assembleHandoffPrompt(handoffInput()), HANDOFF_BEFORE_LIVING)
  assert.equal(assembleHandoffPrompt(handoffInput({ living: undefined })), HANDOFF_BEFORE_LIVING)
  assert.equal(assembleHandoffPrompt(handoffInput({ living: null })), HANDOFF_BEFORE_LIVING)
  assert.doesNotMatch(HANDOFF_BEFORE_LIVING, /\bL\d+\b/)
})

test('a living list prints each L entry with its spec path and line after the scenarios', () => {
  const prompt = assembleHandoffPrompt(handoffInput({ living: LIVING }))
  const scenarioAt = prompt.indexOf('specs/x.md:3')
  assert.ok(scenarioAt !== -1, 'the scenarios are still listed')
  let from = scenarioAt
  for (const entry of LIVING) {
    const idAt = prompt.indexOf(entry.id, from)
    assert.ok(idAt > from, `${entry.id} is listed after the scenarios and in order`)
    const titleAt = prompt.indexOf(entry.title, idAt)
    assert.ok(titleAt !== -1, `${entry.id} carries its heading`)
    const locationAt = prompt.indexOf(`${entry.artifact}:${entry.line}`, idAt)
    assert.ok(locationAt !== -1, `${entry.id} carries its spec path and line`)
    from = idAt
  }
})

test('the living part of the briefing asks for a file:line citation, never records an unconfirmed one as satisfied or omitted, and never halts', () => {
  const without = assembleHandoffPrompt(handoffInput())
  const withLiving = assembleHandoffPrompt(handoffInput({ living: LIVING }))
  // Tokens, not sentences: each must occur more often than the scenario text alone makes it occur.
  for (const [what, pattern] of [
    ['a file:line citation', 'file:line'],
    ['an unconfirmed requirement', 'unconfirmed'],
    ['never recorded as satisfied', 'satisfied'],
    ['never omitted', 'omitted'],
    ['an answer that never halts the run', 'never halts?']
  ]) {
    assert.ok(
      occurrences(withLiving, pattern) > occurrences(without, pattern),
      `the living list adds no instruction about ${what}`
    )
  }
  assert.match(withLiving, /requirement/i)
})

test('the living list is its own section and leaves the rest of the briefing alone', () => {
  const withLiving = assembleHandoffPrompt(handoffInput({ living: LIVING }))
  assert.ok(withLiving.startsWith('Produce the handoff artifacts for change "add-widget".'))
  assert.ok(withLiving.includes('  C1  does the thing\n      specs/x.md:3'), 'the scenario list is byte for byte as before')
  assert.ok(withLiving.endsWith('This is silent.'), 'learnings still close the briefing')
  assert.ok(withLiving.indexOf('L1') < withLiving.indexOf('Finally, capture at most three learnings'))
})

test('the living briefing is a pure function of its input', () => {
  const input = handoffInput({ living: LIVING })
  assert.equal(assembleHandoffPrompt(input), assembleHandoffPrompt(input))
  const before = JSON.stringify(input)
  assembleHandoffPrompt(input)
  assert.equal(JSON.stringify(input), before)
})

test('the handoff entry of the sample-input registry carries one input with a living list, so the integrity sweep assembles the new text', () => {
  const withLiving = PROMPTS.handoff.inputs.filter(i => Array.isArray(i.living) && i.living.length > 0)
  assert.equal(withLiving.length, 1, 'exactly one sample input carries a living list')
  const [sample] = withLiving
  for (const entry of sample.living) {
    for (const key of ['id', 'artifact', 'line', 'title']) assert.ok(entry[key] !== undefined, `sample entry lacks ${key}`)
    assert.match(entry.id, /^L\d+$/)
  }
  const prompt = PROMPTS.handoff.assemble(sample)
  assert.equal(typeof prompt, 'string')
  assert.ok(prompt.includes(sample.living[0].title))
  assert.ok(prompt.includes(`${sample.living[0].artifact}:${sample.living[0].line}`))
  // The existing samples are untouched: the ones without a list still assemble without one.
  assert.ok(PROMPTS.handoff.inputs.some(i => !i.living))
})

test('HANDOFF_RESULT_SCHEMA declares the two requirement counts as integers and still requires only ok', () => {
  const schema = SCHEMAS.HANDOFF_RESULT_SCHEMA
  assert.equal(schema.properties.requirementsChecked.type, 'integer')
  assert.equal(schema.properties.requirementsUnconfirmed.type, 'integer')
  assert.deepEqual(schema.required, ['ok'])
  // The scenario counts beside them are unchanged.
  assert.equal(schema.properties.scenariosChecked.type, 'integer')
  assert.equal(schema.properties.scenariosUnconfirmed.type, 'integer')
})

// --- a clean result is a file with a list in it (design D24 of label-and-harden-the-merge-verdict) ---
//
// A review or a re-review that finds nothing and writes nothing leaves the run
// with no findings list to adjudicate, which it reads as "did not complete" or
// "not re-reviewed". Both briefings therefore name the findings file and ask for
// an empty list.

const FINDINGS_AT = '.claude/ship/add-widget/review/findings.json'
const VERDICTS_AT = '.claude/ship/add-widget/review/verdicts.json'
const EMPTY_LIST = '`[]`'

test('the review briefing names the findings file and asks for an empty list when nothing is found', () => {
  const prompt = assembleReviewPrompt(reviewInput({ findingsPath: FINDINGS_AT, verdictsPath: VERDICTS_AT }))
  assert.ok(prompt.includes(FINDINGS_AT), 'the findings path is not in the review briefing')
  assert.ok(prompt.includes(EMPTY_LIST), 'the review briefing never asks for an empty list')
})

test('the remediation briefing names the findings file and asks for an empty list when nothing is found', () => {
  const prompt = assembleRemediatePrompt({
    change: 'add-widget',
    round: 1,
    plan: {
      fix: { byFile: [{ file: 'lib/db.mjs', findings: [] }], unscoped: [] },
      reReviewDimensions: ['language']
    },
    dimensions: [{ name: 'language', rubric: 'criteria' }],
    policyProse: '',
    findingsPath: FINDINGS_AT,
    verdictsPath: VERDICTS_AT,
    stageLine: ''
  })
  assert.ok(prompt.includes(FINDINGS_AT), 'the findings path is not in the remediation briefing')
  assert.ok(prompt.includes(VERDICTS_AT), 'the verdicts path is not in the remediation briefing')
  assert.ok(prompt.includes(EMPTY_LIST), 'the remediation briefing never asks for an empty list')
})

test('the verdict briefing fixes and re-reviews nothing, so it asks for no file', () => {
  const prompt = assembleVerdictPrompt({ change: 'add-widget', round: 3 })
  assert.ok(!prompt.includes(EMPTY_LIST))
})

// --- the compound-notes table ------------------------------------------------

test('no advisor brief assembler is registered', () => {
  for (const key of Object.keys(PROMPTS)) assert.doesNotMatch(key, /advisor/i, `PROMPTS.${key} is still registered`)
  for (const entry of Object.values(PROMPTS)) assert.doesNotMatch(entry.module, /advisor|brief-kit/, `${entry.module} is still registered`)
})

test('the commit briefing names the compound-notes table as touched only when the manifest carries it', () => {
  const withNotes = assembleCommitPrompt({ change: 'add-widget', stageIndex: 3, notesPath: 'docs/notes/compound.md' })
  assert.match(withNotes, /docs\/notes\/compound\.md/)
  assert.match(withNotes, /touched/)
  // The existing rule still holds; no new staging rule is added beside it.
  assert.match(withNotes, /never `git add -A`, never amend, never push/)

  const without = assembleCommitPrompt({ change: 'add-widget', stageIndex: 3 })
  assert.doesNotMatch(without, /compound\.md|docs\/notes/)
  const nulled = assembleCommitPrompt({ change: 'add-widget', stageIndex: 3, notesPath: null })
  assert.equal(nulled, without, 'an absent and a null notesPath assemble the same briefing')
})

test('PROMPTS.commit registers an input with notesPath and one without', () => {
  const inputs = PROMPTS.commit.inputs
  assert.ok(inputs.some(i => typeof i.notesPath === 'string' && i.notesPath), 'no commit input carries notesPath')
  assert.ok(inputs.some(i => !i.notesPath), 'no commit input leaves notesPath out')
})

test('the review briefing’s finding shape lists specGap as an optional field', () => {
  const prompt = PROMPTS.review.assemble(PROMPTS.review.inputs[0])
  const shape = prompt.match(/findings: \[\{([^\]]*)\}\]/)
  assert.ok(shape, 'the review briefing shows no finding shape')
  assert.match(shape[1], /\bspecGap\b/, 'the finding shape does not list specGap')
  assert.match(prompt, /`specGap` is optional/)
})
