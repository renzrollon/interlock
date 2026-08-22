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
import { join } from 'node:path'
import {
  INTERLOCK_BIN,
  HOST_PORTS,
  assertWorkflowHost,
  createFakeHost,
  mapPipeline,
  parseAgentJson,
  runCli
} from '../../lib/host.mjs'

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

const classified = tasks => ({
  tasks: tasks.map(id => ({
    id,
    group: 1,
    description: `task ${id}`,
    tier: 2,
    model: 'sonnet',
    isTestTask: false
  }))
})

/** Plan → run state, through the host's own CLI port. */
async function createState(host, ids, tag) {
  const planned = await host.runCli([
    'waves',
    '--classified',
    file(`classified-${tag}.json`, classified(ids)),
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
  assert.deepEqual(step.tasks.map(t => t.id), ['1.1', '1.2'])

  // The stub stands in for the model. It reports task results; it does not get
  // to say what happens next.
  const results = await host.mapPipeline(step.tasks, task => host.spawn({
    label: task.id,
    prompt: `implement ${task.id}`,
    model: task.model,
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

  const results = await failing.mapPipeline(step.tasks, task =>
    failing.spawn({ label: task.id, prompt: `implement ${task.id}` })
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

test('runCli refuses an empty argv and resolves a non-zero exit instead of throwing', async () => {
  await assert.rejects(() => runCli([]), /at least one interlock subcommand/)
  const bad = await runCli(['wave-state', 'wat'], { cwd: dir })
  assert.equal(bad.code, 1)
  assert.match(bad.stderr, /unknown wave-state subcommand: wat/)
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
