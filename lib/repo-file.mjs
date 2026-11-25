// One view of "a file inside this repository" for the readers and the one writer
// the artifact gate added (PR #47 review, H1-H3 and M3). A path is checked twice:
// as written, and again once every symlink on it is resolved, so a link that
// leaves the root reads as a path outside does, and a link that stays inside
// still counts. The resolved file is the one read. The same rule the citation
// check's `lineCounter` (lib/settle-cli.mjs) applies.
//
// Nothing here throws, and no reason quotes a file's content: a reason is a fixed
// phrase or an fs error code, so a caller may print it on a status line.

import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/** True when `abs` is `base` itself or a path below it; both absolute. */
export function within(base, abs) {
  const rel = relative(base, abs)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
}

/** The root's real path, or null when it cannot be resolved. */
function realRootOf(root) {
  try {
    return realpathSync(resolve(root))
  } catch {
    return null
  }
}

const codeOf = err => (err && typeof err.code === 'string' ? err.code : 'an error')

/**
 * Where `path` (relative to `root`, or absolute) lands, when it is inside the
 * root both as written and once resolved.
 * @returns {{ ok: true, abs: string, real: string } | { ok: false, absent?: true, reason: string }}
 */
export function locateRepoFile(root, path) {
  const top = resolve(root)
  const abs = resolve(top, path)
  const realTop = realRootOf(root)
  // As written, against the root as given or as resolved: an absolute path may
  // name the root by either (macOS /var and /private/var).
  if (!within(top, abs) && !(realTop !== null && within(realTop, abs))) return { ok: false, reason: 'outside the repository root' }
  if (realTop === null) return { ok: false, reason: 'the repository root does not resolve' }
  let real
  try {
    real = realpathSync(abs)
  } catch (err) {
    return err && err.code === 'ENOENT' ? { ok: false, absent: true, reason: 'absent' } : { ok: false, reason: `unresolvable (${codeOf(err)})` }
  }
  if (!within(realTop, real)) return { ok: false, reason: 'a link to a path outside the repository root' }
  return { ok: true, abs, real }
}

/**
 * A regular file inside the root, whole, at most `maxBytes` long when given.
 * @param {string} root
 * @param {string} path
 * @param {{ maxBytes?: number }} [opts]
 * @returns {{ ok: true, text: string, real: string } | { ok: false, absent?: true, reason: string }}
 */
export function readRepoFile(root, path, { maxBytes } = {}) {
  const at = locateRepoFile(root, path)
  if (!at.ok) return at
  try {
    const st = statSync(at.real)
    if (!st.isFile()) return { ok: false, reason: 'not a regular file' }
    if (typeof maxBytes === 'number' && st.size > maxBytes) {
      return { ok: false, reason: `${st.size} bytes, over the ${maxBytes}-byte cap` }
    }
    return { ok: true, text: readFileSync(at.real, 'utf8'), real: at.real }
  } catch (err) {
    return { ok: false, reason: `unreadable (${codeOf(err)})` }
  }
}

/**
 * Write `data` to `path` inside the root, never through a symlink out of it: the
 * deepest existing ancestor of the file's directory must resolve inside the root
 * before any directory is made, the made directory must resolve inside it after,
 * and the file itself is opened without following a link at its own name.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function writeRepoFile(root, path, data) {
  const top = resolve(root)
  const abs = resolve(top, path)
  const realTop = realRootOf(root)
  if (!within(top, abs) && !(realTop !== null && within(realTop, abs))) return { ok: false, reason: 'the path is outside the repository root' }
  if (realTop === null) return { ok: false, reason: 'the repository root does not resolve' }
  const dir = dirname(abs)
  let existing = dir
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing)
  try {
    if (!within(realTop, realpathSync(existing))) return { ok: false, reason: 'its directory links outside the repository root' }
    mkdirSync(dir, { recursive: true })
    const realDir = realpathSync(dir)
    if (!within(realTop, realDir)) return { ok: false, reason: 'its directory links outside the repository root' }
    let st = null
    try {
      st = lstatSync(abs)
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err
    }
    if (st && !st.isFile()) return { ok: false, reason: 'a link or a non-file is at its path' }
    // O_NOFOLLOW closes the gap between the check above and the open; it is absent on Windows.
    const fd = openSync(abs, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o644)
    try {
      writeFileSync(fd, data)
    } finally {
      closeSync(fd)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: `the write failed (${codeOf(err)})` }
  }
}
