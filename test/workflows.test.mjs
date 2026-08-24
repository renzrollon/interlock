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

  // GOAL MET lines name the workflow in prose (`interlock ship`) so a /goal
  // evaluator can stop. They are not CLI invocations.
  const withoutGoalMet = text.replace(/GOAL MET:.*$/gm, '')
  const invoked = new Set(
    [...withoutGoalMet.matchAll(/\binterlock ([a-z-]+)/g)]
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
  // The close is one sequence — outcome, then receipt, then the summary — so
  // halt() goes through it rather than recording on its own. A halted run that
  // took a shortcut past the close would be the least explicable run in the
  // corpus and the least explained.
  assert.match(haltBody[0], /return closeRun\(\)/, 'halt() must close the run before returning')
  const closeBody = /const closeRun = async[\s\S]*?\n}/.exec(text)
  assert.ok(closeBody, 'ship.js no longer has a recognizable closeRun()')
  assert.match(closeBody[0], /await recordOutcome\(\)/, 'the close must record the outcome')
  assert.match(closeBody[0], /await appendReceipt\(\)/, 'and then the receipt')
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

test('ship.js classifier prompt forbids collision-as-group', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /Default group to the numbered tasks\.md section/)
  assert.match(text, /shared file is NOT a reason for a new group/)
  // Rule 3 spans two concatenated literals, so its full sentence only exists in
  // the assembled prompt — asserted there, in "the assembled plan-waves prompt
  // does not increment group for a later same-file slice".
  assert.match(text, /LATER NUMBERED SECTION/)
})

test('ship.js fuses verify plan into the record-batch ping', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /remainingBatches/)
  assert.match(text, /verify plan --no-profile --context inter-wave/)
  assert.match(text, /If that last stdout has action:"verify"/)
  assert.match(text, /pingExtra\.model = 'haiku'/)
})

test('ship.js dual-writes type and tools on every agent() spawn', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /type: PING_AGENT/)
  assert.match(text, /type: WORKER_AGENT/)
  assert.match(text, /tools: PING_TOOLS/)
  assert.match(text, /tools: WORKER_TOOLS/)
  assert.match(text, /\.\.\.workerExtra, \.\.\.extra/)
  assert.match(text, /cheap = \(name, prompt\) => step\(name, prompt, nextSchema, pingExtra\)/)
  assert.doesNotMatch(text, /tools:\s*\[[^\]]*(Skill|Agent)/)
})

test('ship.js implementers follow tool economy and stop on green for tier 1-2', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /interlock-graph query/, 'implementers must locate via the graph before grep')
  assert.match(text, /Do not re-read/, 'implementers must not re-read a file unless it changed')
  assert.match(text, /schema only/, 'implementers must return the schema only')
  assert.match(text, /tier is 1 or 2/, 'tier 1-2 must stop after checks pass')
})

test('ship.js implementers go through assembleImplementerPrompt, never an inline template', () => {
  // The extracted function is the only reason the snapshots in
  // test/spine/implementer-prompt.test.mjs mean anything. An agent() call that
  // rebuilt the prompt inline would drift past every one of them.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /\/\/ ASSEMBLE_IMPLEMENTER_PROMPT_START/)
  assert.match(text, /\/\/ ASSEMBLE_IMPLEMENTER_PROMPT_END/)
  assert.match(
    text,
    /agent\(\s*\n?\s*assembleImplementerPrompt\(\{ change, lane, previousHandoffs \}\)/,
    'the implementer agent() must be handed the assembled prompt, not a literal'
  )
  const calls = [...text.matchAll(/assembleImplementerPrompt\(/g)]
  assert.equal(calls.length, 2, 'exactly one definition and one call site')

  // Assembly has to stay in the script: the runtime rejects import(), so a
  // shared lib/ module would have to be copied back in here — the drift this
  // whole extraction exists to catch.
  assert.doesNotMatch(text, /\bimport\s*\(/, 'ship.js must not import()')
  assert.doesNotMatch(text, /node:fs/, 'ship.js must not touch the filesystem itself')
})

test('ship.js requires a handoff from implementers and threads the previous wave in', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(
    text,
    /required:\s*\['id',\s*'ok',\s*'handoff'\]/,
    'the implementer schema must require a handoff packet'
  )
  // The projection into batch-N.json is what record-batch actually reads. A
  // handoff dropped there is a handoff the CLI never sees. It is keyed off the
  // per-task OUTCOME now, because a lane reports one of three values per task
  // and only `ok` may be recorded as success.
  assert.match(
    text,
    /ok: o\.outcome === 'ok', error: o\.error, handoff: o\.handoff/,
    'the batch-N.json projection must derive ok from the per-task outcome'
  )
  // Same rule, second field: `filesChanged` was requested from every
  // implementer, returned, and dropped in this projection, which left the
  // packet's evidence with nothing to be cross-checked against. Dropping it
  // again would silently empty every stored reported-path set.
  assert.match(
    text,
    /filesChanged: o\.filesChanged/,
    'the batch-N.json projection must carry the reported changed paths'
  )
  // previousHandoffs rides beside remainingBatches on the same step.
  assert.match(text, /previousHandoffs:\s*\{[\s\S]{0,80}type: 'array'/)
  assert.match(text, /Array\.isArray\(next\.previousHandoffs\)/)
  assert.match(text, /PREVIOUS WAVE \(schema-validated; do not re-derive from git\)/)
})

test('ship.js does not restate the handoff cap that lives in the CLI', () => {
  // Same rule as every other cap: the number lives in lib/limits.mjs and the
  // prompt cites `interlock limits`. A copy here is a copy that drifts.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /character cap \\?`interlock limits\\?` publishes/)
  assert.doesNotMatch(text, /maxHandoffChars|2000 characters/)
})

test('ship.js does not use --handoff to mean the wave packet', () => {
  // `--handoff` is the opt-in strict tail (manual-test-plan.md,
  // code-explanation.md, memory). Overloading it would make one flag mean two
  // unrelated things.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /handoff: strict \|\| has\('handoff'\)/)
  assert.match(text, /manual-test-plan\.md/)
  assert.match(text, /if \(handoff \|\| conformance\)/)
})

function parseInvocationFromSource(args) {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const m = /\/\/ PARSE_INVOCATION_START\n([\s\S]*?)\n\/\/ PARSE_INVOCATION_END/.exec(text)
  assert.ok(m, 'ship.js must define parseInvocation between PARSE_INVOCATION markers')
  return new Function('args', `${m[1]}; return parseInvocation(args)`)(args)
}

test('ship.js treats a raw string args as a change name, not a flag', () => {
  // Skill/slash often pass "my-change --no-commit" as a string. Dropping it
  // (opts={}) or stuffing it into flags loses the change name at validate.
  const parsed = parseInvocationFromSource('my-change --no-commit')
  assert.equal(parsed.changeArg, 'my-change')
  assert.equal(parsed.noCommit, true)
  assert.equal(parsed.review, false)
  assert.equal(parsed.handoff, false)
  assert.equal(parsed.conformance, false)
  assert.equal(parsed.strict, false)
})

test('ship.js reads a change name from an args array', () => {
  // The Workflow tool docs pass lists as JSON arrays. Treating an array as
  // opts={} used to drop the name, so validate ran nameless against every
  // active change and halted.
  const parsed = parseInvocationFromSource(['resilient-gitlab-rate-limiting'])
  assert.equal(parsed.changeArg, 'resilient-gitlab-rate-limiting')
})

test('ship.js reads { change } and a JSON-encoded object string', () => {
  assert.equal(
    parseInvocationFromSource({ change: 'resilient-gitlab-rate-limiting' }).changeArg,
    'resilient-gitlab-rate-limiting'
  )
  assert.equal(
    parseInvocationFromSource('{"change":"resilient-gitlab-rate-limiting"}').changeArg,
    'resilient-gitlab-rate-limiting'
  )
})

test('ship.js parseInvocation treats --review as review-only', () => {
  const parsed = parseInvocationFromSource('my-change --review')
  assert.equal(parsed.changeArg, 'my-change')
  assert.equal(parsed.review, true)
  assert.equal(parsed.handoff, false)
  assert.equal(parsed.conformance, false)
  assert.equal(parsed.strict, false)
})

test('ship.js parseInvocation treats --strict as the previous default tail', () => {
  const parsed = parseInvocationFromSource('my-change --strict')
  assert.equal(parsed.changeArg, 'my-change')
  assert.equal(parsed.review, true)
  assert.equal(parsed.handoff, true)
  assert.equal(parsed.conformance, true)
  assert.equal(parsed.strict, true)
})

test('ship.js parseInvocation reads --strict from a flags array', () => {
  const parsed = parseInvocationFromSource({ change: 'add-auth', flags: ['strict'] })
  assert.equal(parsed.changeArg, 'add-auth')
  assert.equal(parsed.strict, true)
  assert.equal(parsed.review, true)
})

test('ship.js default is lean: tail gated, LEAN SHIP banner, first next folded into plan', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /if \(review\)/)
  assert.match(text, /if \(handoff \|\| conformance\)/)
  assert.match(text, /LEAN SHIP:/)
  assert.match(text, /pass --review \/ --handoff \/ --strict to enable/)
  assert.match(text, /readNext\(planned\)/)
  assert.doesNotMatch(text, /next-1/)
})

test('ship.js records autonomy only under --strict', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const autonomyAt = text.indexOf('interlock autonomy record')
  const strictAt = text.lastIndexOf('(strict', autonomyAt)
  assert.ok(autonomyAt !== -1, 'autonomy record must still exist for --strict')
  assert.ok(strictAt !== -1 && strictAt < autonomyAt, 'autonomy record must sit behind the strict flag')
})

