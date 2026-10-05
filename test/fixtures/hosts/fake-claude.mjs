#!/usr/bin/env node
// A fixture `claude` CLI: enough of the headless contract to prove the adapter's bytes.
//
// It parses the exact argv `lib/host/claude-cli.mjs` sends, reads the prompt
// from stdin, refuses to answer without a schema, and prints the envelope shape
// the real CLI prints — verified against Claude Code on 2026-09-05, and the
// per-model breakdown against the 2.1.274 captures under `claude-envelopes/`:
//
//   { type: "result", subtype: "success", is_error, result, structured_output,
//     session_id, num_turns, total_cost_usd, terminal_reason, permission_denials,
//     usage: { input_tokens, output_tokens, ... },
//     modelUsage: { "<model id>": { inputTokens, outputTokens, ... } } }
//
// Every envelope carries `num_turns`, `total_cost_usd` and a `modelUsage` keyed
// by the `--model` value it was sent (`claude-sonnet-5-5` when it was sent none).
//
// It REFUSES, with exit 64 and a message naming the flag, any `--` option the
// adapter has no business sending — an unknown flag, and `--no-session-persistence`
// by name, so an adapter that disabled persistence (and with it the lane
// transcript the served models are read from) fails here rather than passing.
//
// No model, no network, no API key. The point is the wire, not the judgement.
//
// Modes, selected by argv after a `--`:
//   --fixture-ship        answer whatever step of a ship run this prompt is
//   --fixture-no-usage    omit the usage block, so a wave records unknown
//   --fixture-fail        exit non-zero, so the spawn is null
//   --fixture-no-output   exit 0 with an envelope carrying no structured_output
//   --fixture-echo        return the argv and cwd it saw, for argv pinning
//   --fixture-write=PATH  the file an implementer lane writes (lane collisions)
//   --fixture-per-lane    write a file named after the lane's own task ids instead
//   --fixture-no-effort-flag  a CLI that predates `--effort`: its help omits the
//                         flag and an invocation passing it is rejected
//   --fixture-effort-in-prose  a CLI whose help names `--effort` only in another
//                         option's description, and which rejects the flag
//   --fixture-help-fails  `--help` exits non-zero
//   --fixture-help-hangs  `--help` never answers
//   --fixture-version=V   `--version` prints `V (Claude Code)`, the real CLI's shape
//   --fixture-version-fails  `--version` exits non-zero
//   --fixture-delay=MS    hold the envelope MS milliseconds before printing it, so
//                         a runner test can signal the runner while a lane is in flight
//   --fixture-error-subtype=S  exit 1 with an error envelope on stdout: `subtype: S`,
//                         `is_error: true`, `errors`, and no `structured_output` —
//                         a lane the host stopped (`error_max_turns`, say)
//   --fixture-served-model=ID  add a `modelUsage` entry keyed ID beside the routed
//                         one, as a host-internal or fallback call shows in it
//   --fixture-denials=T,T  `permission_denials` entries naming those tools, each
//                         `{ tool_name, tool_use_id, tool_input: {} }`
//   --fixture-session=ID  the envelope's `session_id` (default `sess-<pid>`)
//   --fixture-transcript=MODEL  write the session's transcript where the host does,
//                         `$CLAUDE_CONFIG_DIR/projects/<slug(realpath(cwd))>/<session>.jsonl`,
//                         with two assistant turns served by MODEL. Refused (64)
//                         when `CLAUDE_CONFIG_DIR` is unset, so a test can never
//                         write into the operator's own `~/.claude`
//   --fixture-no-permission-prompts-flag  a CLI that predates `--permission-prompts`:
//                         its help omits the flag and an invocation passing it is
//                         rejected. The default help lists `--permission-prompts <target>`
//
// `--version` and `--help` are answered before every other check, as the real
// CLI does, so the run program's version probe and the adapter's one-time
// capability probe need no schema and no stdin. `--version` without either
// version mode is NOT answered: it falls through to the contract checks below
// and is refused, so a probe that forgot to name a version reads as unknown.

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectSlug } from '../../../lib/project-slug.mjs'
import { shipAnswer } from './ship-answers.mjs'

const argv = process.argv.slice(2)
const has = flag => argv.includes(flag)
const valueOf = name => {
  const prefix = `${name}=`
  const hit = argv.find(a => a.startsWith(prefix))
  if (hit) return hit.slice(prefix.length)
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : null
}

