#!/usr/bin/env node
// The eval's ACP agent: the process `interlock-ship-acp` spawns per task.
//
// Apparatus, not product. Both arms of the outcome eval use this same agent, so
// it is the constant between them and the harness is not a variable in the
// comparison. Its identity travels on every result row (`AGENT_IDENTITY`), so a
// change to it cannot silently confound a comparison across plugin versions.
//
// This file owns exactly three things: stdio, the system prompt, and writing
// the usage record. The wire is `wire.mjs`, the tools are `tools.mjs`, the model
// loop is `model.mjs`.

import { appendFileSync } from 'node:fs'
import { createAgent, createLineReader } from './wire.mjs'
import { createToolExecutor, TOOL_DEFINITIONS } from './tools.mjs'
import { createModelClient, DEFAULT_MODEL, MODEL_ENV } from './model.mjs'

/**
 * This agent's identity, recorded on every result row so a reader can exclude
 * runs whose instrument differed. Bump the version when its prompt, tools or
 * loop change in a way that could move a measurement.
 */
export const AGENT_IDENTITY = 'interlock-eval-acp-agent/2'

/** Where the runner asks for the per-session usage record to be appended. */
export const USAGE_FILE_ENV = 'INTERLOCK_EVAL_USAGE_FILE'

/** The schema of one usage record. Declared, so a reader classifies rather than guesses. */
export const USAGE_SCHEMA = 'interlock.ship-eval-agent-usage/2'

const SYSTEM_PROMPT = [
  'You are an implementation agent running inside an automated evaluation. You are working in a',
  'small repository, and you have three tools: read_file, write_file and run_command. All three',
  'are scoped to the working directory; a path outside it is refused.',
  '',
  'Do the work the prompt asks for and nothing else. Read before you write. When you change code,',
  'run the repository\'s test suite with run_command to check what you did, and fix what you broke.',
  'Never weaken, skip or delete an existing test to make a suite pass — if a committed test fails,',
  'the code is what is wrong.',
  '',
  'When the prompt asks for a JSON result, your final message must be that JSON object and nothing',
  'else: no prose before or after it, and no code fence.'
].join('\n')

/**
 * Append this process's token usage, as measured by the agent itself, where the
 * runner asked for it.
 *
 * The write is best-effort *for the agent* and is reported when it fails: an
 * agent that killed a ship run because it could not write a bookkeeping line
 * would be measuring apparatus failure as product failure. The runner decides
 * what a missing record means — and a missing record is exactly what "not
 * measured" looks like, which is why nothing here ever writes a zeroed one.
 */
export function reportUsage({ sessionId, model, usage, cacheStatus = null, env = process.env, warn = () => {} }) {
  const path = env[USAGE_FILE_ENV]
  if (!path) return false
  const record = {
    schema: USAGE_SCHEMA,
    ts: new Date().toISOString(),
    agent: AGENT_IDENTITY,
    sessionId,
    model,
    pid: process.pid,
    requests: usage.requests,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    // What the two figures above mean. A zero has four causes and only one of
    // them is a miss; without this a reader of the corpus cannot tell a prefix
    // below the provider's floor from one that was cacheable and not reused.
    cacheStatus
  }
  try {
    appendFileSync(path, `${JSON.stringify(record)}\n`)
    return true
  } catch (err) {
    warn(`usage not recorded to ${path}: ${(err && err.message) || err}`)
    return false
  }
}

function main() {
  const model = createModelClient({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env[MODEL_ENV] || DEFAULT_MODEL
  })

  const send = message => process.stdout.write(`${JSON.stringify(message)}\n`)
  const warn = text => process.stderr.write(`interlock eval agent: ${text}\n`)

  const { handle } = createAgent({
    send,
    async onPrompt({ sessionId, cwd, text, emit }) {
      const executeTool = createToolExecutor({ cwd })
      const { text: reply } = await model.run({
        prompt: text,
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFINITIONS,
        executeTool
      })
      emit(reply)
      reportUsage({
        sessionId,
        model: model.model,
        usage: model.usage,
        cacheStatus: model.cacheStatus(),
        warn
      })
      return { stopReason: 'end_turn' }
    }
  })

  const feed = createLineReader(handle, (line, err) =>
    warn(`unparseable line (${err.message}): ${line.slice(0, 200)}`)
  )

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    feed(chunk).catch(err => warn(`handler failed: ${(err && err.message) || err}`))
  })
  process.stdin.on('end', () => process.exit(0))
}

// Importable for tests; only the executable form starts talking on stdio.
if (process.argv[1] && process.argv[1].endsWith('main.mjs')) main()