test('the docs frame ACP as an opt-in second host and Code Mode as out of scope', () => {
  // The change's own scenario: a reader must not come away thinking Code Mode
  // is a ship host, or that the ACP driver is what happens when the Workflow
  // tool is missing. Both are one sentence away from being read that way, so
  // both are asserted rather than trusted to survive the next docs edit.
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  assert.match(readme, /interlock-ship-acp/)
  assert.match(readme, /Code Mode is out of scope/)
  assert.match(readme, /default and supported host/)

  const codeMode = readme.slice(readme.indexOf('Code Mode is out of scope'))
  assert.ok(
    !/Code Mode[^.]*\bsupported (ship )?host\b(?! today)/.test(codeMode),
    'Code Mode must never be described as a supported ship host'
  )

  const docs = readFileSync(join(ROOT, 'docs', '04-when-it-stops.md'), 'utf8')
  assert.match(docs, /not a fallback/)
  assert.match(docs, /MODEL ROUTING UNAVAILABLE \(ACP host\)/)
})

test('docs/04 publishes the retrigger table and safe /goal recipe', () => {
  const docs = readFileSync(join(ROOT, 'docs', '04-when-it-stops.md'), 'utf8')
  assert.match(docs, /GOAL MET: interlock ship/)
  assert.match(docs, /GOAL MET: interlock spec/)
  assert.match(docs, /Leftover checkboxes and a second Workflow call are not required/)
  assert.match(docs, /Unsafe/)
  assert.match(docs, /all tasks\.md boxes checked/)
  assert.match(docs, /LEAN SHIP/)
})

test('ship.js does not claim a clean complete when a wave had failures', () => {
  // One or two ok:false tasks stay under the halt cap and the run continues to
  // commit. Printing SHIP COMPLETE with silent leftovers is what taught the
  // parent to launch a second 20-agent workflow.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /failedIds/)
  assert.match(text, /SHIP COMPLETE WITH LEFTOVERS/)
  assert.match(text, /Do not start another ship run unless the user asks/)
  assert.match(text, /GOAL MET: interlock ship returned a terminal summary/)
})

test('ship.js ticks succeeded tasks through the CLI, not by editing tasks.md', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /interlock tasks tick/)
  assert.doesNotMatch(text, /Then tick the checkbox in openspec/)
})

test('ship.js halts when classified tasks omit an unchecked checkbox', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /interlock tasks coverage/)
  assert.match(text, /coverageOk/)
  assert.doesNotMatch(text, /plan-coverage/, 'coverage is folded into plan-waves, not a second agent')
})

