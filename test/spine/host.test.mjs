// The host port, exercised through the real CLI (add-interlock-acp-host §1).
//
// The interesting assertion in this file is negative: a host that cannot reach a
// model at all still gets the right halt, because the halt was never the host's
// to compute. `createFakeHost` stubs the spawn side and leaves `runCli` pointed
// at `bin/interlock`, so a test can drive `wave-state create` → `record-batch`
// end to end and check that the reason came out of the CLI's exit status and
// stdout rather than out of the stub.
//
// Node-only. No network, no ACP server, no API key — see
// test/spine/acp-host.test.mjs for the protocol-level coverage.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  INTERLOCK_BIN,
  HOST_PORTS,
  assertWorkflowHost,
  createFakeHost,
  mapPipeline,
  parseAgentJson,
  runCli
} from '../../lib/host.mjs'
import { readClaudeEnvelope } from '../../lib/host/claude-cli.mjs'
import { CAPABILITY_KEYS, HOSTS } from '../../lib/host/registry.mjs'
import { ASSUMED_CAPABILITIES } from '../../lib/run.mjs'
import { makeRepo, DEMO_CHANGE } from '../helpers/ship-harness.mjs'

let dir

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'interlock-host-'))
})

after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function file(name, contents) {
  const p = join(dir, name)
  mkdirSync(join(dir, '.'), { recursive: true })
  writeFileSync(p, typeof contents === 'string' ? contents : JSON.stringify(contents))
  return p
}

/** record-batch fails a task that claims ok:true without a valid handoff. */
const okTask = id => ({
  id,
  ok: true,
  handoff: {
    schema: 'interlock.wave-handoff/1',
    taskId: id,
    status: 'ok',
    summary: `did ${id}`,
    evidence: [`src/${id}.ts:1-10`],
    next: `the next wave can build on ${id}`,
    blocker: null
  }
})

// Tier 4 by default, and deliberately: these tests are about the PORT — one
// spawn per lane, and the CLI deciding what happens next — so they want a plan
// whose lanes are one task each, and cohesion packs disjoint siblings at tier 3
// and below into one lane (LANE_CAPS.cohesionMaxTier). Tier is the shortest way
// to say "keep these separate" without inventing colliding paths, which would
// make them one lane for the opposite reason.
const classified = (tasks, tier = 4) => ({
  tasks: tasks.map(id => ({
    id,
    group: 1,
    description: `task ${id}`,
    tier,
    model: 'sonnet',
    isTestTask: false
  }))
})

/** Plan → run state, through the host's own CLI port. */
async function createState(host, ids, tag, tier) {
  const planned = await host.runCli([
    'waves',
    '--classified',
    file(`classified-${tag}.json`, classified(ids, tier)),
    '--json'
  ])
  assert.equal(planned.code, 0, planned.stderr)
  const state = await host.runCli([
    'wave-state',
    'create',
    '--plan',
    file(`plan-${tag}.json`, planned.stdout),
    '--json'
  ])
  assert.equal(state.code, 0, state.stderr)
  return JSON.parse(state.stdout)
}

test('the port is exactly spawn, mapPipeline and runCli', () => {
  // A fourth port is a policy decision leaking out of the CLI. If this list
  // grows, the thing being added almost certainly belongs behind `interlock`.
  assert.deepEqual(HOST_PORTS, ['spawn', 'mapPipeline', 'runCli'])
  assert.ok(existsSync(INTERLOCK_BIN), `runCli must resolve a real binary, got ${INTERLOCK_BIN}`)
})

test('assertWorkflowHost names the missing port instead of failing three waves in', () => {
  assert.throws(() => assertWorkflowHost({ spawn: () => null, mapPipeline }, 'acp host'), /runCli/)
  assert.throws(() => assertWorkflowHost(null), /not a workflow host/)
  assert.ok(assertWorkflowHost(createFakeHost({ cwd: dir })))
})

