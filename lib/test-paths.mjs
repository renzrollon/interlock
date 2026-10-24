// The test-path predicate, in one place.
//
// Two callers must mean the same thing by "a test file": the PreToolUse guard
// that denies test edits during a run's remediation (`hooks/guard-tests.mjs`),
// and `interlock mr test-paths`, which names the files the merge-request loop
// reverts after a fixer touched them. They only agree while they are the same
// function, so both read this module and `hooks/_shared.mjs` re-exports it.
//
// Pure filesystem reads, and every one fails toward "no profile": a missing or
// malformed `.claude/testing/profile.json` yields `null`, never a throw. No
// `node:` module beyond fs/path, so a hook may import it.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