test('ship.js validate threads a known change as --change, not a bare positional', () => {
  // A positional after --json is easy for the validate agent to drop, and
  // `interlock validate --change <name>` was documented but ignored by the CLI.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /interlock validate --change/)
  assert.doesNotMatch(text, /interlock validate \$\{changeArg \|\| ''\} --json/)
  assert.match(
    text,
    /Unchecked tasks are the work this run implements|0 checked|normal starting state/i
  )
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

test('ship.js logs the ship-run trajectory through run-log, never by touching fs itself', () => {
  // The trajectory writer is a CLI side effect (lib/run-log.mjs via `interlock
  // run-log`), never a script-side fs.appendFile — the runtime gives the
  // script no filesystem of its own, so this is the only way it could log
  // anything at all. This is the same "no import()/fs" guarantee the generic
  // per-file test above already asserts; this test additionally pins that
  // run-log specifically shows up among the dispatched subcommands ship.js
  // actually calls, and that the CLI dispatch table recognizes it.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const usage = readFileSync(join(ROOT, 'bin', 'interlock'), 'utf8')

  assert.match(text, /interlock run-log append --event/, 'ship.js must log trajectory events via the CLI')
  assert.doesNotMatch(text, /\bimport\s*\(/, 'ship.js must not import()')
  assert.doesNotMatch(text, /node:fs/, 'ship.js must not touch the filesystem itself')

  const dispatched = new Set([...usage.matchAll(/^\s*case '([a-z-]+)':/gm)].map(m => m[1]))
  assert.ok(dispatched.has('run-log'), 'the CLI must dispatch a "run-log" subcommand')
})

// --- the two hosts, against one engine ------------------------------------
//
// add-interlock-acp-host accepts one duplicated loop (a workflow script and a
// Node driver) on the explicit condition that both drive the same CLI. These
// tests are that condition, written down: the same subcommands on both sides,
// and no second copy of the rules or of the implementer briefing on the ACP
// side. Without them, "the shared source of truth is the CLI" is a comment.

const ACP_DRIVER = join(ROOT, 'bin', 'interlock-ship-acp')

/** Subcommands a driver invokes, however it spells the invocation. */
function invokedSubcommands(text) {
  const withoutGoalMet = text.replace(/GOAL MET:.*$/gm, '')
  const names = new Set()
  // Prose form, as an agent is told to run it: `interlock wave-state next`.
  for (const m of withoutGoalMet.matchAll(/\binterlock ([a-z-]+)/g)) names.add(m[1])
  // Node form, as the driver runs it itself: `cli(['wave-state', ...])`.
  for (const m of withoutGoalMet.matchAll(/(?:host\.runCli|\bcli)\(\[\s*'([a-z-]+)'/g)) names.add(m[1])
  names.delete('graph') // interlock-graph is a different binary
  names.delete('ship') // interlock-ship-acp is this one
  return names
}

test('the ACP driver and ship.js drive the same interlock subcommands', () => {
  const script = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const driver = readFileSync(ACP_DRIVER, 'utf8')
  const dispatched = new Set(
    [...readFileSync(join(ROOT, 'bin', 'interlock'), 'utf8').matchAll(/^\s*case '([a-z-]+)':/gm)].map(m => m[1])
  )

  const fromScript = invokedSubcommands(script)
  const fromDriver = invokedSubcommands(driver)

  // The lean path, named explicitly. A host that stopped calling one of these
  // is a host that started deciding it for itself.
  for (const required of ['validate', 'wave-state', 'verify', 'outcomes']) {
    assert.ok(fromScript.has(required), `ship.js no longer invokes interlock ${required}`)
    assert.ok(fromDriver.has(required), `the ACP driver does not invoke interlock ${required}`)
  }

  const missing = [...fromDriver].filter(name => !dispatched.has(name))
  assert.deepEqual(missing, [], `the ACP driver invokes subcommand(s) the CLI does not implement: ${missing}`)
})

test('the ACP driver holds no second copy of the halt rules', () => {
  const driver = readFileSync(ACP_DRIVER, 'utf8')

  // It may import the host port. It may not import the policy — a driver that
  // loaded lib/waves.mjs or lib/limits.mjs could answer "may I continue"
  // itself, which is the entire thing this change is not doing.
  const imports = [...driver.matchAll(/from '([^']+)'/g)].map(m => m[1])
  assert.ok(imports.length > 0, 'failed to read the driver imports')
  for (const specifier of imports) {
    assert.ok(
      specifier.startsWith('node:') || /^\.\.\/lib\/host(\/|\.)/.test(specifier),
      `the ACP driver may only import node builtins and the host port, not ${specifier}`
    )
  }

  // Halt reasons and caps are the CLI's words, never restated here.
  for (const forbidden of [
    /task failures accumulated/,
    /maxTaskFailures/,
    /interWaveFixAttempts/,
    /rootCauseIterations/,
    /more than two/i
  ]) {
    assert.doesNotMatch(driver, forbidden, `the ACP driver restates a CLI rule: ${forbidden}`)
  }
})

test('the ACP driver briefs implementers with ship.js own prompt', () => {
  // The tier ladder is snapshotted against test/fixtures/prompts/ for exactly
  // one assembler. A second copy in the driver would drift silently and both
  // hosts would still look correct.
  const driver = readFileSync(ACP_DRIVER, 'utf8')
  assert.match(driver, /ASSEMBLE_IMPLEMENTER_PROMPT_START/)
  assert.match(driver, /assembleImplementerPrompt\(\{ change, lane, previousHandoffs \}\)/)
  for (const copied of [/Your tier is/, /tier 1: the task description alone/, /interlock\.wave-handoff\/1/]) {
    assert.doesNotMatch(driver, copied, `the ACP driver copies implementer prompt text: ${copied}`)
  }
})

test('the ACP driver refuses --strict instead of quietly shipping lean', () => {
  // The MVP is lean ship. Running lean under a strict invocation would be the
  // silent degradation every banner in this repo exists to prevent.
  const driver = readFileSync(ACP_DRIVER, 'utf8')
  assert.match(driver, /REFUSED_FLAGS = \['strict', 'review', 'handoff', 'conformance'\]/)
  assert.match(driver, /is not implemented on the ACP host/)
  assert.match(driver, /process\.exit\(2\)/)
  assert.match(driver, /LEAN SHIP:/, 'the summary must still say what was skipped')
  assert.doesNotMatch(driver, /interlock review /, 'the review tail is Claude Code-only for now')
  assert.doesNotMatch(driver, /interlock remediate/, 'remediation is Claude Code-only for now')
})

test('ship.js prefers parsed cliStdout over a mapped action', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /cliStdout/)
  assert.match(text, /JSON\.parse/)
})

// --- the loop, executed (spec: ship/cap-authority, ship/completion-gate) ----
//
// Everything above reads ship.js as text. That catches a deleted sentence and
// misses a wrong branch, so the tests below run the script against stubbed
// agents (test/helpers/ship-harness.mjs) and assert on what it actually did.

const LIMITS_MODULE = await import('../lib/limits.mjs')
const { LIMITS } = LIMITS_MODULE
const {
  runShip,
  stepResult,
  stepResultNoStdout,
  reuseAdopted,
  reuseRebuilt,
  receiptFrom,
  coercionArtifacts,
  recordedOutcome,
  RUN_BATCH,
  DONE
} = await import('./helpers/ship-harness.mjs')

function remediationBudgetFromSource(input) {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const m = /\/\/ REMEDIATION_BUDGET_START\n([\s\S]*?)\n\/\/ REMEDIATION_BUDGET_END/.exec(text)
  assert.ok(m, 'ship.js must define remediationBudget between REMEDIATION_BUDGET markers')
  return new Function('input', `${m[1]}; return remediationBudget(input)`)(input)
}

test('the remediation bound is derived from the cap, never written as a literal', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.doesNotMatch(
    text,
    /round\s*<=\s*\d/,
    'the remediation loop must not restate the cap as a literal — that is what lib/limits.mjs exists to prevent'
  )
  assert.doesNotMatch(text, /round === 3/)

  const cap = LIMITS.remediationRounds
  // Rounds 1..cap fix; the round after the cap is the verdict.
  for (let round = 1; round <= cap; round++) {
    assert.equal(
      remediationBudgetFromSource({ round, roundCap: cap, blockersRemaining: 1 }).phase,
      'fix',
      `round ${round} of ${cap} must still be a fixing round`
    )
  }
  assert.equal(remediationBudgetFromSource({ round: cap + 1, roundCap: cap }).phase, 'verdict')

  // Raising the cap by one buys exactly one more fixing round, and the verdict
  // round moves with it. This is the property a literal silently breaks.
  assert.equal(
    remediationBudgetFromSource({ round: cap + 1, roundCap: cap + 1, blockersRemaining: 1 }).phase,
    'fix'
  )
  assert.equal(remediationBudgetFromSource({ round: cap + 2, roundCap: cap + 1 }).phase, 'verdict')
})

test('a cap lowered to its minimum leaves exactly one verdict round', () => {
  assert.equal(remediationBudgetFromSource({ round: 1, roundCap: 1, blockersRemaining: 1 }).phase, 'fix')
  assert.equal(remediationBudgetFromSource({ round: 2, roundCap: 1 }).phase, 'verdict')
})

test('a bound the CLI never stated is not a bound', () => {
  for (const roundCap of [undefined, null, 0, -1, 'two']) {
    assert.equal(remediationBudgetFromSource({ round: 1, roundCap }).phase, 'unknown')
  }
})

/** The remediationRounds figure ship.js hands the outcome corpus. */
function recordedRounds(prompts) {
  const outcome = prompts.find(p => p.label === 'record-outcome')
  assert.ok(outcome, 'the run assembled no record-outcome prompt')
  const m = /"remediationRounds":(\d+)/.exec(outcome.prompt)
  assert.ok(m, `record-outcome carries no remediationRounds:\n${outcome.prompt}`)
  return Number(m[1])
}

test('recorded round consumption differs between a one-round and a two-round run', async () => {
  // `Math.min(round, 2)` where round is always one past the bound at loop exit
  // is a constant, and a fictional field in the outcomes corpus makes the one
  // question that corpus exists to answer unanswerable.
  const cap = LIMITS.remediationRounds
  const cleared = await runShip({
    args: 'demo-change --strict',
    responses: { 'remediate-': { ok: true, blockersRemaining: 0, roundCap: cap } }
  })
  const persisted = await runShip({
    args: 'demo-change --strict',
    responses: {
      'remediate-': (label, n) => ({
        ok: true,
        blockersRemaining: n === 1 ? 2 : 0,
        roundCap: cap
      })
    }
  })
  assert.equal(recordedRounds(cleared.prompts), 1)
  assert.equal(recordedRounds(persisted.prompts), 2)
})

test('a lean run records no remediation rounds, distinguishably from "ran and used none"', async () => {
  const { prompts } = await runShip({})
  assert.equal(recordedRounds(prompts), 0)
})

// --- the completion gate ---------------------------------------------------

const verifyRun = (verify) => runShip({ responses: { verify } })

test('a green verification proceeds to the commit', async () => {
  const { output, calls } = await verifyRun({ ok: true, unitGreen: true, skipReasons: [] })
  assert.ok(calls.includes('commit'), 'a green verification must reach the commit step')
  assert.match(output, /SHIP COMPLETE/)
})

test('a red verification halts even without a self-reported halt flag', async () => {
  const { output, calls } = await verifyRun({ ok: false, unitGreen: false })
  assert.ok(!calls.includes('commit'), 'no commit may be created on a red verification')
  assert.match(output, /SHIP HALTED/)
  assert.match(output, /verif/i, 'the halt must name the verification verdict as the reason')
})

test('an absent verdict field is treated as not-verified, never as a pass', async () => {
  for (const verify of [
    { ok: true },
    { ok: true, unitGreen: undefined },
    { unitGreen: true },
    { ok: true, unitGreen: false },
    { ok: false, unitGreen: true }
  ]) {
    const { output, calls } = await verifyRun(verify)
    assert.ok(
      !calls.includes('commit'),
      `${JSON.stringify(verify)} reached the commit — an absent or false verdict is not a passing verdict`
    )
    assert.match(output, /SHIP HALTED/)
  }
})

// --- lanes: one agent per lane, not per task (spec: lanes) -----------------
//
// The whole point of a lane is that N tasks forced to run in order cost ONE
// spawn prefix instead of N. That is a property of what the script dispatches,
// so it is asserted by running the script and counting the agents it actually
// asked for — a source-text check would pass on a loop that flattened lanes.

const laneTask = (id, over = {}) => ({
  id,
  description: `task ${id}`,
  tier: 2,
  model: 'sonnet',
  paths: ['lib/a.mjs'],
  ...over
})

/** The label ship.js gives a lane: its first task id, plus how many follow. */
const labelFor = lane => (lane.length === 1 ? lane[0].id : `${lane[0].id}+${lane.length - 1}`)

/** Run one wave holding exactly one lane, answered by `laneResult`. */
function runLane(lane, laneResult, extra = {}) {
  const step = stepResult({
    action: 'run-batch',
    wave: 1,
    waveIndex: 0,
    waveKind: 'impl',
    batchIndex: 0,
    batchCount: 1,
    tasks: [lane],
    remainingBatches: [[lane]],
    previousHandoffs: [],
    changed: ['lib/a.mjs'],
    maxParallel: 8
  })
  return runShip({
    responses: {
      'plan-waves': {
        ok: true,
        waveCount: 1,
        taskCount: lane.length,
        coverageOk: true,
        fingerprintWritten: true,
        ...step
      },
      [labelFor(lane)]: laneResult,
      ...extra
    }
  })
}

const laneHandoff = id => ({
  schema: 'interlock.wave-handoff/1',
  taskId: id,
  status: 'ok',
  summary: `did ${id}`,
  evidence: ['lib/a.mjs:1-2'],
  next: 'nothing',
  blocker: null
})

/** The record-batch ping's prompt, which carries the batch JSON and the tick. */
function recordPrompt(prompts) {
  const found = prompts.find(p => p.label.startsWith('record-batch-'))
  assert.ok(found, 'the run assembled no record-batch prompt')
  return found.prompt
}

/**
 * The tick ping's prompt. The tick is its own step: the loop cannot know which
 * ids to mark until the record ping has reported what the CLI recorded, so a
 * tick fused into the record ping could only ever tick what the agent claimed.
 */
function tickPrompt(prompts) {
  const found = prompts.find(p => p.label.startsWith('tick-'))
  return found ? found.prompt : null
}

/** What the record ping reports when the CLI recorded these ids as succeeded. */
const recordedOk = ids =>
  stepResult({ action: 'done' }, {}, ids.map(id => recordedOutcome(id, 'ok')))

test('a three-task lane spawns one implementer, not three', async () => {
  const lane = [laneTask('1.1'), laneTask('1.2'), laneTask('1.3')]
  const { calls, prompts } = await runLane(
    lane,
    { tasks: lane.map(t => ({ id: t.id, outcome: 'ok', handoff: laneHandoff(t.id) })) },
    { 'record-batch-': recordedOk(['1.1', '1.2', '1.3']) }
  )
  const implementers = calls.filter(c => c === labelFor(lane))
  assert.equal(implementers.length, 1, `expected one lane agent, got calls: ${calls.join(', ')}`)
  for (const id of ['1.2', '1.3']) {
    assert.ok(!calls.includes(id), `${id} must not get its own agent — it is inside the lane`)
  }
  const prompt = prompts.find(p => p.label === labelFor(lane)).prompt
  assert.match(prompt, /Implement 3 tasks from OpenSpec change "demo-change", IN THIS ORDER/)
  assert.match(tickPrompt(prompts), /--ids 1\.1,1\.2,1\.3/, 'all three succeeded, so all three tick')
})

test('a mid-lane failure ticks the earlier task and counts one failure', async () => {
  const lane = [laneTask('1.1'), laneTask('1.2'), laneTask('1.3')]
  const { output, prompts } = await runLane(
    lane,
    {
      tasks: [
        { id: '1.1', outcome: 'ok', handoff: laneHandoff('1.1') },
        { id: '1.2', outcome: 'failed', error: 'no migration runner' },
        { id: '1.3', outcome: 'not-attempted' }
      ]
    },
    {
      'record-batch-': stepResult({ action: 'done' }, {}, [
        recordedOutcome('1.1', 'ok'),
        recordedOutcome('1.2', 'failed', 'no migration runner')
      ])
    }
  )
  const prompt = recordPrompt(prompts)
  const tick = tickPrompt(prompts)
  assert.match(tick, /--ids 1\.1\b/, 'the task that succeeded is ticked')
  assert.doesNotMatch(tick, /--ids [^\n]*1\.2/, 'a failed task is never ticked')
  assert.doesNotMatch(tick, /--ids [^\n]*1\.3/, 'and neither is one nobody ran')

  const batch = /Write this JSON to \.claude\/ship\/batch-0\.json:\n(\{.*\})/.exec(prompt)
  assert.ok(batch, `the record ping carries no batch JSON:\n${prompt}`)
  const recorded = JSON.parse(batch[1])
  assert.deepEqual(
    recorded.tasks.map(t => [t.id, t.ok]),
    [['1.1', true], ['1.2', false]],
    'a not-attempted task is neither ticked nor recorded as a failure — spending the failure ' +
      'budget on the tasks sitting behind one blocker would halt a run that has one problem'
  )

  assert.match(output, /wave 1 \(run-batch\): 1 ok, 1 failed/)
  assert.match(output, /LANE STOPPED EARLY: 1\.3 not attempted/)
  assert.match(output, /SHIP HALTED|SHIP COMPLETE WITH LEFTOVERS/, 'the failure is still visible')
})

// --- claim versus recorded verdict ----------------------------------------
//
// The defect these three tests exist for: a run ticked and tallied from what
// the implementing agent CLAIMED, so five tasks the state machine failed for
// invalid handoff packets got their boxes ticked beside a halt naming them as
// failures. The claim is the input that was adjudicated, not a second opinion.

test('a claim the CLI recorded as failed is neither ticked nor counted as ok', async () => {
  const lane = [laneTask('1.1'), laneTask('1.2')]
  const { output, prompts } = await runLane(
    lane,
    // The agent claims both succeeded, with packets it believes are valid.
    { tasks: lane.map(t => ({ id: t.id, outcome: 'ok', handoff: laneHandoff(t.id) })) },
    {
      // The CLI disagrees: both packets carried a status outside the accepted
      // set, so `record-batch` failed both tasks.
      'record-batch-': stepResult({ action: 'done' }, {}, [
        recordedOutcome('1.1', 'failed', 'invalid handoff: status must be one of ok|blocked|partial'),
        recordedOutcome('1.2', 'failed', 'invalid handoff: status must be one of ok|blocked|partial')
      ])
    }
  )

  for (const p of prompts) {
    assert.doesNotMatch(
      p.prompt,
      /--ids [^\n]*1\.[12]/,
      `a task the run recorded as failed must never reach a tick:\n${p.label}`
    )
  }
  assert.equal(tickPrompt(prompts), null, 'nothing was recorded as succeeded, so nothing ticks')
  assert.match(
    output,
    /wave 1 \(run-batch\): 0 ok, 2 failed/,
    'the tally counts the recorded outcomes, not the claims'
  )
  assert.match(output, /CLAIM OVERRIDDEN: 1\.1, 1\.2/, 'overriding a claim is a finding, not a silent fix')
  const receipt = receiptFrom(prompts)
  assert.deepEqual(receipt.waves, [{ wave: 1, ok: 0, failed: 2, notAttempted: [] }])
  assert.ok(
    receipt.degradations.some(d => /CLAIM OVERRIDDEN/.test(d)),
    `the override never reached the receipt: ${JSON.stringify(receipt.degradations)}`
  )
})

test('recorded outcomes that never arrived fall back to the claim, loudly', async () => {
  const lane = [laneTask('1.1')]
  // An older CLI, or a ping that dropped the field: the run tallies from the
  // claim as it always did, and says that is what it did.
  const { output, prompts } = await runLane(
    lane,
    { id: '1.1', ok: true, handoff: laneHandoff('1.1') },
    { 'record-batch-': DONE }
  )
  assert.match(output, /wave 1 \(run-batch\): 1 ok, 0 failed/)
  assert.match(tickPrompt(prompts), /--ids 1\.1\b/)
  assert.match(output, /CLAIM-DERIVED TALLIES/, 'a silent fallback would reintroduce the defect')
})

test('a lane result with no per-task outcomes fails every task in the lane', async () => {
  const lane = [laneTask('1.1'), laneTask('1.2')]
  const { output, prompts } = await runLane(lane, { note: 'I did some things' })
  const batch = /Write this JSON to \.claude\/ship\/batch-0\.json:\n(\{.*\})/.exec(
    recordPrompt(prompts)
  )
  const recorded = JSON.parse(batch[1])
  assert.deepEqual(recorded.tasks.map(t => t.ok), [false, false])
  for (const t of recorded.tasks) {
    assert.match(t.error, /carried no per-task outcomes/)
  }
  assert.match(output, /wave 1 \(run-batch\): 0 ok, 2 failed/)
})

test('a lane result that omits one task fails all of them, closed', async () => {
  const lane = [laneTask('1.1'), laneTask('1.2')]
  const { prompts } = await runLane(lane, {
    tasks: [{ id: '1.1', outcome: 'ok', handoff: laneHandoff('1.1') }]
  })
  const prompt = recordPrompt(prompts)
  const recorded = JSON.parse(
    /Write this JSON to \.claude\/ship\/batch-0\.json:\n(\{.*\})/.exec(prompt)[1]
  )
  assert.deepEqual(recorded.tasks.map(t => t.ok), [false, false])
  assert.match(recorded.tasks[0].error, /omitted an outcome for 1\.2/)
  assert.equal(
    tickPrompt(prompts),
    null,
    'nothing may be ticked from a result nobody can trust — so there is no tick step at all'
  )
})

test('a one-task lane keeps the pre-lane label, schema and result shape', async () => {
  const lane = [laneTask('1.1')]
  const { calls, prompts } = await runLane(lane, { id: '1.1', ok: true, handoff: laneHandoff('1.1') })
  assert.ok(calls.includes('1.1'), 'the label is the bare task id, so a replay still cache-hits')
  assert.match(
    prompts.find(p => p.label === '1.1').prompt,
    /Implement exactly one task/,
    'and the prompt is the pre-lane prompt'
  )
})

test('the lane cap is stated once, read by the planner, and never restated in the script', () => {
  // Same rule as every other cap (openspec/specs/ship/cap-authority): the number
  // lives in lib/limits.mjs, the planner obeys it, `interlock limits` prints it,
  // and no prompt or script restates it.
  const waves = readFileSync(join(ROOT, 'lib', 'waves.mjs'), 'utf8')
  assert.match(
    waves,
    /LIMITS\.maxTasksPerAgent/,
    'lib/waves.mjs must read the lane cap — a cap only a test reads is a cap in prose'
  )
  const cli = readFileSync(join(ROOT, 'bin', 'interlock'), 'utf8')
  assert.match(readFileSync(join(ROOT, 'lib', 'limits.mjs'), 'utf8'), /maxTasksPerAgent:/)
  assert.match(cli, /interlock limits/, 'the CLI publishes the caps it reads')

  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.doesNotMatch(
    ship,
    /maxTasksPerAgent/,
    'the script must not carry the lane cap: it dispatches the lanes the planner built'
  )
})

// --- the step transport ----------------------------------------------------
//
// The script has no shell, so it never reads `wave-state` stdout itself: every
// step arrives transcribed by an agent into a schema. That makes the schema the
// only thing telling the agent what to copy, and makes a returned step a claim
// about a shape rather than the shape itself.
//
// Both halves of that failed once, together. The classifier's schema still
// declared the pre-lane `tasks` and never declared `remainingBatches` at all —
// an undeclared property passes validation holding anything — and the loop then
// called `.some` on what came back. A batch transcribed as a list of task ids
// is a string with a truthy `length`, so it walked past the empty-batch guard
// and threw, outside `halt`: no outcome recorded, no trajectory closed.

/** The step-shape helpers, evaluated out of their marked region in ship.js. */
const stepShape = (() => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const m = /\/\/ STEP_SHAPE_START\n([\s\S]*?)\n\/\/ STEP_SHAPE_END/.exec(text)
  assert.ok(m, 'ship.js must define the step-shape helpers between STEP_SHAPE markers')
  return new Function(`${m[1]}; return { batchesOf, dispatchableShape }`)()
})()

/** RUN_BATCH as the CLI printed it, with the authoritative stdout removed. */
function bareStep(over = {}) {
  const { cliStdout, ...step } = RUN_BATCH
  return { ...step, ...over }
}

/** A classifier result carrying a first step. */
function classified(step) {
  return { ok: true, waveCount: 1, taskCount: 1, coverageOk: true, fingerprintWritten: true, ...step }
}

test('the step task shape is stated once, not restated per schema', () => {
  // Same rule as every cap (openspec/specs/ship/cap-authority), applied to a
  // shape: two statements of one transport is how only one of them got widened
  // when batches became lanes.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const statements = text.match(/tier: \{ type: 'integer' \}/g) || []
  assert.equal(
    statements.length,
    1,
    `the task shape is written ${statements.length} times; every schema carrying a step must ` +
      `read the one statement instead`
  )
  assert.match(text, /\.\.\.STEP_FIELDS/, 'and the schemas must spread it rather than copy it')
})

test('a dispatchable step must carry batches of lanes of tasks', () => {
  const { batchesOf, dispatchableShape } = stepShape
  const lane = [{ id: '1.1' }]

  assert.equal(dispatchableShape({ action: 'run-batch', remainingBatches: [[lane]] }), true)
  assert.equal(dispatchableShape({ action: 'run-batch', tasks: [lane] }), true)
  assert.equal(dispatchableShape({ action: 'test-wave', remainingBatches: [[lane]] }), true)

  // The production failure: a batch transcribed as a list of task ids.
  assert.equal(dispatchableShape({ action: 'run-batch', remainingBatches: ['1.1', '1.2'] }), false)
  // The pre-lane shape the classifier's schema still described: one level short.
  assert.equal(dispatchableShape({ action: 'run-batch', tasks: [{ id: '1.1' }] }), false)
  assert.equal(dispatchableShape({ action: 'run-batch', remainingBatches: [[[]]] }), false)
  assert.equal(dispatchableShape({ action: 'run-batch', remainingBatches: [[[{}]]] }), false)
  assert.equal(dispatchableShape({ action: 'run-batch' }), false)
  assert.equal(dispatchableShape(null), false)

  // A step that dispatches nothing is not judged on batches it never carries.
  for (const action of ['verify', 'replan', 'done', 'halt']) {
    assert.equal(dispatchableShape({ action }), true, action)
  }

  // The check and the loop must read the same field, or one passes what the
  // other rejects.
  assert.deepEqual(batchesOf({ tasks: [lane] }), [[lane]], 'tasks is the single remaining batch')
  const two = [[lane], [[{ id: '2.1' }]]]
  assert.deepEqual(batchesOf({ remainingBatches: two, tasks: [lane] }), two)
})

test('a classifier step transcribed without stdout still carries lanes', async () => {
  const { calls } = await runShip({
    responses: { 'plan-waves': classified(stepResultNoStdout(bareStep())) }
  })
  assert.ok(
    !calls.some(c => c.startsWith('next-retry-')),
    `a well-shaped transcription needs no re-read: ${calls.join(', ')}`
  )
  assert.ok(calls.includes('1.1'), 'the wave runs from the transcription alone')
  assert.ok(calls.includes('commit'))
})

test('a batch transcribed as a list of task ids is re-read, not crashed on', async () => {
  const { calls, output } = await runShip({
    responses: {
      'plan-waves': classified(bareStep({ remainingBatches: ['1.1'], tasks: ['1.1'] })),
      // The re-read is pure — `wave-state next` again — so it comes back with
      // the CLI's own stdout and the run continues from it.
      'next-retry-': RUN_BATCH
    }
  })
  assert.ok(
    calls.some(c => c.startsWith('next-retry-')),
    `a misshapen step must trigger the one pure re-read: ${calls.join(', ')}`
  )
  assert.ok(calls.includes('1.1'), 'and the wave then runs normally')
  assert.ok(calls.includes('commit'))
  assert.doesNotMatch(output, /SHIP HALTED/)
})

test('a step that stays misshapen halts by name, with the outcome still recorded', async () => {
  const bad = bareStep({ remainingBatches: ['1.1'] })
  const { calls, output } = await runShip({
    responses: { 'plan-waves': classified(bad), 'next-retry-': bad }
  })
  assert.match(output, /SHIP HALTED — misshapen run-batch step from the state machine/)
  assert.match(output, /batches of lanes of tasks/, 'the halt names the shape that was missing')
  assert.ok(!calls.includes('1.1'), 'nothing is dispatched from a step nobody could read')
  assert.ok(
    calls.includes('record-outcome'),
    'the throw skipped this; a halt writes the corpus line on the way out'
  )
})

// --- plan reuse (spec: plan-reuse) -----------------------------------------
//
// The classifier is the most expensive fixed step in a run. Reuse is only
// correct when a match was affirmatively established, and the run has to say
// which path it took either way — a run that silently changed its own cost is
// the failure the banner block exists to remove.

test('a matching fingerprint skips the classifier entirely', async () => {
  const { calls, output } = await runShip({ responses: { 'plan-reuse': reuseAdopted() } })
  assert.ok(calls.includes('plan-reuse'), 'the reuse check always runs')
  assert.ok(
    !calls.includes('plan-waves'),
    `the classifier must not run when the plan was reused: ${calls.join(', ')}`
  )
  assert.match(output, /PLAN REUSED \(match\)/)
  assert.ok(calls.includes('commit'), 'and the run still finishes')
})

test('the reuse probe asks the CLI and never decides for itself', async () => {
  const { prompts } = await runShip({})
  const probe = prompts.find(p => p.label === 'plan-reuse')
  assert.ok(probe, 'ship.js assembled no plan-reuse prompt')
  assert.match(probe.prompt, /interlock plan reuse --change demo-change/)
  assert.match(probe.prompt, /never infer reuse:true from a plan file existing/)
  assert.match(probe.prompt, /If reuse is false, or noRemainingWork is true, STOP THERE/)
})

test('every non-match rebuilds, and the summary names which non-match it was', async () => {
  const cases = [
    ['no-plan', 'no stored plan at .claude/ship/plan.json'],
    ['unreadable-plan', 'the stored plan at .claude/ship/plan.json could not be read: bad JSON'],
    ['unreadable-fingerprint', 'the stored fingerprint carries no hash'],
    ['inputs-changed', "the change's artifacts have been edited since the plan was built"],
    ['plan-format-changed', 'the stored plan was written for another plan format'],
    ['check-failed', 'the reuse check itself failed: EACCES']
  ]
  for (const [status, reason] of cases) {
    const { calls, output } = await runShip({
      responses: { 'plan-reuse': reuseRebuilt({ reuseStatus: status, reason }) }
    })
    assert.ok(calls.includes('plan-waves'), `${status} must fall back to the classifier`)
    assert.match(output, new RegExp(`PLAN REBUILT \\(${status}\\)`), status)
    assert.ok(output.includes(reason), `the reason must be reported verbatim for ${status}`)
  }
})

test('a probe that returns nothing at all rebuilds rather than reusing', async () => {
  const { calls, output } = await runShip({ responses: { 'plan-reuse': null } })
  assert.ok(calls.includes('plan-waves'))
  assert.match(output, /PLAN REBUILT \(check-failed\)/)
})

test('a probe claiming a match without producing a step is not a reuse', async () => {
  // `reuse: true` with no adopted step means the plan was never turned into run
  // state. Trusting the claim would start a wave loop with no state file.
  const { calls, output } = await runShip({
    responses: { 'plan-reuse': { reuse: true, reuseStatus: 'match', reason: 'matched' } }
  })
  assert.ok(calls.includes('plan-waves'), 'it falls back to the classifier')
  assert.match(output, /PLAN REBUILT \(adopt-failed\)/)
  assert.match(output, /could not be turned into a run state/)
})

test('an all-complete plan reports no remaining work instead of an empty run', async () => {
  const { calls, output } = await runShip({
    responses: { 'plan-reuse': reuseAdopted(DONE, { noRemainingWork: true }) }
  })
  assert.match(output, /NO REMAINING WORK: every task in the stored plan is already complete/)
  assert.ok(!calls.includes('plan-waves'), 'nothing to classify')
  assert.ok(!calls.includes('commit'), 'and nothing to commit — no work was dispatched')
  assert.ok(calls.includes('record-outcome'), 'the run still records its outcome')
})

test('the classifier stores the fingerprint, and says so when it could not', async () => {
  const { prompts } = await runShip({})
  const planner = prompts.find(p => p.label === 'plan-waves')
  assert.match(planner.prompt, /interlock plan fingerprint --change demo-change --write/)
  assert.match(planner.prompt, /Report its "written" value as fingerprintWritten/)

  const { output } = await runShip({
    responses: {
      'plan-waves': {
        ok: true,
        waveCount: 1,
        taskCount: 1,
        coverageOk: true,
        fingerprintWritten: false,
        ...RUN_BATCH
      }
    }
  })
  assert.match(output, /PLAN FINGERPRINT NOT STORED/)
})

test('a run that halts before the reuse check says the plan path is unknown', async () => {
  const { output } = await runShip({ responses: { validate: { ok: false, detail: 'nope' } } })
  assert.match(output, /SHIP HALTED/)
  assert.match(
    output,
    /PLAN UNKNOWN: the run ended before the plan-reuse check reported/,
    '"we never found out" and "there was no prior plan" are different facts'
  )
})

// --- the degradation block, derived rather than accumulated ----------------

test('a clean run says so, and says it from the recorded conditions', async () => {
  const { output } = await runShip({})
  assert.match(output, /No degradation banners/)
})

test('a cap-exhausted verification is named in the degradation block', async () => {
  const { output } = await runShip({
    responses: {
      'record-outcome': {
        ok: true,
        reconstructable: true,
        capExhaustedVerifications: 1,
        skippedVerificationReasons: ['verify-cap-reached']
      }
    }
  })
  assert.doesNotMatch(
    output,
    /No degradation banners/,
    'a run that skipped a checkpoint must not report itself as clean'
  )
  assert.match(output, /verify-cap-reached/)
})

test('unresolved errors carried past a wave are named', async () => {
  const { output } = await runShip({
    responses: {
      'record-outcome': { ok: true, reconstructable: true, unresolvedErrors: 2 }
    }
  })
  assert.doesNotMatch(output, /No degradation banners/)
  assert.match(output, /unresolved/i)
})

test('a missing closing outcome is named as unknown, not treated as clean', async () => {
  const { output } = await runShip({ responses: { 'record-outcome': null } })
  assert.doesNotMatch(output, /No degradation banners/)
  assert.match(output, /UNKNOWN|unknown/)
})

test('a failed task tick is surfaced rather than discarded', async () => {
  const { output } = await runShip({
    responses: {
      'tick-': { ok: true, tickFailed: true, tickMissing: ['1.1'] }
    }
  })
  assert.doesNotMatch(output, /No degradation banners/)
  assert.match(output, /1\.1/)
})

// --- task shape for ship --------------------------------------------------
//
// `tasks.md` is the wave plan, so the rules that keep it wave-shaped are a
// contract across three surfaces: the Interlock spec skill (which applies even
// when a consumer repo's config.yaml is empty), this repo's own
// `openspec/config.yaml` task rules (which the OpenSpec CLI injects into stock
// propose), and the classifier prompt that reads whatever tasks.md ended up
// saying. A rule surviving on only one of them has already started drifting.
//
// The stock OpenSpec propose skill is deliberately not asserted on: it is
// OpenSpec's generic artifact writer, it has no waves, and a fork of it here
// would not ship with the Interlock plugin anyway.

const SPEC_SKILL = join(ROOT, 'skills', 'spec', 'SKILL.md')
const OPENSPEC_CONFIG = join(ROOT, 'openspec', 'config.yaml')

/** The `rules: tasks:` list items from openspec/config.yaml, as raw strings. */
function configTaskRules() {
  const lines = readFileSync(OPENSPEC_CONFIG, 'utf8').split('\n')
  const start = lines.findIndex(l => /^\s{2,}tasks:\s*$/.test(l))
  if (start === -1) return []
  const out = []
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+-\s+(.+)$/.exec(line)
    if (!item) break
    out.push(item[1].trim())
  }
  return out
}

