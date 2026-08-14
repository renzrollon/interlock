// Structural validation of the bundled dynamic workflows.
//
// A workflow is a script the runtime executes, which makes it the one place in
// this plugin where a mistake is not recoverable by a model noticing and
// adapting mid-run. The runtime also imposes constraints that fail the whole
// run *before it starts* — a script containing `import()` is rejected outright —
// so the cheapest place to catch them is here.
//
// The last test is the important one: it asserts that every `interlock`
// subcommand the workflow invokes actually exists in the CLI. That is the seam
// this architecture created — policy in the CLI, control flow in the script —
// and it is exactly the seam that rots silently.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOWS_DIR = join(ROOT, 'workflows')

const workflowFiles = existsSync(WORKFLOWS_DIR)
  ? readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.js')).sort()
  : []

test('the plugin ships at least the ship workflow', () => {
  assert.ok(workflowFiles.includes('ship.js'), `expected workflows/ship.js, found: ${workflowFiles}`)
})

for (const fileName of workflowFiles) {
  const text = readFileSync(join(WORKFLOWS_DIR, fileName), 'utf8')

  test(`${fileName}: exports a meta block with a name and description`, () => {
    assert.match(text, /export const meta\s*=/, 'a workflow must export meta')
    const name = /name:\s*'([^']+)'/.exec(text)
    assert.ok(name, `${fileName}: meta.name is missing`)
    assert.equal(
      name[1],
      fileName.replace(/\.js$/, ''),
      `${fileName}: meta.name sets the command name, so it must match the file name`
    )
    assert.match(text, /description:/, `${fileName}: meta.description is missing`)
  })

  test(`${fileName}: contains no import(), which the runtime rejects outright`, () => {
    // "No module loading: a script that contains import() fails before the run
    // starts." This is why the engines are CLI subcommands rather than modules.
    assert.doesNotMatch(text, /\bimport\s*\(/, `${fileName}: import() fails the run before it starts`)
    assert.doesNotMatch(
      text,
      /^\s*import\s+[^(]/m,
      `${fileName}: static imports are not available to a workflow script either`
    )
  })

  test(`${fileName}: never reaches for the filesystem or a shell itself`, () => {
    // The script has neither. Agents do the I/O; the script coordinates them.
    // A require/fs/child_process reference here would be a script that looks
    // right and dies at run time.
    for (const forbidden of [/\brequire\s*\(/, /node:fs/, /child_process/, /\bexecSync\b/, /\bprocess\.cwd\b/]) {
      assert.doesNotMatch(text, forbidden, `${fileName}: ${forbidden} is unavailable inside a workflow`)
    }
  })

  test(`${fileName}: tolerates agent() returning null`, () => {
    // "An agent() call resolves to null if you stop it mid-run or it hits an
    // unrecoverable API error." A script that assumes an object crashes on a
    // stop, which is the one moment a user is most likely to trigger.
    assert.match(
      text,
      /!\w+\s*(\|\||\)|&&)|=== null|!== null|\?\?|Boolean\(/,
      `${fileName}: no null-guard on an agent result is visible`
    )
  })
}

test('ship.js invokes only interlock subcommands that exist', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const usage = readFileSync(join(ROOT, 'bin', 'interlock'), 'utf8')

  // Top-level commands the CLI dispatches on, read from its own switch so this
  // cannot drift from the implementation the way a hardcoded list would.
  const dispatched = new Set(
    [...usage.matchAll(/^\s*case '([a-z-]+)':/gm)].map(m => m[1])
  )
  assert.ok(dispatched.size > 5, 'failed to read the CLI dispatch table')

  const invoked = new Set(
    [...text.matchAll(/\binterlock ([a-z-]+)/g)]
      .map(m => m[1])
      // `interlock-graph` is a different binary; the capture picks up its suffix.
      .filter(name => name !== 'graph')
  )
  assert.ok(invoked.size > 0, 'ship.js appears to invoke no interlock subcommands at all')

  const missing = [...invoked].filter(name => !dispatched.has(name))
  assert.deepEqual(
    missing,
    [],
    `ship.js invokes interlock subcommand(s) the CLI does not implement: ${missing.join(', ')}`
  )
})

test('ship.js keeps the degradation banner strings verbatim', () => {
  // Users are told to look for these in docs/04-when-it-stops.md. They are a
  // contract, and a reworded banner is a banner nobody greps for.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  for (const banner of [
    'GRAPH UNAVAILABLE:',
    'NO TEST PROFILE:',
    'MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=',
    'VERIFICATION SKIPPED: reason=',
    'E2E FAILED (non-blocking by policy):'
  ]) {
    assert.ok(text.includes(banner), `ship.js no longer emits the "${banner}" banner`)
  }
})

test('ship.js prints a banner block even when nothing degraded', () => {
  // Silence is the failure mode the block exists to remove: a summary with no
  // banner section is indistinguishable from a run that degraded and hid it.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /No degradation banners/)
})

