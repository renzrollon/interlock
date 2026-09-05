#!/usr/bin/env node
// A fixture `codex` CLI: the `exec` contract, verified against codex-cli 0.145.0.
//
//   codex exec --json --output-schema <FILE> -o <FILE> -C <DIR>
//              --sandbox workspace-write [--model <M>]
//   prompt on stdin, JSONL events on stdout, the final message in the `-o` file
//
// `--ask-for-approval` is deliberately NOT accepted: that flag does not exist on
// `codex exec`, which never prompts. A fixture that tolerated it would let the
// adapter drift back to an argv the real CLI rejects.
//
// Modes (after a `--`):
//   --fixture-ship / --fixture-no-usage / --fixture-fail / --fixture-no-output
//   --fixture-echo / --fixture-write=PATH / --fixture-per-lane / --fixture-per-lane — as in fake-claude

import { readFileSync, writeFileSync } from 'node:fs'
import { shipAnswer } from './ship-answers.mjs'

const all = process.argv.slice(2)
// A fixture is invoked as `node fake-codex.mjs [--fixture-*] <the adapter's argv>`,
// so the adapter's own invocation starts at its subcommand. Slicing there is
// what lets `argv[0] === 'exec'` stay a real assertion about the adapter rather
// than about how the test wired the fixture up.
const at = all.indexOf('exec')
const argv = at === -1 ? all : all.slice(at)
const has = flag => argv.includes(flag)
const valueOf = name => {
  const prefix = `${name}=`
  const hit = argv.find(a => a.startsWith(prefix))
  if (hit) return hit.slice(prefix.length)
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : null
}

const fail = (code, message) => {
  process.stderr.write(`fake-codex: ${message}\n`)
  process.exit(code)
}

if (argv[0] !== 'exec') fail(64, 'the adapter must invoke the `exec` subcommand')
if (has('--ask-for-approval')) fail(64, 'codex exec has no --ask-for-approval; the adapter must not send one')
if (!has('--json')) fail(64, 'the adapter must pass --json')
if (!has('--output-schema')) fail(64, 'the adapter must enforce a result schema')
if (!has('-o')) fail(64, 'the adapter must name an output file with -o')
if (!has('-C')) fail(64, 'the adapter must name the working root with -C')
if (valueOf('--sandbox') !== 'workspace-write') fail(64, '--sandbox must be workspace-write')
if (all.includes('--fixture-fail')) fail(2, 'refusing on purpose')

/** The schema codex is handed as a FILE rather than as a flag value. */
const readSchemaFile = path => {
  try {
    return path ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

/** The result schema this spawn was given, so the fixture can answer its shape. */
const parseSchema = raw => {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const fixtureWrite = (all.find(a => a.startsWith('--fixture-write=')) || '').split('=')[1] || null
const outputPath = valueOf('-o')
const cwd = valueOf('-C')

let prompt = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  prompt += chunk
})
process.stdin.on('end', () => {
  if (!prompt.trim()) fail(64, 'the prompt must arrive on stdin, never as argv')

  // The JSONL event stream. The token count is the event the adapter scans for;
  // everything else is noise it must step over without being confused by it.
  const emit = event => process.stdout.write(`${JSON.stringify(event)}\n`)
  emit({ id: '0', msg: { type: 'task_started', model_context_window: 200000 } })
  emit({ id: '1', msg: { type: 'agent_message', message: 'working' } })
  if (!all.includes('--fixture-no-usage')) {
    emit({
      id: '2',
      msg: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 11, output_tokens: 23, total_tokens: 34 } }
      }
    })
  }
  emit({ id: '3', msg: { type: 'task_complete' } })

  if (all.includes('--fixture-no-output')) process.exit(0)

  const payload = all.includes('--fixture-echo')
    ? { ok: true, argv, cwd, model: valueOf('--model'), schemaPath: valueOf('--output-schema'), promptOnStdin: true }
    : all.includes('--fixture-ship')
      ? shipAnswer(prompt, {
        writePath: fixtureWrite || 'README.md',
        perLane: all.includes('--fixture-per-lane'),
        schema: parseSchema(readSchemaFile(valueOf('--output-schema')))
      })
      : { ok: true, pid: process.pid }

  writeFileSync(outputPath, JSON.stringify(payload))
})
