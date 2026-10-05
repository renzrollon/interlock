// The state home — where a run's append-only corpora live.
//
// A ship run writes two kinds of file. Its working state (the manifest, the
// cursor, the briefings, the spill) belongs to the working tree the run operates
// on. Its corpora (the trajectory, the outcome line, the metrics, the resume
// card) belong to the project, because `interlock report` reads them across
// every run the project has ever had.
//
// On a main checkout those are the same directory and nothing here matters. On
// a linked worktree they are not: a Desktop worktree session runs in a checkout
// that is deleted when the session is archived, so corpora written there are
// written into a directory with an expiry date, and the report run from the main
// checkout never sees them. This module names the main checkout instead — read
// from git's common directory, which is the one fact every linked worktree of a
// repository shares.
//
// Four properties are load-bearing:
//
//   1. NEVER THROWS. Every failure — a missing git, a directory that is not a
//      repository, a hang, output it cannot read — collapses to the root itself
//      with a reason, which is exactly today's behaviour plus a sentence. The
//      caller banners `STATE HOME UNRESOLVED: <reason>`; a fallback without a
//      reason would be a silent degradation, so every fallback carries one.
//
//   2. WRITES NOTHING. It reads two paths from git and asks one yes/no question.
//      `git rev-parse` touches no index and no lock.
//
//   3. LANES ARE NOT SESSIONS. Interlock's own lane worktrees are linked
//      worktrees too, and resolving one to the main checkout would scatter a
//      lane's state across two trees. They are recognised by path segment, with
//      no git call — `laneWorktreePath` in `lib/run.mjs` is the one derivation
//      of that path, and a marker file a lane could lose would misread it as a
//      session the moment it went missing.
//
//   4. REAL PATHS. macOS keeps `/tmp` and `/var` behind symlinks and git reports
//      real paths, so the root and every path git prints are compared after
//      `realpath`; a symlinked root and its target resolve alike.
//
// An explicit home (`--state-home`, else `INTERLOCK_STATE_HOME`) replaces the
// home only after the surface is known, because the surface describes the
// session — where the run actually is — and that stays true whoever chose the
// home.
//
// Shelling out to git from `lib/` follows `lib/drift.mjs` and
// `lib/run-paths.mjs`: `execFileSync`, stderr discarded, bounded, every failure
// caught.

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/** What the working root is. Recorded on the manifest, the `run-start` event and the receipt. */
export const SURFACES = Object.freeze(['main', 'linked-worktree', 'lane-worktree', 'unknown'])

/** The environment variable that pins the state home when no `--state-home` flag is given. */
export const STATE_HOME_ENV = 'INTERLOCK_STATE_HOME'

/**
 * The directory Interlock's lane worktrees live under, as path segments.
 *
 * Restated from `LANE_WORKTREES_DIR` in `lib/run.mjs` rather than imported:
 * `lib/run.mjs` imports this module, and the reverse import would be a cycle.
 * `test/spine/state-home.test.mjs` pins the two together, so the restatement
 * cannot drift without a red test.
 */
export const LANE_WORKTREE_SEGMENTS = Object.freeze(['.claude', 'ship', 'worktrees'])

/** How long one git call may take before the resolver gives up on it. */
const GIT_TIMEOUT_MS = 10_000

/** The option git older than 2.31 does not know, and may echo back rather than reject. */
const PATH_FORMAT = '--path-format=absolute'

function defaultExec(file, args, { cwd } = {}) {
  return execFileSync(file, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_TIMEOUT_MS
  })
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function messageOf(err) {
  if (err && typeof err.message === 'string' && err.message) return err.message
  return String(err)
}

