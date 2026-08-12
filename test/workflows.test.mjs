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
