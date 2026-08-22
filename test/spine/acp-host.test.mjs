// The ACP adapter, on the wire (add-interlock-acp-host §3).
//
// Two layers, deliberately separated:
//
//   default        a fixture agent under test/fixtures/acp/ that speaks the
//                  protocol and nothing else. It proves framing, the handshake,
//                  session-per-spawn, permission answering and null-on-failure
//                  without a model, a network or an API key.
//   opt-in         one test against the user's real agent, gated on
//                  INTERLOCK_ACP_COMMAND. `npm test` skips it, because a
//                  suite that needs a live coding agent is a suite nobody runs.
//
// The fixture is handed to `createAcpHost({ command })` explicitly rather than
// through the environment, so setting INTERLOCK_ACP_COMMAND stays a meaningful
// signal that a real agent is available.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACP_COMMAND_ENV,
  ACP_PROTOCOL_VERSION,
  createAcpHost,
  formatSpawnPrompt,
  parseAcpCommand
} from '../../lib/host/acp.mjs'
import { HOST_PORTS } from '../../lib/host.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURE = join(ROOT, 'test', 'fixtures', 'acp', 'agent.mjs')

const fixtureHost = (flags = '', opts = {}) =>
  createAcpHost({
    command: `${process.execPath} ${FIXTURE}${flags ? ` ${flags}` : ''}`,
    cwd: ROOT,
    timeoutMs: 20000,
    ...opts
  })

test('the ACP host implements the port and admits it cannot route models', () => {
  const host = fixtureHost()
  for (const port of HOST_PORTS) assert.equal(typeof host[port], 'function', `missing ${port}`)
  // ACP v1 has no per-prompt model selector. Saying so is what lets the driver
  // print a banner instead of letting a summary imply the tier ladder ran.
  assert.equal(host.modelRoutingSupported, false)
  assert.equal(ACP_PROTOCOL_VERSION, 1)
})

test('a spawn is one process, one session, one prompt turn', async () => {
  const host = fixtureHost()
  const result = await host.spawn({
    label: '1.1',
    prompt: 'implement task 1.1',
    model: 'sonnet',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }
  })

  assert.ok(result, 'the fixture agent replied but the host produced no result')
  assert.equal(result.ok, true)
  assert.equal(result.sawSchemaInstruction, true, 'the schema must travel in the prompt text')
  assert.equal(result.sawModelMeta, true, 'the planner model slug rides in _meta')
  assert.equal(result.model, 'sonnet')
  assert.match(result.sessionId, /^sess-/)
})

test('a batch gets a fresh agent process each, not a shared session', async () => {
  // "One agent per task" is the isolation mechanism. A host that reused one
  // session would hand task 3 everything tasks 1 and 2 said.
  const host = fixtureHost()
  const tasks = [{ id: '1.1' }, { id: '1.2' }, { id: '1.3' }]
  const results = await host.mapPipeline(tasks, task =>
    host.spawn({ label: task.id, prompt: `implement ${task.id}`, schema: { type: 'object' } })
  )

  assert.equal(results.length, 3)
  const pids = new Set(results.map(r => r.pid))
  const sessions = new Set(results.map(r => r.sessionId))
  assert.equal(pids.size, 3, 'each spawn must be its own agent process')
  assert.equal(sessions.size, 3, 'each spawn must be its own session')
})

test('a permission request is answered allow_always, not left hanging', async () => {
  // The run is unattended by contract. A driver that stalled on a permission
  // prompt would break the same promise `disallowed-tools: AskUserQuestion`
  // keeps on the Claude Code side.
  const host = fixtureHost('--permission')
  const result = await host.spawn({ label: 'commit', prompt: 'write a file', schema: { type: 'object' } })
  assert.ok(result)
  assert.equal(result.permissionOptionId, 'always')
})

test('prose around the JSON still yields a result', async () => {
  const host = fixtureHost('--prose')
  const result = await host.spawn({ label: '1.1', prompt: 'implement it', schema: { type: 'object' } })
  assert.ok(result, 'a chatty agent must not cost the run a task')
  assert.equal(result.ok, true)
})

test('a refusal and a dead agent both resolve to null, never a throw', async () => {
  const events = []
  const refusing = fixtureHost('--refuse', { onEvent: e => events.push(e) })
  assert.equal(await refusing.spawn({ label: '1.1', prompt: 'do it' }), null)
  assert.ok(
    events.some(e => e.type === 'spawn-done' && e.stopReason === 'refusal'),
    'a refusal must be visible to the caller as an event'
  )

  const dead = fixtureHost('--die')
  assert.equal(await dead.spawn({ label: '1.2', prompt: 'do it' }), null)

  const missing = createAcpHost({ command: 'interlock-no-such-acp-agent-xyz', cwd: ROOT, timeoutMs: 5000 })
  assert.equal(await missing.spawn({ label: '1.3', prompt: 'do it' }), null)
})

test('the ACP host still asks the CLI for policy', async () => {
  // The whole point of the adapter: swapping the spawn does not swap the rules.
  const dir = mkdtempSync(join(tmpdir(), 'interlock-acp-'))
  try {
    const host = fixtureHost('', { cwd: dir })
    const bad = await host.runCli(['wave-state', 'next', '--state', join(dir, 'nope.json'), '--json'])
    assert.equal(bad.code, 1)
    const limits = await host.runCli(['limits', '--json'])
    assert.equal(limits.code, 0, limits.stderr)
    assert.ok(JSON.parse(limits.stdout), 'the host must reach the real policy engine')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseAcpCommand handles quotes and refuses an empty command', () => {
  assert.deepEqual(parseAcpCommand('claude-code-acp'), { command: 'claude-code-acp', args: [] })
  assert.deepEqual(parseAcpCommand('  npx  my-agent --acp  '), {
    command: 'npx',
    args: ['my-agent', '--acp']
  })
  assert.deepEqual(parseAcpCommand('agent --flag "two words" \'and more\''), {
    command: 'agent',
    args: ['--flag', 'two words', 'and more']
  })
  assert.throws(() => parseAcpCommand(''), new RegExp(ACP_COMMAND_ENV))
  assert.throws(() => parseAcpCommand(undefined), new RegExp(ACP_COMMAND_ENV))
  assert.throws(() => parseAcpCommand('agent "unterminated'), /unterminated/)
})

test('formatSpawnPrompt adds a result contract only when there is a schema', () => {
  assert.equal(formatSpawnPrompt({ prompt: 'just do it' }), 'just do it')
  const withSchema = formatSpawnPrompt({ prompt: 'do it', schema: { type: 'object' } })
  assert.match(withSchema, /^do it/, 'the caller owns the prompt; the host only appends')
  assert.match(withSchema, /reply with a single JSON object/)
  assert.match(withSchema, /"type":"object"/)
})

// --- opt-in: a live agent ---------------------------------------------------

test(
  'a live ACP agent answers a trivial prompt',
  {
    skip: process.env[ACP_COMMAND_ENV]
      ? false
      : `set ${ACP_COMMAND_ENV} to run this against a real ACP agent`
  },
  async () => {
    const host = createAcpHost({ cwd: ROOT })
    const result = await host.spawn({
      label: 'acp-smoke',
      prompt:
        'Reply with the JSON object {"ok": true} and nothing else. Do not read or write any files.',
      schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }
    })
    assert.ok(result, `no parseable result from ${host.command}`)
    assert.equal(result.ok, true)
  }
)