if (has('--version') && (valueOf('--fixture-version') || has('--fixture-version-fails'))) {
  if (has('--fixture-version-fails')) {
    process.stderr.write('fake-claude: version is unavailable on purpose\n')
    process.exit(3)
  }
  process.stdout.write(`${valueOf('--fixture-version')} (Claude Code)\n`)
  process.exit(0)
}

if (has('--help')) {
  if (has('--fixture-help-fails')) {
    process.stderr.write('fake-claude: help is unavailable on purpose\n')
    process.exit(3)
  }
  if (has('--fixture-help-hangs')) {
    // Never answers; the probe's timeout is what ends it.
    setInterval(() => {}, 1 << 30)
    await new Promise(() => {})
  } else {
    const lines = [
      'Usage: claude [options] [prompt]',
      '',
      'Options:',
      '  -p, --print                 Print response and exit',
      '  --output-format <format>    Output format',
      '  --model <model>             Model for the current session',
      '  --permission-mode <mode>    Permission mode for the session'
    ]
    if (!has('--fixture-no-permission-prompts-flag')) {
      lines.push('  --permission-prompts <target>  Where permission prompts go (none to never ask)')
    }
    if (has('--fixture-effort-in-prose')) {
      lines.push('  --thinking <mode>           Thinking mode (replaces the removed --effort flag)')
    } else if (!has('--fixture-no-effort-flag')) {
      lines.push('  --effort <level>            Effort level for the current session')
    }
    process.stdout.write(`${lines.join('\n')}\n`)
    process.exit(0)
  }
} else if ((has('--fixture-no-effort-flag') || has('--fixture-effort-in-prose')) && has('--effort')) {
  process.stderr.write("error: unknown option '--effort'\n")
  process.exit(1)
} else if (has('--fixture-no-permission-prompts-flag') && has('--permission-prompts')) {
  process.stderr.write("error: unknown option '--permission-prompts'\n")
  process.exit(1)
}

// Session persistence is what writes the lane transcript the adapter reads its
// served models from, and what makes a lane resumable. Refused by name.
if (has('--no-session-persistence')) {
  process.stderr.write('fake-claude: the adapter must never pass --no-session-persistence\n')
  process.exit(64)
}

if (has('--fixture-fail')) {
  process.stderr.write('fake-claude: refusing on purpose\n')
  process.exit(2)
}

// The contract, asserted by the fixture itself rather than only by the test:
// a run that stopped passing `-p` or `--output-format json` would otherwise get
// a green envelope back and look correct.
for (const required of ['-p', '--output-format']) {
  if (!has(required)) {
    process.stderr.write(`fake-claude: the adapter must pass ${required}\n`)
    process.exit(64)
  }
}
if (valueOf('--output-format') !== 'json') {
  process.stderr.write('fake-claude: --output-format must be json\n')
  process.exit(64)
}
if (!has('--json-schema')) {
  process.stderr.write('fake-claude: the adapter must enforce a result schema\n')
  process.exit(64)
}

// Every option the adapter may send. Anything else is refused by name: a flag
// that drifted into the argv is a failing test here, not a CLI that shrugged.
const KNOWN_OPTIONS = new Set([
  '-p',
  '--print',
  '--output-format',
  '--json-schema',
  '--plugin-dir',
  '--agent',
  '--model',
  '--effort',
  '--permission-mode',
  '--permission-prompts',
  '--allowedTools'
])
for (const arg of argv) {
  if (!arg.startsWith('-') || arg.startsWith('--fixture-')) continue
  const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg
  if (!KNOWN_OPTIONS.has(name)) {
    process.stderr.write(`fake-claude: unknown option '${name}'\n`)
    process.exit(64)
  }
}
if (has('--permission-prompts') && valueOf('--permission-prompts') !== 'none') {
  process.stderr.write('fake-claude: --permission-prompts takes none here\n')
  process.exit(64)
}

/** The model this session was sent, or the id the real CLI would default to. */
const ROUTED_MODEL = valueOf('--model') || 'claude-sonnet-5-5'
const SESSION_ID = valueOf('--fixture-session') || `sess-${process.pid}`
const ERROR_SUBTYPE = valueOf('--fixture-error-subtype')

if (has('--fixture-transcript') || valueOf('--fixture-transcript')) {
  if (!process.env.CLAUDE_CONFIG_DIR) {
    process.stderr.write('fake-claude: --fixture-transcript needs CLAUDE_CONFIG_DIR, never the real ~/.claude\n')
    process.exit(64)
  }
}

/** One per-model breakdown entry, shaped like the captured envelopes'. */
const modelEntry = (inputTokens, outputTokens) => ({
  inputTokens,
  outputTokens,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  costUSD: 0.001
})

