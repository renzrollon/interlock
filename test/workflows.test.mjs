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
import { readFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { laneEffort as laneEffortSource } from '../lib/waves.mjs'

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

test('the degradation banner strings are kept verbatim, at whichever party raises them', () => {
  // Users are told to look for these in docs/04-when-it-stops.md. They are a
  // contract, and a reworded banner is a banner nobody greps for.
  //
  // Which party raises which is now the interesting half. A banner about the
  // HOST's environment can only be raised by the host; a banner about the run's
  // own decisions is the CLI's, and a host restating one would be two sources
  // for one string. So each is pinned where it is raised, and nowhere else.
  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')

  for (const banner of [
    'GRAPH UNAVAILABLE:',
    'NO TEST PROFILE:',
    'MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL='
  ]) {
    assert.ok(ship.includes(banner), `the host no longer emits the "${banner}" banner`)
    assert.ok(!run.includes(banner), `lib/run.mjs restates the host's "${banner}" banner`)
  }
  for (const banner of ['VERIFICATION SKIPPED: reason=', 'E2E FAILED (non-blocking by policy):']) {
    assert.ok(run.includes(banner), `the run program no longer emits the "${banner}" banner`)
    assert.ok(!ship.includes(banner), `ship.js restates the CLI's "${banner}" banner`)
  }
})

test('the summary prints a banner block even when nothing degraded', () => {
  // Silence is the failure mode the block exists to remove: a summary with no
  // banner section is indistinguishable from a run that degraded and hid it.
  const receipt = readFileSync(join(ROOT, 'lib', 'receipt.mjs'), 'utf8')
  assert.match(receipt, /No degradation banners/)
  // And the host prints what the close returned rather than composing a second
  // summary of its own — two formatters of one set of facts is how a run comes
  // to be described two ways.
  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.doesNotMatch(ship, /No degradation banners/)
  assert.match(ship, /closed\.summary/, 'the host prints the summary the close built')
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

test('a halt records an outcome and a receipt, on both drivers', () => {
  // A corpus of only successful runs cannot answer the question it exists for,
  // and a halted run is its most informative record. The close is one sequence —
  // receipt, terminal event, outcome — and a halt goes through it rather than
  // recording on its own.
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), join(ROOT, 'bin', 'interlock-run')]) {
    const text = readFileSync(driver, 'utf8')
    const stopBody = /async function stop\(reason\)[\s\S]*?\n}/.exec(text)
    assert.ok(stopBody, `${driver} no longer has a recognizable stop()`)
    assert.match(
      stopBody[0],
      /'run', 'close', '--halt', reason/,
      'a halt must close through the CLI, not by printing and exiting'
    )
  }
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /appendOutcome\(root, \{/, 'the close records the outcome')
  assert.match(run, /\.\.\.receipt,\n\s*runId: manifest\.runId/, 'and the receipt')
  assert.match(
    run,
    /type: haltReason \? 'run-halt' : 'run-complete'/,
    'and a terminal event on both paths, not only the clean one'
  )
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

test('the receipt never assumes a field it did not observe', () => {
  // Guessing is how a corpus becomes confidently wrong. Nothing is asked of an
  // agent any more — the receipt is built from what the run recorded — so the
  // rule is asserted at the builder, where an absent field becomes `null` and
  // `null` reads as unknown.
  const receipt = readFileSync(join(ROOT, 'lib', 'receipt.mjs'), 'utf8')
  assert.match(receipt, /Every field is either observed or `undefined`/)
  assert.match(receipt, /substitutes[\s\S]{0,60}zero for a value the run never found out/)
  // The tri-state that makes the rule load-bearing: told-not-to-commit is false,
  // halted-before-commit is unknown, and those are different facts.
  assert.match(
    receipt,
    /committed: commit \? commit\.ok === true : summary\.commitSkipped === true \? false : undefined/
  )
})

test('recording a batch, a verification or a replan yields the next step in one call', () => {
  // This used to be `--write-state` on three `wave-state` commands, so a ping
  // could record and learn the next action in one agent turn. The run program
  // does it in-process: it records, writes the state, and returns the decorated
  // next step — one CLI call, no agent turn at all.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  for (const [recorder, fn] of [
    ['record-batch', 'recordBatchResult'],
    ['record-verify', 'recordVerifyResult'],
    ['replan', 'applyReplan']
  ]) {
    assert.match(run, new RegExp(`\\b${fn}\\(`), `lib/run.mjs no longer calls ${fn} for ${recorder}`)
  }
  // Every one of the three ends the same way: write the state, then decorate.
  assert.equal(
    (run.match(/writeState\(root, after\)/g) || []).length,
    3,
    'each recorder must persist the state it produced'
  )
  assert.match(run, /decorate\(ctx, nextRaw, manifest/, 'and return the next step from it')
})

test('the classifier briefing forbids collision-as-group, and no driver restates it', () => {
  const planner = readFileSync(join(ROOT, 'lib', 'prompts', 'planner.mjs'), 'utf8')
  assert.match(planner, /Default group to the numbered tasks\.md section/)
  assert.match(planner, /shared file is NOT a reason for a new group/)
  assert.match(planner, /LATER NUMBERED SECTION/)
  // The whole point of moving it: there is one statement of the rule, and the
  // cross-driver parity test that used to compare two is gone because there is
  // nothing left to compare.
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), join(ROOT, 'bin', 'interlock-run')]) {
    assert.doesNotMatch(
      readFileSync(driver, 'utf8'),
      /shared file is NOT a reason for a new group/,
      `${driver} carries a second copy of the grouping rules`
    )
  }
})

test('the CLI plans the verification itself, so no ping has to fuse it in', () => {
  // The fusion existed because a verification cost an extra agent turn: the
  // record-batch ping was asked to run `verify plan` in the same turn. The CLI
  // plans it in-process now, and the agent is handed the planned steps — so the
  // saving is structural and the instruction that arranged it is gone.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /planVerification\(profile, opts\)/, 'the CLI builds the plan')
  assert.match(run, /judgeVerification\(plan, reportedSteps, \{ context \}\)/, 'and renders the verdict')
  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.doesNotMatch(ship, /verify plan --no-profile/, 'no host asks an agent to plan a verification')
  assert.doesNotMatch(ship, /If that last stdout has action:"verify"/)
})

test('every spawn carries both a type and a tools allowlist', () => {
  // Dual-write `type` (plugin agent) and `tools` (allowlist) so a runtime that
  // ignores one key still shrinks the inherited catalog. The step names both
  // now, from `lib/host.mjs`'s own constants — the four literals the script used
  // to restate are down to the ping's, which is the only agent it spawns on its
  // own account.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /\.\.\.spawnPrefix\(kind === 'ping' \? 'ping' : 'worker'\)/)
  assert.doesNotMatch(run, /tools:\s*\[[^\]]*(Skill|Agent)/)

  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(ship, /type: PING_AGENT/)
  assert.match(ship, /tools: PING_TOOLS/)
  // And the worker spawn passes through what the step named rather than
  // substituting a catalog of its own.
  assert.match(ship, /type: s\.type,\n\s*tools: s\.tools,/)
  assert.doesNotMatch(ship, /tools:\s*\[[^\]]*(Skill|Agent)/)
})

test('implementers follow tool economy and stop on green for tier 1-2', () => {
  const text = readFileSync(join(ROOT, 'lib', 'prompts', 'implementer.mjs'), 'utf8')
  assert.match(text, /interlock-graph query/, 'implementers must locate via the graph before grep')
  assert.match(text, /Do not re-read/, 'implementers must not re-read a file unless it changed')
  assert.match(text, /schema only/, 'implementers must return the schema only')
  assert.match(text, /tier is 1 or 2/, 'tier 1-2 must stop after checks pass')
})

test('lane briefings go through assembleImplementerPrompt, never an inline template', () => {
  // The extracted function is the only reason the snapshots in
  // test/spine/implementer-prompt.test.mjs mean anything. A call site that
  // rebuilt the prompt inline would drift past every one of them — and there is
  // exactly one call site now, in the CLI, rather than one per host.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  const args = /assembleImplementerPrompt\(\{([\s\S]*?)\}\)/.exec(run)
  assert.ok(args, 'lib/run.mjs must assemble the lane briefing through the shared function')
  // The inputs the call site must still thread through. `solo` is read off the
  // STEP, never off the invocation flag: the planner decides the mode and the
  // run state carries it, so a flag read here would brief the agent for a shape
  // the planner may not have built.
  for (const input of [
    /\bchange,/,
    /\blane,/,
    /\bpreviousHandoffs,/,
    /isolateWaves: isolate,/,
    /solo: step\.mode === 'solo'/
  ]) {
    assert.match(args[1], input, `the lane call site must still pass ${input}`)
  }

  // No driver assembles one. The Workflow script cannot even hold the text: it
  // is handed a path and a hash (design D2), and the ACP driver is handed the
  // assembled string on the step.
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), join(ROOT, 'bin', 'interlock-run')]) {
    const text = readFileSync(driver, 'utf8')
    assert.doesNotMatch(
      text,
      /assembleImplementerPrompt/,
      `${driver} still assembles an implementer prompt`
    )
    assert.doesNotMatch(
      text,
      /ASSEMBLE_IMPLEMENTER_PROMPT/,
      `${driver} still carries or reads the marked block — the smuggling is over`
    )
  }

  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.doesNotMatch(ship, /\bimport\s*\(/, 'ship.js must not import()')
  assert.doesNotMatch(ship, /node:fs/, 'ship.js must not touch the filesystem itself')
})

test('implementers must return a handoff, and the previous wave is threaded in', () => {
  const schemas = readFileSync(join(ROOT, 'lib', 'prompts', 'schemas.mjs'), 'utf8')
  assert.match(
    schemas,
    /required: \['id', 'ok', 'handoff'\]/,
    'the implementer schema must require a handoff packet'
  )
  const text = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  // The projection into batch-N.json is what record-batch actually reads. A
  // handoff dropped there is a handoff the CLI never sees. It is keyed off the
  // per-task OUTCOME now, because a lane reports one of three values per task
  // and only `ok` may be recorded as success.
  assert.match(
    text,
    /ok: o\.outcome === 'ok',\n\s*error: o\.error,\n\s*handoff: o\.handoff/,
    'the recorded projection must derive ok from the per-task outcome'
  )
  // Same rule, second field: `filesChanged` was requested from every
  // implementer, returned, and dropped in this projection, which left the
  // packet's evidence with nothing to be cross-checked against. Dropping it
  // again would silently empty every stored reported-path set.
  assert.match(
    text,
    /filesChanged: o\.filesChanged/,
    'the recorded projection must carry the reported changed paths'
  )
  // previousHandoffs rides on the step the state machine emitted and reaches
  // the lane through its briefing.
  assert.match(text, /Array\.isArray\(step\.previousHandoffs\) \? step\.previousHandoffs : \[\]/)
  assert.match(
    readFileSync(join(ROOT, 'lib', 'prompts', 'implementer.mjs'), 'utf8'),
    /PREVIOUS WAVE \(schema-validated; do not re-derive from git\)/
  )
})

test('no briefing restates the handoff cap that lives in the CLI', () => {
  // Same rule as every other cap: the number lives in lib/limits.mjs and the
  // prompt cites `interlock limits`. A copy is a copy that drifts.
  const text = readFileSync(join(ROOT, 'lib', 'prompts', 'implementer.mjs'), 'utf8')
  assert.match(text, /character cap \\?`interlock limits\\?` publishes/)
  assert.doesNotMatch(text, /maxHandoffChars|2000 characters/)
})

test('--handoff is not used to mean the wave packet', () => {
  // `--handoff` is the opt-in strict tail (manual-test-plan.md,
  // code-explanation.md, memory). Overloading it would make one flag mean two
  // unrelated things.
  //
  // The driver parses the flag, because argument delivery is host-specific;
  // what the flag BUYS is decided once, in the run program. So the two halves
  // are asserted where they each live.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /handoff: strict \|\| has\('handoff'\)/)
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(
    run,
    /manifest\.flags\.handoff === true \|\| manifest\.flags\.conformance === true/,
    'the run program decides when the handoff step is emitted'
  )
  assert.match(
    readFileSync(join(ROOT, 'lib', 'prompts', 'handoff.mjs'), 'utf8'),
    /manual-test-plan\.md/,
    'and the artifact it names lives in the briefing assembler'
  )
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

test('the default is lean: the tail is gated, and the summary says what it skipped', () => {
  // The gate is the manifest's flags, read in the run program. Neither driver
  // consults them: `emit-strict-tail-from-cli` moved the last of that decision
  // out of the Workflow script, so a host that branched on a tail flag would be
  // a host deciding something the program decides.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /if \(manifest\.flags\.review === true\) \{/)
  assert.match(run, /manifest\.flags\.handoff === true \|\| manifest\.flags\.conformance === true/)
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), RUNNER_DRIVER]) {
    assert.doesNotMatch(
      readFileSync(driver, 'utf8'),
      /if \(flags\.(review|handoff|conformance|strict)\b/,
      `${driver} branches on a tail flag — which steps a flag buys is the run program's`
    )
  }
  // And the banner that keeps a lean run from reading like a strict one.
  const receipt = readFileSync(join(ROOT, 'lib', 'receipt.mjs'), 'utf8')
  assert.match(receipt, /LEAN SHIP:/)
  assert.match(receipt, /pass --review \/ --handoff \/ --strict to enable/)
})

test('the autonomy record is written by the close, so no agent supplies its count', async () => {
  // It used to ride on the commit prompt under `--strict`, then on a spawn of
  // the host tail — both of which handed an OBSERVED count to a party the
  // record assesses. `run close` writes it from the CLI's own last
  // adjudication (design D6), and no prompt asks for it at all.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /recordAutonomy\('review-code', \{ blockers \}, \{ root \}\)/)
  assert.match(run, /manifest\.flags\.strict === true && manifest\.review/, 'strict runs only')
  assert.match(run, /function survivingBlockers\(manifest\)/, 'and the count is the CLI\'s')
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), RUNNER_DRIVER]) {
    assert.doesNotMatch(
      readFileSync(driver, 'utf8'),
      /autonomy/,
      `${driver} still mentions the ladder — the close writes it, no host does`
    )
  }
  // The lean commit briefing must not carry it either: a lean run reviews
  // nothing, so a ladder entry from one would describe a review that never
  // happened. Asserted on the ASSEMBLED text, not the source: the module's own
  // comment explains where the line went, and a source grep would flag the
  // explanation.
  const { assembleCommitPrompt } = await import('../lib/prompts/commit.mjs')
  assert.doesNotMatch(assembleCommitPrompt({ change: 'demo', stageIndex: 1 }), /autonomy|ladder/i)
})

test('the docs frame the runner as an opt-in second host and Code Mode as out of scope', () => {
  // The change's own scenario: a reader must not come away thinking Code Mode
  // is a ship host, or that the runner is what happens when the Workflow tool
  // is missing. Both are one sentence away from being read that way, so both
  // are asserted rather than trusted to survive the next docs edit.
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  assert.match(readme, /interlock-run/)
  assert.match(readme, /interlock-ship-acp/, 'and the shim is still named while it exists')
  assert.match(readme, /Code Mode is out of scope/)
  assert.match(readme, /default and supported host/)

  const codeMode = readme.slice(readme.indexOf('Code Mode is out of scope'))
  assert.ok(
    !/Code Mode[^.]*\bsupported (ship )?host\b(?! today)/.test(codeMode),
    'Code Mode must never be described as a supported ship host'
  )

  const docs = readFileSync(join(ROOT, 'docs', '04-when-it-stops.md'), 'utf8')
  assert.match(docs, /not a fallback/)
  assert.match(docs, /MODEL ROUTING UNAVAILABLE \(<host>\)/)
})

