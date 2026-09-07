// The eval agent's tool set: read a file, write a file, run a command.
//
// Three tools, each scoped to the session's working directory — which the ship
// loop sets to the scratch root. The scoping is the point: this agent is
// pointed at a fixture copy by a runner that has already refused to place that
// copy inside this repository, and a tool that could resolve its way out would
// undo that refusal one `../` at a time.
//
// Scoping is enforced twice, because once is not enough: the resolved path must
// lie under the root, and — where the path exists — its resolved real path must
// too, which is what a symlink pointing outward fails.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve, sep } from 'node:path'

/** How much of a file the agent may read in one call. */
const MAX_READ_BYTES = 256 * 1024

/** How much command output travels back into the conversation, per stream. */
const MAX_OUTPUT_CHARS = 20000

/** Wall clock for one command. A wedged command must not wedge the run. */
const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Resolve `path` under `root`, refusing anything that lands outside it.
 *
 * @param {string} root
 * @param {string} path
 * @returns {string} the absolute path
 */
export function resolveInside(root, path) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('path is required')
  }
  const realRoot = realpathSync(root)
  const absolute = isAbsolute(path) ? resolve(path) : resolve(realRoot, path)
  const inside = target => target === realRoot || target.startsWith(realRoot + sep)

  if (!inside(absolute)) {
    throw new Error(
      `refusing to touch ${path}: it resolves outside the session's working directory`
    )
  }
  // A path that exists may still be a symlink pointing out of the root. The
  // nearest existing ancestor is checked for the same reason: a write to
  // `linked-dir/file.txt` escapes just as completely as a write to `../file`.
  const existing = existsSync(absolute) ? absolute : nearestExisting(absolute, realRoot)
  if (existing && !inside(realpathSync(existing))) {
    throw new Error(
      `refusing to touch ${path}: it resolves outside the session's working directory via a link`
    )
  }
  return absolute
}

function nearestExisting(absolute, realRoot) {
  let current = dirname(absolute)
  while (current.startsWith(realRoot) && !existsSync(current)) current = dirname(current)
  return existsSync(current) ? current : null
}

/**
 * The tool definitions, in the Messages API's shape.
 *
 * Descriptions are written for the model that reads them: each says what the
 * tool does and what it refuses, so a refusal reads as a boundary rather than
 * as a malfunction worth retrying.
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'read_file',
    description:
      'Read a UTF-8 text file from the working directory. Paths are relative to the working ' +
      'directory; a path resolving outside it is refused. Returns the file contents, truncated ' +
      'if very large.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the working directory' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description:
      'Write a UTF-8 text file in the working directory, creating parent directories and ' +
      'overwriting any existing file. Paths are relative to the working directory; a path ' +
      'resolving outside it is refused.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the working directory' },
        content: { type: 'string', description: 'The complete new contents of the file' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'run_command',
    description:
      'Run a shell command in the working directory and return its exit code, stdout and ' +
      'stderr. Use this to list files, search, and run the test suite. The command runs with ' +
      'the working directory as its cwd and is killed if it exceeds its time budget.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' }
      },
      required: ['command']
    }
  }
]

/** Truncate long output, saying so rather than trailing off silently. */
function clip(text, limit) {
  const value = typeof text === 'string' ? text : ''
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n… [${value.length - limit} more characters omitted]`
}

/**
 * Build the executor the model loop calls with `{ name, input }`.
 *
 * Every tool returns a string. A refused or failed tool returns its reason as
 * that string with `isError` set — the model is told what happened and can act
 * on it, which is not the same as the turn failing.
 *
 * @param {object} options
 * @param {string} options.cwd the session's working directory
 * @param {number} [options.commandTimeoutMs]
 * @param {object} [options.env] environment for `run_command`
 * @returns {(call: { name: string, input: object }) => { content: string, isError: boolean }}
 */
export function createToolExecutor({ cwd, commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, env } = {}) {
  // The model's credential is stripped from the environment commands run in.
  // A fixture's own test suite has no business reading it, and a command that
  // could would put the key one `env` away from anything the agent writes.
  const commandEnv = { ...(env || process.env) }
  delete commandEnv.ANTHROPIC_API_KEY
  delete commandEnv.ANTHROPIC_AUTH_TOKEN
  delete commandEnv.INTERLOCK_EVAL_USAGE_FILE

  return function execute({ name, input }) {
    const args = input && typeof input === 'object' ? input : {}
    try {
      if (name === 'read_file') {
        const path = resolveInside(cwd, args.path)
        if (!existsSync(path)) return { content: `no such file: ${args.path}`, isError: true }
        return { content: clip(readFileSync(path, 'utf8'), MAX_READ_BYTES), isError: false }
      }

      if (name === 'write_file') {
        if (typeof args.content !== 'string') {
          return { content: 'content is required and must be a string', isError: true }
        }
        const path = resolveInside(cwd, args.path)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, args.content)
        return { content: `wrote ${args.content.length} characters to ${args.path}`, isError: false }
      }

      if (name === 'run_command') {
        if (typeof args.command !== 'string' || !args.command.trim()) {
          return { content: 'command is required', isError: true }
        }
        const r = spawnSync('sh', ['-c', args.command], {
          cwd,
          env: commandEnv,
          encoding: 'utf8',
          timeout: commandTimeoutMs,
          maxBuffer: 32 * 1024 * 1024
        })
        if (r.error && r.error.code === 'ETIMEDOUT') {
          return {
            content: `command exceeded its ${commandTimeoutMs}ms budget and was killed`,
            isError: true
          }
        }
        if (r.error) return { content: `command failed to start: ${r.error.message}`, isError: true }
        const body =
          `exit code: ${r.status}\n` +
          `stdout:\n${clip(r.stdout, MAX_OUTPUT_CHARS)}\n` +
          `stderr:\n${clip(r.stderr, MAX_OUTPUT_CHARS)}`
        // A non-zero exit is information, not a tool error: the model asked
        // what the suite does and the answer is "it fails".
        return { content: body, isError: false }
      }

      return { content: `no such tool: ${name}`, isError: true }
    } catch (err) {
      return { content: (err && err.message) || String(err), isError: true }
    }
  }
}
