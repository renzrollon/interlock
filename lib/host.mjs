// The workflow host port (add-interlock-acp-host §1).
//
// Every guarantee in this repository comes from `bin/interlock` — which wave
// runs next, whether accumulated failures have exhausted the budget, whether a
// red unit suite blocks a commit. Exactly one guarantee came from somewhere
// else: the *spawn*. `workflows/ship.js` runs on the Claude Code dynamic
// workflow runtime and reaches a model through that runtime's `agent()` and
// `pipeline()` globals, which exist nowhere else. That is the whole portability
// hole, and it is three functions wide:
//
//   spawn        one labelled agent, given a prompt, a model and a schema
//   mapPipeline  the same, in parallel, across a batch the planner sized
//   runCli       execute `interlock` and hand back exit code plus stdout
//
// A host implements those three and nothing else. It does NOT decide wave
// order, it does NOT judge a verify result, it does NOT apply a cap or a review
// gate — those live behind `runCli` on purpose, so a second host cannot quietly
// grow a second copy of the rules. `test/spine/host.test.mjs` holds that line by
// driving a real batch through a host that cannot talk to a model at all: the
// halt still comes out of the CLI's exit status.
//
// `workflows/ship.js` deliberately does not import this module. The workflow
// runtime rejects a script containing `import()` before the run starts, so the
// script keeps using the runtime's native globals; the port is for the ACP
// driver (`bin/interlock-ship-acp`) and for tests. The two drivers share the
// CLI, which is the same split — script versus policy — the repo already had.

import { spawn as spawnProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path to the policy engine. Resolved from this module's own location
 * rather than from PATH or a caller-supplied string: a host that could point
 * `runCli` at some other binary is a host that could reimplement the rules and
 * still look like it was obeying them.
 */
export const INTERLOCK_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'interlock')

/** The three ports a host must provide. Read by `assertWorkflowHost`. */
export const HOST_PORTS = ['spawn', 'mapPipeline', 'runCli']

/**
 * @typedef {object} SpawnRequest
 * @property {string} label      stable name for the agent (task id, step name)
 * @property {string} prompt     the full prompt text
 * @property {string} [model]    model slug the planner assigned, if the host can honour it
 * @property {object} [schema]   JSON Schema the result must satisfy
 */

/**
 * @typedef {object} CliResult
 * @property {number} code    exit status; the loop branches on this, never on prose
 * @property {string} stdout
 * @property {string} stderr
 * @property {string|null} [signal]
 */

/**
 * @typedef {object} WorkflowHost
 * @property {(req: SpawnRequest) => Promise<object|null>} spawn
 * @property {(tasks: object[], fn: (task: object, index: number) => Promise<object|null>) => Promise<Array<object|null>>} mapPipeline
 * @property {(argv: string[], opts?: { input?: string }) => Promise<CliResult>} runCli
 */

/**
 * Fail loudly at startup rather than three waves in, when a half-built host
 * turns out to be missing the one port the loop needs next.
 *
 * @param {object} host
 * @param {string} [label]
 * @returns {WorkflowHost} the same object, for chaining
 */
export function assertWorkflowHost(host, label = 'host') {
  if (!host || typeof host !== 'object') {
    throw new Error(`${label} is not a workflow host: expected an object with ${HOST_PORTS.join(', ')}`)
  }
  const missing = HOST_PORTS.filter(port => typeof host[port] !== 'function')
  if (missing.length) {
    throw new Error(`${label} is missing workflow host port(s): ${missing.join(', ')}`)
  }
  return host
}

/**
 * Execute `interlock` and resolve with its exit code and output.
 *
 * Never rejects on a non-zero exit — a non-zero exit is the answer, not an
 * error, and a host that threw on it would turn a halt into a crash. It rejects
 * only when the process could not be started at all. A run killed by a signal
 * resolves with code 1, because the loop's question is "may I continue", and the
 * answer to that for a killed CLI is no.
 *
 * Invoked as `node <bin/interlock>` rather than as an executable so it works
 * regardless of the file mode on the checkout and of what is on PATH.
 *
 * @param {string[]} argv           subcommand and flags, e.g. ['wave-state', 'next', '--json']
 * @param {object} [opts]
 * @param {string} [opts.cwd]       repo root the CLI runs in
 * @param {object} [opts.env]
 * @param {string} [opts.input]     stdin, for the CLI's `-` file arguments
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<CliResult>}
 */