test('skills/spec states the ship task shape, including the same-file rule', () => {
  const text = readFileSync(SPEC_SKILL, 'utf8')
  assert.match(
    text,
    /^#+ Task shape for ship\s*$/m,
    'skills/spec/SKILL.md omitted the "Task shape for ship" heading — that section is what ' +
      'carries these rules when a consumer repo\'s config.yaml injects nothing'
  )
  assert.match(
    text,
    /sequential same-file work is one checkbox/i,
    'skills/spec/SKILL.md omitted "sequential same-file work is one checkbox"'
  )
  assert.match(
    text,
    /section is one wave/i,
    'skills/spec/SKILL.md omitted the rule that a numbered section is one wave'
  )
})

test('openspec/config.yaml task rules carry the same three sentences', () => {
  const rules = configTaskRules()
  assert.ok(
    rules.length >= 3,
    `openspec/config.yaml declares no rules.tasks list (found ${rules.length} item(s)) — ` +
      `openspec instructions tasks is what injects them for this repo`
  )
  const joined = rules.join('\n')
  assert.match(
    joined,
    /sequential same-file work is one checkbox/i,
    'openspec/config.yaml task rules omitted "sequential same-file work is one checkbox"'
  )
  assert.match(joined, /numbered section/i, 'the default-grouping rule is missing')
  assert.match(
    joined,
    /needs the previous section's output to already exist/i,
    'the output-exists boundary rule is missing'
  )
})

