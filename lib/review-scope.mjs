// The changed line ranges a reviewer is told to judge (fan-out-the-strict-ship-
// review, D16). The hunk parser `interlock review brief` has always used, lifted
// out of `lib/review-cli.mjs` so the ship run's review step calls the same one.
//
// Pure: it reads the text of a `git diff -U0` and a list of paths, and touches
// no disk and no git. The caller runs git (against `<base>...HEAD` for the
// brief, against the run's pinned start commit for ship) and hands the text in.

/**
 * The flags after `git diff` that make its text the one `changedRanges` parses whatever the
 * person's configuration says (PR #46 review, M1): no external diff or textconv driver, no
 * relative mode, no colour, and the `a/` and `b/` prefixes that `diff.noprefix`,
 * `diff.mnemonicPrefix`, `diff.srcPrefix` and `diff.dstPrefix` would otherwise change.
 */
export const PINNED_DIFF = Object.freeze(['-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '--src-prefix=a/', '--dst-prefix=b/'])

/** The C escapes git writes inside a quoted path, by the letter after the backslash. */
const C_ESCAPES = Object.freeze({ a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 })

/**
 * A path as a `---`/`+++` header names it, unquoted and without its side prefix.
 * Git quotes a path holding a byte it will not print bare (a non-ASCII byte under
 * the default `core.quotePath`, a quote, a backslash, a control character) as a
 * C string, `"b/\303\251 x.txt"`: the quotes are dropped, each escape decoded
 * to its byte and the bytes read as UTF-8, so the path matches the name a finding
 * gives the same file. A quoted string that does not close is kept as written.
 * Git ends the header with a tab when the name holds a space, quoted or bare;
 * that tab is dropped first. It is never the name's own: git always quotes a
 * name that holds a tab, so the name's tab is inside the quotes as `\t`.
 *
 * @param {string} raw  what follows `--- ` or `+++ `
 * @param {'a/'|'b/'} prefix
 * @returns {string}
 */
export function headerPath(raw, prefix) {
  let path = String(raw).replace(/\t$/, '')
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
    const bytes = []
    // By code point, so a character git left bare (core.quotePath off) is encoded whole.
    const body = Array.from(path.slice(1, -1))
    const encoder = new TextEncoder()
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]
      if (ch !== '\\' || i + 1 >= body.length) {
        for (const b of encoder.encode(ch)) bytes.push(b)
        continue
      }
      const next = body[i + 1]
      const octal = /^[0-7]{3}/.exec(body.slice(i + 1, i + 4).join(''))
      if (octal) {
        bytes.push(parseInt(octal[0], 8) & 0xff)
        i += 3
      } else if (Object.hasOwn(C_ESCAPES, next)) {
        bytes.push(C_ESCAPES[next])
        i += 1
      } else {
        bytes.push(0x5c)
      }
    }
    path = new TextDecoder().decode(Uint8Array.from(bytes))
  }
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

/**
 * The files a `git diff -U0` text changes, each with its changed line ranges in
 * the post-image, then the observed paths the diff does not name.
 *
 * - A deleted file is named under its old path with no ranges.
 * - A pure-deletion hunk (`+c,0`) adds no range: no line of the post-image changed.
 * - An observed path the diff already names is not listed twice.
 * - An observed path the diff does not name is listed after the diff's files.
 *   A string entry carries no ranges; an object entry `{ path, lines }` with a
 *   positive integer `lines` carries one whole-file range `[1, lines]`, which is
 *   how an untracked file (git does not diff it) is told whole. A caller that
 *   cannot count the lines passes the string and the path is listed with none.
 * - `linesOf(path)`, when given, counts a string entry's lines, and is called
 *   only for an observed path the diff does not name: a file the diff already
 *   ranges is never read whole to be counted. Any observed path the diff does
 *   not name is told whole this way — an untracked file, and also a tracked one
 *   with no hunk against the base (a mode change, an edit made and reverted).
 * - `marks: true` adds what the pre-existing check of `interlock review comment`
 *   needs and no other caller reads: `deleted: true` on a file the diff deletes,
 *   and `removedAt`, the post-image line each pure-deletion hunk follows (0 when
 *   the lines removed were the file's first). Without it the entries are exactly
 *   `{ path, ranges }`.
 *
 * @param {string} diffText  the output of `git diff -U0 --no-color <base>`
 * @param {Array<string | { path: string, lines?: number }>} [observedPaths]
 * @param {{ linesOf?: (path: string) => number|null|undefined, marks?: boolean }} [options]
 * @returns {Array<{ path: string, ranges: Array<[number, number]>, deleted?: true, removedAt?: number[] }>}
 */
export function changedRanges(diffText, observedPaths = [], { linesOf, marks = false } = {}) {
  const files = []
  let current = null
  let preImage = null
  // `---`/`+++` are headers only between `diff --git` and the first hunk, so a
  // deleted line `-- x` or an added line `++ x` is never read as one.
  let inHeader = false
  for (const line of String(diffText || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHeader = true
      current = null
      preImage = null
      continue
    }
    const was = inHeader && line.match(/^--- (.+)$/)
    if (was) {
      const path = headerPath(was[1], 'a/')
      preImage = path === '/dev/null' ? null : path
      continue
    }
    const file = inHeader && line.match(/^\+\+\+ (.+)$/)
    if (file) {
      const path = headerPath(file[1], 'b/')
      // A deleted file has no post-image; it is named under its old path, with no ranges.
      current = path === '/dev/null' ? null : { path, ranges: [], ...(marks ? { removedAt: [] } : {}) }
      if (current) files.push(current)
      else if (preImage) files.push({ path: preImage, ranges: [], ...(marks ? { deleted: true, removedAt: [] } : {}) })
      continue
    }
    if (line.startsWith('@@')) inHeader = false
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (hunk && current) {
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      if (count > 0) current.ranges.push([start, start + count - 1])
      else if (marks) current.removedAt.push(start)
    }
  }
  for (const observed of Array.isArray(observedPaths) ? observedPaths : []) {
    const path = typeof observed === 'string' ? observed : observed && observed.path
    if (typeof path !== 'string' || !path || files.some(f => f.path === path)) continue
    const lines =
      observed && typeof observed === 'object' ? observed.lines : typeof linesOf === 'function' ? linesOf(path) : undefined
    files.push({ path, ranges: Number.isInteger(lines) && lines > 0 ? [[1, lines]] : [] })
  }
  return files
}

/**
 * The number of lines in a file's text, a final newline closing the last line
 * rather than opening an empty one; null for text that could not be read.
 *
 * @param {string|null} text
 * @returns {number|null}
 */
export function lineCount(text) {
  if (typeof text !== 'string') return null
  return text.split('\n').length - (text.endsWith('\n') || !text ? 1 : 0)
}