export function runCli(argv, { cwd = process.cwd(), env = process.env, input, timeoutMs } = {}) {
  const args = (Array.isArray(argv) ? argv : []).map(String)
  if (!args.length) {
    return Promise.reject(new Error('runCli needs at least one interlock subcommand'))
  }
  return new Promise((resolve, reject) => {
    const child = spawnProcess(process.execPath, [INTERLOCK_BIN, ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer =
      Number.isInteger(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => child.kill('SIGKILL'), timeoutMs)
        : null

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', err => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({
        code: typeof code === 'number' ? code : 1,
        stdout,
        stderr: signal ? `${stderr}interlock: killed by ${signal}\n` : stderr,
        signal: signal || null
      })
    })
    child.stdin.end(input === undefined ? '' : String(input))
  })
}

/**
 * Run every item of a batch concurrently. The planner already decided how wide
 * a batch may be — splitting colliding tasks into later batches of the same
 * wave — so a host that throttled here would be overriding a policy decision it
 * does not own.
 *
 * A task that throws resolves to `null`, matching the workflow runtime's
 * `agent()` contract: a stopped or unrecoverable agent is a task failure the
 * loop must report, not an exception that unwinds the run.
 *
 * @param {object[]} items
 * @param {(item: object, index: number) => Promise<object|null>} fn
 * @returns {Promise<Array<object|null>>}
 */
export function mapPipeline(items, fn) {
  const list = Array.isArray(items) ? items : []
  return Promise.all(
    list.map((item, index) =>
      Promise.resolve()
        .then(() => fn(item, index))
        .then(result => (result === undefined ? null : result))
        .catch(() => null)
    )
  )
}

/**
 * Recover the JSON object an agent was asked to return from whatever it
 * actually said. Hosts whose transport has no schema enforcement (ACP returns
 * streamed text) need this; `null` on failure keeps them on the same contract
 * as a runtime that validates the schema itself.
 *
 * @param {string} text
 * @returns {object|null}
 */
export function parseAgentJson(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed) return null

  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(trimmed)
  const candidates = [trimmed]
  if (fenced) candidates.push(fenced[1].trim())

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // fall through to the brace scan
    }
  }

  // Last resort: the first balanced object in the text. Agents prepend prose
  // more often than they malform JSON, and a run should not halt over a
  // greeting. String-aware so a brace inside a summary does not end the scan.
  for (const candidate of candidates) {
    const start = candidate.indexOf('{')
    if (start === -1) continue
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            const parsed = JSON.parse(candidate.slice(start, i + 1))
            if (parsed && typeof parsed === 'object') return parsed
          } catch {
            // keep scanning; a later balanced object may parse
          }
          break
        }
      }
    }
  }
  return null
}

/**
 * A host for tests: the spawn side is a stub, the CLI side is the real binary.
 *
 * That asymmetry is the point. Stubbing `runCli` too would let a test assert
 * that the loop halted while proving nothing about *who decided* — and "the
 * host must not compute halt reasons itself" is precisely the requirement these
 * tests exist to hold. So there is no `cli` override: `runCli` always execs
 * `bin/interlock`.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd]                        repo root for the CLI
 * @param {object} [opts.env]
 * @param {(req: SpawnRequest, index: number) => (object|null|Promise<object|null>)} [opts.spawn]
 *        stub result per spawn; omitted means every agent returns null
 * @returns {WorkflowHost & { spawns: SpawnRequest[], cliCalls: string[][] }}
 */
export function createFakeHost({ cwd = process.cwd(), env = process.env, spawn } = {}) {
  const spawns = []
  const cliCalls = []

  const host = {
    spawns,
    cliCalls,
    async spawn(req) {
      const request = req && typeof req === 'object' ? req : {}
      spawns.push(request)
      if (typeof spawn !== 'function') return null
      const result = await spawn(request, spawns.length - 1)
      return result === undefined ? null : result
    },
    mapPipeline,
    runCli(argv, opts = {}) {
      cliCalls.push((Array.isArray(argv) ? argv : []).map(String))
      return runCli(argv, { cwd, env, ...opts })
    }
  }

  return assertWorkflowHost(host, 'fake host')
}
