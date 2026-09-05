// The outcome eval's ACP agent and the runner's scratch-root isolation
// (spec: evals/outcome-fixtures, evals/outcome-run).
//
// Everything here runs with no network, no credential and no model call. The
// agent's wire half is driven by a stub transport — recorded lines in, recorded
// messages out — and its model half is driven by a stub `fetch` returning
// canned Messages API responses. What is being proved is that the agent answers
// the protocol `lib/host/acp.mjs` speaks and loops over tool use correctly; what
// the model would actually say is not this suite's business and cannot be
// asserted offline anyway.
//
// The isolation half proves the refusal fires and that preparing and exercising
// every fixture's scratch root leaves this repository's own corpora
// byte-identical. That last assertion is the one the corpus purge of 2026-08-29
// bought: the fixture set exists to be run, and the first thing that must be
// true about running it is that it writes nothing here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAgent, createLineReader, promptText, ACP_PROTOCOL_VERSION } from '../../evals/ship/agent/wire.mjs'
import { createToolExecutor, resolveInside, TOOL_DEFINITIONS } from '../../evals/ship/agent/tools.mjs'
import { createModelClient, addUsage, emptyUsage, DEFAULT_MODEL } from '../../evals/ship/agent/model.mjs'
import { reportUsage, AGENT_IDENTITY, USAGE_SCHEMA } from '../../evals/ship/agent/main.mjs'
import {
  assertScratchRootOutsideRepo,
  prepareScratchRoot,
  removeScratchRoot,
  selectAgent,
  REPO_ROOT,
  ACP_COMMAND_ENV
} from '../../evals/ship/run.mjs'
import { readFixtures } from '../../evals/ship/fixtures.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'bin', 'interlock')

function scratchDir(label) {
  return mkdtempSync(join(tmpdir(), `interlock-eval-test-${label}-`))
}

// --- the wire subset, against a stub transport ------------------------------

/** Drive the agent with recorded lines; collect everything it sends. */
async function driveAgent({ onPrompt }) {
  const sent = []
  const { handle } = createAgent({ send: m => sent.push(m), onPrompt, defaultCwd: '/nowhere' })
  const feed = createLineReader(handle)
  return { sent, feed }
}

test('the agent answers the ACP wire subset with no network and no model call', async () => {
  const prompts = []
  const { sent, feed } = await driveAgent({
    onPrompt(turn) {
      prompts.push(turn)
      turn.emit('{"ok":true}')
      return { stopReason: 'end_turn' }
    }
  })

  await feed(
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } })}\n`
  )
  const initialized = sent.find(m => m.id === 1)
  assert.ok(initialized, 'no reply to initialize')
  assert.equal(initialized.result.protocolVersion, ACP_PROTOCOL_VERSION)
  assert.deepEqual(initialized.result.agentCapabilities, {})
  assert.deepEqual(initialized.result.authMethods, [])

  await feed(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/new',
      params: { cwd: '/work/scratch', mcpServers: [] }
    })}\n`
  )
  const session = sent.find(m => m.id === 2)
  assert.ok(session && typeof session.result.sessionId === 'string' && session.result.sessionId)

  await feed(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: {
        sessionId: session.result.sessionId,
        prompt: [{ type: 'text', text: 'implement task 1.1' }],
        _meta: { 'interlock/model': 'some-slug' }
      }
    })}\n`
  )

  // The turn saw the session's cwd and the prompt's text, and the model slug
  // travelled in _meta as the host sends it.
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].cwd, '/work/scratch')
  assert.equal(prompts[0].text, 'implement task 1.1')
  assert.equal(prompts[0].meta['interlock/model'], 'some-slug')

  // The reply streamed as an agent_message_chunk, then the turn ended.
  const chunk = sent.find(
    m => m.method === 'session/update' && m.params.update.sessionUpdate === 'agent_message_chunk'
  )
  assert.ok(chunk, 'no agent_message_chunk was streamed')
  assert.equal(chunk.params.sessionId, session.result.sessionId)
  assert.equal(chunk.params.update.content.type, 'text')
  assert.equal(chunk.params.update.content.text, '{"ok":true}')

  const ended = sent.find(m => m.id === 3)
  assert.equal(ended.result.stopReason, 'end_turn')
})

test('the agent reports a failed turn as an error, never as an empty end_turn', async () => {
  // The client turns a rejected request into a null spawn result and the CLI
  // decides what that costs. An empty success would read as an agent that had
  // nothing to say, which is a different fact entirely.
  const { sent, feed } = await driveAgent({
    onPrompt() {
      throw new Error('the model was unreachable')
    }
  })
  await feed(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} })}\n`)
  const sessionId = sent.find(m => m.id === 1).result.sessionId
  await feed(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'go' }] }
    })}\n`
  )
  const reply = sent.find(m => m.id === 2)
  assert.ok(reply.error, 'a failed turn replied with a result')
  assert.match(reply.error.message, /unreachable/)
  assert.equal(reply.result, undefined)
})

test('the agent declines a method it does not implement, and ignores a response', async () => {
  const { sent, feed } = await driveAgent({ onPrompt: () => ({}) })
  await feed(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'session/cancel' })}\n`)
  assert.equal(sent.find(m => m.id === 7).error.code, -32601)

  // A response to something the agent never asked is dropped, not answered
  // with an error the client would have to interpret.
  const before = sent.length
  await feed(`${JSON.stringify({ jsonrpc: '2.0', id: 99, result: { ok: true } })}\n`)
  assert.equal(sent.length, before)
})