test('ship.js never prints an autonomy level', () => {
  // The ladder is experimental storage-only this release. Recording is fine;
  // showing a level to a reader implies a guarantee that does not exist.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const recordCalls = [...text.matchAll(/interlock autonomy (\w+)/g)].map(m => m[1])
  for (const call of recordCalls) {
    assert.ok(
      call === 'record',
      `ship.js calls "interlock autonomy ${call}" — only "record" is allowed while the ladder is storage-only`
    )
  }
})

test('no workflow carries a reference to the private predecessor repo', () => {
  const banned = /carl-|IdeaProjects|gitlab-dedicated|kaspar|day5-sdd|roadmap-harness/
  for (const fileName of workflowFiles) {
    const hit = banned.exec(readFileSync(join(WORKFLOWS_DIR, fileName), 'utf8'))
    assert.equal(hit, null, `${fileName}: leaked reference "${hit && hit[0]}"`)
  }
})

test('ship.js records an outcome on the way out of a halt', () => {
  // A corpus of only successful runs cannot answer the question it exists for,
  // and a halted run is its most informative record.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const haltBody = /const halt = async[\s\S]*?\n}/.exec(text)
  assert.ok(haltBody, 'ship.js no longer has a recognizable halt()')
  assert.match(haltBody[0], /await recordOutcome\(\)/, 'halt() must record before returning')
})

test('ship.js does not file a continuity run as a checkpoint', () => {
  // The corpus compares the two populations. Hardcoding the mode would make the
  // comparison say the opposite of the truth.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /opts\.mode === 'continue'/, 'the mode must come from the invocation')
  assert.doesNotMatch(
    text,
    /mode:\s*'checkpoint'/,
    'ship.js hardcodes mode:checkpoint — a continuity run would be misfiled'
  )
})

test('ship.js never assumes an outcome field it did not observe', () => {
  // Guessing unitGreen is how a corpus becomes confidently wrong.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /Leave a field out\s+entirely rather than guessing it|not a claim/)
})

test('ship.js folds record/replan into the next step via --write-state', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  for (const cmd of ['record-batch', 'record-verify', 'replan']) {
    assert.match(
      text,
      new RegExp(`wave-state ${cmd}[^\\n]*--write-state`),
      `ship.js ${cmd} must pass --write-state so stdout is the next step`
    )
  }
})

test('ship.js implementers follow tool economy and stop on green for tier 1-2', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /interlock-graph query/, 'implementers must locate via the graph before grep')
  assert.match(text, /Do not re-read/, 'implementers must not re-read a file unless it changed')
  assert.match(text, /schema only/, 'implementers must return the schema only')
  assert.match(text, /tier is 1 or 2/, 'tier 1-2 must stop after checks pass')
})

test('ship.js treats a raw string args as a change name, not a flag', () => {
  // Skill/slash often pass "my-change --no-commit" as a string. Dropping it
  // (opts={}) or stuffing it into flags loses the change name at validate.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /typeof args === 'string'/, 'must read a string args payload')
  assert.match(text, /rawTokens\.find\(t => !t\.startsWith\('-'\)\)/, 'first non-flag token is the change name')
})

test('ship.js uses haiku for mechanical control-plane steps', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /model:\s*'haiku'/, 'control-plane steps must pin haiku')
  assert.match(text, /cheap\(\s*`next-/, 'next must go through the cheap wrapper')
  assert.match(text, /cheap\(\s*`record-batch-/, 'record-batch must go through the cheap wrapper')
  assert.match(text, /cheap\(\s*`inter-wave-verify-/, 'inter-wave verify must go through the cheap wrapper')
  assert.match(text, /cheap\(\s*`replan-/, 'replan must go through the cheap wrapper')
})

test('ship.js review and remediate return counts only', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /do not paste dimension reports/i)
  assert.match(text, /do not paste fixer or skeptic/i)
})

test('ship.js control-plane pings copy stdout and do not say Report the step', () => {
  // "Report the step verbatim" taught haiku to set action:"report". The ping
  // must copy stdout, and the six real actions have to be named so it cannot
  // treat an English verb as one of them.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.doesNotMatch(text, /Report the step/)
  assert.match(text, /Copy stdout JSON into the result/)
  assert.match(text, /Never invent action/)
  for (const action of ['run-batch', 'test-wave', 'verify', 'replan', 'done', 'halt']) {
    assert.match(
      text,
      new RegExp(`Allowed values:[^\\n]*${action}`),
      `control-plane copy instructions must name ${action}`
    )
  }
})

test('ship.js retries an unknown wave-state action via next-retry- before halt', () => {
  // An invented action is a relay miss. Re-reading state is pure; a new label
  // cache-misses only the ping. Editing the prompt to resume would replay
  // every later implementer.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /next-retry-/)
  assert.match(text, /cheap\(\s*`next-retry-/)
  const retryAt = text.indexOf('next-retry-')
  const haltAt = text.indexOf('unrecognized step from the state machine')
  assert.ok(retryAt !== -1 && haltAt !== -1, 'retry and halt must both exist')
  assert.ok(retryAt < haltAt, 'retry must happen before the unrecognized-action halt')
  assert.match(text, /wave-state next --state \$\{STATE\} --json/)
})

test('ship.js prefers parsed cliStdout over a mapped action', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /cliStdout/)
  assert.match(text, /JSON\.parse/)
})
