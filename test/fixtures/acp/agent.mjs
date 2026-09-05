#!/usr/bin/env node
// A fixture ACP agent: enough of the protocol to prove the adapter's bytes.
//
// It answers `initialize`, `session/new` and `session/prompt` over
// newline-delimited JSON-RPC on stdio, exactly as ACP's stdio transport
// specifies, and streams its reply back as an `agent_message_chunk`. No model,
// no network, no API key — the point is the wire, not the judgement.
//
// Modes, selected by argv:
//   (default)   reply with a JSON object naming this process; advertise no
//               config options and reject session/set_model with -32601
//   --prose     wrap that object in chat prose, to exercise recovery
//   --refuse    end the turn with stopReason "refusal" and no text at all
//   --permission ask for tool permission first and report which option won
//   --die       exit before answering anything
//   --ship      answer whatever step of a ship run this prompt is, so the whole
//               driver can be run end to end without a model
//
// And three that exist for model routing, because every wire path the adapter
// negotiates has to be provable without a live agent:
//   --config-options  advertise a `model` select and accept
//                     session/set_config_option
//   --set-model       advertise nothing and accept only the legacy
//                     session/set_model
//   --config-error    advertise the option, reject set_config_option, accept
//                     set_model — the fallback path
//
// Whichever way a model arrived, the payload echoes it as `appliedModel` and
// names the method as `appliedVia`, so a test asserts what the AGENT saw rather
// than what the adapter reported about itself.

// The `--ship` answers are shared with the three fake vendor CLIs
// (`test/fixtures/hosts/`): four fixtures drive the same run program, and four
// copies of "what does an implementer lane return" is four chances for one host
// to stay green against a shape the others stopped producing.
import { shipAnswer } from '../hosts/ship-answers.mjs'

const mode = {
  prose: process.argv.includes('--prose'),
  refuse: process.argv.includes('--refuse'),
  permission: process.argv.includes('--permission'),
  die: process.argv.includes('--die'),
  ship: process.argv.includes('--ship'),
  configOptions: process.argv.includes('--config-options'),
  setModel: process.argv.includes('--set-model'),
  configError: process.argv.includes('--config-error')
}

if (mode.die) process.exit(3)

/**
 * The advertised model select. `x-large` is advertised by a display name only,
 * so the adapter's name-substring rule and its explicit map both have something
 * to match that its value rule cannot reach.
 */
const modelOption = () => ({
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: appliedModel || 'sonnet',
  options: [
    { value: 'haiku', name: 'Claude Haiku', description: 'fastest' },
    { value: 'sonnet', name: 'Claude Sonnet', description: 'balanced' },
    { value: 'opus', name: 'Claude Opus 4', description: 'most capable' },
    { value: 'x-large', name: 'Claude Opus', description: 'named, not valued' }
  ]
})

/** True when session/new advertises the model option at all. */
const advertisesModel = mode.configOptions || mode.configError
/** True when session/set_model is accepted rather than answered -32601. */
const acceptsSetModel = mode.setModel || mode.configError

let appliedModel = null
let appliedVia = null

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

  const payload = mode.ship ? shipAnswer(text) : {
    ok: true,
    pid: process.pid,
    sessionId: params.sessionId,
    sawSchemaInstruction: /reply with a single JSON object/.test(text),
    sawModelMeta: Boolean(params._meta && params._meta['interlock/model']),
    model: (params._meta && params._meta['interlock/model']) || null,
    appliedModel,
    appliedVia,
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
    send({
      jsonrpc: '2.0',
      id,
      result: {
        sessionId: `sess-${process.pid}-${++nextId}`,
        ...(advertisesModel ? { configOptions: [modelOption()] } : {})
      }
    })
    return
  }
  if (method === 'session/set_config_option') {
    if (mode.configError) {
      send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'fixture agent: config option rejected' } })
      return
    }
    if (!advertisesModel) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'fixture agent: no session/set_config_option' } })
      return
    }
    appliedModel = params.value
    appliedVia = 'set_config_option'
    // The real method replies with the full option list, so the fixture does too.
    send({ jsonrpc: '2.0', id, result: { configOptions: [modelOption()] } })
    return
  }
  if (method === 'session/set_model') {
    if (!acceptsSetModel) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'fixture agent: no session/set_model' } })
      return
    }
    appliedModel = params.modelId
    appliedVia = 'set_model'
    send({ jsonrpc: '2.0', id, result: {} })
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

// --- --ship: one answer per step of a real ship run -------------------------
//
// Which step this is comes off the briefing the CLI assembled, because that is
// all an ACP agent ever receives — there is no label on the wire. The answers
// themselves live in `test/fixtures/hosts/ship-answers.mjs`, shared with the
// fake vendor CLIs, so one shape serves every host.

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
