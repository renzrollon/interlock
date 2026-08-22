#!/usr/bin/env node
// A fixture ACP agent: enough of the protocol to prove the adapter's bytes.
//
// It answers `initialize`, `session/new` and `session/prompt` over
// newline-delimited JSON-RPC on stdio, exactly as ACP's stdio transport
// specifies, and streams its reply back as an `agent_message_chunk`. No model,
// no network, no API key — the point is the wire, not the judgement.
//
// Modes, selected by argv:
//   (default)   reply with a JSON object naming this process
//   --prose     wrap that object in chat prose, to exercise recovery
//   --refuse    end the turn with stopReason "refusal" and no text at all
//   --permission ask for tool permission first and report which option won
//   --die       exit before answering anything

const mode = {
  prose: process.argv.includes('--prose'),
  refuse: process.argv.includes('--refuse'),
  permission: process.argv.includes('--permission'),
  die: process.argv.includes('--die')
}

if (mode.die) process.exit(3)

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`)

let nextId = 0
const pendingClientCalls = new Map()

const askClient = (method, params) =>
  new Promise(resolve => {
    const id = `agent-${++nextId}`
    pendingClientCalls.set(id, resolve)
    send({ jsonrpc: '2.0', id, method, params })
  })

async function handlePrompt(id, params) {
  const text = (params.prompt || [])
    .filter(block => block && block.type === 'text')
    .map(block => block.text)
    .join('')

  let permissionOptionId = null
  if (mode.permission) {
    const answer = await askClient('session/request_permission', {
      sessionId: params.sessionId,
      toolCall: { toolCallId: 'call-1', title: 'write a file', kind: 'edit', status: 'pending' },
      options: [
        { optionId: 'no', name: 'Reject', kind: 'reject_once' },
        { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'always', name: 'Always allow', kind: 'allow_always' }
      ]
    })
    permissionOptionId =
      (answer && answer.outcome && answer.outcome.optionId) || (answer && answer.outcome && answer.outcome.outcome) || null
  }

  if (mode.refuse) {
    send({ jsonrpc: '2.0', id, result: { stopReason: 'refusal' } })
    return
  }

  const payload = {
    ok: true,
    pid: process.pid,
    sessionId: params.sessionId,
    sawSchemaInstruction: /reply with a single JSON object/.test(text),
    sawModelMeta: Boolean(params._meta && params._meta['interlock/model']),
    model: (params._meta && params._meta['interlock/model']) || null,
    permissionOptionId
  }
  const body = JSON.stringify(payload)

  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: mode.prose ? `Sure — here is the result:\n\n${body}\n\nHope that helps!` : body
        }
      }
    }
  })
  send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } })
}

async function handle(message) {
  if (!message || typeof message !== 'object') return
  if (message.method === undefined && message.id !== undefined) {
    const resolve = pendingClientCalls.get(message.id)
    if (resolve) {
      pendingClientCalls.delete(message.id)
      resolve(message.result)
    }
    return
  }
  const { id, method, params = {} } = message
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: { protocolVersion: params.protocolVersion || 1, agentCapabilities: {}, authMethods: [] }
    })
    return
  }
  if (method === 'session/new') {
    send({ jsonrpc: '2.0', id, result: { sessionId: `sess-${process.pid}-${++nextId}` } })
    return
  }
  if (method === 'session/prompt') {
    await handlePrompt(id, params)
    return
  }
  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `fixture agent: no ${method}` } })
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) handle(JSON.parse(line))
  }
})
process.stdin.on('end', () => process.exit(0))
