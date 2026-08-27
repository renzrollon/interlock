// Shared plumbing for the PreToolUse guards and the SessionStart preflight.
//
// A hook is a bare Node script the Claude Code host runs in its own process: it
// reads one JSON event on stdin and speaks its decision back through stdout and
// the exit code, per the host's hook protocol. It shares no memory with the
// plugin — the only state it has is what it reads off the filesystem. So every
// helper here is a pure filesystem/stdin read, and every one of them fails in
// the ALLOW direction: a guard that blocked a tool call because its own parse
// threw would be a worse failure than the one it exists to prevent.

import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

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

/** Parse `.claude/testing/profile.json`, or null on absence/malformed. */
export function loadTestProfile(root) {
  try {
    const value = JSON.parse(readFileSync(resolve(root, '.claude', 'testing', 'profile.json'), 'utf8'))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

// Directory names that hold tests, used only to recognise a test root token
// inside a profile command — never as a standalone hardcoded glob against the
// tree. The profile is the source of truth for where THIS project's tests live.
const TEST_DIR_TOKENS = new Set(['test', 'tests', '__tests__', 'e2e', 'cypress', 'playwright', 'spec', 'specs'])
const TEST_FILE_SUFFIX = /\.(test|spec)\.[a-z0-9]+$/i

/**
 * Derive the set of test-root directories this project actually uses from its
 * test profile, by reading the path tokens out of the profile's own commands
 * (`find test -name ...`, `npx playwright test e2e/`, ...). A `<placeholder>`
 * token is skipped — it is the argument the command leaves open, not a path.
 *
 * @returns {{ roots: string[], hasProfile: boolean }}
 */
export function testRootsFromProfile(profile) {
  if (!profile || typeof profile !== 'object') return { roots: [], hasProfile: false }
  const roots = new Set()
  const consider = raw => {
    if (typeof raw !== 'string') return
    for (const token of raw.trim().split(/\s+/)) {
      if (!token || token.startsWith('<') || token.startsWith('-')) continue
      const norm = token.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
      const segments = norm.split('/')
      // The first segment that is a known test-dir token anchors a root at the
      // path up to and including it — `packages/app/e2e` → `packages/app/e2e`.
      for (let i = 0; i < segments.length; i++) {
        if (TEST_DIR_TOKENS.has(segments[i].toLowerCase())) {
          roots.add(segments.slice(0, i + 1).join('/'))
          break
        }
      }
    }
  }
  for (const kind of ['unit', 'e2e']) {
    const section = profile[kind]
    if (!section || typeof section !== 'object') continue
    consider(section.command)
    consider(section.single_file)
    consider(section.filter_syntax)
  }
  return { roots: [...roots], hasProfile: true }
}

/**
 * Is `absPath` a test file for this project? True when it lives under one of the
 * profile-derived roots, or when its filename carries the `.test.`/`.spec.`
 * convention (a filename shape, not a directory glob). `root` is the project
 * root the relative comparison is made against.
 */
export function isTestPath(absPath, testRoots, root) {
  if (typeof absPath !== 'string') return false
  const rel = relPosix(root, absPath)
  if (TEST_FILE_SUFFIX.test(rel)) return true
  for (const testRoot of testRoots) {
    const r = testRoot.replace(/\/+$/, '')
    if (rel === r || rel.startsWith(r + '/')) return true
  }
  return false
}

/** Project-relative POSIX path, for stable comparison against profile roots. */
export function relPosix(root, absPath) {
  const base = resolve(root).replace(/\\/g, '/').replace(/\/+$/, '')
  const p = resolve(absPath).replace(/\\/g, '/')
  if (p === base) return ''
  if (p.startsWith(base + '/')) return p.slice(base.length + 1)
  return p // outside the project root: return as-is, suffix check still applies
}
