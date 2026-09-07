#!/usr/bin/env node
// A fixture `qwen` CLI, verified against qwen-code 0.22.2.
//
//   qwen -p - --output-format json --json-schema <JSON> --yolo [-m <MODEL>]
//   prompt on stdin, one JSON envelope on stdout
//
// `-m` is the model flag as `qwen --help` spells it. `--yolo` and `--json-schema`
// are accepted by the parser but absent from `--help`; both were confirmed by a
// live argv probe, and the fixture requires them so a silent drop would fail
// rather than pass.
//
// Modes (after a `--`):
//   --fixture-ship / --fixture-usage / --fixture-fail / --fixture-no-output
//   --fixture-echo / --fixture-write=PATH / --fixture-per-lane
//
// Usage is OPT-IN here, the mirror of the other two fixtures: Qwen's envelope
// carries no token accounting by default, which is exactly why the host declares
// `usage: false` and every wave on it is recorded unknown.

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

const fail = (code, message) => {
  process.stderr.write(`fake-qwen: ${message}\n`)
  process.exit(code)
}

if (!has('-p')) fail(64, 'the adapter must pass -p for non-interactive mode')
if (valueOf('--output-format') !== 'json') fail(64, '--output-format must be json')
if (!has('--json-schema')) fail(64, 'the adapter must enforce a result schema')
if (!has('--yolo')) fail(64, 'an unattended run must pass --yolo; there is nobody to approve a tool call')
if (has('--fixture-fail')) fail(2, 'refusing on purpose')

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
  if (!prompt.trim()) fail(64, 'the prompt must arrive on stdin, never as argv')

  const response = has('--fixture-no-output')
    ? null
    : has('--fixture-echo')
      ? { ok: true, argv, cwd: process.cwd(), model: valueOf('-m'), schema: valueOf('--json-schema'), promptOnStdin: true }
      : has('--fixture-ship')
        ? shipAnswer(prompt, {
            writePath: valueOf('--fixture-write') || 'README.md',
            perLane: has('--fixture-per-lane'),
            schema: parseSchema(valueOf('--json-schema'))
          })
        : { ok: true, pid: process.pid }

  process.stdout.write(
    `${JSON.stringify({
      response,
      ...(has('--fixture-usage') ? { stats: { tokens: { input: 11, output: 23 } } } : {})
    })}\n`
  )
})