/** Write the session's transcript where the host does: two assistant turns served by `model`. */
function writeTranscript(model) {
  const cwd = realpathSync(process.cwd())
  const dir = join(process.env.CLAUDE_CONFIG_DIR, 'projects', projectSlug(cwd))
  mkdirSync(dir, { recursive: true })
  const base = { isSidechain: false, cwd, sessionId: SESSION_ID, version: '2.1.274' }
  const usage = output => ({
    input_tokens: 10,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 100 },
    output_tokens: output,
    service_tier: 'standard'
  })
  const assistant = (n, uuid, parentUuid) => ({
    ...base,
    parentUuid,
    type: 'assistant',
    uuid,
    timestamp: new Date().toISOString(),
    message: {
      id: `msg_fixture_${n}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: `turn ${n}` }],
      stop_reason: 'end_turn',
      usage: usage(20 * n)
    }
  })
  const rows = [
    {
      ...base,
      parentUuid: null,
      type: 'user',
      uuid: 'u-1',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'the briefing' }
    },
    assistant(1, 'a-1', 'u-1'),
    {
      ...base,
      parentUuid: 'a-1',
      type: 'user',
      uuid: 'u-2',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-1', content: 'ok' }] }
    },
    assistant(2, 'a-2', 'u-2')
  ]
  writeFileSync(join(dir, `${SESSION_ID}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
}

/** The result schema this spawn was given, so the fixture can answer its shape. */
const parseSchema = raw => {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

let prompt = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  prompt += chunk
})
process.stdin.on('end', () => {
  if (!prompt.trim()) {
    process.stderr.write('fake-claude: the prompt must arrive on stdin, never as argv\n')
    process.exit(64)
  }

  const served = valueOf('--fixture-served-model')
  const denied = (valueOf('--fixture-denials') || '').split(',').map(t => t.trim()).filter(Boolean)
  const envelope = {
    type: 'result',
    subtype: ERROR_SUBTYPE || 'success',
    is_error: Boolean(ERROR_SUBTYPE),
    num_turns: 2,
    session_id: SESSION_ID,
    total_cost_usd: 0.0123,
    terminal_reason: ERROR_SUBTYPE ? ERROR_SUBTYPE.replace(/^error_/, '') : 'completed',
    ...(ERROR_SUBTYPE ? { errors: [`fake-claude: ${ERROR_SUBTYPE} on purpose`] } : { result: 'done' }),
    ...(has('--fixture-no-usage')
      ? {}
      : { usage: { input_tokens: 11, output_tokens: 23, cache_read_input_tokens: 0 } }),
    modelUsage: {
      [ROUTED_MODEL]: modelEntry(11, 23),
      ...(served && served !== ROUTED_MODEL ? { [served]: modelEntry(1180, 14) } : {})
    },
    permission_denials: denied.map((tool, i) => ({ tool_name: tool, tool_use_id: `toolu_fixture_${i + 1}`, tool_input: {} }))
  }

  const transcriptModel = valueOf('--fixture-transcript')
  if (transcriptModel) writeTranscript(transcriptModel)

  if (ERROR_SUBTYPE) {
    // A stopped lane: the envelope still names why, and the exit says it failed.
    process.stdout.write(`${JSON.stringify(envelope)}\n`)
    process.exitCode = 1
    return
  }

  if (!has('--fixture-no-output')) {
    envelope.structured_output = has('--fixture-echo')
      ? {
          ok: true,
          argv,
          cwd: process.cwd(),
          model: valueOf('--model'),
          effort: valueOf('--effort'),
          agent: valueOf('--agent'),
          permissionMode: valueOf('--permission-mode'),
          permissionPrompts: valueOf('--permission-prompts'),
          pluginDir: valueOf('--plugin-dir'),
          allowedTools: valueOf('--allowedTools'),
          schema: valueOf('--json-schema'),
          promptOnStdin: true
        }
      : has('--fixture-ship')
        ? shipAnswer(prompt, {
            writePath: valueOf('--fixture-write') || 'README.md',
            perLane: has('--fixture-per-lane'),
            schema: parseSchema(valueOf('--json-schema'))
          })
        : { ok: true, pid: process.pid }
  }

  const print = () => process.stdout.write(`${JSON.stringify(envelope)}\n`)
  const delay = Number.parseInt(valueOf('--fixture-delay') || '', 10)
  if (Number.isInteger(delay) && delay > 0) setTimeout(print, delay)
  else print()
})