test('the assembled plan-waves prompt does not increment group for a later same-file slice', async () => {
  // Asserted on the assembled string rather than the source bytes: a
  // concatenation defect drops an instruction out of the prompt and leaves the
  // sentence intact in the file, where a grep passes on the broken script.
  const { prompts } = await runShip({})
  const found = prompts.find(p => p.label === 'plan-waves')
  assert.ok(found, 'ship.js assembled no prompt labelled "plan-waves"')
  const prompt = found.prompt

  assert.match(
    prompt,
    /LATER NUMBERED SECTION that needs an earlier section's output/,
    `the classifier is not told that a new group is only a later numbered section.\n` +
      `Assembled prompt:\n${prompt}`
  )
  assert.match(
    prompt,
    /next sequential slice of the same file is NOT a new group/i,
    `the classifier is not told to keep sequential same-file slices in one group.\n` +
      `Assembled prompt:\n${prompt}`
  )
  assert.doesNotMatch(
    prompt,
    /add a group when a later task needs an earlier task's output/i,
    'the old task-scoped wording is what let the model mint a group per sequential slice'
  )
})

// --- the run receipt (spec: ship-run) ---------------------------------------
//
// The receipt is the run's own account of itself, and the only reason it can be
// trusted is that nothing re-derives it: the fields come from the `summary` the
// run already accumulated, the degradation list is the one the banner printed,
// and `lib/run-log.mjs` copies the whole thing by name. So these tests assert
// the two properties an agent in the transport path cannot protect — that the
// payload is built at all, on every exit, and that it says the same thing the
// printed summary does.