function isTimeout(err) {
  return Boolean(err) && (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM')
}

function isMissingGit(err) {
  return Boolean(err) && err.code === 'ENOENT'
}

/** The first line git wrote to stderr, without its `fatal: ` prefix — present only when an exec captured it. */
function stderrLine(err) {
  const raw = err && err.stderr
  const text = typeof raw === 'string' ? raw : raw && typeof raw.toString === 'function' ? raw.toString() : ''
  const line = text.split(/\r?\n/).map(l => l.trim()).find(Boolean)
  return line ? line.replace(/^(fatal|error):\s*/i, '') : null
}

/**
 * One sentence for a failed git call. The default exec discards stderr, so the
 * exit status is usually all there is; 128 is git's fatal exit, and the fatal a
 * resolver meets is almost always "not a git repository".
 */
function describeGitFailure(err, what, root) {
  if (isMissingGit(err)) return `git could not be run in ${root}: not found on PATH (ENOENT)`
  if (isTimeout(err)) return `git timed out after ${GIT_TIMEOUT_MS / 1000}s in ${root}`
  const said = stderrLine(err)
  const status = err && typeof err.status === 'number' ? err.status : null
  if (said) return `${what} failed in ${root}: ${said}`
  if (status === 128) return `${what} failed in ${root} (exit 128): not a git repository, or one git refuses to read`
  if (status !== null) return `${what} failed in ${root} (exit ${status})`
  if (err && err.signal) return `${what} in ${root} was stopped by ${err.signal}`
  return `${what} failed in ${root}: ${messageOf(err)}`
}

function lines(out) {
  return String(out ?? '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
}

/** A path made real when it can be; left as given when it cannot (it may not exist, which is not an error here). */
function realOrSelf(path, realpath) {
  try {
    const real = realpath(path)
    return nonEmptyString(real) ? real : path
  } catch {
    return path
  }
}

function hasLaneSegments(path) {
  const parts = path.split(/[\\/]+/)
  const [a, b, c] = LANE_WORKTREE_SEGMENTS
  for (let i = 0; i + 2 < parts.length; i++) {
    if (parts[i] === a && parts[i + 1] === b && parts[i + 2] === c) return true
  }
  return false
}

/** True when `path` is `root` or anywhere beneath it. */
function isWithin(path, root) {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/**
 * The state home a user set explicitly, or `null` when they set none.
 *
 * The `--state-home` flag wins over `INTERLOCK_STATE_HOME`; an empty or
 * whitespace-only value, or a flag given without a value, is no setting at all.
 * A relative value is made absolute against the current directory — the one the
 * user typed it in.
 *
 * @param {{flag?: unknown, env?: Record<string, string|undefined>}} [opts]
 * @returns {string|null} an absolute path, or null
 */
export function explicitStateHome({ flag, env = process.env } = {}) {
  if (nonEmptyString(flag)) return resolve(process.cwd(), flag)
  const fromEnv = env && env[STATE_HOME_ENV]
  if (nonEmptyString(fromEnv)) return resolve(process.cwd(), fromEnv)
  return null
}

/**
 * Where the corpora of a run working in `root` go, and what `root` is.
 *
 * In order (design D13): the root is made absolute and real; a root under
 * Interlock's lane-worktree directory is its own home with no git call; git's
 * directory and common directory decide main checkout versus linked worktree,
 * with the linked worktree's home accepted only when a working tree sits beside
 * the common directory; any failure is the root itself with a reason; and an
 * explicit home replaces the result last, keeping the surface.
 *
 * Never throws and never writes.
 *
 * @param {string} root the working root the run operates on; defaults to the current directory
 * @param {object} [opts]
 * @param {string|null} [opts.explicit] the `--state-home` value; when absent, `env[STATE_HOME_ENV]` is consulted
 * @param {Record<string, string|undefined>} [opts.env] where `INTERLOCK_STATE_HOME` is read; defaults to `process.env`
 * @param {(file: string, args: string[], opts: {cwd: string}) => string} [opts.exec] runs git and returns stdout; throws on failure
 * @param {(path: string) => string} [opts.realpath] defaults to `fs.realpathSync`
 * @returns {{home: string, surface: 'main'|'linked-worktree'|'lane-worktree'|'unknown', reason: string|null, resolvedFrom: 'explicit'|'git'|'lane'|'fallback'}}
 *   `reason` is null unless the surface is `unknown`, and says why when it is —
 *   including after an explicit home replaced the fallback, because it still
 *   explains the surface.
 */
export function resolveStateHome(root, { explicit, env = process.env, exec = defaultExec, realpath = realpathSync } = {}) {
  let abs = process.cwd()
  let resolved
  try {
    abs = resolve(nonEmptyString(root) ? root : '.')
    resolved = resolveFromRoot(abs, { exec, realpath })
  } catch (err) {
    // Unreachable by design — every step above catches its own failure — but
    // the never-throws property is the contract, so it is held here as well.
    resolved = fallback(abs, `the state home could not be resolved: ${messageOf(err)}`)
  }

  let pinned = null
  try {
    pinned = nonEmptyString(explicit) ? resolve(process.cwd(), explicit) : explicitStateHome({ env })
  } catch {
    pinned = null
  }
  if (pinned) return { ...resolved, home: realOrSelf(pinned, realpath), resolvedFrom: 'explicit' }
  return resolved
}

function fallback(home, reason) {
  return { home, surface: 'unknown', reason, resolvedFrom: 'fallback' }
}

function resolveFromRoot(abs, { exec, realpath }) {
  // 1. Absolute, then real. A root that cannot be made real is not one git can
  //    be asked about either; say which of the two it is.
  let root
  try {
    root = realpath(abs)
    if (!nonEmptyString(root)) root = abs
  } catch (err) {
    const code = err && err.code
    if (code === 'ENOENT' || code === 'ENOTDIR') return fallback(abs, `the working root ${abs} does not exist`)
    return fallback(abs, `the working root ${abs} could not be resolved: ${code || messageOf(err)}`)
  }

  // 2. One of Interlock's own lane worktrees: its own home, and no git call.
  if (hasLaneSegments(root) || hasLaneSegments(abs)) {
    return { home: root, surface: 'lane-worktree', reason: null, resolvedFrom: 'lane' }
  }

  // 3. Ask git for the two directories. A git before 2.31 does not know
  //    `--path-format` and either rejects it (retried without) or echoes it back
  //    as a line of output (dropped); either way the paths may then be relative,
  //    and mean something only once resolved against the root. A missing git or
  //    a timeout is not retried — the option cannot be why, and a retry would
  //    double a ten-second wait for the same answer.
  let out
  try {
    out = exec('git', ['rev-parse', PATH_FORMAT, '--git-dir', '--git-common-dir'], { cwd: root })
  } catch (first) {
    if (isMissingGit(first) || isTimeout(first)) {
      return fallback(root, describeGitFailure(first, 'git rev-parse', root))
    }
    try {
      out = exec('git', ['rev-parse', '--git-dir', '--git-common-dir'], { cwd: root })
    } catch (retry) {
      return fallback(root, describeGitFailure(retry, 'git rev-parse', root))
    }
  }

  const printed = lines(out)
  if (printed[0] === PATH_FORMAT) printed.shift()
  if (printed.length < 2) {
    return fallback(
      root,
      `git rev-parse in ${root} printed ${printed.length} line(s) where a git directory and a common directory were expected`
    )
  }
  const gitDir = realOrSelf(resolve(root, printed[0]), realpath)
  const commonDir = realOrSelf(resolve(root, printed[1]), realpath)

  if (gitDir === commonDir) {
    return { home: root, surface: 'main', reason: null, resolvedFrom: 'git' }
  }

  // A linked worktree. Its main checkout is the common directory's parent — but
  // only when a working tree actually sits there: a bare repository's common
  // directory has no checkout beside it, and its parent is just a directory.
  const candidate = dirname(commonDir)
  const bare = `the common directory ${commonDir} has no working tree beside it (a bare repository)`
  let inside
  try {
    inside = lines(exec('git', ['-C', candidate, 'rev-parse', '--is-inside-work-tree'], { cwd: root }))[0]
  } catch (err) {
    if (isMissingGit(err) || isTimeout(err)) return fallback(root, describeGitFailure(err, 'git rev-parse', candidate))
    return fallback(root, bare)
  }
  if (inside !== 'true') return fallback(root, bare)

  // A main checkout inside the working root would make the root its own
  // ancestor's home; whatever produced that answer, it is not one to write into.
  if (isWithin(candidate, root)) {
    return fallback(root, `the main checkout ${candidate} resolved inside the working root ${root}`)
  }

  return { home: candidate, surface: 'linked-worktree', reason: null, resolvedFrom: 'git' }
}
