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

test('ship.js classifier prompt forbids collision-as-group', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /Default group to the numbered tasks\.md section/)
  assert.match(text, /shared file is NOT a reason for a new group/)
  assert.match(text, /needs an earlier task's output to already exist/)
})

test('ship.js fuses verify plan into the record-batch ping', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /remainingBatches/)
  assert.match(text, /verify plan --no-profile --context inter-wave/)
  assert.match(text, /If that last stdout has action:"verify"/)
  assert.match(text, /pingExtra\.model = 'haiku'/)
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
    /agent\(\s*\n?\s*assembleImplementerPrompt\(\{ change, task, previousHandoffs \}\)/,
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
  // handoff dropped there is a handoff the CLI never sees.
  assert.match(text, /ok: Boolean\(r\.ok\), error: r\.error, handoff: r\.handoff/)
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
  assert.match(driver, /assembleImplementerPrompt\(\{ change, task, previousHandoffs \}\)/)
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
const { runShip, stepResult } = await import('./helpers/ship-harness.mjs')

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
      'record-batch-': stepResult({ action: 'done' }, { tickFailed: true, tickMissing: ['1.1'] })
    }
  })
  assert.doesNotMatch(output, /No degradation banners/)
  assert.match(output, /1\.1/)
})