test('prompt text drops the blocks the agent has declared no capability to read', () => {
  assert.equal(
    promptText([
      { type: 'text', text: 'a' },
      { type: 'image', data: '…' },
      { type: 'text', text: 'b' }
    ]),
    'ab'
  )
  assert.equal(promptText(undefined), '')
})

// --- the tools are scoped to the session's working directory ---------------

test('a tool refuses a path that resolves outside the working directory', () => {
  const root = scratchDir('tools')
  try {
    const execute = createToolExecutor({ cwd: root })
    writeFileSync(join(root, 'inside.txt'), 'yes')

    assert.equal(execute({ name: 'read_file', input: { path: 'inside.txt' } }).content, 'yes')

    const escaped = execute({ name: 'read_file', input: { path: '../../etc/hosts' } })
    assert.equal(escaped.isError, true)
    assert.match(escaped.content, /outside the session's working directory/)

    const absolute = execute({ name: 'write_file', input: { path: '/tmp/nope.txt', content: 'x' } })
    assert.equal(absolute.isError, true)
    assert.equal(existsSync('/tmp/nope.txt'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a symlink pointing out of the working directory is refused too', () => {
  const root = scratchDir('symlink')
  const outside = scratchDir('outside')
  try {
    writeFileSync(join(outside, 'secret.txt'), 'not yours')
    symlinkSync(outside, join(root, 'link'))
    const execute = createToolExecutor({ cwd: root })
    const read = execute({ name: 'read_file', input: { path: 'link/secret.txt' } })
    assert.equal(read.isError, true)
    assert.match(read.content, /via a link/)

    const write = execute({ name: 'write_file', input: { path: 'link/planted.txt', content: 'x' } })
    assert.equal(write.isError, true)
    assert.equal(existsSync(join(outside, 'planted.txt')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('write_file creates parent directories and run_command reports a non-zero exit as information', () => {
  const root = scratchDir('write')
  try {
    const execute = createToolExecutor({ cwd: root })
    const wrote = execute({ name: 'write_file', input: { path: 'src/deep/new.mjs', content: 'export const a = 1\n' } })
    assert.equal(wrote.isError, false)
    assert.equal(readFileSync(join(root, 'src/deep/new.mjs'), 'utf8'), 'export const a = 1\n')

    const failed = execute({ name: 'run_command', input: { command: 'exit 3' } })
    // A failing command is an answer, not a tool malfunction: the model asked
    // what the suite does and the answer is "it fails".
    assert.equal(failed.isError, false)
    assert.match(failed.content, /exit code: 3/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('run_command does not pass the model credential to the commands it runs', () => {
  const root = scratchDir('credential')
  try {
    const execute = createToolExecutor({
      cwd: root,
      env: { ...process.env, ANTHROPIC_API_KEY: 'sk-should-not-leak', PATH: process.env.PATH }
    })
    const result = execute({ name: 'run_command', input: { command: 'echo "[$ANTHROPIC_API_KEY]"' } })
    assert.match(result.content, /\[\]/)
    assert.ok(!result.content.includes('sk-should-not-leak'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveInside accepts the root itself and rejects an empty path', () => {
  const root = scratchDir('resolve')
  try {
    assert.equal(resolveInside(root, '.'), realpathSync(root))
    assert.equal(resolveInside(root, 'a/b.txt'), join(realpathSync(root), 'a', 'b.txt'))
    assert.throws(() => resolveInside(root, ''), /path is required/)
    assert.throws(() => resolveInside(root, undefined), /path is required/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- the model loop, against a stub fetch -----------------------------------

/** A stub `fetch` that replays canned Messages API responses in order. */
function stubFetch(responses) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers })
    const next = responses.shift()
    if (!next) throw new Error('stub fetch ran out of responses')
    if (next.status && next.status !== 200) {
      return { ok: false, status: next.status, text: async () => next.body || '' }
    }
    return { ok: true, status: 200, json: async () => next }
  }
  return { impl, calls }
}

test('the model loop executes tool calls and returns them in one user message', async () => {
  const { impl, calls } = stubFetch([
    {
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 20 },
      content: [
        { type: 'text', text: 'let me look' },
        { type: 'tool_use', id: 'call_a', name: 'read_file', input: { path: 'a.txt' } },
        { type: 'tool_use', id: 'call_b', name: 'read_file', input: { path: 'b.txt' } }
      ]
    },
    {
      stop_reason: 'end_turn',
      usage: { input_tokens: 300, output_tokens: 40 },
      content: [{ type: 'text', text: '{"ok":true}' }]
    }
  ])

  const executed = []
  const client = createModelClient({ apiKey: 'test-key', fetchImpl: impl })
  const result = await client.run({
    prompt: 'do the thing',
    system: 'be brief',
    tools: TOOL_DEFINITIONS,
    executeTool(call) {
      executed.push(call.name)
      return { content: `contents of ${call.input.path}`, isError: false }
    }
  })

  assert.equal(result.stopReason, 'end_turn')
  assert.equal(result.turns, 2)
  // Only the final turn's text comes back: the client scans for the first
  // balanced JSON object in what it receives, so a mid-loop remark must not
  // travel with it.
  assert.equal(result.text, '{"ok":true}')
  assert.deepEqual(executed, ['read_file', 'read_file'])

  // Both results went back in ONE user message — splitting them teaches the
  // model to stop making parallel calls.
  const second = calls[1].body.messages
  const resultMessages = second.filter(
    m => m.role === 'user' && Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result')
  )
  assert.equal(resultMessages.length, 1)
  assert.equal(resultMessages[0].content.length, 2)
  assert.deepEqual(resultMessages[0].content.map(b => b.tool_use_id), ['call_a', 'call_b'])

  // Usage accumulated across every request, by name.
  assert.deepEqual(client.usage, {
    requests: 2,
    inputTokens: 400,
    outputTokens: 60,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0
  })

  // The wire shape the API requires.
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages')
  assert.equal(calls[0].headers['anthropic-version'], '2023-06-01')
  assert.equal(calls[0].headers['x-api-key'], 'test-key')
  assert.equal(calls[0].body.model, DEFAULT_MODEL)
  assert.equal(calls[0].body.system, 'be brief')
})

test('a failing tool travels back as an error result, not as a dropped call', async () => {
  const { impl, calls } = stubFetch([
    {
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'tool_use', id: 'call_a', name: 'read_file', input: { path: 'gone.txt' } }]
    },
    { stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'ok' }] }
  ])
  const client = createModelClient({ apiKey: 'k', fetchImpl: impl })
  await client.run({
    prompt: 'go',
    executeTool: () => ({ content: 'no such file: gone.txt', isError: true })
  })
  const sentResult = calls[1].body.messages.at(-1).content[0]
  assert.equal(sentResult.type, 'tool_result')
  assert.equal(sentResult.is_error, true)
})

test('the model loop speaks its failures rather than returning a partial answer', async () => {
  const refused = stubFetch([{ status: 429, body: '{"error":{"message":"rate limited"}}' }])
  const client = createModelClient({ apiKey: 'k', fetchImpl: refused.impl })
  await assert.rejects(() => client.run({ prompt: 'go', executeTool: () => ({ content: '', isError: false }) }), /429/)

  // A loop that never stops asking for tools hits its ceiling and says so,
  // rather than reporting a truncated run as a complete one.
  const forever = {
    stop_reason: 'tool_use',
    usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: 'tool_use', id: 'c', name: 'run_command', input: { command: 'true' } }]
  }
  const looping = stubFetch(Array.from({ length: 10 }, () => ({ ...forever })))
  const bounded = createModelClient({ apiKey: 'k', fetchImpl: looping.impl, maxTurns: 3 })
  await assert.rejects(
    () => bounded.run({ prompt: 'go', executeTool: () => ({ content: 'ok', isError: false }) }),
    /ceiling of 3 model turns/
  )
})

test('a missing credential is refused at construction, with the reason', () => {
  assert.throws(() => createModelClient({ apiKey: '' }), /ANTHROPIC_API_KEY/)
})

test('an unmeasured usage tally is never fabricated from a response that carried none', () => {
  const tally = emptyUsage()
  addUsage(tally, undefined)
  assert.equal(tally.requests, 0, 'a response with no usage block must not count as a request')
  addUsage(tally, { input_tokens: 5 })
  assert.deepEqual(tally, {
    requests: 1,
    inputTokens: 5,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0
  })
})

// --- the agent reports its usage to the runner ------------------------------

test('the agent appends one usage record per session where the runner asked', () => {
  const dir = scratchDir('usage')
  try {
    const path = join(dir, 'usage.jsonl')
    const usage = { requests: 3, inputTokens: 900, outputTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 8 }
    const wrote = reportUsage({
      sessionId: 'sess-1',
      model: 'claude-opus-5',
      usage,
      env: { INTERLOCK_EVAL_USAGE_FILE: path }
    })
    assert.equal(wrote, true)
    const record = JSON.parse(readFileSync(path, 'utf8').trim())
    assert.equal(record.schema, USAGE_SCHEMA)
    assert.equal(record.agent, AGENT_IDENTITY)
    assert.equal(record.sessionId, 'sess-1')
    assert.equal(record.model, 'claude-opus-5')
    assert.equal(record.outputTokens, 120)
    assert.equal(record.inputTokens, 900)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no usage file means no record, and a failed append is spoken rather than fatal', () => {
  assert.equal(reportUsage({ sessionId: 's', model: 'm', usage: emptyUsage(), env: {} }), false)

  const spoken = []
  const wrote = reportUsage({
    sessionId: 's',
    model: 'm',
    usage: emptyUsage(),
    env: { INTERLOCK_EVAL_USAGE_FILE: join(scratchDir('nope'), 'missing-dir', 'usage.jsonl') },
    warn: text => spoken.push(text)
  })
  // An agent that killed a ship run because it could not write a bookkeeping
  // line would be measuring apparatus failure as product failure.
  assert.equal(wrote, false)
  assert.equal(spoken.length, 1)
  assert.match(spoken[0], /usage not recorded/)
})

// --- agent selection --------------------------------------------------------

test('the runner defaults to the committed agent and records which was used', () => {
  const committed = selectAgent({})
  assert.equal(committed.source, 'committed')
  assert.equal(committed.identity, AGENT_IDENTITY)
  assert.match(committed.command, /evals\/ship\/agent\/main\.mjs$/)

  const operator = selectAgent({ [ACP_COMMAND_ENV]: '  my-acp-agent --flag  ' })
  assert.equal(operator.source, 'operator')
  assert.equal(operator.command, 'my-acp-agent --flag')
  // An external command is not version-keyed; the identity says so rather than
  // dressing it up as one the repository could compare rows across.
  assert.match(operator.identity, /^operator-supplied:/)

  assert.equal(selectAgent({ [ACP_COMMAND_ENV]: '   ' }).source, 'committed')
})

// --- scratch-root isolation -------------------------------------------------

test('a root inside this repository is refused, with the reason stated', () => {
  for (const inside of [REPO_ROOT, join(REPO_ROOT, 'evals'), join(REPO_ROOT, 'evals', 'ship', 'scratch')]) {
    assert.throws(
      () => assertScratchRootOutsideRepo(inside),
      /resolves inside .*the repository under test/,
      `${inside} was not refused`
    )
  }
  // Refused before the directory exists, too — a root is judged by where it
  // would land, not by whether someone already made it.
  assert.throws(() => assertScratchRootOutsideRepo(join(REPO_ROOT, 'no', 'such', 'dir')), /refusing/)

  // And a base that reaches the repository through a symlink is refused, which
  // is the case a string comparison alone would miss.
  const base = scratchDir('link-base')
  try {
    symlinkSync(REPO_ROOT, join(base, 'repo'))
    assert.throws(() => assertScratchRootOutsideRepo(join(base, 'repo', 'scratch')), /refusing/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }

  // A genuine temporary directory is accepted.
  const ok = scratchDir('accepted')
  try {
    assert.ok(assertScratchRootOutsideRepo(ok))
  } finally {
    rmSync(ok, { recursive: true, force: true })
  }
})

test('prepareScratchRoot refuses a base inside this repository and leaves nothing behind', () => {
  const [fixture] = readFixtures()
  const before = existsSync(join(REPO_ROOT, 'evals', 'ship', 'scratch'))
  assert.throws(
    () => prepareScratchRoot(fixture, { tmpBase: join(REPO_ROOT, 'evals', 'ship', 'scratch') }),
    /refusing/
  )
  assert.equal(existsSync(join(REPO_ROOT, 'evals', 'ship', 'scratch')), before)
})

/** Size and mtime of every file in a corpus — a modification shows as well as a creation. */
function snapshot(dirs) {
  const into = []
  const walk = abs => {
    if (!existsSync(abs)) return
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const next = join(abs, entry.name)
      if (entry.isDirectory()) walk(next)
      else if (entry.isFile()) {
        const s = statSync(next)
        into.push(`${relative(REPO_ROOT, next)}\t${s.size}\t${s.mtimeMs}`)
      }
    }
  }
  for (const dir of dirs) walk(join(REPO_ROOT, dir))
  return into
}

test('a completed scratch run leaves this repository\'s corpora byte-identical', () => {
  // The three corpora a run writes to: the outcome corpus, the run trajectory
  // and the review metrics. A fixture run that reached any of them would be
  // indistinguishable, once written, from a record of real work.
  const CORPORA = [join('.claude', 'learning'), join('.claude', 'ship'), join('.claude', 'metrics')]
  const before = snapshot(CORPORA)

  const roots = []
  try {
    for (const fixture of readFixtures()) {
      const { root, commit } = prepareScratchRoot(fixture)
      roots.push(root)

      // The starting state landed, committed, with the testing profile the
      // graders will need — and the baseline commit the weakened-suite check
      // is measured against exists.
      assert.ok(commit, `${fixture.id}: the scratch repository has no baseline commit`)
      assert.ok(existsSync(join(root, '.claude', 'testing', 'profile.json')))

      // Exercise the CLI against the scratch root, which is the shape every
      // grader takes: an `interlock` invocation with `--root <scratch>`.
      const validated = spawnSync(process.execPath, [BIN, 'validate', fixture.change, '--root', root, '--json'], {
        cwd: ROOT,
        encoding: 'utf8'
      })
      assert.equal(validated.status, 0, `${fixture.id}: validate against the scratch root exited non-zero`)

      // Anything the run produced stayed in the scratch root.
      mkdirSync(join(root, '.claude', 'learning'), { recursive: true })
      writeFileSync(join(root, '.claude', 'learning', 'outcomes.jsonl'), '{"scratch":true}\n')
    }
  } finally {
    for (const root of roots) removeScratchRoot(root)
  }

  const after = snapshot(CORPORA)
  const created = after.filter(line => !before.includes(line))
  assert.deepEqual(
    created,
    [],
    'a fixture run wrote into this repository\'s corpora. The scratch root is the only place a ' +
      'run may write, and nothing is copied back:\n' +
      created.map(line => `  ${line.split('\t')[0]}`).join('\n')
  )
  assert.equal(before.length, after.length, 'a corpus file was removed by the eval')
})