test('the docs carry every banner the runner prints, verbatim', () => {
  // A banner nobody documented is a banner a reader meets for the first time on
  // a failing run. Each of these names a way the run was weaker than the default
  // host, so the page that explains halts is where they belong. Pinned against
  // the DRIVER's own strings rather than restated, so a reworded banner and a
  // stale page cannot pass together.
  const driver = readFileSync(RUNNER_DRIVER, 'utf8')
  const docs = readFileSync(join(ROOT, 'docs', '04-when-it-stops.md'), 'utf8')
  for (const banner of [
    'RUNNER HOST',
    'SUBSCRIPTION PATH: programmatic',
    'CHATGPT PLAN PATH',
    'HOOKS NOT IN FORCE',
    'MODEL ROUTING UNAVAILABLE'
  ]) {
    assert.ok(driver.includes(banner), `the runner no longer prints ${banner}`)
    assert.ok(docs.includes(banner), `docs/04 does not explain ${banner}`)
  }
  // The one host-only banner the CLI raises rather than the driver.
  assert.ok(readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8').includes('TOKEN USAGE NOT REPORTED'))
  assert.ok(docs.includes('TOKEN USAGE NOT REPORTED'))
})

test('the docs state why the Workflow runtime stays the default, in one place', () => {
  // The billing rationale is the reason `/interlock:ship` did not move to the
  // runner, and it is exactly the kind of claim that rots into folklore if it
  // lives only in a commit message. The banner points at this paragraph, so
  // this is the one place to update if the policy settles.
  const docs = readFileSync(join(ROOT, 'docs', '04-when-it-stops.md'), 'utf8')
  assert.match(docs, /exempted/, 'docs/04 must say which path was exempted')
  assert.match(docs, /claude -p`?, the Agent SDK and ACP/, 'and which usage was flagged')
  assert.match(
    readFileSync(RUNNER_DRIVER, 'utf8'),
    /docs\/04-when-it-stops\.md/,
    'and the banner must point at it'
  )
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  assert.match(readme, /separate metered credit/, 'the README must carry the same reason')
  assert.match(readme, /INTERLOCK_MODEL_MAP/, 'and the published model map')
})

// --- the ACP driver's routing banner, end to end (spec: workflow-host) ------
//
// The banner used to be a constant in the driver's `banners` array, printed on
// every run whatever happened. It is now derived from the adapter's per-spawn
// events, which means the property worth asserting is no longer "the string
// exists" — it is that a run which routed every model does NOT print it, and a
// run that could not print it WITH a reason. Both are driven through the real
// binary, because the seam being tested is the driver's, not the adapter's.

const RUNNER_BIN = join(ROOT, 'bin', 'interlock-run')
const ACP_FIXTURE = join(ROOT, 'test', 'fixtures', 'acp', 'agent.mjs')

/** A temp repo with one classified task, ready for a lean ship run. */
function acpShipRepo() {
  const root = mkdtempSync(join(tmpdir(), 'interlock-acp-routing-'))
  const change = 'add-thing'
  const base = `openspec/changes/${change}`
  const put = (rel, body) => {
    const dest = join(root, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n')
  }
  put(`${base}/proposal.md`, '# Add thing\n\nWhy: because.\n')
  put(`${base}/design.md`, '# Design\n\nD1: keep it small.\n')
  put(`${base}/tasks.md`, '# Tasks\n\n- [ ] 1.1 Note it in README.md\n')
  put('README.md', 'hello\n')
  put('.claude/ship/classified.json', {
    tasks: [
      {
        id: '1.1',
        group: 1,
        description: 'Note it in README.md',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: ['README.md']
      }
    ]
  })
  execFileSync('git', ['init', '-q', '.'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root })
  return { root, change }
}

/** Run the runner on its ACP host against the fixture agent; return its stdout. */
function runAcpShip(fixtureFlags) {
  const { root, change } = acpShipRepo()
  try {
    try {
      return execFileSync(
        process.execPath,
        [RUNNER_BIN, change, '--host', 'acp', '--no-commit', '--root', '.'],
        {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 120000,
          env: {
            ...process.env,
            INTERLOCK_ACP_COMMAND: `${process.execPath} ${ACP_FIXTURE} --ship ${fixtureFlags}`.trim()
          }
        }
      )
    } catch (err) {
      // A halt is a verdict, not a test failure: the summary is on stdout either way.
      return err.stdout || ''
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('the runner stays silent about routing failure when every model was applied', () => {
  const stdout = runAcpShip('--config-options')
  assert.match(
    stdout,
    /model routing: applied on (\d+)\/\1 spawns/,
    `the summary must say routing happened:\n${stdout}`
  )
  assert.doesNotMatch(
    stdout,
    /MODEL ROUTING UNAVAILABLE \(acp\)/,
    `a run that routed every model must not banner that it could not:\n${stdout}`
  )
})

test('the runner banners routing failure with a reason per unrouted spawn', () => {
  // The default fixture advertises no config options and answers set_model
  // -32601 — the pre-config-options agent, and today's behaviour exactly.
  const stdout = runAcpShip('')
  assert.match(
    stdout,
    /MODEL ROUTING UNAVAILABLE \(acp\)/,
    `an unroutable agent must still raise the banner:\n${stdout}`
  )
  assert.match(
    stdout,
    /— .+: no model option advertised/,
    `the banner must name the spawn and the reason, not just fire:\n${stdout}`
  )
  assert.doesNotMatch(
    stdout,
    /model routing: applied on/,
    `a run that routed nothing must not also claim it did:\n${stdout}`
  )
})

test('the runner reads `applied` off the event and computes nothing itself', () => {
  // The whole point of the event: only the adapter saw the wire, so only the
  // adapter may decide whether a model landed. A driver that re-derived it from
  // the configured command, the slug, or the agent's reply would be guessing.
  const driver = readFileSync(RUNNER_BIN, 'utf8')
  const reads = (driver.match(/\.applied\b/g) || []).length
  assert.ok(reads > 0, 'the driver never reads the event field it banners from')
  assert.equal(
    reads,
    (driver.match(/\bevent\.applied\b/g) || []).length,
    'every `.applied` the driver reads must be the adapter event field, not a verdict of its own'
  )
  assert.match(
    driver,
    /routing\.filter\(event => event\.applied === false\)/,
    'the unrouted set must be the events the adapter marked unapplied'
  )
  assert.doesNotMatch(
    driver,
    /\bapplied\s*:/,
    'the driver must not construct a routing verdict of its own'
  )
  assert.doesNotMatch(
    driver,
    /modelRoutingSupported/,
    'the removed boolean must not come back as a second source of truth'
  )
})

// --- the runner, end to end on a vendor CLI (spec: run-host-adapters) -------
//
// Everything above drives the runner's ACP host. These drive it on `claude`,
// against a fixture binary that refuses a wrong invocation, because the three
// properties this change is actually for — a worktree per lane, a fold that
// halts on a real collision, and a banner naming the billing path — are
// properties of the DRIVER and not of any adapter.

const HOST_FIXTURES = join(ROOT, 'test', 'fixtures', 'hosts')

/**
 * A temp repo with two classified tasks whose predicted paths are disjoint, so
 * the planner puts them in one batch of two lanes.
 */
function runnerRepo({ paths = [['docs/a.md'], ['docs/b.md']] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'interlock-runner-'))
  const change = 'add-thing'
  const base = `openspec/changes/${change}`
  const put = (rel, body) => {
    const dest = join(root, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n')
  }
  put(`${base}/proposal.md`, '# Add thing\n\nWhy: because.\n')
  put(`${base}/design.md`, '# Design\n\nD1: keep it small.\n')
  put(`${base}/tasks.md`, '# Tasks\n\n- [ ] 1.1 Write docs/a.md\n- [ ] 1.2 Write docs/b.md\n')
  put('README.md', 'hello\n')
  // Tier 4 on purpose: cohesion packs path-disjoint components at or below
  // `LANE_CAPS.cohesionMaxTier` into ONE lane, and a batch of one lane proves
  // nothing about isolation between lanes.
  put('.claude/ship/classified.json', {
    tasks: [
      { id: '1.1', group: 1, description: 'Write docs/a.md', tier: 4, model: 'sonnet', isTestTask: false, paths: paths[0] },
      { id: '1.2', group: 1, description: 'Write docs/b.md', tier: 4, model: 'sonnet', isTestTask: false, paths: paths[1] }
    ]
  })
  execFileSync('git', ['init', '-q', '.'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root })
  return { root, change }
}

/** Run the runner on one host against its fixture CLI; return stdout and the repo. */
function runRunner(host, { fixture, fixtureFlags = [], flags = [], env = {}, root, change }) {
  const commandEnv = {
    claude: 'INTERLOCK_CLAUDE_COMMAND',
    codex: 'INTERLOCK_CODEX_COMMAND',
    qwen: 'INTERLOCK_QWEN_COMMAND'
  }[host]
  try {
    return execFileSync(
      process.execPath,
      [RUNNER_BIN, change, '--host', host, '--no-commit', '--root', '.', ...flags],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 180000,
        env: {
          ...process.env,
          CODEX_API_KEY: undefined,
          OPENAI_API_KEY: undefined,
          ...(commandEnv && fixture
            ? { [commandEnv]: [process.execPath, fixture, ...fixtureFlags].join(' ') }
            : {}),
          ...env
        }
      }
    )
  } catch (err) {
    // A halt is a verdict, not a test failure: the summary is on stdout either way.
    return err.stdout || ''
  }
}

test('the runner forks a worktree per lane, folds both, and removes them', () => {
  const { root, change } = runnerRepo()
  try {
    const stdout = runRunner('claude', {
      fixture: join(HOST_FIXTURES, 'fake-claude.mjs'),
      fixtureFlags: ['--fixture-ship', '--fixture-per-lane'],
      flags: ['--isolate-waves'],
      root,
      change
    })
    assert.match(stdout, /SHIP COMPLETE|SHIP COMPLETE WITH LEFTOVERS/, `the run must reach a summary:\n${stdout}`)
    // The lanes' writes reached the SHARED tree — that is what the fold is for.
    // Each lane wrote its own copy in its own worktree; both folded cleanly
    // because the fixture stamps the lane's task ids into the file it writes.
    assert.ok(existsSync(join(root, 'docs', 'lane-1.1.md')), `lane 1.1's write was not folded back:\n${stdout}`)
    assert.ok(existsSync(join(root, 'docs', 'lane-1.2.md')), `lane 1.2's write was not folded back:\n${stdout}`)
    assert.match(stdout, /wave 1 \(run-batch\): 2 ok, 0 failed/, `both lanes must have run:\n${stdout}`)
    // And nothing was left behind: a folded worktree is removed uniformly.
    for (const lane of ['1.1', '1.2']) {
      assert.ok(
        !existsSync(join(root, '.claude', 'ship', 'worktrees', 'wave-1', lane)),
        `lane ${lane}'s worktree survived a clean fold`
      )
    }
    const registered = execFileSync('git', ['worktree', 'list'], { cwd: root, encoding: 'utf8' })
    assert.equal(registered.trim().split('\n').length, 1, `a worktree stayed registered:\n${registered}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('two lanes that write the same file halt the run and leave both worktrees named', () => {
  // The prediction said disjoint; the lanes both wrote README.md anyway. That is
  // exactly the case worktree isolation exists to catch, and the only honest
  // outcome is a halt naming the path — a fold would silently drop one lane's work.
  const { root, change } = runnerRepo()
  try {
    const stdout = runRunner('claude', {
      fixture: join(HOST_FIXTURES, 'fake-claude.mjs'),
      fixtureFlags: ['--fixture-ship', '--fixture-write=collide.md'],
      flags: ['--isolate-waves'],
      root,
      change
    })
    assert.match(stdout, /SHIP HALTED/, `a real collision must halt:\n${stdout}`)
    assert.match(stdout, /collide\.md/, `the halt must name the path:\n${stdout}`)
    assert.match(stdout, /1\.1/, `and both lanes:\n${stdout}`)
    assert.match(stdout, /1\.2/, `and both lanes:\n${stdout}`)
    assert.match(stdout, /surviving worktrees/, `and say the worktrees are still there:\n${stdout}`)
    assert.ok(
      existsSync(join(root, '.claude', 'ship', 'worktrees', 'wave-1')),
      'the surviving worktrees must be left on disk for the operator'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the runner names its host, and the billing banner is per host', () => {
  const claudeRun = runnerRepo()
  try {
    const stdout = runRunner('claude', {
      fixture: join(HOST_FIXTURES, 'fake-claude.mjs'),
      fixtureFlags: ['--fixture-ship'],
      root: claudeRun.root,
      change: claudeRun.change
    })
    assert.match(stdout, /RUNNER HOST: claude \(experimental\)/, stdout)
    assert.match(stdout, /SUBSCRIPTION PATH: programmatic \(claude\)/, stdout)
    assert.match(stdout, /docs\/04-when-it-stops\.md/, 'the banner points at the one paragraph to update')
    assert.doesNotMatch(stdout, /HOOKS NOT IN FORCE/, 'the plugin\'s hooks do fire on the claude host')
  } finally {
    rmSync(claudeRun.root, { recursive: true, force: true })
  }

  const qwenRun = runnerRepo()
  try {
    const stdout = runRunner('qwen', {
      fixture: join(HOST_FIXTURES, 'fake-qwen.mjs'),
      fixtureFlags: ['--fixture-ship'],
      root: qwenRun.root,
      change: qwenRun.change
    })
    assert.match(stdout, /RUNNER HOST: qwen \(experimental\)/, stdout)
    assert.doesNotMatch(stdout, /SUBSCRIPTION PATH/, `qwen spends no Anthropic credit:\n${stdout}`)
    assert.match(stdout, /HOOKS NOT IN FORCE \(qwen\)/, stdout)
    assert.match(stdout, /TOKEN USAGE NOT REPORTED/, 'and a host with no accounting says so')
  } finally {
    rmSync(qwenRun.root, { recursive: true, force: true })
  }
})

test('a Codex run with no API key names the ChatGPT plan path and the absent guards', () => {
  const { root, change } = runnerRepo()
  try {
    const stdout = runRunner('codex', {
      fixture: join(HOST_FIXTURES, 'fake-codex.mjs'),
      fixtureFlags: ['--fixture-ship'],
      root,
      change
    })
    assert.match(stdout, /RUNNER HOST: codex \(experimental\)/, stdout)
    assert.match(stdout, /CHATGPT PLAN PATH \(codex\)/, stdout)
    assert.match(stdout, /HOOKS NOT IN FORCE \(codex\)/, stdout)
    // Unmapped slugs on a map-only host are bannered, never passed off as routed.
    assert.match(stdout, /MODEL ROUTING UNAVAILABLE \(codex\)/, stdout)
    assert.match(stdout, /no mapping for sonnet/, stdout)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a Codex run WITH an API key does not claim the ChatGPT plan path', () => {
  const { root, change } = runnerRepo()
  try {
    const stdout = runRunner('codex', {
      fixture: join(HOST_FIXTURES, 'fake-codex.mjs'),
      fixtureFlags: ['--fixture-ship'],
      env: { CODEX_API_KEY: 'sk-test', INTERLOCK_MODEL_MAP: '{"codex":{"sonnet":"gpt-5-codex"}}' },
      root,
      change
    })
    assert.doesNotMatch(stdout, /CHATGPT PLAN PATH/, stdout)
    assert.doesNotMatch(stdout, /MODEL ROUTING UNAVAILABLE/, `a mapped slug is routed:\n${stdout}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unknown host and the Workflow host are refused before anything is written', () => {
  for (const [host, pattern] of [['gemini', /unknown host "gemini"/], ['workflow', /\/interlock:ship/]]) {
    const { root, change } = runnerRepo()
    try {
      let stderr = ''
      let code = 0
      try {
        execFileSync(process.execPath, [RUNNER_BIN, change, '--host', host, '--root', '.'], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60000
        })
      } catch (err) {
        stderr = err.stderr || ''
        code = err.status
      }
      assert.equal(code, 2, `--host ${host} must exit 2`)
      assert.match(stderr, pattern)
      assert.ok(
        !existsSync(join(root, '.claude', 'ship', 'run.json')),
        `--host ${host} wrote a manifest for a run that never happened`
      )
      assert.ok(!existsSync(join(root, '.claude', 'ship', 'runs')), 'and a trajectory')
      assert.ok(!existsSync(join(root, '.claude', 'ship', 'briefings')), 'and briefings')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('the shim prints its deprecation line on stderr and forwards every argument', () => {
  // stderr, never stdout: stdout carries the run summary a caller may be parsing.
  const { root, change } = runnerRepo()
  try {
    let stdout = ''
    let stderr = ''
    try {
      const out = execFileSync(
        process.execPath,
        [join(ROOT, 'bin', 'interlock-ship-acp'), change, '--no-commit', '--root', '.'],
        {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 120000,
          env: {
            ...process.env,
            INTERLOCK_ACP_COMMAND: `${process.execPath} ${ACP_FIXTURE} --ship`
          }
        }
      )
      stdout = out
    } catch (err) {
      stdout = err.stdout || ''
      stderr = err.stderr || ''
    }
    // The forwarded arguments got a real run: the summary names the change.
    assert.match(stdout, /RUNNER HOST: acp \(experimental\)/, `the shim must run the acp host:\n${stdout}`)
    assert.match(stdout, new RegExp(change), stdout)
    assert.doesNotMatch(stdout, /is now interlock-run/, 'the deprecation line must not pollute stdout')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the shim says the new name and the removal schedule', () => {
  const shim = readFileSync(join(ROOT, 'bin', 'interlock-ship-acp'), 'utf8')
  assert.match(shim, /interlock-ship-acp is now interlock-run --host acp/)
  assert.match(shim, /process\.stderr\.write/, 'on stderr')
  assert.match(shim, /removed in the next minor version/)
  assert.match(shim, /'--host',\s*'acp'/, 'and it runs the acp host')
  // A shim that flattened the exit status would turn a halt into a clean run.
  assert.match(shim, /process\.exit\(signal \? 1 : typeof code === 'number' \? code : 1\)/)
})

// The shape the suite-count drift actually takes in this repo, observed twice:
// a number, an optional `+`, then a suite noun a word or two later. Matched as a
// shape rather than as the stale values (760, 590+), because a pin on the values
// would pass the first time someone writes a *new* wrong number.
const SUITE_COUNT = /\b\d[\d,]*\+?\s+(?:[A-Za-z-]+\s+){0,2}(?:unit tests|tests|test suite|test cases|cases)\b/i

// The three published files that stated a count of the unit suite. Every one of
// them was wrong — the documented 760 / 590+ against 1330 actually collected —
// because nothing asserted them. Kept in one list so a fourth site added later
// is one entry, not a fourth test.
const COUNT_FREE_DOCS = ['README.md', join('docs', '06-why-it-works.md'), join('docs', '10-agentic-workflow-ship-and-spec.md')]

test('package.json declares no runtime dependencies', () => {
  // Backs the documented `no dependencies to install first` claim in README.md's
  // Development block. That claim replaced a hand-written test count, and it is
  // the half of the old sentence a reader acts on: it is what tells them
  // `npm test` works on a fresh clone. Exactly derivable, so it is derived.
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.ok(
    !manifest.dependencies || Object.keys(manifest.dependencies).length === 0,
    'package.json declares runtime dependencies, contradicting the documented ' +
      '"no dependencies to install first" claim in README.md. Adding one is a design ' +
      'decision (CLAUDE.md) — update the documented claim in the same commit.'
  )

  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  assert.match(readme, /no dependencies to install first/)
})

test('the docs state no hand-written count of the test suite', () => {
  // Fixing the four sentences was a one-time edit the next docs pass could undo.
  // This pins the absence instead: a prose claim nobody asserts silently stops
  // being true, and a suite count is the purest instance — it is wrong the
  // moment a test is added, and nothing goes red. A count may return only if it
  // is derived from the suite at test time; a literal one may not.
  for (const rel of COUNT_FREE_DOCS) {
    const text = readFileSync(join(ROOT, rel), 'utf8')
    const hit = text.match(SUITE_COUNT)
    assert.ok(
      !hit,
      `${rel} states a hand-written count of the test suite: "${hit?.[0]}". ` +
        'Remove the number, or derive it from the suite at test time.'
    )
  }
})

test('docs/10 names the evals suite in §2 and §8 and states its coverage gap', () => {
  // §2's bullet called the unit suite "Evals" and §8 never mentioned that a
  // model-in-the-loop suite exists, so a reader learned neither that `evals/`
  // is there nor where it stops. Both are pinned because a coverage claim with
  // no stated boundary reads as full coverage.
  //
  // Deliberately NOT pinned: the run status ("has not yet been run against a
  // model"). That sentence is expected to change the first time the suite runs,
  // and hooks/guard-tests.mjs denies test edits during remediation / fix-tests —
  // so a pin on it would turn a correct docs update into a blocked test edit
  // (design.md D3). Scope is durable; status is not.
  const docs = readFileSync(join(ROOT, 'docs', '10-agentic-workflow-ship-and-spec.md'), 'utf8')
  const section = (from, to) => docs.slice(docs.indexOf(from), docs.indexOf(to))

  const s2 = section('## 2. Mental model', '## 3. How spec works')
  assert.ok(s2.length > 0, '§2 heading moved — the slice is empty')
  assert.match(s2, /`evals\/`/)
  assert.match(s2, /model-in-the-loop/)

  const s8evals = section('### Evals', '### Human gates')
  assert.ok(s8evals.length > 0, '§8 Evals subsection moved — the slice is empty')
  assert.match(s8evals, /`evals\/`/)
  // The surfaces its cases exercise, one token per eval case directory.
  for (const surface of [/implementer briefing/i, /control-plane action/i, /trampoline halt/i, /skill routing/i, /evidence locator/i, /tier read scope/i, /cited cap resolution/i]) {
    assert.match(s8evals, surface)
  }
  // The boundary: the spec path has no model-in-the-loop coverage at all.
  for (const uncovered of [/`skills\/spec`/, /`review-artifacts`/, /`review-code`/, /`explore`/, /`bootstrap`/]) {
    assert.match(s8evals, uncovered)
  }
  assert.match(s8evals, /advisory/i)
  assert.match(s8evals, /gates nothing/i)

  // Thresholds live in the CLI, not in prose (CLAUDE.md). The subsection may say
  // a cost ceiling exists; it must name the command that prints it instead of
  // printing one, and it must not state a case count either.
  assert.match(s8evals, /interlock limits/)
  assert.doesNotMatch(s8evals, /\$\s*\d/)
  assert.doesNotMatch(s8evals, /\b\d+(?:\.\d+)?\s*(?:usd|dollars?)\b/i)
  assert.doesNotMatch(s8evals, /\b\d+\s+(?:[A-Za-z-]+\s+){0,2}(?:runs?|cases?|graders?)\b/i)
  assert.doesNotMatch(s8evals, SUITE_COUNT)
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

test('a run with leftovers does not print a clean complete', () => {
  // One or two ok:false tasks stay under the halt cap and the run continues to
  // commit. Printing SHIP COMPLETE with silent leftovers is what taught the
  // parent to launch a second 20-agent workflow.
  const receipt = readFileSync(join(ROOT, 'lib', 'receipt.mjs'), 'utf8')
  assert.match(receipt, /SHIP COMPLETE WITH LEFTOVERS/)
  assert.match(receipt, /leftover tasks \(boxes still unchecked\)/)
  assert.match(receipt, /Do not start another ship run unless the user asks/)
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /failedIds/, 'and the recorded failures are carried to the receipt')
  // The one line that stays with the host: `/goal` is a Claude Code convention.
  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(ship, /GOAL MET: interlock ship returned a terminal summary/)
  assert.doesNotMatch(receipt, /GOAL MET/, 'and means nothing on another host')
})

test('succeeded tasks are ticked by the CLI, from what it recorded', () => {
  // No agent ticks a box, and none is asked to: the run ticks the ids its own
  // record-batch adjudicated as ok. A box ticked from a claim is how
  // unimplemented work ships behind a "[x]".
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /tickTasks\(root, manifest\.change, verdict\.tickIds\)/)
  assert.match(run, /TASK TICK FAILED:/, 'and a tick that could not be written is said out loud')
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), join(ROOT, 'bin', 'interlock-run')]) {
    assert.doesNotMatch(readFileSync(driver, 'utf8'), /tasks tick|tick the checkbox/)
  }
})

test('a classification that omits an unchecked checkbox halts the run', () => {
  // Coverage is checked by the CLI, right after the classifier writes its file
  // — not by the classifying agent, which is the party the check exists to
  // catch out.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /planCoverage\(inspection\.tasks\.items, listed\)/)
  assert.match(run, /plan omitted unchecked tasks:/)
  const planner = readFileSync(join(ROOT, 'lib', 'prompts', 'planner.mjs'), 'utf8')
  assert.doesNotMatch(
    planner,
    /interlock tasks coverage/,
    'the classifier is not asked to check its own coverage'
  )
  assert.match(
    planner,
    /the orchestrator runs the planner, the coverage check/,
    'it is told who does, so it does not do it anyway'
  )
})

test('the change name is threaded as --change, never as a bare positional', () => {
  // A positional is easy for a relay to drop. It is a named flag on the one
  // call that takes it, and validation happens inside that call rather than in
  // an agent that could report ok on a change it never resolved.
  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(ship, /\.\.\.\(changeArg \? \['--change', changeArg\] : \[\]\)/)
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /inspectChange\(root, change\)/, 'run start validates the change itself')
  assert.match(run, /validate failed:/)
})

test('ship.js uses haiku for its mechanical control-plane relays', () => {
  // Every CLI call the script makes is a relay: it writes a file, runs a
  // command and copies stdout. There is exactly one such wrapper now instead of
  // four call sites, so the model pin is one statement rather than four.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /pingExtra\.model = 'haiku'/, 'control-plane relays must pin haiku')
  assert.match(text, /async function cli\(argv, results, extraWrites = \[\]\)/)
  assert.match(text, /const relayed = await ping\(/, 'and every one goes through the ping wrapper')
  // The relay is mechanical by contract, not by convention.
  assert.match(text, /You are a mechanical relay for one command/)
  assert.match(text, /never adjust a value/)
})

// --- effort routing dispatch (spec: effort-routing) ------------------------
//
// `laneEffort` used to exist twice — the source in lib/waves.mjs and a mirror in
// ship.js — because the workflow runtime rejects import(), and the two were
// pinned equal here so a drift could not silently re-route a cached lane on
// replay. There is one now: the CLI derives the effort and puts it on the
// spawn. So what is pinned is the absence of the mirror, and that the one
// derivation reaches the spawn.

test('no driver mirrors laneEffort or laneModel any more', () => {
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), join(ROOT, 'bin', 'interlock-run')]) {
    const text = readFileSync(driver, 'utf8')
    for (const name of ['laneEffort', 'laneModel', 'laneLabel', 'LANE_EFFORT', 'LANE_DISPATCH']) {
      assert.doesNotMatch(
        text,
        new RegExp(`\\b${name}\\b`),
        `${driver} still carries ${name} — the derivation lives in lib/waves.mjs and reaches a ` +
          `host on the spawn, so a second copy is the drift the mirror test used to guard`
      )
    }
  }
})

test('the CLI applies the lane effort at dispatch and pins the review skeptics at xhigh', () => {
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  // The lane spawn carries its lane's derived effort, beside the model.
  assert.match(run, /model: laneModel\(lane\),\n\s*effort: laneEffort\(lane\)/)
  // And a host passes it through rather than choosing one.
  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(ship, /\.\.\.\(s\.effort \? \{ effort: s\.effort \} : \{\}\)/)
  // The adversarial steps are pinned at the published skeptic effort rather
  // than left at the session default, and the pin is the CLI's — the literal
  // left the script with the tail (design D8).
  assert.match(run, /effort: EFFORT\.skeptic/)
  assert.doesNotMatch(ship, /xhigh/, 'no host declares an effort level of its own')
  assert.doesNotMatch(readFileSync(RUNNER_DRIVER, 'utf8'), /xhigh/)
})

test('the review and remediation briefings ask for counts only', () => {
  // The reasoning, the findings and the fix diffs live in the work files and in
  // the diff. A result field carrying a dimension report would put kilobytes of
  // model prose on the wire where the CLI wants a number it did not have to
  // trust anyway.
  const review = readFileSync(join(ROOT, 'lib', 'prompts', 'review.mjs'), 'utf8')
  const remediate = readFileSync(join(ROOT, 'lib', 'prompts', 'remediate.mjs'), 'utf8')
  assert.match(review, /do not paste dimension reports/i)
  assert.match(remediate, /do not paste fixer or skeptic/i)
})

test('a control-plane relay copies stdout and is told to interpret nothing', () => {
  // "Report the step verbatim" once taught haiku to set action:"report", so the
  // relay is told to copy rather than report — and, now that a step is a whole
  // program rather than one of six actions, that it is a relay and not a worker.
  // Listing allowed actions would be loop knowledge in a driver; refusing to
  // interpret is not.
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), join(ROOT, 'bin', 'interlock-run')]) {
    const text = readFileSync(driver, 'utf8')
    assert.doesNotMatch(text, /Report the step/)
  }
  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(ship, /You are a mechanical relay for one command/)
  assert.match(ship, /Do not interpret it, and do not do the work it/)
  assert.match(ship, /Copy that command's stdout into this result verbatim as cliStdout/)
  assert.match(ship, /Never invent either, never summarize, and never adjust a value/)
  // And the parse prefers the CLI's own bytes over anything the model retyped.
  assert.match(ship, /JSON\.parse\(relayed\.cliStdout\)/)
})

