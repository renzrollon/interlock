// Evidence locators — one definition of "what a citation looks like".
//
// Two surfaces cite work by pointing at it: a review skeptic's `evidence`
// prose (`lib/review-core.mjs`) and a wave handoff packet's `evidence` array
// (`lib/waves.mjs`). Both audit a citation the same way, on two conditions,
// because either alone is defeated:
//
//   1. Shape — `path`, `path:line` or `path:start-end`. Non-emptiness alone was
//      satisfied by the string "👍".
//   2. Membership — the path canonicalizes to one present in the changed-path
//      set. Shape alone is satisfied by inventing `lib/nowhere.ts:1`.
//
// The line is never required to exist in the file. A citation may legitimately
// name a line the work itself later moved or deleted, so path membership is the
// strongest condition that cannot produce a false rejection.
//
// WHY THIS IS ONE MODULE AND NOT TWO REGEXES. The second surface arrived after
// the first, and the cheap version of adding it is a second regex next to the
// new caller. Two definitions of "locator" drift, and the drift is silent —
// each surface keeps passing its own tests while they diverge. So the
// canonicalizer and the membership index live here and are imported.
//
// WHAT IS DELIBERATELY *NOT* SHARED: the anchoring. `review-core` scans free
// prose, so `CITATION_TOKEN` matches within a sentence and tolerates a trailing
// `:column`. `validateHandoff` receives an array of discrete locators, so it
// anchors the whole string and forbids a colon in the path. Both are correct
// for their input, and unifying them would loosen handoff validation. Any
// future "cleanup" that merges them is a regression.
//
// Pure: no fs, no clock, no I/O.

import { canonicalizePath } from './risk.mjs'

// Re-exported so a caller needs one import for the whole vocabulary, and so a
// test can assert on the canonicalizer the audit actually uses rather than on a
// same-named function it hopes is the same one.
export { canonicalizePath }

/**
 * `path:line`, `path:start-end`, and a trailing `:column` a tool may have
 * added. The path is a non-whitespace run, so this half cannot see a path
 * containing spaces — that case is handled by `citesLineIn` against a known
 * spelling.
 *
 * Global, so `matchAll` finds every citation in a block of prose. Callers must
 * not hold state on it beyond one `matchAll` (it carries `lastIndex`).
 */
export const CITATION_TOKEN = /(\S+?):(\d+)(?:-\d+)?(?::\d+)?(?![\w.\-/])/g

/** Does `text` cite `path` with a line number after it? */
export function citesLineIn(text, path) {
  for (let from = 0; ; ) {
    const at = text.indexOf(path, from)
    if (at === -1) return false
    if (/^:\d+/.test(text.slice(at + path.length))) return true
    from = at + 1
  }
}

/**
 * The changed-path set as canonical identities plus the spellings the caller
 * used, so a citation can be matched either way.
 *
 * `null` — not an empty Set — when there is nothing to match against, so a
 * caller can tell "no path set was available" from "the path set is empty",
 * which are different facts about a citation that failed.
 *
 * @param {unknown} changedPaths
 * @returns {Set<string>|null}
 */
export function diffIndex(changedPaths) {
  if (!Array.isArray(changedPaths) || !changedPaths.length) return null
  const out = new Set()
  for (const entry of changedPaths) {
    if (typeof entry !== 'string' || !entry.trim()) continue
    out.add(entry.trim())
    const canonical = canonicalizePath(entry)
    if (canonical) out.add(canonical)
  }
  return out.size ? out : null
}

/**
 * The path half of one DISCRETE locator — `lib/a.mjs:12-40` → `lib/a.mjs`.
 *
 * For an array of locators, not for prose: it takes the whole string as the
 * citation and only strips a trailing `:line` / `:start-end`. `null` when the
 * remainder cannot be placed inside the repository, because an identity that
 * could not be computed must not be treated as one that matches.
 *
 * @param {unknown} entry
 * @returns {string|null}
 */
export function locatorPath(entry) {
  if (typeof entry !== 'string') return null
  const trimmed = entry.trim()
  if (!trimmed) return null
  return canonicalizePath(trimmed.replace(/:\d+(-\d+)?$/, ''))
}
