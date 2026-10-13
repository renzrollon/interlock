// The facts behind the `spec.coverage` signal: which source files a diff adds,
// edits and keeps, and whether a living spec or one of the change's own delta
// specs names them.
//
// Pure. Spec text and path lists in, a plain structure out: no graph (it is
// gitignored and absent in CI), no git and no disk. A file is named when a spec
// mentions its repository-relative path by the one rule the graph's extractor
// shares (`specMentionedPaths`), compared on the canonical path form, and only
// coverable source is judged — a test, a configuration file or a document having
// no spec is not a gap. The gather (`lib/merge-evidence.mjs`) reads the texts;
// `readSpecCoverage` in `lib/merge-confidence.mjs` judges the facts.
// design D7 and D8 of complete-and-record-the-merge-verdict.

import { isCoverableSource } from './artifacts.mjs'
import { canonicalizePath } from './risk.mjs'
import { specMentionedPaths } from './spec-text.mjs'

/** The canonical paths a list of `{ path, text }` specs mention. */
function mentionsOf(specs) {
  const out = new Set()
  for (const spec of Array.isArray(specs) ? specs : []) {
    for (const mentioned of specMentionedPaths(spec?.text)) {
      const canonical = canonicalizePath(mentioned)
      if (canonical) out.add(canonical)
    }
  }
  return out
}

/** The canonical, coverable paths of a list, first-seen order, each once. */
function coverable(paths) {
  const out = []
  const seen = new Set()
  for (const entry of Array.isArray(paths) ? paths : []) {
    const canonical = canonicalizePath(entry)
    if (!canonical || seen.has(canonical) || !isCoverableSource(canonical)) continue
    seen.add(canonical)
    out.push(canonical)
  }
  return out
}

/**
 * @param {object} input
 * @param {string[]} input.added            paths the diff adds (a rename's new path included)
 * @param {string[]} input.modified         paths the diff edits
 * @param {string[]} input.sourceFiles      every tracked file at the head
 * @param {{path:string,text:string}[]} input.livingAtHead        every living spec, as the head has it
 * @param {{path:string,text:string}[]} input.changedSpecsAtBase  each living spec the diff changed or deleted, as the base had it
 * @param {{path:string,text:string}[]} input.deltaSpecs          the change's own delta specs
 * @returns {{
 *   added: { path: string, namedBy: 'living'|'delta'|null }[],
 *   lost: { path: string, spec: string }[],
 *   legacy: string[],
 *   repo: { named: number, total: number }
 * }}
 */
export function specCoverageFacts({
  added = [],
  modified = [],
  sourceFiles = [],
  livingAtHead = [],
  changedSpecsAtBase = [],
  deltaSpecs = []
} = {}) {
  const living = mentionsOf(livingAtHead)
  const delta = mentionsOf(deltaSpecs)
  const named = path => living.has(path) || delta.has(path)

  const addedFiles = coverable(added)
  const addedSet = new Set(addedFiles)

  const addedFacts = addedFiles.map(path => ({
    path,
    namedBy: living.has(path) ? 'living' : delta.has(path) ? 'delta' : null
  }))

  // Lost: a kept coverable file (tracked at the head, not added by this diff)
  // that a spec the diff changed named at the base and that nothing names now.
  const tracked = coverable(sourceFiles)
  const lost = []
  const lostSet = new Set()
  for (const spec of Array.isArray(changedSpecsAtBase) ? changedSpecsAtBase : []) {
    const before = mentionsOf([spec])
    for (const path of tracked) {
      if (addedSet.has(path) || lostSet.has(path)) continue
      if (!before.has(path) || named(path)) continue
      lostSet.add(path)
      lost.push({ path, spec: spec.path })
    }
  }

  // Legacy: an edited coverable file nothing names that this change did not
  // cause to lose its name.
  const legacy = coverable(modified).filter(
    path => !addedSet.has(path) && !lostSet.has(path) && !named(path)
  )

  return {
    added: addedFacts,
    lost,
    legacy,
    repo: { named: tracked.filter(named).length, total: tracked.length }
  }
}