test('a relay that produced no readable step stops the run rather than guessing', () => {
  // An invented action used to be a relay miss the script recovered from by
  // re-reading the state under a new label. There is nothing to invent now: a
  // step is the CLI's own JSON, and either it parsed or it did not. What
  // matters is that neither outcome is a guess — an unreadable relay is a halt
  // that closes, with the reason named.
  const text = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(text, /stdout was not JSON\. Nothing is inferred from that: the caller stops/)
  assert.match(text, /the run program returned no step — the CLI relay could not be read/)
  // And a run that can no longer read its program still records a receipt.
  const stopAt = text.indexOf('async function stop(reason)')
  const noStepAt = text.indexOf('the run program returned no step')
  assert.ok(stopAt !== -1 && noStepAt !== -1)
  assert.match(text, /return await stop\('the run program returned no step/)
  // `run next` is what a caller uses to re-read the state deliberately, and it
  // is a CLI subcommand rather than a prompt telling a model to run one.
  const cli = readFileSync(join(ROOT, 'bin', 'interlock'), 'utf8')
  assert.match(cli, /sub === 'next'/)
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

  // The script no longer logs anything itself — the CLI records every event
  // from the step it emitted, which is strictly better: an instruction a model
  // could skip became a side effect of the call it was going to make anyway.
  assert.doesNotMatch(text, /interlock run-log/, 'no host composes a trajectory event')
  assert.doesNotMatch(text, /\bimport\s*\(/, 'ship.js must not import()')
  assert.doesNotMatch(text, /node:fs/, 'ship.js must not touch the filesystem itself')

  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /appendRunLogEvent\(ctx\.root, \{/, 'the CLI appends the events instead')
  assert.match(run, /type: 'agent-spawn'/, 'including the spawns it asked for')

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

const RUNNER_DRIVER = join(ROOT, 'bin', 'interlock-run')

/** Subcommands a driver invokes, however it spells the invocation. */
function invokedSubcommands(text) {
  // Comment lines are excluded: a driver that CITES `interlock limits` in a
  // comment explaining where a cap lives is not invoking it, and counting the
  // citation would make the "one family" check unpassable for any file that
  // explains itself.
  const withoutGoalMet = text
    .replace(/GOAL MET:.*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const names = new Set()
  // Prose form, as an agent is told to run it: `interlock wave-state next`.
  for (const m of withoutGoalMet.matchAll(/\binterlock ([a-z-]+)/g)) names.add(m[1])
  // Node form, as the driver runs it itself: `cli(['wave-state', ...])`.
  for (const m of withoutGoalMet.matchAll(/(?:host\.runCli|\bcli)\(\[\s*'([a-z-]+)'/g)) names.add(m[1])
  names.delete('graph') // interlock-graph is a different binary
  names.delete('ship') // the shim `interlock-ship-acp` names this binary
  return names
}

test('the runner and ship.js drive the same interlock subcommands', () => {
  const script = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const driver = readFileSync(RUNNER_DRIVER, 'utf8')
  const dispatched = new Set(
    [...readFileSync(join(ROOT, 'bin', 'interlock'), 'utf8').matchAll(/^\s*case '([a-z-]+)':/gm)].map(m => m[1])
  )

  const fromScript = invokedSubcommands(script)
  const fromDriver = invokedSubcommands(driver)

  // The lean path, named explicitly. Both hosts drive it through ONE family
  // now: a host that reached for anything else on the lean path would be a host
  // deciding something the program decides.
  for (const host of [fromScript, fromDriver]) {
    assert.ok(host.has('run'), 'both hosts must drive the run program')
  }
  // Neither host invokes anything but the run family. The Workflow script used
  // to reach for `review`, `review-policy`, `remediate`, `autonomy`, `surface`
  // and `conformance` from inside its inline tail; `emit-strict-tail-from-cli`
  // made every one of those a decision the run program takes in-process, so
  // this list is empty on BOTH drivers and there is no allowance left.
  for (const [name, invoked] of [['ship.js', fromScript], ['the runner', fromDriver]]) {
    assert.deepEqual(
      [...invoked].filter(sub => sub !== 'run'),
      [],
      `${name} invokes a subcommand outside the run family: ${[...invoked].join(', ')}`
    )
  }

  const missing = [...fromDriver].filter(name => !dispatched.has(name))
  assert.deepEqual(missing, [], `the runner invokes subcommand(s) the CLI does not implement: ${missing}`)
})

test('the runner holds no second copy of the halt rules', () => {
  const driver = readFileSync(RUNNER_DRIVER, 'utf8')

  // It may import the host port. It may not import the policy — a driver that
  // loaded lib/waves.mjs or lib/limits.mjs could answer "may I continue"
  // itself, which is the entire thing this change is not doing.
  const imports = [...driver.matchAll(/from '([^']+)'/g)].map(m => m[1])
  assert.ok(imports.length > 0, 'failed to read the driver imports')
  for (const specifier of imports) {
    assert.ok(
      specifier.startsWith('node:') || /^\.\.\/lib\/host(\/|\.)/.test(specifier),
      `the runner may only import node builtins and the host port, not ${specifier}`
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
    assert.doesNotMatch(driver, forbidden, `the runner restates a CLI rule: ${forbidden}`)
  }
})

test('the runner carries no briefing text at all, and sends what the step handed it', () => {
  // The tier ladder is snapshotted against test/fixtures/prompts/ for exactly
  // one assembler. A second copy in a driver would drift silently and both
  // hosts would still look correct. The driver used to avoid that by reading
  // the workflow script's source through `new Function`; it now receives the
  // assembled string on the step and sends it inline.
  const driver = readFileSync(RUNNER_DRIVER, 'utf8')
  assert.match(driver, /prompt: s\.prompt,/, 'the briefing is the step\'s, sent verbatim')
  assert.doesNotMatch(driver, /new Function\(/, 'no host evaluates another host\'s source')
  assert.doesNotMatch(driver, /SHIP_SCRIPT/, 'and none reads it off disk')
  for (const copied of [
    /Your tier is/,
    /tier 1: the task description alone/,
    /interlock\.wave-handoff\/1/,
    /Tier 1 trivial/,
    /recommendedMode/
  ]) {
    assert.doesNotMatch(driver, copied, `the runner copies briefing text: ${copied}`)
  }
})

test('the runner refuses no tail flag and carries no tail text', () => {
  // It used to exit 2 on --strict, --review, --handoff and --conformance,
  // because the tail ran inline inside the Workflow script and this host had no
  // copy of it. The tail is a CLI-emitted program now, so there is nothing left
  // to refuse — and a refusal branch that survived would make one host's strict
  // run silently different from the other's.
  const driver = readFileSync(RUNNER_DRIVER, 'utf8')
  assert.doesNotMatch(driver, /REFUSED_FLAGS/)
  assert.doesNotMatch(driver, /is not implemented on the ACP host/)
  assert.doesNotMatch(driver, /step\.action === 'host-tail'/)
  // Every tail flag reaches `run start`, which is the only place they are read.
  for (const flag of ['review', 'handoff', 'conformance', 'strict']) {
    assert.match(
      driver,
      new RegExp(`\\.\\.\\.\\(${flag} \\? \\['--${flag}'\\] : \\[\\]\\)`),
      `the runner must pass --${flag} through to run start`
    )
  }
  // And it holds none of the text those flags buy.
  for (const copied of [/adversarially review/i, /two skeptics/i, /manual-test-plan/, /reReviewDimensions/]) {
    assert.doesNotMatch(driver, copied, `the runner copies tail text: ${copied}`)
  }
  // The summary is still the CLI's, and it still says what a lean run skipped.
  assert.match(readFileSync(join(ROOT, 'lib', 'receipt.mjs'), 'utf8'), /LEAN SHIP:/)
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
  receiptFrom,
  outcomeFrom,
  trajectory,
  countingBudget,
  handoffFor,
  makeRepo,
  reviewFiles
} = await import('./helpers/ship-harness.mjs')

// The remediation bound used to be a `remediationBudget` helper extracted from
// ship.js's source between markers. It left with the tail: rounds are arranged
// by `lib/remediate.mjs` from `LIMITS.remediationRounds`, and the run program
// walks them (test/spine/remediate.test.mjs owns the arithmetic;
// test/spine/run.test.mjs owns what a raised cap does to a driven run). What is
// asserted here is only that no driver grew a copy.

test('the remediation bound is stated by the CLI and by neither driver', () => {
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), RUNNER_DRIVER]) {
    const text = readFileSync(driver, 'utf8')
    assert.doesNotMatch(text, /roundCap/, `${driver} carries the round budget`)
    assert.doesNotMatch(text, /round\s*<=\s*\d/, `${driver} restates the cap as a literal`)
    assert.doesNotMatch(text, /verdict round/i, `${driver} knows what a verdict round is`)
  }
  // And the cap has exactly one reader, which is where raising it takes effect.
  const remediate = readFileSync(join(ROOT, 'lib', 'remediate.mjs'), 'utf8')
  assert.match(remediate, /LIMITS\.remediationRounds/)
})

/**
 * The remediationRounds figure ship.js hands the outcome corpus.
 *
 * Read from the receipt, because that is now the only place it is stated: the
 * corpus line's observed half is derived from the receipt by
 * `interlock outcomes append`, so a run cannot report one number here and a
 * different one there.
 */
function recordedRounds(root) {
  const receipt = receiptFrom(root)
  assert.ok(receipt, 'the run wrote no receipt to its trajectory')
  // Absent, not zero: a lean run never reached a remediation step, and
  // "measured none" is a different fact from "never found out".
  return Object.prototype.hasOwnProperty.call(receipt, 'remediationRounds')
    ? receipt.remediationRounds
    : null
}

test('recorded round consumption differs between a one-round and a two-round run', async () => {
  // The figure has to come from what the run CONSUMED. `Math.min(round, 2)`
  // where round is always one past the bound at loop exit is a constant, and a
  // fictional field in the outcomes corpus makes the one question that corpus
  // exists to answer unanswerable.
  //
  // Rounds are driven by the FILES a fixer leaves behind, not by a count it
  // reports: `run remediated` re-adjudicates them. So a fixer that clears the
  // blocker on its first pass buys one round, and one that clears it on its
  // second buys two.
  const clearing = clearsOn => (label, n, ctx) => {
    const { findings, verdicts } = reviewFiles({ blockers: n >= clearsOn ? 0 : 1, warnings: 0, dismissed: 0 })
    ctx.write('.claude/ship/findings.json', findings)
    ctx.write('.claude/ship/verdicts.json', verdicts)
    return { ok: true }
  }
  const withBlocker = (label, n, ctx) => {
    const { findings, verdicts } = reviewFiles({ blockers: 1, warnings: 0, dismissed: 0 })
    ctx.write('.claude/ship/findings.json', findings)
    ctx.write('.claude/ship/verdicts.json', verdicts)
    return { ok: true }
  }
  const cleared = await runShip({
    keepRepo: true,
    args: 'demo-change --strict',
    responses: { review: withBlocker, 'remediate-': clearing(1) }
  })
  const persisted = await runShip({
    keepRepo: true,
    args: 'demo-change --strict',
    responses: { review: withBlocker, 'remediate-': clearing(2) }
  })
  try {
    assert.equal(recordedRounds(cleared.root), 1)
    assert.equal(recordedRounds(persisted.root), 2)
  } finally {
    rmSync(cleared.root, { recursive: true, force: true })
    rmSync(persisted.root, { recursive: true, force: true })
  }
})

test('a lean run records no remediation rounds, distinguishably from "ran and used none"', async () => {
  // A lean run skips review, so no remediation step ever ran and there is no
  // count to report. The corpus reads that as unobserved rather than as zero:
  // it holds the checkpoint runs as a control group, and defaulting an absence
  // to a clean value would bias exactly that group.
  const { root } = await runShip({ keepRepo: true })
  try {
    assert.equal(recordedRounds(root), null)
    assert.notEqual(recordedRounds(root), 0, 'a run that never remediated did not remediate zero times')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- the completion gate ---------------------------------------------------

/**
 * A run whose final verification actually plans a step, answered by what the
 * verifying agent REPORTS — exit codes and counts, never a verdict.
 *
 * That distinction is the point. The agent used to return `{ok, unitGreen}` and
 * the run branched on it, which made the party being verified the party
 * deciding whether verification passed. It reports what the suites did; the CLI
 * judges.
 */
const verifyRun = results =>
  runShip({
    repo: { profile: { version: 1, unit: { command: 'npm test' } } },
    responses: { verify: { results } }
  })

test('a green verification proceeds to the commit', async () => {
  const { output, calls } = await verifyRun([
    { kind: 'unit', exitCode: 0, total: 3, passed: 3, failed: 0 }
  ])
  assert.ok(calls.includes('commit'), 'a green verification must reach the commit step')
  assert.match(output, /SHIP COMPLETE/)
})

test('a red verification halts, whatever the agent says about it', async () => {
  const { output, calls } = await verifyRun([
    { kind: 'unit', exitCode: 1, total: 3, passed: 2, failed: 1, failures: ['a test failed'] }
  ])
  assert.ok(!calls.includes('commit'), 'no commit may be created on a red verification')
  assert.match(output, /SHIP HALTED/)
  assert.match(output, /unit|verif/i, 'the halt must name the verification verdict as the reason')
})

test('an agent cannot vote its own verification through', async () => {
  // Every shape of self-declared pass, over a red suite. None of them may reach
  // the commit: the verdict is the CLI's, rendered from the exit codes, and a
  // field the agent volunteered is not an input to it.
  const red = { kind: 'unit', exitCode: 1, total: 1, passed: 0, failed: 1 }
  for (const claim of [
    { ok: true, results: [red] },
    { ok: true, unitGreen: true, results: [red] },
    { halted: false, unitGreen: true, results: [red] }
  ]) {
    const { output, calls } = await runShip({
      repo: { profile: { version: 1, unit: { command: 'npm test' } } },
      responses: { verify: claim }
    })
    assert.ok(
      !calls.includes('commit'),
      `${JSON.stringify(claim)} reached the commit — a self-declared pass is not a verdict`
    )
    assert.match(output, /SHIP HALTED/)
  }
})

test('a verification with no reported results at all does not pass', async () => {
  // An absent report is "not verified", never a passing verdict — the same
  // direction the completion gate has always failed in.
  const { output, calls } = await runShip({
    repo: { profile: { version: 1, unit: { command: 'npm test' } } },
    responses: { verify: {} }
  })
  assert.ok(!calls.includes('commit'))
  assert.match(output, /SHIP HALTED/)
})

// --- lanes: one agent per lane, not per task (spec: lanes) -----------------
//
// The whole point of a lane is that N tasks forced to run in order cost ONE
// spawn prefix instead of N. That is a property of what the script dispatches,
// so it is asserted by running the script and counting the agents it actually
// asked for — a source-text check would pass on a loop that flattened lanes.

const laneTask = (id, over = {}) => ({
  id,
  group: 1,
  description: `task ${id}`,
  tier: 2,
  model: 'sonnet',
  isTestTask: false,
  paths: ['lib/a.mjs'],
  ...over
})

/** The label a lane runs under: its first task id, plus how many follow. */
const labelFor = lane => (lane.length === 1 ? lane[0].id : `${lane[0].id}+${lane.length - 1}`)

const laneHandoff = id => ({
  schema: 'interlock.wave-handoff/1',
  taskId: id,
  status: 'ok',
  summary: `did ${id}`,
  evidence: ['lib/a.mjs:1-2'],
  next: 'nothing',
  blocker: null
})

/**
 * Run one wave holding exactly one lane, answered by `laneResult`.
 *
 * The classification is real and so is the CLI: the tasks below are what the
 * classifier would have written, and what the run records, ticks and tallies is
 * the run program's own doing. Only the lane agent is canned — which is the one
 * party a test cannot supply, and the one whose claims these tests exist to
 * contradict.
 */
function runLane(lane, laneResult, opts = {}) {
  return runShip({
    keepRepo: true,
    classified: { tasks: lane },
    repo: {
      tasks: '# Tasks\n\n' + lane.map(t => `- [ ] ${t.id} ${t.description}`).join('\n') + '\n'
    },
    responses: { [labelFor(lane)]: laneResult, ...(opts.responses || {}) }
  })
}

/** The tasks.md the run left behind, so a tick can be read rather than inferred. */
function tasksMd(root, change = 'demo-change') {
  return readFileSync(join(root, 'openspec', 'changes', change, 'tasks.md'), 'utf8')
}

/** Which ids the run ticked. */
function ticked(root, change) {
  return [...tasksMd(root, change).matchAll(/- \[x\] (\S+)/g)].map(m => m[1])
}

test('a three-task lane spawns one implementer, not three', async () => {
  const lane = [laneTask('1.1'), laneTask('1.2'), laneTask('1.3')]
  const { calls, prompts, root } = await runLane(lane, {
    tasks: lane.map(t => ({ id: t.id, outcome: 'ok', handoff: laneHandoff(t.id) }))
  })
  try {
    const implementers = calls.filter(c => c === labelFor(lane))
    assert.equal(implementers.length, 1, `expected one lane agent, got calls: ${calls.join(', ')}`)
    for (const id of ['1.2', '1.3']) {
      assert.ok(!calls.includes(id), `${id} must not get its own agent — it is inside the lane`)
    }
    const prompt = prompts.find(p => p.label === labelFor(lane)).prompt
    assert.match(prompt, /Implement 3 tasks from OpenSpec change "demo-change", IN THIS ORDER/)
    assert.deepEqual(ticked(root), ['1.1', '1.2', '1.3'], 'all three succeeded, so all three tick')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a mid-lane failure ticks the earlier task and counts one failure', async () => {
  const lane = [laneTask('1.1'), laneTask('1.2'), laneTask('1.3')]
  const { output, root } = await runLane(lane, {
    tasks: [
      { id: '1.1', outcome: 'ok', handoff: laneHandoff('1.1') },
      { id: '1.2', outcome: 'failed', error: 'no migration runner' },
      { id: '1.3', outcome: 'not-attempted' }
    ]
  })
  try {
    assert.deepEqual(
      ticked(root),
      ['1.1'],
      'the task that succeeded is ticked; a failed task and one nobody ran are not'
    )
    assert.match(output, /wave 1 \(run-batch\): 1 ok, 1 failed/)
    assert.match(
      output,
      /LANE STOPPED EARLY: 1\.3 not attempted/,
      'a not-attempted task is neither ticked nor charged to the failure budget — spending it ' +
        'on the tasks sitting behind one blocker would halt a run that has one problem'
    )
    assert.match(output, /SHIP HALTED|SHIP COMPLETE WITH LEFTOVERS/, 'the failure is still visible')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- claim versus recorded verdict ----------------------------------------
//
// The defect these tests exist for: a run ticked and tallied from what the
// implementing agent CLAIMED, so five tasks the state machine failed for
// invalid handoff packets got their boxes ticked beside a halt naming them as
// failures. The claim is the input that was adjudicated, not a second opinion.
//
// The disagreement is produced rather than stubbed now. The agent claims
// success with a packet the state machine rejects, and the CLI records what it
// records — so the two observations differ for the reason they differ in
// production, instead of because a fixture said so.

test('a claim the CLI recorded as failed is neither ticked nor counted as ok', async () => {
  const lane = [laneTask('1.1'), laneTask('1.2')]
  const { output, root } = await runLane(lane, {
    // Both claimed ok, both carrying a packet whose status is outside the
    // accepted set — which `record-batch` fails the task for.
    tasks: lane.map(t => ({
      id: t.id,
      outcome: 'ok',
      handoff: { ...laneHandoff(t.id), status: 'finished' }
    }))
  })
  try {
    assert.deepEqual(ticked(root), [], 'a task the run recorded as failed must never be ticked')
    assert.match(
      output,
      /wave 1 \(run-batch\): 0 ok, 2 failed/,
      'the tally counts the recorded outcomes, not the claims'
    )
    assert.match(
      output,
      /CLAIM OVERRIDDEN: 1\.1, 1\.2/,
      'overriding a claim is a finding, not a silent fix'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a lane result with no per-task outcomes fails every task in the lane', async () => {
  const lane = [laneTask('1.1'), laneTask('1.2')]
  const { output, root } = await runLane(lane, { note: 'I did some things' })
  try {
    assert.deepEqual(ticked(root), [])
    assert.match(output, /wave 1 \(run-batch\): 0 ok, 2 failed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a lane result that omits one task fails all of them, closed', async () => {
  const lane = [laneTask('1.1'), laneTask('1.2')]
  const { output, root } = await runLane(lane, {
    tasks: [{ id: '1.1', outcome: 'ok', handoff: laneHandoff('1.1') }]
  })
  try {
    assert.deepEqual(
      ticked(root),
      [],
      'nothing may be ticked from a result nobody can trust — including the task it did report'
    )
    assert.match(output, /wave 1 \(run-batch\): 0 ok, 2 failed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a worker that does not acknowledge its briefing fails the task, closed', async () => {
  // The by-reference contract (design D2). A worker that did not read its
  // instructions did not do this task, whatever it reports about it — so a
  // missing or wrong hash is a null result with a named reason, which the
  // recorder already treats as a failed task.
  const lane = [laneTask('1.1')]
  const { output, root } = await runShip({
    keepRepo: true,
    classified: { tasks: lane },
    responses: {
      // The harness normally answers with the sha the bootstrap asked for. This
      // one answers without it.
      '1.1': () => ({ id: '1.1', ok: true, handoff: laneHandoff('1.1'), briefing: 'nope' })
    }
  })
  try {
    assert.deepEqual(ticked(root), [], 'an unacknowledged briefing may not tick a box')
    assert.match(output, /BRIEFING NOT ACKNOWLEDGED: 1\.1/)
    assert.match(output, /wave 1 \(run-batch\): 0 ok, 1 failed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a one-task lane keeps the pre-lane label, schema and result shape', async () => {
  const lane = [laneTask('1.1')]
  const { calls, prompts, root } = await runLane(lane, {
    id: '1.1',
    ok: true,
    handoff: laneHandoff('1.1')
  })
  try {
    assert.ok(calls.includes('1.1'), 'the label is the bare task id, so a replay still cache-hits')
    assert.match(
      prompts.find(p => p.label === '1.1').prompt,
      /Implement exactly one task/,
      'and the prompt is the pre-lane prompt'
    )
    assert.deepEqual(ticked(root), ['1.1'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- isolated-lane merge, opt-in via --isolate-waves (spec: ship/wave-isolation, ship/lane-merge) --
//
// Unset, a batch runs exactly as it always has: no worktree isolation opt on
// the lane spawn, and no merge-base/merge-lanes step at all. Set, each lane's
// spawn is asked to run in its own worktree and a merge-lanes step folds the
// batch's worktrees back before the next batch's base is read.

// A two-lane batch: two tasks with disjoint paths, so the planner builds one
// batch holding two lanes and each lane gets its own agent — and, under
// isolation, its own worktree.
// Tier 4, so the planner does not fold them into one cohesion lane:
// `LANE_CAPS.cohesionMaxTier` stops cohesion packing above tier 3, and two
// lanes is the whole point of an isolation fixture.
const TWO_LANES = [
  laneTask('1.1', { tier: 4 }),
  laneTask('2.1', { group: 1, tier: 4, paths: ['lib/b.mjs'] })
]

/** Drive an isolated run over `lane`, with the fold's own result canned. */
function runIsolated(tasks, responses = {}) {
  return runShip({
    keepRepo: true,
    args: 'demo-change --isolate-waves',
    classified: { tasks },
    repo: {
      tasks: '# Tasks\n\n' + tasks.map(t => `- [ ] ${t.id} ${t.description}`).join('\n') + '\n'
    },
    responses
  })
}

test('without --isolate-waves, no lane spawn asks for a worktree and nothing is folded', async () => {
  const { prompts, commands } = await runShip({})
  assert.ok(
    !commands.some(c => c.includes('merge-lanes')),
    'an unisolated run must fold nothing'
  )
  const lanePrompt = prompts.find(p => p.label === '1.1')
  assert.ok(lanePrompt, 'the default single-lane run must still spawn the lane')
  assert.equal(lanePrompt.isolation, undefined, 'unset, the spawn opts must be byte-identical to today')
  assert.doesNotMatch(lanePrompt.prompt, /ISOLATION/, 'the prompt must not mention worktree isolation')
})

test('--isolate-waves asks each lane to run in its own worktree', async () => {
  const { prompts, root } = await runIsolated(TWO_LANES, {
    '1.1': { id: '1.1', ok: true, handoff: handoffFor('1.1'), worktreePath: '/tmp/wt-1.1' },
    '2.1': { id: '2.1', ok: true, handoff: handoffFor('2.1'), worktreePath: '/tmp/wt-2.1' }
  })
  try {
    for (const label of ['1.1', '2.1']) {
      const lane = prompts.find(p => p.label === label)
      assert.ok(lane, `the isolated run must spawn lane ${label}`)
      assert.equal(lane.isolation, 'worktree', 'the lane spawn must request its own worktree')
      assert.match(lane.prompt, /ISOLATION — you are running in your own git worktree/)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an isolated batch captures the shared tree\'s base commit before its lanes fork', async () => {
  // Read before, not after, so nothing else lands on the shared tree between
  // the reading and the fold — and read by the CLI itself rather than by a
  // ping, which is one fewer agent turn and one fewer place to lose it.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /mergeBase = ctx\.deps\.headCommit\(root\)/)
  assert.match(
    run,
    /could not capture the shared-tree base commit before an isolated batch/,
    'and an unreadable base halts rather than being guessed'
  )
  const cli = readFileSync(join(ROOT, 'bin', 'interlock'), 'utf8')
  assert.match(cli, /'rev-parse', 'HEAD'/)
})

test('a merge that does not come back clean halts the run and names the survivors', async () => {
  // The fold is the CLI's, so the halt is asserted at the CLI: a collision or an
  // unresolved lane stops the run, names what could not be folded, and leaves
  // every worktree where it is.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /merge-lanes halted on wave/)
  assert.match(run, /real collision on \$\{JSON\.stringify\(merged\.collisions\)\}/)
  assert.match(run, /unresolved lane\(s\) \$\{JSON\.stringify\(merged\.unresolved\)\}/)
  assert.match(run, /surviving worktrees: \$\{survivors \|\| '\(none\)'\}/)
  // And the halt is a step whose continuation is the close, so a collision is
  // recorded rather than dropped.
  assert.match(run, /return finishStep\(ctx, manifest, haltStep\(\n\s*`merge-lanes halted/)
})

test('a failed lane never folds — its worktree is preserved and named', async () => {
  const { output, root } = await runIsolated(TWO_LANES, {
    '1.1': { id: '1.1', ok: false, error: 'blocked', handoff: null, worktreePath: '/tmp/wt-1.1' },
    '2.1': { id: '2.1', ok: true, handoff: handoffFor('2.1'), worktreePath: '/tmp/wt-2.1' }
  })
  try {
    assert.match(
      output,
      /LANE WORKTREE PRESERVED: 1\.1 at \/tmp\/wt-1\.1/,
      "a failed lane's writes are not folded, and where they are left is said out loud"
    )
    assert.doesNotMatch(
      output,
      /LANE WORKTREE PRESERVED: [^\n]*2\.1/,
      'the lane that succeeded is not preserved — it was folded'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the fold is offered only the lanes with no failed task', () => {
  // The projection that decides it, asserted at the one place that builds it: a
  // lane with any failed task contributes nothing to the shared tree, because
  // folding a partial write from a lane that stopped mid-way is the
  // silent-overwrite defect the merge policy refuses.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /if \(outcomes\.some\(o => o\.outcome === 'failed'\}?\)\) \{/)
  assert.match(run, /laneWorktreesPreserved\.push\(\{ label, worktreePath \}\)/)
  assert.match(run, /laneFoldCandidates\.push\(\{/)
})

test('the lane cap is stated once, read by the planner, and never restated in the script', () => {
  // Same rule as every other cap (openspec/specs/ship/cap-authority): the number
  // lives in lib/limits.mjs, the planner obeys it, `interlock limits` prints it,
  // and no prompt or script restates it.
  const waves = readFileSync(join(ROOT, 'lib', 'waves.mjs'), 'utf8')
  assert.match(
    waves,
    /LANE_CAPS\.byTier/,
    'lib/waves.mjs must read the per-tier lane cap — a cap only a test reads is a cap in prose'
  )
  const cli = readFileSync(join(ROOT, 'bin', 'interlock'), 'utf8')
  assert.match(readFileSync(join(ROOT, 'lib', 'limits.mjs'), 'utf8'), /export const LANE_CAPS = \{/)
  assert.match(cli, /interlock limits/, 'the CLI publishes the caps it reads')

  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  // Neither the old scalar nor the table that replaced it. The script dispatches
  // the lanes the planner built; the moment it carries a lane cap of its own,
  // there are two answers to how long a lane may get.
  assert.doesNotMatch(
    ship,
    /maxTasksPerAgent|LANE_CAPS/,
    'the script must not carry the lane cap: it dispatches the lanes the planner built'
  )
})

// --- the plan-shape flags (spec: solo-mode) --------------------------------
//
// `--solo` / `--waves` name the SHAPE of the plan, which is a different decision
// from `mode: continue|checkpoint` — hence `laneMode`. The override reaches the
// three commands that build or match a plan; `wave-state create` is not one of
// them, because it reads the mode off the plan file it is handed.

test('ship.js parseInvocation reads --solo and --waves into laneMode', () => {
  assert.equal(parseInvocationFromSource('my-change --solo').laneMode, 'solo')
  assert.equal(parseInvocationFromSource('my-change --waves').laneMode, 'waves')
  assert.equal(parseInvocationFromSource({ change: 'add-auth', flags: ['solo'] }).laneMode, 'solo')
})

test('ship.js parseInvocation leaves laneMode unset when neither flag is passed', () => {
  const parsed = parseInvocationFromSource('my-change')
  assert.equal(parsed.laneMode, null, 'absent, the classifier recommends inside the envelope')
  assert.equal(parsed.laneModeConflict, false)
})

test('ship.js parseInvocation reports --solo and --waves together as a conflict', () => {
  // Not last-wins: the two shapes produce different agent counts and different
  // bills, and this run has nobody to ask which was meant.
  const parsed = parseInvocationFromSource('my-change --solo --waves')
  assert.equal(parsed.laneModeConflict, true)
  assert.equal(parsed.laneMode, null, 'a contradiction resolves to no mode, never to one of them')
})

test('--solo and --waves together halt the run before anything is spawned', async () => {
  const { output, calls } = await runShip({ args: 'demo-change --solo --waves' })
  assert.match(output, /--solo and --waves were both passed/)
  assert.ok(
    !calls.includes('plan-waves'),
    `nothing may be planned on a contradictory invocation, got: ${calls.join(', ')}`
  )
})

test('--solo reaches the run as one flag, and the CLI threads it where it belongs', async () => {
  const { commands } = await runShip({ args: 'demo-change --solo' })
  const start = commands.find(c => c[1] === 'start')
  assert.ok(start, 'the run must begin with `run start`')
  assert.ok(
    start.includes('--mode') && start[start.indexOf('--mode') + 1] === 'solo',
    `the shape override must reach run start, got: ${start.join(' ')}`
  )
  // From there it is the CLI's: the reuse probe and the planner get it, and
  // `wave-state create` deliberately does not — it reads the mode off the plan
  // it is handed, and a flag there would be a second authority for a value the
  // plan already carries.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /resolvePlanReuse\(root, change, \{[\s\S]{0,120}mode: manifest\.flags\.laneMode/)
  assert.match(run, /planWaves\(classified, \{[\s\S]{0,120}mode: manifest\.flags\.laneMode/)
  assert.match(run, /createRunState\(plan, \{\n\s*maxParallel:/)
  assert.doesNotMatch(run, /createRunState\([\s\S]{0,120}mode:/)
})

test('no shape flag means no --mode anywhere: the plan is byte-identical to today', async () => {
  const { commands } = await runShip({})
  for (const argv of commands) {
    assert.ok(
      !argv.includes('--mode'),
      `\`interlock ${argv.join(' ')}\` carries a shape override that was never asked for`
    )
  }
})

// The implementer briefing follows the STEP, not the flag: a classifier
// recommendation inside the envelope reaches solo with no flag at all.

const soloLane = [laneTask('1.1'), laneTask('1.2')]

/**
 * A run whose plan is one solo lane, or the same two tasks as an ordinary lane.
 *
 * The mode comes off the PLAN, which is what makes this worth driving rather
 * than stubbing: `--solo` reaches `run start`, the planner builds a solo plan
 * inside the published envelope, the state carries the mode, and the step
 * echoes it. A fixture asserting `mode: 'solo'` on a step would prove only that
 * the fixture said so.
 */
function runSoloWave(args = 'demo-change --solo') {
  return runShip({
    keepRepo: true,
    args,
    classified: { tasks: soloLane },
    repo: { tasks: '# Tasks\n\n- [ ] 1.1 task 1.1\n- [ ] 1.2 task 1.2\n' },
    responses: {
      [labelFor(soloLane)]: {
        tasks: soloLane.map(t => ({ id: t.id, outcome: 'ok', handoff: laneHandoff(t.id) }))
      }
    }
  })
}

test('a plan in solo mode briefs the implementer as the whole change', async () => {
  const { prompts, root } = await runSoloWave()
  try {
    const prompt = prompts.find(p => p.label === labelFor(soloLane)).prompt
    assert.match(prompt, /Implement OpenSpec change "demo-change" end to end — all 2 of its tasks/)
    assert.match(prompt, /Your tier is 4\./, 'a solo agent is briefed at the full-read ladder')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the same two tasks in waves mode are briefed as an ordinary lane', async () => {
  const { prompts, root } = await runSoloWave('demo-change --waves')
  try {
    const prompt = prompts.find(p => p.label === labelFor(soloLane)).prompt
    assert.doesNotMatch(prompt, /end to end/)
    assert.match(prompt, /Implement 2 tasks from OpenSpec change "demo-change", IN THIS ORDER/)
    assert.match(prompt, /Your tier is 2\./)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
// --- the step transport ----------------------------------------------------
//
// The script has no shell, so it never reads CLI stdout itself: every step
// arrives through a relay agent. That used to make a returned step a CLAIM
// about a shape — the loop validated `batchesOf`/`dispatchableShape` before
// dispatching, because a batch transcribed as a list of task ids is a string
// with a truthy `length` and walked past the empty-batch guard.
//
// Two things changed. The step is now the CLI's own JSON, parsed whole rather
// than reassembled field by field from a schema — so there is no per-field
// transcription to get wrong. And the shape check moved to the party that
// builds the step: `lib/run.mjs` refuses to emit a batch it cannot dispatch,
// which is a check on the producer rather than on the transport.

test('the step schema is stated once, by the party that builds the step', () => {
  // Same rule as every cap (openspec/specs/ship/cap-authority), applied to a
  // shape: two statements of one transport is how only one of them got widened
  // when batches became lanes. There is one now, and it is the CLI's.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /export const STEP_SCHEMA = 'interlock\.run-step\/1'/)
  assert.match(run, /const PASS_THROUGH = Object\.freeze\(\[/, 'the carried fields are named once')
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), join(ROOT, 'bin', 'interlock-run')]) {
    const text = readFileSync(driver, 'utf8')
    assert.doesNotMatch(
      text,
      /STEP_FIELDS|STEP_SHAPE|batchesOf|dispatchableShape/,
      `${driver} restates the step shape — the transport is one JSON document now`
    )
  }
})

test('a batch the CLI cannot dispatch is refused where it is built, not where it lands', async () => {
  // The production failure: a batch with no dispatchable lane reached the loop
  // and threw OUTSIDE halt, so no outcome was recorded and no trajectory was
  // closed. The refusal is at the builder now, and it is a halt step — which
  // means it closes.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /if \(!lanes\.length \|\| lanes\.some\(lane => !Array\.isArray\(lane\) \|\| !lane\.length\)\)/)
  assert.match(run, /the state machine asked for a batch with no dispatchable lane/)

  // And a step whose action the program does not know is a named halt rather
  // than an unhandled branch.
  assert.match(run, /unrecognized step from the state machine: \$\{step\.action\}/)
})

test('a relay that could not be read halts, and the halt still closes', async () => {
  // The step never arrives as fields an agent mapped by hand — it is the CLI's
  // stdout, parsed or not. Neither outcome is a guess.
  const { output } = await runShip({
    responses: {
      // A relay that returns nothing at all: the harness answers the first
      // `interlock run start` with no stdout.
      'cli-1': null
    }
  })
  assert.match(output, /SHIP HALTED/)
  assert.match(output, /the CLI relay could not be read/)
})


// --- plan reuse (spec: plan-reuse) -----------------------------------------
//
// The classifier is the most expensive fixed step in a run. Reuse is only
// correct when a match was affirmatively established, and the run has to say
// which path it took either way — a run that silently changed its own cost is
// the failure the banner block exists to remove.
//
// The probe is the CLI's own now. It used to be an agent asked to run
// `interlock plan reuse`, copy its verdict, and — in the same turn — adopt the
// plan; a probe that claimed a match without producing a step was a reuse the
// script had to detect and refuse. There is no claim to refuse any more: `run
// start` calls `resolvePlanReuse` and either builds the run state from what it
// returned or does not.

test('a matching fingerprint skips the classifier entirely', async () => {
  // A first run stores the fingerprint; the second finds it and reuses the plan.
  // Driven twice against ONE repository, because reuse is a property of what the
  // first run left behind.
  const first = await runShip({ keepRepo: true })
  try {
    const second = await runShip({ keepRepo: true, repo: { reuseRoot: first.root } })
    assert.ok(
      !second.calls.includes('plan-waves'),
      `the classifier must not run when the plan was reused: ${second.calls.join(', ')}`
    )
    assert.match(second.output, /PLAN REUSED \(match\)/)
  } finally {
    rmSync(first.root, { recursive: true, force: true })
  }
})

test('a first run has no plan to reuse, and says which non-match it was', async () => {
  const { calls, output } = await runShip({})
  assert.ok(calls.includes('plan-waves'), 'no stored plan means the classifier runs')
  assert.match(output, /PLAN REBUILT \(no-plan\)/)
  assert.match(output, /no stored plan at \.claude\/ship\/plan\.json/)
})

test('every non-match rebuilds, and each names itself', () => {
  // The statuses are the CLI's, and the summary prints whichever one came back.
  // Asserted at the two ends rather than by forging six probe results: the
  // resolver publishes the vocabulary, and the summary renders it verbatim.
  const fingerprint = readFileSync(join(ROOT, 'lib', 'plan-fingerprint.mjs'), 'utf8')
  for (const status of [
    'no-plan',
    'unreadable-plan',
    'unreadable-fingerprint',
    'inputs-changed',
    'plan-format-changed',
    'check-failed'
  ]) {
    assert.ok(
      fingerprint.includes(`'${status}'`),
      `lib/plan-fingerprint.mjs no longer publishes the ${status} outcome`
    )
  }
  const receipt = readFileSync(join(ROOT, 'lib', 'receipt.mjs'), 'utf8')
  assert.match(receipt, /PLAN REBUILT \(\$\{summary\.plan\.status\}\): \$\{summary\.plan\.reason\}/)
  assert.match(receipt, /PLAN REUSED \(\$\{summary\.plan\.status\}\): \$\{summary\.plan\.reason\}/)
  // Reuse is never assumed: anything but an affirmative match rebuilds,
  // including an error while checking.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /if \(reuse\.reuse && reuse\.narrowed\)/)
  assert.match(run, /manifest\.plan = \{ reused: false, status: reuse\.status, reason: reuse\.reason \}/)
})

test('an all-complete plan reports no remaining work instead of an empty run', async () => {
  // Every task in the stored plan already ticked. That is not an empty run to
  // dispatch — it is a change with nothing left to do, and a zero-batch run
  // would report a clean ship that implemented nothing.
  const first = await runShip({ keepRepo: true })
  try {
    const second = await runShip({ keepRepo: true, repo: { reuseRoot: first.root } })
    assert.match(second.output, /NO REMAINING WORK: every task in the stored plan is already complete/)
    assert.ok(!second.calls.includes('commit'), 'nothing to commit — no work was dispatched')
    assert.ok(receiptFrom(first.root), 'and the run still records its outcome')
  } finally {
    rmSync(first.root, { recursive: true, force: true })
  }
})

test('the run stores the fingerprint, and says so when it could not', async () => {
  const { root } = await runShip({ keepRepo: true })
  try {
    assert.ok(
      existsSync(join(root, '.claude', 'ship', 'plan-fingerprint.json')),
      'a run that classified must store the fingerprint its plan was derived from'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  // And a store that failed is a banner, not silence: it costs the NEXT run a
  // classifier pass, which is a slow run nobody would otherwise diagnose.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /PLAN FINGERPRINT NOT STORED/)
  assert.match(run, /will re-classify every artifact from scratch/)
})

test('a name that resolves to nothing halts by name rather than as a relay failure', async () => {
  const { output } = await runShip({ args: 'no-such-change' })
  assert.match(output, /SHIP HALTED/)
  assert.match(output, /validate failed: change "no-such-change" not found/)
  assert.doesNotMatch(
    output,
    /the CLI relay could not be read/,
    'a refused invocation is not a broken transport, and reporting it as one sends the reader ' +
      'to the wrong place entirely'
  )
})

test('a run that halts before the reuse check says the plan path is unknown', async () => {
  const { output } = await runShip({ repo: { broken: true } })
  assert.match(output, /SHIP HALTED/)
  assert.match(
    output,
    /PLAN UNKNOWN: the run ended before the plan-reuse check reported/,
    '"we never found out" and "there was no prior plan" are different facts'
  )
})

// --- the degradation block, derived rather than accumulated ----------------
//
// The block used to print whatever happened to be in an accumulator, so silence
// and cleanliness were indistinguishable. It is derived from the recorded
// conditions instead, and the absence of a close is itself reported.

test('the block is always printed: either the degradations, or that there were none', async () => {
  // Silence is the failure this exists to remove. Every run prints one or the
  // other, and a run that skipped a check is not a clean run — which is why the
  // clean sentence is asserted where a clean list can actually be produced.
  const { output } = await runShip({
    repo: { profile: { version: 1, unit: { command: 'npm test' } } },
    responses: { verify: { results: [{ kind: 'unit', exitCode: 0, total: 1, passed: 1, failed: 0 }] } }
  })
  assert.ok(
    /No degradation banners/.test(output) || /VERIFICATION SKIPPED|UNAVAILABLE|NOT/.test(output),
    `the summary named neither its degradations nor their absence:\n${output}`
  )
  const { formatRunSummary } = await import('../lib/receipt.mjs')
  assert.match(
    formatRunSummary({ change: 'demo-change', summary: { plan: null }, flags: {}, degradations: [] }),
    /No degradation banners/,
    'an empty degradation list must be said out loud, never rendered as an empty section'
  )
})

test('a cap-exhausted verification is named in the degradation block', () => {
  // Read back off the wave state at close, not accumulated as it happened: the
  // count and the banner come from one place, so they cannot come apart.
  const receipt = readFileSync(join(ROOT, 'lib', 'receipt.mjs'), 'utf8')
  assert.match(receipt, /capExhaustedSkipReason\(\) \{\n\s*return 'verify-cap-reached'/)
  assert.match(receipt, /VERIFY CAP EXHAUSTED: \$\{closing\.capExhaustedVerifications\}/)
  assert.match(receipt, /skippedVerifications: closing/, 'and the receipt counts the same list')
  const waves = readFileSync(join(ROOT, 'lib', 'waves.mjs'), 'utf8')
  assert.match(waves, /SKIP_VERIFY_CAP = 'verify-cap-reached'/, 'one spelling, two readers')
})

test('unresolved errors carried past a wave are named', () => {
  const receipt = readFileSync(join(ROOT, 'lib', 'receipt.mjs'), 'utf8')
  assert.match(receipt, /UNRESOLVED ERRORS CARRIED PAST A WAVE: \$\{closing\.unresolvedErrors\}/)
  assert.match(receipt, /the fix budget was[\s\S]{0,40}spent and the run continued/)
})

test('a missing close is named as unknown, not treated as clean', () => {
  const receipt = readFileSync(join(ROOT, 'lib', 'receipt.mjs'), 'utf8')
  assert.match(receipt, /CLOSING STEP OUTCOME UNKNOWN/)
  assert.match(receipt, /were never observed/)
})

test('a failed task tick is surfaced rather than discarded', async () => {
  // A succeeded task whose checkbox could not be marked. Downstream, an
  // unchecked box is indistinguishable from a task that failed.
  const { root, output } = await runShip({
    keepRepo: true,
    repo: { readOnlyTasks: true }
  })
  try {
    assert.doesNotMatch(output, /No degradation banners/)
    assert.match(output, /TASK TICK FAILED/)
    assert.match(output, /1\.1/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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
// trusted is that nothing re-derives it: it is built by `lib/receipt.mjs` from
// what the run recorded, appended by the run's own close, and copied by name by
// `lib/run-log.mjs`. It used to be composed into a prompt and carried to the
// trajectory by an agent, which is why these tests once asserted on prompt
// text. They read the trajectory now, which is where every consumer reads it.

/** A run driven to completion, with its repository kept so the record can be read. */
function kept(opts = {}) {
  return runShip({ keepRepo: true, ...opts })
}

test('every exit path appends a receipt, and exactly one', async () => {
  const exits = {
    'a clean run': {},
    '--apply-only': { args: 'demo-change --apply-only' },
    '--no-commit': { args: 'demo-change --no-commit' },
    'a halt': {
      repo: { profile: { version: 1, unit: { command: 'npm test' } } },
      responses: { verify: { results: [{ kind: 'unit', exitCode: 1, total: 1, passed: 0, failed: 1 }] } }
    }
  }
  for (const [name, run] of Object.entries(exits)) {
    const { root } = await kept(run)
    try {
      const receipts = trajectory(root).filter(e => e.type === 'run-receipt')
      assert.equal(receipts.length, 1, `${name} appended ${receipts.length} receipts — a run has one close`)
      const events = trajectory(root).map(e => e.type)
      assert.ok(
        events.indexOf('run-receipt') < Math.max(
          events.indexOf('run-complete'),
          events.indexOf('run-halt')
        ),
        `${name} wrote its terminal event before its receipt`
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('the receipt carries the tallies, the plan verdict and the commit the summary printed', async () => {
  const { root, output } = await kept()
  try {
    const receipt = receiptFrom(root)
    assert.ok(receipt, 'no receipt reached the trajectory')

    assert.equal(receipt.type, 'run-receipt')
    assert.equal(receipt.change, 'demo-change')
    assert.deepEqual(receipt.waves, [{ wave: '1', ok: 1, failed: 0, notAttempted: 0 }])
    assert.match(output, /wave 1 \(run-batch\): 1 ok, 0 failed/)
    assert.equal(receipt.planReused, false, 'the default run rebuilds — and says which')
    assert.equal(receipt.planStatus, 'no-plan')
    assert.equal(receipt.halted, false)
    assert.equal(receipt.committed, true)
    assert.equal(receipt.commit, 'deadbee')
    assert.match(output, /commit: deadbee/)
    assert.deepEqual(receipt.leftoverTaskIds, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the receipt never carries the plan itself', async () => {
  const { root } = await kept()
  try {
    const receipt = receiptFrom(root)
    assert.equal(receipt.plan, undefined, 'plan identity travels as a hash, not as 46 KB of plan')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- the corpus line's provenance ------------------------------------------
//
// The closing step used to be handed the run's own measurements under "Correct
// any field that does not match what actually happened". That is the assessed
// party writing the assessment's inputs, in the file whose whole purpose is to
// answer "should we have skipped the human that time?".
//
// No step is handed them now. The close derives the observed half from the
// receipt it just wrote, in-process, and the reported half comes from the same
// place — so the invitation is not merely forbidden, it is unstatable.

test('the corpus line derives its observed half from the receipt, not from a report', async () => {
  const { root } = await kept()
  try {
    const outcome = outcomeFrom(root)
    assert.ok(outcome, 'the run appended no corpus line')
    assert.equal(outcome.change, 'demo-change')
    assert.ok(outcome.observed, 'the observed half must be present and derived')
    // And derived from the receipt, which is the only copy of these facts.
    const receipt = receiptFrom(root)
    assert.equal(outcome.observed.ok, !receipt.halted)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('no agent is in the corpus line\'s path at all', () => {
  // The structural version of the old prompt check. `appendOutcome` is called
  // by the close with `observedFromReceipt(receipt)`; there is no prompt in
  // which a value could be re-offered for correction.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /appendOutcome\(root, \{[\s\S]{0,160}observed: observedFromReceipt\(receipt\)/)
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), join(ROOT, 'bin', 'interlock-run')]) {
    assert.doesNotMatch(
      readFileSync(driver, 'utf8'),
      /outcomes append|record-outcome|record-receipt/,
      'no host composes, carries or transports the corpus line'
    )
  }
})

test('an outcome that could not be written is reported and never fails the run', () => {
  // Corpus-loss semantics differ by corpus, deliberately: the outcome corpus
  // reports its own write failures and never touches the exit code, while the
  // run trajectory is fatal.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /if \(!outcome\.written\) ctx\.warn\(`outcome not recorded/)
  assert.match(run, /losing a corpus line must not fail the run/)
  assert.match(run, /RUN NOT RECONSTRUCTABLE/, 'the trajectory check is the fatal one')
  assert.match(run, /exitCode: haltReason \|\| !reconstructable \? 1 : 0/)
})

test('the printed degradation banners and the receipt are the same list', async () => {
  // Computed once and used twice. Two derivations could only agree by luck, and
  // a banner disagreeing with the record is the same class of defect one level
  // up from the one the degradation block removes.
  const { root, output } = await kept({
    responses: {
      validate: { hasGraph: false, hasTestProfile: false, haikuAvailable: true }
    }
  })
  try {
    const receipt = receiptFrom(root)
    assert.ok(
      receipt.degradations.length >= 2,
      `too few degradations: ${JSON.stringify(receipt.degradations)}`
    )
    for (const line of receipt.degradations) {
      assert.ok(
        output.includes(line),
        `the receipt carries a degradation the summary never printed:\n${line}\n\nSummary:\n${output}`
      )
    }
    assert.match(output, /GRAPH UNAVAILABLE/)
    assert.match(output, /NO TEST PROFILE/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a halted run records a receipt naming the halt and every task left behind', async () => {
  // A halt with tasks unticked. A halted run is the most informative record in
  // the corpus, so it must not be the one that skips its receipt.
  const lane = [laneTask('1.1'), laneTask('1.2')]
  const { root, output } = await runShip({
    keepRepo: true,
    classified: { tasks: lane },
    repo: {
      tasks: '# Tasks\n\n- [ ] 1.1 task 1.1\n- [ ] 1.2 task 1.2\n',
      profile: { version: 1, unit: { command: 'npm test' } }
    },
    responses: {
      [labelFor(lane)]: {
        tasks: lane.map(t => ({ id: t.id, outcome: 'failed', error: 'no migration runner' }))
      },
      verify: { results: [{ kind: 'unit', exitCode: 1, total: 2, passed: 0, failed: 2 }] }
    }
  })
  try {
    const receipt = receiptFrom(root)
    assert.equal(receipt.halted, true)
    assert.ok(receipt.haltReason, 'a halted receipt with no reason is the record nobody can use')
    assert.match(output, /SHIP HALTED/)
    assert.deepEqual(receipt.leftoverTaskIds, ['1.1', '1.2'])
    assert.equal(receipt.commit, null, 'a halted run has no commit identifier to carry')
    assert.equal(
      receipt.committed,
      null,
      'and it never found out whether it would have committed — which is not the same as declining to'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- token spend, measured on the host that can ------------------------------
//
// The figure comes from the workflow runtime's own cumulative counter, read by
// the SCRIPT at wave boundaries and merely carried by an agent. That is what
// keeps it a measurement rather than a self-report — and it holds only as long
// as the transport does not invite the carrier to adjust it, which the last test
// in this block is about.

/** Two tasks in one group, path-disjoint so they hold separate lanes. */
function waveGroup(prefix, group, over = {}) {
  return [
    laneTask(`${prefix}.1`, { group, paths: [`lib/${prefix}a.mjs`], ...over }),
    laneTask(`${prefix}.2`, { group, paths: [`lib/${prefix}b.mjs`], ...over })
  ]
}

/** `# Tasks` markdown listing every task in `waves`, in order. */
function tasksMdFor(waves) {
  return '# Tasks\n\n' + waves.flat().map(t => `- [ ] ${t.id} ${t.description}`).join('\n') + '\n'
}

/** The lane response every task in a wave succeeded, threaded as a handoff. */
function laneOk(wave) {
  return { tasks: wave.map(t => ({ id: t.id, outcome: 'ok', handoff: laneHandoff(t.id) })) }
}

test('a run of three waves records three wave figures and one run total', async () => {
  // Each group holds two path-disjoint tasks so the planner's singleton fold
  // (lib/waves.mjs) cannot collapse it onto the previous wave as a later batch
  // — that fold is what a one-task group would trigger, and it would turn this
  // into a one-wave run silently.
  const waves = [waveGroup('1', 1), waveGroup('2', 2), waveGroup('3', 3)]
  const { root } = await runShip({
    keepRepo: true,
    budget: countingBudget(1000),
    classified: { tasks: waves.flat() },
    repo: { tasks: tasksMdFor(waves) },
    responses: Object.fromEntries(waves.map(w => [labelFor(w), laneOk(w)]))
  })
  try {
    const receipt = receiptFrom(root)
    assert.deepEqual(receipt.spend.map(s => s.wave), ['1', '2', '3'])
    for (const entry of receipt.spend) {
      assert.equal(typeof entry.outputTokens, 'number', `wave ${entry.wave} recorded no figure`)
      assert.ok(entry.outputTokens > 0, `wave ${entry.wave} recorded ${entry.outputTokens}`)
    }
    assert.equal(typeof receipt.outputTokens, 'number')
    assert.ok(receipt.outputTokens > 0)

    // Each wave's figure is its own span, not the cumulative reading: three waves
    // in a row that all reported the running total would be the boundary-drift
    // defect, and every number would still look plausible.
    const cumulative = receipt.spend.reduce((sum, s) => sum + s.outputTokens, 0)
    assert.ok(cumulative <= receipt.outputTokens, 'the wave spans sum to no more than the run')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a verification-only span records its measured delta, not an assumed zero', async () => {
  // A red inter-wave verify halts the run before wave 2's batch ever spawns —
  // so wave 1's recorded figure is either one mark's worth (if the verify
  // step's own turns were assumed free) or two (if they were measured). Two is
  // the only value a real inter-wave verify can produce.
  const perRead = 500
  const waves = [waveGroup('1', 1), waveGroup('2', 2)]
  const { root } = await runShip({
    keepRepo: true,
    budget: countingBudget(perRead),
    classified: { tasks: waves.flat() },
    repo: {
      tasks: tasksMdFor(waves),
      profile: { version: 1, unit: { command: 'npm test' } }
    },
    responses: {
      [labelFor(waves[0])]: laneOk(waves[0]),
      'inter-wave-verify-': { ok: false, unitGreen: false, detail: 'suite is red' }
    }
  })
  try {
    const receipt = receiptFrom(root)
    assert.deepEqual(receipt.spend.map(s => s.wave), ['1'], 'wave 2 never dispatched a batch')
    assert.equal(
      receipt.spend[0].outputTokens,
      perRead * 2,
      'a span with no implementer is not a span with no cost — the verify step added its own delta'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a runtime with no token accounting records unknown rather than throwing', async () => {
  // The harness passes no `budget` here, so the script sees no such global at
  // all — the ACP host's case, and the one a bare reference would have died on.
  const { root, output } = await runShip({ keepRepo: true })
  try {
    const receipt = receiptFrom(root)
    assert.deepEqual(receipt.spend, [{ wave: '1', outputTokens: null }])
    assert.equal(receipt.outputTokens, null)
    assert.match(output, /SHIP COMPLETE|SHIP HALTED/, 'the run still finished')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a budget with no target set is still measured — the guard is on spent(), not total', async () => {
  // `budget.total` is null whenever no token target was given, while `spent()`
  // stays meaningful. A guard written against `total` would blank the
  // measurement on every ordinary run and nothing would say so.
  const budget = countingBudget(250)
  assert.equal(budget.total, null)
  const { root } = await runShip({ keepRepo: true, budget })
  try {
    const receipt = receiptFrom(root)
    assert.equal(typeof receipt.outputTokens, 'number')
    assert.ok(receipt.outputTokens > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a runtime that stops exposing accounting mid-run degrades rather than failing the run', async () => {
  let reads = 0
  let spent = 0
  const budget = {
    total: null,
    spent() {
      // Exposed for the first few reads, then gone.
      if (++reads > 2) throw new Error('accounting withdrawn')
      spent += 400
      return spent
    }
  }
  const { root, output } = await runShip({ keepRepo: true, budget })
  try {
    const receipt = receiptFrom(root)
    assert.match(output, /SHIP COMPLETE|SHIP HALTED/, 'the run must not fail over a measurement')
    assert.ok(Array.isArray(receipt.spend))
    for (const entry of receipt.spend) {
      assert.ok(
        entry.outputTokens === null || entry.outputTokens >= 0,
        `wave ${entry.wave} recorded ${entry.outputTokens}`
      )
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the host hands its measurements to the close, and the close does not re-derive them', () => {
  // The whole basis for calling token spend a measurement rather than a
  // self-report is that the host computed it from the runtime's own counter and
  // the CLI merely records it. One place that recomputed it would undo that,
  // which is how the same defect once got into the outcome record.
  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  assert.match(ship, /'--host-observed'/, 'the host names the channel')
  assert.match(ship, /outputTokens:\n?\s*spentAtClose === null \|\| spendOpenedAt === null/)
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  // The host's own figures WIN wherever it has any. A runner host has no
  // process-wide counter, so its adapters read each vendor envelope's usage and
  // the close adds those up (design D9) — addition of reported measurements,
  // never a re-derivation of the Workflow runtime's.
  assert.match(
    run,
    /const hostSpend = Array\.isArray\(observed\.spend\) && observed\.spend\.length \? observed\.spend : null/
  )
  assert.match(run, /spend: hostSpend \|\| counted\.spend/, 'the host measurement takes precedence')
  assert.match(run, /outputTokens: hostTotal !== undefined \? hostTotal : counted\.outputTokens/)
  assert.match(
    run,
    /UNKNOWN IS NOT ZERO, and it is contagious by design/,
    'and one unmeasured spawn makes its group unknown rather than smaller'
  )
  assert.match(
    run,
    /this process — running BETWEEN agent turns — never sees/,
    'and the CLI says why it cannot measure it itself'
  )
  // An absent figure stays absent rather than becoming zero.
  assert.match(run, /: undefined\n\s*,?/)
  assert.match(run, /An absent field stays absent — never zero/)
})

// --- what a halt left behind ------------------------------------------------
//
// Found by running the thing, not by reading it: a real halt at verification
// produced a receipt with `leftoverTaskIds: []` while three boxes sat unchecked
// in tasks.md. Leftovers had been derived from the failure list, and a wave the
// halt stopped from ever running has no failures in it — so the receipt of the
// run that most needed to say what it dropped said nothing.

test('a halt names every unchecked task, not only the ones that failed', async () => {
  // 1.1 failed; 2.1 sits in a later wave the halt stopped from ever running.
  // Both are still unchecked, and both are what a later reader has to be told.
  const tasks = [laneTask('1.1'), laneTask('2.1', { group: 2, paths: ['lib/b.mjs'] })]
  const { root, output } = await runShip({
    keepRepo: true,
    classified: { tasks },
    repo: { tasks: '# Tasks\n\n- [ ] 1.1 task 1.1\n- [ ] 2.1 task 2.1\n' },
    responses: {
      '1.1': { id: '1.1', ok: false, error: 'no migration runner', handoff: null }
    }
  })
  try {
    const receipt = receiptFrom(root)
    assert.deepEqual(
      receipt.leftoverTaskIds,
      ['1.1', '2.1'],
      'a task a halt stopped from running is left behind exactly as much as one that failed'
    )
    // And the banner a human reads is the same list, not the failure subset.
    assert.match(output, /2\.1/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('leftovers are read from the checkboxes, never derived from the failure list', () => {
  // The failure list is a subset of the truth by construction. It survives only
  // as the fallback for a run whose change cannot be read at all — and what it
  // must never become is `[]`, which reads as "finished everything".
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /function readLeftoverIds\(root, manifest\)/)
  assert.match(run, /items\.filter\(t => t && t\.done === false\)/, 'the checkbox is the source')
  assert.match(
    run,
    /return \(manifest\.waves \|\| \[\]\)\.flatMap\(w => w\.failedIds \|\| \[\]\)/,
    'and the failure list is only the fallback'
  )
  assert.match(run, /"Left behind" is not "failed"/)
})

test('--no-commit and --apply-only record "did not commit", not "never found out"', async () => {
  for (const args of ['demo-change --no-commit', 'demo-change --apply-only']) {
    const { root } = await runShip({ keepRepo: true, args })
    try {
      const receipt = receiptFrom(root)
      assert.equal(receipt.committed, false, `${args}: the run chose not to commit and must say so`)
      assert.equal(receipt.commit, null, `${args}: and carries no identifier`)
      assert.equal(receipt.halted, false, `${args}: an early return is not a halt`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('a run that never reviewed reports no review counts rather than zero blockers', async () => {
  const lean = await runShip({ keepRepo: true })
  const strict = await runShip({ keepRepo: true, args: 'demo-change --strict' })
  try {
    const leanReceipt = receiptFrom(lean.root)
    assert.equal(
      leanReceipt.reviewBlockers,
      null,
      'a lean run never reviewed — 0 blockers would be a lie'
    )
    assert.equal(leanReceipt.reviewRaised, null)

    const strictReceipt = receiptFrom(strict.root)
    assert.equal(strictReceipt.reviewRaised, 2)
    assert.equal(strictReceipt.reviewSurviving, 1)
    assert.equal(strictReceipt.reviewBlockers, 0)
    assert.equal(
      strictReceipt.reviewWarnings,
      1,
      'surviving minus blockers, from two counts that were observed'
    )
  } finally {
    rmSync(lean.root, { recursive: true, force: true })
    rmSync(strict.root, { recursive: true, force: true })
  }
})

/**
 * A `commit` response that performs a REAL git commit against `root` and
 * reports the sha it produced — the one way to exercise `readTouchedPaths`
 * (`lib/run-paths.mjs`) honestly, since it shells out to git rather than
 * trusting anything an agent claims. Touches only `lib/a.mjs`, so the observed
 * set is exactly the one path these tests assert on.
 */
function realCommit(root, message = 'feat: bump a') {
  return () => {
    writeFileSync(join(root, 'lib', 'a.mjs'), 'export const a = 2\n')
    execFileSync('git', ['add', 'lib/a.mjs'], { cwd: root })
    execFileSync('git', ['commit', '-qm', message], { cwd: root })
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    return { ok: true, sha }
  }
}

test('a committing run records both path sets, read by the CLI and not by the agent', async () => {
  // No agent ever reports a path set in this design — `run close` reads both
  // itself (`lib/run-paths.mjs`, against the sha and the stored plan), which is
  // the property this test now demonstrates structurally: the commit agent
  // reports only `{ok, sha}` and the receipt's path sets still come out right.
  const { root, change } = makeRepo({})
  await runShip({
    keepRepo: true,
    repo: { reuseRoot: root, change },
    responses: { commit: realCommit(root) }
  })
  try {
    const receipt = receiptFrom(root)
    assert.deepEqual(receipt.touchedPaths, ['lib/a.mjs'])
    assert.deepEqual(receipt.predictedPaths, ['lib/a.mjs'])
    assert.equal(receipt.predictedPathsComplete, true)
    assert.equal(receipt.touchedPathsReason, null, 'an observed set carries no reason')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a run with no commit records the touched set unobserved, never as empty', async () => {
  for (const args of ['demo-change --no-commit', 'demo-change --apply-only']) {
    const { root } = await runShip({ keepRepo: true, args })
    try {
      const receipt = receiptFrom(root)
      assert.equal(receipt.touchedPaths, null, `${args}: unobserved, so the field is null`)
      assert.notDeepEqual(receipt.touchedPaths, [], `${args}: [] would assert a commit that touched nothing`)
      assert.match(receipt.touchedPathsReason, /does not commit/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('a halted run records the touched set unobserved with a stated reason', async () => {
  // The plan itself was already written to disk before verification ever ran,
  // so a halt at verify leaves `predictedPaths` observed — it is only the
  // commit half that never happened, and only that half reads as unobserved.
  const { root } = await runShip({
    keepRepo: true,
    repo: { profile: { version: 1, unit: { command: 'npm test' } } },
    responses: { verify: { ok: false, unitGreen: false, detail: 'suite is red' } }
  })
  try {
    const receipt = receiptFrom(root)
    assert.equal(receipt.halted, true)
    assert.equal(receipt.touchedPaths, null)
    assert.match(receipt.touchedPathsReason, /no commit identifier/)
    assert.deepEqual(receipt.predictedPaths, ['lib/a.mjs'])
    assert.equal(receipt.predictedPathsComplete, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a plan that predicted for only some tasks is carried as incomplete, not as short', async () => {
  const laneTaskNoPath = laneTask('1.2', { paths: [] })
  const wave1 = [laneTask('1.1'), laneTaskNoPath]
  const { root } = await runShip({
    keepRepo: true,
    classified: { tasks: wave1 },
    repo: { tasks: '# Tasks\n\n' + wave1.map(t => `- [ ] ${t.id} ${t.description}`).join('\n') + '\n' },
    responses: {
      [labelFor(wave1)]: { tasks: wave1.map(t => ({ id: t.id, outcome: 'ok', handoff: laneHandoff(t.id) })) }
    }
  })
  try {
    const receipt = receiptFrom(root)
    assert.deepEqual(receipt.predictedPaths, ['lib/a.mjs'], 'the union carries only what was declared')
    assert.equal(receipt.predictedPathsComplete, false, 'one task declared no paths, so the set is incomplete')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- the receipt and the adjudication live in lib/, reached through run close --
//
// These used to pin the ACP driver to ship.js's marked blocks (`BUILD_RECEIPT`,
// `RECORDED_VERDICT`) — the mechanism by which two hosts wrote "the same"
// receipt without a second implementation. The mechanism is gone with the
// duplication it served: `lib/receipt.mjs` builds the receipt and the summary,
// `lib/run.mjs` adjudicates and reads the leftovers and both path sets, and a
// driver reaches all of it through `interlock run close`. So what is pinned now
// is that the modules do what the blocks did, and that no driver has grown a
// copy back.

const RECEIPT_MODULE = await import('../lib/receipt.mjs')
const RUN_MODULE = await import('../lib/run.mjs')

test('the receipt builder is one module, and neither driver carries a marked block of it', () => {
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), RUNNER_DRIVER]) {
    const text = readFileSync(driver, 'utf8')
    for (const marker of ['BUILD_RECEIPT_START', 'RECORDED_VERDICT_START', 'buildReceipt(', 'adjudicateBatches(']) {
      assert.ok(!text.includes(marker), `${driver} carries ${marker} — the receipt and the verdict are the CLI's`)
    }
  }
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(
    run,
    /import \{\n(?:\s+\w+,\n)*\s+\w+\n\} from '\.\/receipt\.mjs'/,
    'lib/run.mjs must take the receipt builder from the one module that owns it'
  )
  for (const name of ['buildReceipt', 'formatRunSummary', 'tailFromManifest']) {
    assert.equal(typeof RECEIPT_MODULE[name], 'function', `lib/receipt.mjs must export ${name}`)
  }
})

test('the CLI ticks and tallies from what it recorded, never from the agent\'s claim', () => {
  // The defect was in both hosts because both computed "what succeeded" from the
  // agent's `ok` field. There is one adjudication now, in the run program.
  const { recordedOutcomes, adjudicateBatches, claimDerivedBanner } = RUN_MODULE
  const claims = [[{ id: '1.1', ok: true }, { id: '1.2', ok: true }]]
  const verdict = adjudicateBatches(
    claims,
    recordedOutcomes([{ id: '1.1', outcome: 'failed', reason: 'invalid handoff' }, { id: '1.2', outcome: 'ok' }])
  )
  assert.deepEqual(verdict.tickIds, ['1.2'])
  assert.deepEqual(verdict.waves, [{ ok: 1, failed: 1, failedIds: ['1.1'], recordedNotAttempted: [] }])
  assert.equal(verdict.claimDerived, false)
  assert.deepEqual(verdict.overrides.map(o => o.id), ['1.1'])

  // A payload covering only some of the claims is no payload: tallying the rest
  // from the claim while reading as recorded is the same defect one level down.
  const partial = adjudicateBatches(claims, recordedOutcomes([{ id: '1.1', outcome: 'ok' }]))
  assert.equal(partial.claimDerived, true)
  assert.match(claimDerivedBanner(), /CLAIM-DERIVED TALLIES/)

  // And the tick reads the verdict, not the claims.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /verdict\.tickIds/)
  assert.doesNotMatch(run, /\.filter\(r => r\.ok\)/, 'the tick list must not be rebuilt from the agents own claims')
})

test('the CLI asks the checkboxes what is unchecked instead of listing failures', () => {
  // A halt leaves waves that never ran and never failed. The leftover list is
  // read from tasks.md by the close; no driver derives it, and no driver runs a
  // second reader of its own.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /function readLeftoverIds\(root, manifest\)/)
  assert.match(run, /leftoverTaskIds = readLeftoverIds\(root, manifest\)/)
  assert.doesNotMatch(run, /leftoverTaskIds: .*waves\.flatMap/, 'the failure list is not the leftover list')
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), RUNNER_DRIVER]) {
    const text = readFileSync(driver, 'utf8')
    assert.doesNotMatch(text, /leftoverTaskIds|unticked\(/, `${driver} derives leftovers — that is the close's`)
  }
})

test('the receipt builder produces the whitelisted shape', () => {
  const { buildReceipt } = RECEIPT_MODULE
  const empty = buildReceipt({})
  assert.equal(empty.type, 'run-receipt')
  assert.equal(empty.halted, false)
  assert.deepEqual(empty.waves, [])
  assert.equal(empty.committed, undefined, 'an empty summary never found out anything')

  const filled = buildReceipt({
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

test('a host that could not measure spend reads as unknown, not as a run that spent nothing', () => {
  const { buildReceipt } = RECEIPT_MODULE
  const waves = [
    { wave: 1, ok: 2, failed: 0, notAttempted: [] },
    { wave: 2, ok: 1, failed: 0, notAttempted: [] }
  ]
  const unmeasured = buildReceipt({
    change: 'add-widget',
    summary: { waves, spend: waves.map(w => ({ wave: w.wave, outputTokens: null })), outputTokens: null }
  })
  assert.deepEqual(unmeasured.spend, [
    { wave: 1, outputTokens: null },
    { wave: 2, outputTokens: null }
  ])
  assert.equal(unmeasured.outputTokens, null)

  const measuredNothing = buildReceipt({
    change: 'add-widget',
    summary: { waves, spend: waves.map(w => ({ wave: w.wave, outputTokens: 0 })), outputTokens: 0 }
  })
  assert.notEqual(unmeasured.spend[0].outputTokens, measuredNothing.spend[0].outputTokens)
  assert.notEqual(unmeasured.outputTokens, measuredNothing.outputTokens)
})

test('the runner hands the close no spend figure, and the close never invents one', () => {
  // ACP has no token counter. The temptation is concrete — the Workflow host
  // carries a per-run counter for the same field — so the absence of an
  // estimate is asserted, not hoped for: the driver names no figure at all, and
  // the close records a figure only when a host observed one.
  const driver = readFileSync(RUNNER_DRIVER, 'utf8')
  assert.doesNotMatch(driver, /outputTokens/, 'the ACP host must never compute a spend figure')
  assert.doesNotMatch(driver, /--host-observed/, 'and it hands the close nothing to read one from')
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(
    run,
    /typeof observed\.outputTokens === 'number' \|\| observed\.outputTokens === null\n\s*\? observed\.outputTokens\n\s*: undefined/,
    'an unobserved spend stays undefined, which the writer records as unknown'
  )
})

test('the close reads both path sets itself, so no host has to declare itself unable', () => {
  // The one host difference that used to need declaring: the Workflow host
  // asked an agent to run the two readers, the ACP driver ran them itself. The
  // close runs them now, and neither driver mentions a path set.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /import \{ readPredictedPaths, readTouchedPaths \} from '\.\/run-paths\.mjs'/)
  assert.match(run, /paths: readPathSets\(root, manifest\)/, 'the sets ride in their own group, not folded into closing')
  assert.doesNotMatch(run, /closing: \{[^}]*closingFromWaveState/)
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), RUNNER_DRIVER]) {
    const text = readFileSync(driver, 'utf8')
    assert.doesNotMatch(text, /touchedPaths|predictedPaths|'paths',/, `${driver} reads a path set — that is the close's`)
  }
})

test('the shared builder records a close that could read neither set as unobserved', () => {
  const { buildReceipt } = RECEIPT_MODULE
  const unread = buildReceipt({
    change: 'add-widget',
    summary: {
      waves: [],
      paths: {
        touchedPathsReason: 'the run recorded no commit identifier',
        predictedPathsReason: 'no executed plan was found at .claude/ship/plan.json'
      }
    }
  })
  assert.equal(unread.touchedPaths, undefined)
  assert.equal(unread.predictedPaths, undefined)
  assert.equal(unread.predictedPathsComplete, undefined)
  assert.match(unread.touchedPathsReason, /no commit identifier/)
  assert.match(unread.predictedPathsReason, /no executed plan/)

  const read = buildReceipt({
    change: 'add-widget',
    summary: {
      waves: [],
      commit: { ok: true, sha: 'cafe123' },
      paths: {
        touchedPaths: ['lib/a.mjs'],
        predictedPaths: ['lib/a.mjs', 'lib/b.mjs'],
        predictedPathsComplete: true
      }
    }
  })
  assert.deepEqual(read.touchedPaths, ['lib/a.mjs'])
  assert.equal(read.predictedPathsComplete, true)
  assert.equal(read.touchedPathsReason, undefined)

  // An unreadable wave state still leaves the verification conditions unknown,
  // whichever way the path sets went.
  assert.equal(read.skippedVerifications, undefined)
  assert.equal(unread.unresolvedErrors, undefined)
})

// --- a driver holds no policy (spec: ship/run-program) ----------------------
//
// The reason `interlock run` exists: a driver that holds nothing cannot drift.
// The sweep below is the published list of what "nothing" means — every token
// is a piece of policy that lives in lib/ and is assembled into a briefing by
// the CLI, so its appearance in a driver is a second statement.
//
// There is no allowance. The strict tail used to be one — a named
// `HOST_TAIL_SEAM` marker whose text the sweep skipped — and
// `emit-strict-tail-from-cli` deleted both the seam and the skip. The tail's
// own tokens are in the list below precisely so the deletion cannot be undone
// by accident.

/** The policy a driver may not restate. Each entry names what the token is a piece of. */
const NO_POLICY_TOKENS = [
  ['the tier ladder', /Tier [1-5] [a-z]/],
  ['the implementer tier line', /Your tier is/],
  ['the dependsOn contract', /dependsOn/],
  ['the handoff schema', /interlock\.wave-handoff\/1/],
  ['the classifier mode field', /recommendedMode/],
  ['the remediation budget', /remediationRounds|roundCap/],
  ['the lane model table', /laneModel/],
  ['the lane effort table', /laneEffort/],
  ['the lane label rule', /laneLabel/],
  ['the implementer assembler', /assembleImplementerPrompt/],
  ['the docs-only verify skip', /docs-only/],
  ['the no-command verify skip', /no-detectable-command/],
  ['the verify cap skip', /verify-cap-reached/],
  // The runner CREATES a lane worktree from the base the step named (design
  // D7), so `step.mergeBase` is a field it reads, not a rule it states. What it
  // must never do is DECIDE the fold or compute a base of its own — asserted
  // both by these tokens and, positively, by the test below.
  ['the lane merge', /merge-lanes|mergeDecision|rev-parse/],
  ['the verify judgement', /verify judge|exitCode !== 0/],
  ['the step-cap literal', /maxRunSteps\s*[=:]\s*\d/],
  // The strict tail. Each of these was in ship.js until
  // `emit-strict-tail-from-cli`, and each is a piece of the review, the
  // remediation plan, the handoff decision or the autonomy record that the run
  // program now states exactly once.
  ['the skeptic verdict shape', /isReal|qualityScore|severityScore/],
  ['the re-review dimension list', /reReviewDimensions/],
  ['the fixer grouping', /byFile/],
  ['the manual-test-plan decision', /needsManualTestPlan/],
  ['the autonomy record', /autonomy record|autonomy/],
  ['the review dimension set', /technical-lead/],
  ['the skeptic effort literal', /xhigh/]
]

/** A driver's source with comments removed. */
function policySurface(path) {
  // A comment that CITES where a rule lives is not a statement of the rule.
  return readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, '')
}

test('neither driver states any policy the run program emits', t => {
  const drivers = [
    ['workflows/ship.js', join(WORKFLOWS_DIR, 'ship.js')],
    ['bin/interlock-run', RUNNER_DRIVER]
  ]
  for (const [name, path] of drivers) {
    const surface = policySurface(path)
    for (const [what, token] of NO_POLICY_TOKENS) {
      assert.doesNotMatch(
        surface,
        token,
        `${name} states ${what} (${token}) — it belongs in lib/, assembled by interlock run`
      )
    }
  }
  t.diagnostic(`swept ${NO_POLICY_TOKENS.length} policy tokens over ${drivers.length} drivers`)
})

test('the runner takes the merge base from the step and never computes one', () => {
  // The compensating half of the sweep's `mergeBase` allowance. Reading the
  // field a step handed it is the interpreter contract; deriving a base would
  // make the driver an orchestrator, and a lane forked from a commit the CLI
  // did not choose is a fold that silently finds the wrong diff.
  const driver = policySurface(RUNNER_DRIVER)
  assert.match(driver, /step\.mergeBase/, 'it reads the base off the step')
  assert.doesNotMatch(driver, /mergeBase\s*=\s*(?!=)/, 'and never assigns one of its own')
  assert.doesNotMatch(driver, /rev-parse/, 'so it never asks git for a base')
  assert.doesNotMatch(driver, /collision|survivingWorktrees/, 'and it never adjudicates the fold')
  // It creates and nothing else: removal is `run record-batch`'s, uniformly,
  // so a folded worktree and an auto-removed empty one end the same way.
  assert.match(driver, /'worktree',\s*'add'/, 'it creates the lane worktree')
  assert.doesNotMatch(driver, /'worktree',\s*'remove'/, 'and does not remove it')
})

test('no driver carries a tail seam, and the sweep has no allowance to skip', () => {
  // The property the deleted `HOST_TAIL_SEAM` allowance used to hold open. It
  // is asserted from both ends: no marker survives in either driver, and the
  // sweep helper reads the whole file rather than a prefix of it.
  for (const path of [join(WORKFLOWS_DIR, 'ship.js'), RUNNER_DRIVER]) {
    const text = readFileSync(path, 'utf8')
    assert.ok(!text.includes('HOST_TAIL_SEAM'), `${path} still names a tail seam`)
    assert.ok(!text.includes("'host-tail'"), `${path} still handles a host-tail step`)
    assert.equal(
      policySurface(path).length,
      text.replace(/^\s*\/\/.*$/gm, '').length,
      `${path}: the sweep must read the whole driver, not a prefix`
    )
  }
})

test('the bootstrap is plumbing pinned by fixture, so it cannot quietly grow instructions', () => {
  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const m = /const BOOTSTRAP = \(label, path, sha\) =>\n([\s\S]*?Expected sha256: \$\{sha\}`)/.exec(ship)
  assert.ok(m, 'ship.js must declare BOOTSTRAP as (label, path, sha) =>')
  const bootstrap = new Function('label', 'path', 'sha', `return (${m[1]})`)
  const expected = readFileSync(join(ROOT, 'test', 'fixtures', 'prompts', 'bootstrap.txt'), 'utf8')
  assert.equal(
    bootstrap('1.1', '.claude/ship/briefings/1.1.md', '0123456789abcdef'.repeat(4)),
    expected,
    'the bootstrap text differs from test/fixtures/prompts/bootstrap.txt'
  )
  // It names a file and a field and nothing about the work.
  assert.doesNotMatch(expected, /tier|handoff|tasks\.md|openspec/i)
})

test('the Workflow script calls run start by literal and every later run subcommand from then.argv', () => {
  const ship = readFileSync(join(WORKFLOWS_DIR, 'ship.js'), 'utf8')
  const literal = [...ship.matchAll(/cli\(\[\s*'run',\s*'([a-z-]+)'(,\s*'([^']+)')?/g)].map(m => ({
    sub: m[1],
    next: m[3] || null
  }))
  assert.deepEqual(
    literal.map(l => l.sub).sort(),
    ['close', 'start'],
    `ship.js names a run subcommand by literal: ${literal.map(l => l.sub).join(', ')}`
  )
  // The one literal close is the halt path: a run that lost its step has no
  // `then.argv` to follow, so the close is the only continuation it can name.
  const close = literal.find(l => l.sub === 'close')
  assert.equal(close.next, '--halt', 'a literal run close is only ever the halt close')
  // Every other continuation is the step's own.
  assert.match(ship, /: await cli\(step\.then\.argv, results\)/)
  assert.match(ship, /await cli\(\[\.\.\.step\.then\.argv, \.\.\.closeArgs\(\)\], results, closeWrites\(\)\)/)
})

test('the runaway backstop is the runtime ceiling and not the step cap, on both drivers', () => {
  for (const driver of [join(WORKFLOWS_DIR, 'ship.js'), RUNNER_DRIVER]) {
    const text = readFileSync(driver, 'utf8')
    const m = /const RUNAWAY_BACKSTOP = (\d+)\s*$/m.exec(text)
    assert.ok(m, `${driver} must declare RUNAWAY_BACKSTOP as a bare integer literal, derived from nothing`)
    const backstop = Number(m[1])
    assert.notEqual(backstop, LIMITS.maxRunSteps, `${driver}: the backstop restates maxRunSteps`)
    assert.ok(
      backstop > LIMITS.maxRunSteps,
      `${driver}: a backstop at or below the cap is a policy cap the CLI did not publish`
    )
    assert.doesNotMatch(text, /RUNAWAY_BACKSTOP = [^\n]*(\+|maxRunSteps|LIMITS)/, `${driver}: the backstop is derived`)
    assert.doesNotMatch(text, /MAX_LOOP_STEPS/, `${driver}: the old literal is back`)
  }
})

// --- docs/14: the consumer posture, pinned -----------------------------------
//
// Following the precedent above ('the docs frame ACP as an opt-in second host'):
// distinguishing tokens rather than whole sentences, so an ordinary rewording
// keeps the pin and a reversal of meaning does not survive it. This page is the
// one place a consuming team is told what is checked, what is recorded and that
// none of it gates — claims that are load-bearing precisely because nobody in
// that team will read the harness to check them.

const EVALS_DOC = join(ROOT, 'docs', '14-evals.md')

/** Prose with line breaks and markdown emphasis flattened, so a pin matches the claim. */
const flatten = text => text.replace(/\*\*/g, '').replace(/\s+/g, ' ')

test('docs/14 exists and is reachable from the entry document', () => {
  // A failure, never a skip: an absent page states nothing to anyone, and a
  // skipping test would report the same green as a page that says everything.
  assert.ok(existsSync(EVALS_DOC), 'docs/14-evals.md must exist — the consumer posture lives nowhere else')

  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  assert.match(readme, /docs\/14-evals\.md/, 'the entry document must link the page')
})

test('docs/14 states what is checked, by which command, and separates the preflight', () => {
  // Read with whitespace and emphasis flattened: the pin is on the claim, and a
  // line break or a pair of asterisks moving is exactly the reword it must survive.
  const doc = flatten(readFileSync(EVALS_DOC, 'utf8'))

  assert.match(doc, /exit code is the decision/i)
  assert.match(doc, /interlock doctor/)
  assert.match(doc, /grades the machine before the run/i)
  assert.match(doc, /grade the run as it proceeds|grades the run as it proceeds/i)
  // A sample of the in-run deciders, each named with its command rather than
  // described in prose.
  for (const command of [
    'interlock validate',
    'interlock gate',
    'interlock verify unit',
    'interlock run-log check'
  ]) {
    assert.ok(doc.includes(command), `docs/14 must name ${command} as the command that decides`)
  }
})

test('docs/14 states what is recorded, where, that it gates nothing, and links the keep guidance', () => {
  const doc = flatten(readFileSync(EVALS_DOC, 'utf8'))

  assert.match(doc, /\.claude\/ship\/runs/)
  assert.match(doc, /\.claude\/learning\/outcomes\.jsonl/)
  assert.match(doc, /\.claude\/metrics/)
  assert.match(doc, /nothing Interlock records about your run changes what your run does/i)
  assert.match(doc, /gates nothing/i)
  // Referenced, not restated: there must be exactly one place that answers
  // whether the corpora belong in git.
  assert.match(doc, /11-the-indicators\.md#whether-to-keep-them/)
  assert.doesNotMatch(doc, /```gitignore/, 'the .gitignore blocks live in docs/11, not here')
})

test('docs/14 states the no-consumer-CI-evals posture with its three reasons', () => {
  const doc = flatten(readFileSync(EVALS_DOC, 'utf8'))

  assert.match(doc, /does not run those evals in a consuming repository's CI|no model evals run in your CI/i)
  assert.match(doc, /model-facing surface is identical in every consumer/i)
  assert.match(doc, /your own test suite/i)
  assert.match(doc, /checkpoint/i)
  assert.match(doc, /early-access and metered/i)

  // The reversal. A single sentence saying consumers should run the suite in
  // their pipeline would invert the page while leaving every pin above intact.
  assert.doesNotMatch(
    doc,
    /(?:you |consumers? )(?:should|can|may) run (?:Interlock'?s? |the )?(?:model )?evals?(?: suite)? in (?:your|their|a consumer's) (?:CI|pipeline)/i,
    'the page must never state that Interlock runs, or that you should run, model evals in a consumer CI'
  )
})

test('docs/14 states how to file a failure, and that capture writes only where told', () => {
  const doc = flatten(readFileSync(EVALS_DOC, 'utf8'))

  assert.match(doc, /interlock evals capture --run/)
  assert.match(doc, /provenance/i)
  assert.match(doc, /writes only into the directory you named/i)
  assert.match(doc, /refuses a run that cannot be reconstructed/i)
})

test('docs/14 names the command that publishes a cap and states no threshold as policy', () => {
  const doc = flatten(readFileSync(EVALS_DOC, 'utf8'))
  assert.match(doc, /interlock limits/, 'a cap is named by where to read it')

  // No bare numeric threshold presented as policy. The page is allowed to carry
  // exit codes and document numbers — those are identifiers, not thresholds —
  // so the pattern targets the shapes a restated cap actually takes.
  const policyNumbers = [
    /\b(?:at most|no more than|up to|maximum of|max of|cap(?:ped)? (?:at|of)|limit of|ceiling of|threshold of)\s+\$?\d/i,
    /\b\d+\s*(?:%|percent\b)/i,
    /\$\s?\d/
  ]
  for (const pattern of policyNumbers) {
    const hit = pattern.exec(doc)
    assert.equal(hit, null, `docs/14 restates a threshold: "${hit && hit[0]}" — name interlock limits instead`)
  }
})