test('a fake host drives a batch through the CLI and the next step comes from stdout', async () => {
  const host = createFakeHost({ cwd: dir, spawn: req => ({ id: req.label, ok: true }) })
  const state = await createState(host, ['1.1', '1.2'], 'ok')

  const step = JSON.parse(
    (await host.runCli(['wave-state', 'next', '--state', file('run0.json', state), '--json'])).stdout
  )
  assert.equal(step.action, 'run-batch')
  // `tasks` is the batch, and a batch holds LANES. These two tasks predict no
  // paths, so they cannot be shown to collide, and at tier 4 they are above the
  // cohesion ceiling — so each is its own lane.
  assert.deepEqual(step.tasks.map(lane => lane.map(t => t.id)), [['1.1'], ['1.2']])

  // The stub stands in for the model. It reports task results; it does not get
  // to say what happens next. One spawn per LANE — a host that fanned out per
  // task would pay a spawn prefix for work already forced to be sequential.
  const results = await host.mapPipeline(step.tasks, lane => host.spawn({
    label: lane.length === 1 ? lane[0].id : `${lane[0].id}+${lane.length - 1}`,
    prompt: `implement ${lane.map(t => t.id).join(', ')}`,
    model: lane[0].model,
    schema: { type: 'object' }
  }))
  assert.deepEqual(results.map(r => r.id), ['1.1', '1.2'])
  assert.deepEqual(host.spawns.map(s => s.label), ['1.1', '1.2'])

  const recorded = await host.runCli([
    'wave-state',
    'record-batch',
    '--state',
    file('run0b.json', state),
    '--result',
    file('batch-0.json', { tasks: results.map(r => okTask(r.id)) }),
    '--write-state',
    join(dir, 'run1.json'),
    '--json'
  ])
  assert.equal(recorded.code, 0, recorded.stderr)
  assert.equal(JSON.parse(recorded.stdout).action, 'done', 'a single-wave plan finishes after its batch')
})

test('halt reasons come from the CLI exit status, not from the host', async () => {
  // Three failed tasks blow the failure budget. `lib/limits.mjs` owns that
  // number, the CLI applies it, and the host learns about it the same way
  // ship.js does: a non-zero exit and action:"halt" on stdout.
  const failing = createFakeHost({
    cwd: dir,
    spawn: req => ({ id: req.label, ok: false, error: 'stub cannot implement anything' })
  })
  const state = await createState(failing, ['1.1', '1.2', '1.3'], 'halt')
  const step = JSON.parse(
    (await failing.runCli(['wave-state', 'next', '--state', file('halt-run0.json', state), '--json'])).stdout
  )

  const results = await failing.mapPipeline(step.tasks, lane =>
    failing.spawn({ label: lane[0].id, prompt: `implement ${lane[0].id}` })
  )
  assert.equal(results.filter(r => r && r.ok === false).length, 3)

  const recorded = await failing.runCli([
    'wave-state',
    'record-batch',
    '--state',
    file('halt-run0b.json', state),
    '--result',
    file('batch-fail.json', { tasks: results }),
    '--write-state',
    join(dir, 'halt-run1.json'),
    '--json'
  ])

  assert.equal(recorded.code, 1, 'a recorded result that halts the run must exit non-zero')
  const next = JSON.parse(recorded.stdout)
  assert.equal(next.action, 'halt')
  assert.match(next.reason || '', /task failures accumulated/)

  // The stub never said "halt" and never counted anything. Everything the host
  // knows about the budget arrived as an exit code.
  for (const spawnResult of results) {
    assert.equal(spawnResult.error, 'stub cannot implement anything')
    assert.ok(!('action' in spawnResult), 'a spawned agent must not be the source of a step')
  }
  const recordedCalls = failing.cliCalls.filter(argv => argv[0] === 'wave-state')
  assert.ok(recordedCalls.length >= 2, 'the host must ask the CLI, not decide')
})

test('a host that never records a batch never learns the run halted', async () => {
  // The other half of the same rule: skipping `record-batch` does not make the
  // failures go away, it makes them invisible. This is what a host
  // reimplementing the loop in its own code would look like from outside.
  const host = createFakeHost({ cwd: dir })
  const state = await createState(host, ['1.1', '1.2', '1.3'], 'skip')
  const step = JSON.parse(
    (await host.runCli(['wave-state', 'next', '--state', file('skip-run0.json', state), '--json'])).stdout
  )
  assert.equal(step.action, 'run-batch', 'state that was never recorded still offers the same batch')
})

test('mapPipeline turns a thrown or absent agent result into null, not an exception', async () => {
  const results = await mapPipeline([{ id: 'a' }, { id: 'b' }, { id: 'c' }], task => {
    if (task.id === 'b') throw new Error('agent died')
    if (task.id === 'c') return undefined
    return { id: task.id, ok: true }
  })
  assert.deepEqual(results, [{ id: 'a', ok: true }, null, null])
})

test('a spawn stub that is omitted returns null for every agent', async () => {
  const host = createFakeHost({ cwd: dir })
  const result = await host.spawn({ label: 'plan-waves', prompt: 'classify' })
  assert.equal(result, null)
  assert.equal(host.spawns.length, 1)
})

