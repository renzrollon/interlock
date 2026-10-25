// Shared plumbing for the PreToolUse guards and the SessionStart preflight.
//
// A hook is a bare Node script the Claude Code host runs in its own process: it
// reads one JSON event on stdin and speaks its decision back through stdout and
// the exit code, per the host's hook protocol. It shares no memory with the
// plugin — the only state it has is what it reads off the filesystem. So every
// helper here is a pure filesystem/stdin read, and every one of them fails in
// the ALLOW direction: a guard that blocked a tool call because its own parse
// threw would be a worse failure than the one it exists to prevent.

import { isAbsolute, resolve } from 'node:path'

// The test-path predicate lives in `lib/test-paths.mjs` so the guard and
// `interlock mr test-paths` are one implementation (close-the-merge-request-loop).
export { isTestPath, loadTestProfile, relPosix, testRootsFromProfile } from '../lib/test-paths.mjs'

/** Read the PreToolUse/SessionStart event the host writes to stdin. */
export async function readEvent() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    // A malformed event is not something a guard should block on — allow.
    return {}
  }
}

/**
 * Allow the tool call. The host's default on a clean exit with no decision is to
 * proceed, so allow is simply "say nothing, exit 0". Used for both the ordinary
 * allow and the fail-open path after an internal error (with a stderr note).
 */
export function allow(note) {
  if (note) process.stderr.write(`${note}\n`)
  process.exit(0)
}

/**
 * Deny the tool call in the shape the host's PreToolUse protocol expects, so the
 * blocked agent receives `reason` as actionable feedback rather than an opaque
 * failure. `detail` travels alongside the human-readable reason as machine-
 * readable fields (guard name, path/command, current stage).
 */
export function deny(reason, detail = {}) {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    },
    // Kept for a reader that wants the parts without re-parsing the sentence.
    interlockGuard: detail
  }
  process.stdout.write(JSON.stringify(out) + '\n')
  process.exit(0)
}

/** The tool name from the event, tolerant of the two casings seen in the wild. */
export function toolName(event) {
  return event.tool_name || event.toolName || ''
}

/** The tool input object, under either key the host has used. */
export function toolInput(event) {
  return event.tool_input || event.toolInput || {}
}

/** Project root the hook runs against — the host sets cwd to it. */
export function projectRoot(event) {
  return event.cwd || process.cwd()
}

/**
 * The absolute file path an Edit/Write targets, or null when the payload names
 * no concrete path. An unresolvable target is not a target to protect, so the
 * guards allow it — this returning null is how they reach that decision.
 */
export function editTargetPath(event) {
  const input = toolInput(event)
  const raw = input.file_path || input.filePath || input.path
  if (typeof raw !== 'string' || !raw.trim()) return null
  return isAbsolute(raw) ? raw : resolve(projectRoot(event), raw)
}
