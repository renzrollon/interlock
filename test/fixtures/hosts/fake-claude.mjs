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
//
// `--version` and `--help` are answered before every other check, as the real
// CLI does, so the run program's version probe and the adapter's one-time
// capability probe need no schema and no stdin. `--version` without either
// version mode is NOT answered: it falls through to the contract checks below
// and is refused, so a probe that forgot to name a version reads as unknown.

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
      '  --model <model>             Model for the current session'
    ]
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
          effort: valueOf('--effort'),
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

  const print = () => process.stdout.write(`${JSON.stringify(envelope)}\n`)
  const delay = Number.parseInt(valueOf('--fixture-delay') || '', 10)
  if (Number.isInteger(delay) && delay > 0) setTimeout(print, delay)
  else print()
})