test('every exit path appends a receipt after closing the run', async () => {
  const exits = {
    'a clean run': {},
    '--apply-only': { args: 'demo-change --apply-only' },
    '--no-commit': { args: 'demo-change --no-commit' },
    'a halt': { responses: { verify: { ok: false, unitGreen: false } } },
    'nothing left to do': { responses: { 'plan-reuse': reuseAdopted(RUN_BATCH, { noRemainingWork: true }) } }
  }
  for (const [name, run] of Object.entries(exits)) {
    const { calls } = await runShip(run)
    assert.ok(calls.includes('record-receipt'), `${name} closed without a receipt`)
    assert.ok(
      calls.indexOf('record-outcome') < calls.indexOf('record-receipt'),
      `${name} built its receipt before the closing step reported — the skip reasons, cap ` +
        `exhaustion and unresolved-error counts are not complete until then`
    )
    assert.equal(
      calls.filter(c => c === 'record-receipt').length,
      1,
      `${name} appended more than one receipt — a run has one close`
    )
  }
})

test('the receipt carries the tallies, the plan verdict and the commit the summary printed', async () => {
  const { prompts, output } = await runShip({})
  const receipt = receiptFrom(prompts)
  assert.ok(receipt, 'no receipt payload reached the record-receipt prompt')

  assert.equal(receipt.type, 'run-receipt')
  assert.equal(receipt.change, 'demo-change')
  assert.deepEqual(receipt.waves, [{ wave: 1, ok: 1, failed: 0, notAttempted: [] }])
  assert.match(output, /wave 1 \(run-batch\): 1 ok, 0 failed/)
  assert.equal(receipt.planReused, false, 'the default run rebuilds — and says which')
  assert.equal(receipt.planStatus, 'no-plan')
  assert.equal(receipt.halted, false)
  assert.equal(receipt.committed, true)
  assert.equal(receipt.commit, 'deadbee')
  assert.match(output, /commit: deadbee/)
  assert.deepEqual(receipt.leftoverTaskIds, [])
})