test('a fake host records type and tools on the spawn request', async () => {
  const host = createFakeHost({ cwd: dir, spawn: req => ({ id: req.label, ok: true, type: req.type }) })
  const result = await host.spawn({
    label: '1.1',
    prompt: 'implement',
    type: 'interlock:worker',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash']
  })
  assert.equal(result.type, 'interlock:worker')
  assert.deepEqual(host.spawns[0].type, 'interlock:worker')
  assert.deepEqual(host.spawns[0].tools, ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'])
})

test('runCli refuses an empty argv and resolves a non-zero exit instead of throwing', async () => {
  await assert.rejects(() => runCli([]), /at least one interlock subcommand/)
  const bad = await runCli(['wave-state', 'wat'], { cwd: dir })
  assert.equal(bad.code, 1)
  assert.match(bad.stderr, /unknown wave-state subcommand: wat/)
})

// --- the interpreter loop over the port (emit-wave-steps-from-cli) ---------
//
// Every earlier test in this file drives one CLI call at a time. This one
// walks the whole `interlock run` program — `run start` through `run
// close` — the way a real driver's loop does: spawn everything a step names
// through the port, hand the results back to `then.argv`, repeat until
// `then` is null. No model, no network — the port's `spawn` stub answers
// with canned results, and the CLI is the only thing deciding what happens
// next.

test('an interpreter over the fake host walks a lean run from start to close', async () => {
  const { root, change } = makeRepo()
  try {
    await interpretLeanRun(root, change)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

async function interpretLeanRun(root, change) {
  const put = (path, body) => {
    const dest = join(root, path)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n')
  }

  const CLASSIFIED = {
    tasks: [
      {
        id: '1.1',
        group: 1,
        description: 'task 1.1',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: ['lib/a.mjs']
      }
    ]
  }

  // The batch's lanes, captured once the run-batch step names them, so the
  // spawn stub can answer each lane by its own task ids rather than guessing.
  let lanes = null

  const host = createFakeHost({
    cwd: root,
    spawn: (req, index) => {
      if (req.label === 'plan-waves') {
        // Standing in for the classifier: it writes the classification file
        // itself and is never asked to run the CLI (design D7).
        put('.claude/ship/classified.json', CLASSIFIED)
        return { ok: true }
      }
      if (req.label === 'commit') {
        return { ok: true, sha: 'deadbee' }
      }
      const lane = lanes ? lanes[index] : null
      const ids = lane ? lane.map(t => t.id) : []
      return {
        tasks: ids.map(id => ({
          id,
          outcome: 'ok',
          filesChanged: ['lib/a.mjs'],
          handoff: {
            schema: 'interlock.wave-handoff/1',
            taskId: id,
            status: 'ok',
            summary: 'done',
            evidence: ['lib/a.mjs:1'],
            next: 'nothing',
            blocker: null
          }
        }))
      }
    }
  })

  /** One `interlock run …` call through the port, mirroring a driver's `cli()`. */
  async function call(argv, results) {
    const full = [...argv]
    if (results !== undefined) {
      put('.claude/ship/host-results.json', results)
      full.push('--results', '.claude/ship/host-results.json')
    }
    full.push('--json')
    const res = await host.runCli(full)
    assert.equal(res.code, 0, `interlock ${full.join(' ')} exited ${res.code}: ${res.stderr}`)
    return JSON.parse(res.stdout)
  }

  let step = await call(['run', 'start', '--change', change])
  assert.equal(step.action, 'classify')

  await host.mapPipeline(step.spawns, s => host.spawn(s))
  step = await call(step.then.argv)
  assert.equal(step.action, 'run-batch')

  lanes = step.lanes
  let results = await host.mapPipeline(step.spawns, s => host.spawn(s))
  step = await call(step.then.argv, results)
  assert.equal(step.action, 'verify-final', 'no test profile in this repo, so verification is skipped')

  step = await call(step.then.argv)
  assert.equal(step.action, 'commit')

  results = await host.mapPipeline(step.spawns, s => host.spawn(s))
  step = await call(step.then.argv, results)

  assert.equal(step.action, 'complete')
  assert.equal(step.exitCode, 0)
  assert.equal(step.then, null, 'a terminal step names no continuation')
  assert.match(step.summary, /SHIP COMPLETE/)

  // The port carried every spawn a driver would have made, and nothing else
  // decided what came next: only host.runCli's return value did.
  assert.deepEqual(host.spawns.map(s => s.label), ['plan-waves', '1.1', 'commit'])
  assert.ok(
    host.cliCalls.some(argv => argv[0] === 'run' && argv[1] === 'close'),
    'the interpreter must reach run close through the same port, not a shortcut'
  )
}

// --- the usage envelope's cache fields (spec: run-host-adapters) ------------

/** The envelope shape the vendor CLI returns, with whatever usage a case needs. */
const envelope = usage => JSON.stringify({ structured_output: { ok: true }, ...(usage ? { usage } : {}) })

test('both lifetime tiers survive the parse, and neither is summed into the other', () => {
  const { usage } = readClaudeEnvelope(
    envelope({
      input_tokens: 120,
      output_tokens: 30,
      cache_read_input_tokens: 40_000,
      cache_creation: { ephemeral_5m_input_tokens: 900, ephemeral_1h_input_tokens: 7 }
    })
  )
  assert.equal(usage.inputTokens, 120)
  assert.equal(usage.outputTokens, 30)
  assert.equal(usage.cacheReadInputTokens, 40_000)
  // Split by tier, because the two are priced differently and a total could not
  // be priced back apart.
  assert.deepEqual(usage.cacheCreationInputTokens, { ephemeral_5m: 900, ephemeral_1h: 7 })
  assert.notEqual(usage.cacheCreationInputTokens, 907)
})

test('an omitted cache field is absent, never a zero', () => {
  const read = readClaudeEnvelope(
    envelope({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 12 })
  ).usage
  assert.equal(read.cacheReadInputTokens, 12)
  assert.ok(!('cacheCreationInputTokens' in read), 'an omitted creation block is absent, not {}')

  // One tier reported, the other omitted: the omitted one does not appear at all.
  const oneTier = readClaudeEnvelope(
    envelope({ input_tokens: 1, output_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 5 } })
  ).usage
  assert.deepEqual(oneTier.cacheCreationInputTokens, { ephemeral_5m: 5 })
  assert.ok(!('cacheReadInputTokens' in oneTier))

  // A MEASURED zero is kept as a zero — that is a different fact from absence.
  const measuredZero = readClaudeEnvelope(
    envelope({
      input_tokens: 1,
      output_tokens: 1,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }
    })
  ).usage
  assert.equal(measuredZero.cacheReadInputTokens, 0)
  assert.deepEqual(measuredZero.cacheCreationInputTokens, { ephemeral_5m: 0, ephemeral_1h: 0 })
})

test('an unparseable or usage-free envelope is a host that did not report', () => {
  for (const stdout of ['not json at all', '', '[1,2,3]', undefined]) {
    assert.equal(readClaudeEnvelope(stdout).usage, null, `${String(stdout)} must report nothing`)
  }
  // Present, parseable, and carrying no usage block: still absent, never zeros.
  const noUsage = readClaudeEnvelope(envelope(null))
  assert.equal(noUsage.usage, null)
  // And the spawn's other recorded outcomes are unaffected.
  assert.deepEqual(noUsage.result, { ok: true })
})

test('cache accounting is its own declared capability, not one implied by usage', () => {
  // Declared by every adapter, with a boolean — a fifth adapter cannot arrive
  // with it silently absent.
  for (const [id, entry] of Object.entries(HOSTS)) {
    assert.equal(typeof entry.capabilities.cacheAccounting, 'boolean', `${id} declares no cacheAccounting`)
  }
  assert.ok(CAPABILITY_KEYS.includes('cacheAccounting'))

  // And it is NOT implied by usage: codex reports token usage and no cache
  // decomposition, which is exactly the gap the separate declaration exists for.
  assert.equal(HOSTS.codex.capabilities.usage, true)
  assert.equal(HOSTS.codex.capabilities.cacheAccounting, false)
  assert.equal(HOSTS.claude.capabilities.cacheAccounting, true)

  // The Workflow host — the run program's assumption for a manifest that
  // declared nothing — exposes a cumulative scalar and no decomposition.
  assert.equal(ASSUMED_CAPABILITIES.usage, true)
  assert.equal(ASSUMED_CAPABILITIES.cacheAccounting, false)
})

test('parseAgentJson recovers a result from prose, a fence, or neither', () => {
  assert.deepEqual(parseAgentJson('{"ok":true}'), { ok: true })
  assert.deepEqual(parseAgentJson('Here you go:\n```json\n{"ok":false,"error":"x"}\n```\n'), {
    ok: false,
    error: 'x'
  })
  assert.deepEqual(parseAgentJson('Sure! {"id":"1.1","note":"a } brace in prose"} done'), {
    id: '1.1',
    note: 'a } brace in prose'
  })
  assert.equal(parseAgentJson('I could not do it.'), null)
  assert.equal(parseAgentJson(''), null)
  assert.equal(parseAgentJson(undefined), null)
  assert.equal(parseAgentJson('[1,2,3]'), null, 'the contract is an object result')
})
