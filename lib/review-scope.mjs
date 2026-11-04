// The changed line ranges a reviewer is told to judge (fan-out-the-strict-ship-
// review, D16). The hunk parser `interlock review brief` has always used, lifted
// out of `lib/review-cli.mjs` so the ship run's review step calls the same one.
//
// Pure: it reads the text of a `git diff -U0` and a list of paths, and touches
// no disk and no git. The caller runs git (against `<base>...HEAD` for the
// brief, against the run's pinned start commit for ship) and hands the text in.

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
 *
 * @param {string} diffText  the output of `git diff -U0 --no-color <base>`
 * @param {Array<string | { path: string, lines?: number }>} [observedPaths]
 * @returns {Array<{ path: string, ranges: Array<[number, number]> }>}
 */
export function changedRanges(diffText, observedPaths = []) {
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
    const was = inHeader && line.match(/^--- (?:a\/)?(.+)$/)
    if (was) {
      preImage = was[1] === '/dev/null' ? null : was[1]
      continue
    }
    const file = inHeader && line.match(/^\+\+\+ (?:b\/)?(.+)$/)
    if (file) {
      // A deleted file has no post-image; it is named under its old path, with no ranges.
      current = file[1] === '/dev/null' ? null : { path: file[1], ranges: [] }
      if (current) files.push(current)
      else if (preImage) files.push({ path: preImage, ranges: [] })
      continue
    }
    if (line.startsWith('@@')) inHeader = false
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (hunk && current) {
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      if (count > 0) current.ranges.push([start, start + count - 1])
    }
  }
  for (const observed of Array.isArray(observedPaths) ? observedPaths : []) {
    const path = typeof observed === 'string' ? observed : observed && observed.path
    if (typeof path !== 'string' || !path || files.some(f => f.path === path)) continue
    const lines = observed && typeof observed === 'object' ? observed.lines : undefined
    files.push({ path, ranges: Number.isInteger(lines) && lines > 0 ? [[1, lines]] : [] })
  }
  return files
}
