// The reading class of a changed file: what a person must read in a diff
// (change judge-size-by-what-a-person-reads, design D8, D9, D11, D13).
//
// Each changed file is placed in exactly one class by its path, never by its
// content, the first rule that matches deciding:
//
//   1. under a counts-as-source path of the base's review policy: source
//   2. a documentation path (the risk signal's `isDocsPath`): prose
//   3. a test path (the risk signal's `isTestPath`): test
//   4. anything else: source
//
// The rule is a deny-list: a path no rule recognises is source, so a lockfile
// or a workflow file counts as it always did. The documentation rule covers the
// whole `openspec/` tree. Pure: no I/O and no threshold. The size signal
// (`readDiffShape` in `lib/merge-confidence.mjs`) applies the published caps.

import { canonicalizePath, isDocsPath, isTestPath } from './risk.mjs'

/** The one location that is read as review policy: the repository root. Defined here, with no I/O, so the proof can name it. */
export const REVIEW_POLICY_FILE = 'REVIEW.md'

/** The classes, in the order the evidence states them. */
export const READING_CLASSES = Object.freeze(['source', 'test', 'prose'])

// The listed paths in canonical form, in list order, each once. An entry that
// cannot name a path inside the repository lists nothing.
function canonicalList(sourcePaths) {
  const out = []
  for (const entry of Array.isArray(sourcePaths) ? sourcePaths : []) {
    const canonical = canonicalizePath(typeof entry === 'string' ? entry.replace(/\/+$/, '') : entry)
    if (canonical && !out.includes(canonical)) out.push(canonical)
  }
  return out
}

function under(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`)
}

// The class rules 2 to 4 give a path, with no list.
function classByRule(path) {
  if (isDocsPath(path)) return 'prose'
  if (isTestPath(path)) return 'test'
  return 'source'
}

function placed(path, listed) {
  const canonical = canonicalizePath(path) || String(path ?? '')
  const listedUnder = listed.find(prefix => under(canonical, prefix)) ?? null
  return { class: listedUnder ? 'source' : classByRule(canonical), listedUnder, byRule: classByRule(canonical) }
}

/**
 * The class of one changed path, and the canonical listed path that decided
 * it when the counts-as-source list did (null otherwise).
 *
 * @param {string} path the file's path after the change
 * @param {string[]} [sourcePaths] the counts-as-source list, read from the base
 * @returns {{ class: 'source'|'test'|'prose', listedUnder: string|null }}
 */
export function readingClassOf(path, sourcePaths = []) {
  const { class: cls, listedUnder } = placed(path, canonicalList(sourcePaths))
  return { class: cls, listedUnder }
}

/**
 * The lines and files of each class and of the whole diff. A binary row is one
 * file and no lines. `listed` names, in list order, each listed path that
 * placed in the source class a file which would otherwise be test or prose,
 * with the files and lines it placed.
 *
 * @param {Array<{ path: string, lines: number, binary?: boolean }>} files
 * @param {string[]} [sourcePaths]
 * @returns {{ source: {lines: number, files: number}, test: {lines: number, files: number},
 *   prose: {lines: number, files: number}, total: {lines: number, files: number},
 *   binaryFiles: number, listed: Array<{ path: string, files: number, lines: number }> }}
 */
export function splitByReading(files, sourcePaths = []) {
  const listed = canonicalList(sourcePaths)
  const sums = Object.fromEntries([...READING_CLASSES, 'total'].map(cls => [cls, { lines: 0, files: 0 }]))
  const moved = new Map(listed.map(prefix => [prefix, { path: prefix, files: 0, lines: 0 }]))
  let binaryFiles = 0
  for (const file of Array.isArray(files) ? files : []) {
    const lines = file.binary ? 0 : Number(file.lines) || 0
    if (file.binary) binaryFiles += 1
    const at = placed(file.path, listed)
    for (const key of [at.class, 'total']) {
      sums[key].lines += lines
      sums[key].files += 1
    }
    if (at.listedUnder && at.byRule !== 'source') {
      const entry = moved.get(at.listedUnder)
      entry.files += 1
      entry.lines += lines
    }
  }
  return {
    source: sums.source,
    test: sums.test,
    prose: sums.prose,
    total: sums.total,
    binaryFiles,
    listed: [...moved.values()].filter(entry => entry.files)
  }
}
