#!/usr/bin/env node
// A fixture `claude` CLI: enough of the headless contract to prove the adapter's bytes.
//
// It parses the exact argv `lib/host/claude-cli.mjs` sends, reads the prompt
// from stdin, refuses to answer without a schema, and prints the envelope shape
// the real CLI prints — verified against Claude Code on 2026-09-05:
//
//   { type: "result", subtype: "success", is_error, result, structured_output,
//     session_id, usage: { input_tokens, output_tokens, ... } }
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

  const envelope = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: `sess-${process.pid}`,
    result: 'done',
    ...(has('--fixture-no-usage')
      ? {}
      : { usage: { input_tokens: 11, output_tokens: 23, cache_read_input_tokens: 0 } })
  }

  if (!has('--fixture-no-output')) {
    envelope.structured_output = has('--fixture-echo')
      ? {
          ok: true,
          argv,
          cwd: process.cwd(),
          model: valueOf('--model'),
          agent: valueOf('--agent'),
          permissionMode: valueOf('--permission-mode'),
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

  process.stdout.write(`${JSON.stringify(envelope)}\n`)
})