test('the receipt carries the plan fingerprint hash and never the plan', async () => {
  const { prompts } = await runShip({})
  const receipt = receiptFrom(prompts)
  assert.equal(receipt.planFingerprint, 'a'.repeat(64))
  assert.equal(receipt.plan, undefined, 'plan identity travels as a hash, not as 46 KB of plan')

  const closing = prompts.find(p => p.label === 'record-outcome').prompt
  assert.match(closing, /plan-fingerprint\.json/)
  assert.match(closing, /Report the hash only — never the plan's contents/)
})

test('the printed degradation banners and the receipt are the same list', async () => {
  // Computed once and used twice (design.md — Decision 3). Two derivations
  // could only agree by luck, and a banner disagreeing with the record is the
  // same class of defect one level up from the one degradationLines() removes.
  const { prompts, output } = await runShip({
    responses: {
      validate: { ok: true, change: 'demo-change', hasGraph: false, hasTestProfile: false, haikuAvailable: true },
      'record-outcome': {
        ok: true,
        reconstructable: true,
        skippedVerificationReasons: ['docs-only-wave'],
        capExhaustedVerifications: 2,
        unresolvedErrors: 1,
        planFingerprint: 'b'.repeat(64)
      }
    }
  })
  const receipt = receiptFrom(prompts)
  assert.ok(receipt.degradations.length >= 4, `too few degradations: ${JSON.stringify(receipt.degradations)}`)

  for (const line of receipt.degradations) {
    assert.ok(
      output.includes(line),
      `the receipt carries a degradation the summary never printed:\n${line}\n\nSummary:\n${output}`
    )
  }
  // And the counts behind them come from the same closing result.
  assert.equal(receipt.skippedVerifications, 1)
  assert.equal(receipt.capExhaustedVerifications, 2)
  assert.equal(receipt.unresolvedErrors, 1)
  assert.match(output, /VERIFY CAP EXHAUSTED: 2/)
  assert.match(output, /UNRESOLVED ERRORS CARRIED PAST A WAVE: 1/)
})

test('a clean run reports no degradations in the receipt and none in the banner', async () => {
  const { prompts, output } = await runShip({})
  assert.deepEqual(receiptFrom(prompts).degradations, [])
  assert.match(output, /No degradation banners/)
})

test('a halted run records a receipt naming the halt and every task left behind', async () => {
  // The spec's scenario: a halt partway through the second wave with two tasks
  // unticked. A halted run is the most informative record in the corpus, so it
  // must not be the one that skips its receipt.
  const waveTwo = [laneTask('2.1'), laneTask('2.2')]
  // Counted across labels, not within one: each loop step gets its own
  // `record-batch-N` label, so a per-label counter would answer "wave 2" every
  // time and the loop would never leave it.
  let records = 0
  const { prompts, output } = await runShip({
    responses: {
      'record-batch-': () =>
        ++records === 1
          ? stepResult({
              action: 'run-batch',
              wave: 2,
              waveIndex: 1,
              waveKind: 'impl',
              batchIndex: 0,
              batchCount: 1,
              tasks: [waveTwo],
              remainingBatches: [[waveTwo]],
              previousHandoffs: [],
              changed: ['lib/a.mjs'],
              maxParallel: 8
            })
          : DONE,
      [labelFor(waveTwo)]: {
        tasks: [
          { id: '2.1', outcome: 'failed', error: 'no migration runner' },
          { id: '2.2', outcome: 'failed', error: 'no migration runner' }
        ]
      },
      verify: { ok: false, unitGreen: false }
    }
  })

  const receipt = receiptFrom(prompts)
  assert.equal(receipt.halted, true)
  assert.ok(receipt.haltReason, 'a halted receipt with no reason is the record nobody can use')
  assert.match(output, new RegExp(`SHIP HALTED — ${receipt.haltReason.slice(0, 20)}`))
  assert.deepEqual(receipt.leftoverTaskIds, ['2.1', '2.2'])
  assert.deepEqual(receipt.waves.map(w => [w.wave, w.ok, w.failed]), [[1, 1, 0], [2, 0, 2]])
  assert.equal(receipt.commit, undefined, 'a halted run has no commit identifier to carry')
  assert.equal(
    receipt.committed,
    undefined,
    'and it never found out whether it would have committed — which is not the same as declining to'
  )
})

// --- what a halt left behind ------------------------------------------------
//
// Found by running the thing (tasks.md 7.3), not by reading it: a real halt at
// verification produced a receipt with `leftoverTaskIds: []` while three boxes
// sat unchecked in tasks.md. Leftovers had been derived from the failure list,
// and a wave the halt stopped from ever running has no failures in it — so the
// receipt of the run that most needed to say what it dropped said nothing.

test('a halt names every unchecked task, not only the ones that failed', async () => {
  // 2.1 and 2.2 failed; 3.1 never ran. All three are still unchecked, and all
  // three are what a later reader has to be told.
  const waveTwo = [laneTask('2.1'), laneTask('2.2')]
  let records = 0
  const { prompts, output } = await runShip({
    responses: {
      'record-batch-': () =>
        ++records === 1
          ? stepResult({
              action: 'run-batch',
              wave: 2,
              waveIndex: 1,
              waveKind: 'impl',
              batchIndex: 0,
              batchCount: 1,
              tasks: [waveTwo],
              remainingBatches: [[waveTwo]],
              previousHandoffs: [],
              changed: ['lib/a.mjs'],
              maxParallel: 8
            })
          : DONE,
      [labelFor(waveTwo)]: {
        tasks: [
          { id: '2.1', outcome: 'failed', error: 'no migration runner' },
          { id: '2.2', outcome: 'failed', error: 'no migration runner' }
        ]
      },
      verify: { ok: false, unitGreen: false },
      'record-outcome': {
        ok: true,
        reconstructable: true,
        leftoverTaskIds: ['2.1', '2.2', '3.1']
      }
    }
  })

  const receipt = receiptFrom(prompts)
  assert.equal(receipt.halted, true)
  assert.deepEqual(
    receipt.leftoverTaskIds,
    ['2.1', '2.2', '3.1'],
    'a task the halt stopped from running is left behind exactly as much as one that failed'
  )
  // And the banner a human reads is the same list, not the failure subset.
  assert.match(output, /3\.1/)
})

test('an unread checkbox leaves leftovers as what the run does know, never as none', async () => {
  // The closing step could not read tasks.md, so it left the field out. The
  // fallback is the failure list — smaller than the truth, but observed. What
  // it must never become is `[]`, which would read as "finished everything".
  const waveTwo = [laneTask('2.1')]
  let records = 0
  const { prompts } = await runShip({
    responses: {
      'record-batch-': () =>
        ++records === 1
          ? stepResult({
              action: 'run-batch',
              wave: 2,
              waveIndex: 1,
              waveKind: 'impl',
              batchIndex: 0,
              batchCount: 1,
              tasks: [waveTwo],
              remainingBatches: [[waveTwo]],
              previousHandoffs: [],
              changed: ['lib/a.mjs'],
              maxParallel: 8
            })
          : DONE,
      [labelFor(waveTwo)]: { id: '2.1', ok: false, error: 'no migration runner', handoff: null },
      verify: { ok: false, unitGreen: false },
      'record-outcome': { ok: true, reconstructable: true }
    }
  })

  assert.deepEqual(receiptFrom(prompts).leftoverTaskIds, ['2.1'])
})

test('the closing step reads unchecked ids from the CLI rather than deriving them', async () => {
  const { prompts } = await runShip({})
  const prompt = prompts.find(p => p.label === 'record-outcome').prompt

  assert.match(prompt, /interlock validate --change demo-change --json/)
  assert.match(prompt, /every "id" from its tasks\.items whose "done" is false/)
  assert.match(
    prompt,
    /Do not derive them from tasks\.md yourself/,
    'the checkbox is the CLI\'s to read — an agent counting boxes is an agent that can miscount'
  )
  assert.match(
    prompt,
    /omitted means unknown, and unknown must never be reported as an empty list/,
    'an empty list claims the run finished everything'
  )
})

test('--no-commit and --apply-only record "did not commit", not "never found out"', async () => {
  for (const args of ['demo-change --no-commit', 'demo-change --apply-only']) {
    const { prompts } = await runShip({ args })
    const receipt = receiptFrom(prompts)
    assert.equal(receipt.committed, false, `${args}: the run chose not to commit and must say so`)
    assert.equal(receipt.commit, undefined, `${args}: and carries no identifier`)
    assert.equal(receipt.halted, false, `${args}: an early return is not a halt`)
  }
})

test('a run that never reviewed reports no review counts rather than zero blockers', async () => {
  const lean = receiptFrom((await runShip({})).prompts)
  assert.equal(lean.reviewBlockers, undefined, 'a lean run never reviewed — 0 blockers would be a lie')
  assert.equal(lean.reviewRaised, undefined)

  const strict = receiptFrom((await runShip({ args: 'demo-change --strict' })).prompts)
  assert.equal(strict.reviewRaised, 2)
  assert.equal(strict.reviewSurviving, 1)
  assert.equal(strict.reviewBlockers, 0)
  assert.equal(strict.reviewWarnings, 1, 'surviving minus blockers, from two counts that were observed')
})

test('the receipt prompt asks for verbatim transport and invites no correction', async () => {
  const { prompts } = await runShip({})
  const prompt = prompts.find(p => p.label === 'record-receipt').prompt

  assert.match(prompt, /exactly as given, byte for byte/)
  assert.match(prompt, /Do not adjust, correct, re-derive, reorder or add to any field/)
  assert.match(prompt, /interlock run-log append --event \.claude\/ship\/run-receipt\.json/)
  assert.match(prompt, /never fails a run/, 'losing the receipt must not fail the run that earned it')
  // The closing prompt's own invitation to correct fields is right for an
  // outcome record the agent observed and wrong for a payload the run measured.
  assert.doesNotMatch(prompt, /Correct any field/)
  assert.doesNotMatch(prompt, /starting point/)
})

test('the receipt payload survives assembly with no coercion artifacts', async () => {
  const { prompts } = await runShip({})
  const prompt = prompts.find(p => p.label === 'record-receipt').prompt
  assert.deepEqual(
    coercionArtifacts(prompt.replace(/\{"type":"run-receipt".*?\}\n\n/s, '')),
    [],
    'the record-receipt prompt lost an interpolation somewhere'
  )
})

test('the ACP driver writes the same receipt from ship.js own builder', async () => {
  // A second implementation of "what the run observed" is drift a reader could
  // never see: both hosts would look correct and their trajectories would not
  // agree. So the driver evaluates the marked block instead of copying it.
  const driver = readFileSync(ACP_DRIVER, 'utf8')
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /\/\/ BUILD_RECEIPT_START/, 'ship.js must mark its receipt builder')
  assert.match(driver, /BUILD_RECEIPT_START/)
  assert.match(driver, /buildReceipt\(\{/)
  for (const copied of [/reviewBlockers:/, /capExhaustedVerifications:\s*closing/, /planReused:/]) {
    assert.doesNotMatch(driver, copied, `the ACP driver copies receipt fields: ${copied}`)
  }
  // And it appends the event itself — no agent in the path.
  assert.match(driver, /'run-log',\s*\n\s*'append',\s*\n\s*'--event',\s*\n\s*write\(workPath\('run-receipt\.json'\)/)
})

test('the ACP driver ticks and tallies from what the CLI recorded, from ship.js own block', async () => {
  // The defect was in both hosts because both computed "what succeeded" from
  // the agent's `ok` field. Fixing it in one and copying the rule into the
  // other would leave two implementations of which observation is the run's.
  const driver = readFileSync(ACP_DRIVER, 'utf8')
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /\/\/ RECORDED_VERDICT_START/, 'ship.js must mark the adjudication')
  assert.match(driver, /RECORDED_VERDICT_START/)
  assert.match(driver, /adjudicateBatches\(accumulated, verdictMissing \? null : verdicts\)/)
  assert.match(driver, /verdict\.tickIds\.join\(','\)/)
  assert.doesNotMatch(
    driver,
    /accumulated\.flat\(\)\.filter\(r => r\.ok\)/,
    'the tick list must not be rebuilt from the agents own claims'
  )
  assert.doesNotMatch(
    driver,
    /ok: reported\.filter\(r => r\.ok\)\.length/,
    'and neither must the per-wave tally'
  )

  const m = /\/\/ RECORDED_VERDICT_START\n([\s\S]*?)\n\/\/ RECORDED_VERDICT_END/.exec(text)
  const api = new Function(
    `${m[1]}; return { recordedOutcomes, adjudicateBatches, claimDerivedBanner }`
  )()
  const claims = [[{ id: '1.1', ok: true }, { id: '1.2', ok: true }]]
  const verdict = api.adjudicateBatches(
    claims,
    api.recordedOutcomes({
      recorded: [{ id: '1.1', outcome: 'failed', reason: 'invalid handoff' }, { id: '1.2', outcome: 'ok' }]
    })
  )
  assert.deepEqual(verdict.tickIds, ['1.2'])
  assert.deepEqual(verdict.waves, [{ ok: 1, failed: 1, failedIds: ['1.1'], recordedNotAttempted: [] }])
  assert.equal(verdict.claimDerived, false)
  assert.deepEqual(verdict.overrides.map(o => o.id), ['1.1'])

  // A payload covering only some of the claims is no payload: tallying the rest
  // from the claim while reading as recorded is the same defect one level down.
  const partial = api.adjudicateBatches(claims, api.recordedOutcomes({ recorded: [{ id: '1.1', outcome: 'ok' }] }))
  assert.equal(partial.claimDerived, true)
  assert.match(api.claimDerivedBanner(), /CLAIM-DERIVED TALLIES/)
})

test('the ACP driver asks the CLI what is unchecked instead of listing failures', async () => {
  // Same rule as the workflow host, reached without an agent: this driver can
  // run the CLI itself. What both must not do is call the failure list the
  // leftover list — a halt leaves waves that never ran and never failed.
  const driver = readFileSync(ACP_DRIVER, 'utf8')
  assert.match(driver, /async function unticked\(\)/)
  assert.match(driver, /'validate',\s*'--change',\s*resolvedChange/)
  assert.match(driver, /items\.filter\(t => t && !t\.done/)
  assert.match(driver, /if \(!Array\.isArray\(items\)\) return null/, 'unreadable is unknown, not none')
  assert.doesNotMatch(
    driver,
    /leftoverTaskIds: summary\.waves\.flatMap/,
    'the failure list is not the leftover list'
  )
})

test('the ACP driver receipt builder loads and produces the whitelisted shape', async () => {
  // Evaluated the way the driver evaluates it, so a marker block that no longer
  // stands alone fails here rather than at the end of somebody's ship run.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const m = /\/\/ BUILD_RECEIPT_START\n([\s\S]*?)\n\/\/ BUILD_RECEIPT_END/.exec(text)
  assert.ok(m, 'ship.js must define buildReceipt between BUILD_RECEIPT markers')
  const build = new Function('input', `${m[1]}; return buildReceipt(input)`)

  const empty = build({})
  assert.equal(empty.type, 'run-receipt')
  assert.equal(empty.halted, false)
  assert.deepEqual(empty.waves, [])
  assert.equal(empty.committed, undefined, 'an empty summary never found out anything')

  const filled = build({
    change: 'add-widget',
    summary: {
      waves: [{ wave: 2, ok: 1, failed: 1, notAttempted: ['2.3'], handoffs: ['SECRET'] }],
      plan: { reused: true, status: 'match', reason: 'still matches' },
      review: { raised: 3, surviving: 2, blockers: 1, findings: ['SECRET'] },
      remediationRounds: 1,
      closing: { skippedVerificationReasons: ['docs-only-wave'], capExhaustedVerifications: 0, unresolvedErrors: 2 },
      commit: { ok: true, sha: 'cafe123' },
      halted: null
    },
    degradations: ['VERIFICATION SKIPPED: reason=docs-only-wave'],
    planFingerprint: 'd'.repeat(64),
    leftoverTaskIds: ['2.2']
  })
  assert.equal(filled.planReused, true)
  assert.equal(filled.reviewWarnings, 1)
  assert.equal(filled.skippedVerifications, 1)
  assert.equal(filled.unresolvedErrors, 2)
  assert.equal(filled.committed, true)
  assert.equal(filled.commit, 'cafe123')
  assert.deepEqual(Object.keys(filled.waves[0]).sort(), ['failed', 'notAttempted', 'ok', 'wave'])
  assert.doesNotMatch(JSON.stringify(filled), /SECRET/)
})
