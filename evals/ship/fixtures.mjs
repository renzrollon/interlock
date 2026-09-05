// Reading the committed outcome-eval fixture set.
//
// One reader, used by both `npm test` (which proves every fixture solvable
// offline) and the eval runner (which copies a fixture to a scratch root). A
// second reader is how the suite's idea of a fixture and the runner's drift
// apart, and this set exists precisely to be trusted.
//
// This module reads and copies. It never executes a fixture, never writes into
// a fixture directory, and knows nothing about arms, models or grading.

import { readdirSync, readFileSync, existsSync, statSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The directory holding the committed fixtures. */
export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/** The schema every `fixture.json` declares. Copied by name, never inferred. */
export const FIXTURE_SCHEMA = 'interlock.ship-eval-fixture/1'

/** Entries under `fixtures/` that are documentation rather than a fixture. */
const NON_FIXTURE_ENTRIES = new Set(['README.md'])

/**
 * Fixture ids, sorted. A directory counts only when it carries a
 * `fixture.json` — a half-written fixture is not silently half-run.
 *
 * @returns {string[]}
 */
export function listFixtureIds() {
  if (!existsSync(FIXTURES_DIR)) return []
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !NON_FIXTURE_ENTRIES.has(e.name))
    .map(e => e.name)
    .filter(name => existsSync(join(FIXTURES_DIR, name, 'fixture.json')))
    .sort()
}

/**
 * One fixture's declarations and paths.
 *
 * @param {string} id
 * @returns {{
 *   id: string,
 *   dir: string,
 *   startDir: string,
 *   referenceDir: string,
 *   descriptionPath: string,
 *   change: string,
 *   shape: string,
 *   taskArtifacts: Record<string, string[]>,
 *   taskDependencies: Array<{ task: string, dependsOn: string[] }>
 * }}
 */
export function readFixture(id) {
  const dir = join(FIXTURES_DIR, id)
  const declared = JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8'))
  if (declared.schema !== FIXTURE_SCHEMA) {
    throw new Error(
      `${id}/fixture.json declares schema "${declared.schema}", not "${FIXTURE_SCHEMA}" — ` +
        `refusing to read it under a schema it does not claim`
    )
  }
  return {
    id: declared.id,
    dir,
    startDir: join(dir, 'start'),
    referenceDir: join(dir, 'reference'),
    descriptionPath: join(dir, 'FIXTURE.md'),
    change: declared.change,
    shape: declared.shape,
    taskArtifacts: declared.taskArtifacts || {},
    taskDependencies: declared.taskDependencies || []
  }
}

/** Every fixture, read. */
export function readFixtures() {
  return listFixtureIds().map(readFixture)
}

/**
 * Copy a directory tree, creating what it needs. Files already present at the
 * destination are overwritten — which is what makes this both "lay down the
 * starting state" and "apply the reference over it".
 *
 * Returns the repository-relative paths written, sorted, so a caller can say
 * what an overlay actually did rather than assert it from the manifest.
 *
 * @param {string} from
 * @param {string} to
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function copyTree(from, to, prefix = '') {
  const written = []
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1
  )) {
    const source = join(from, entry.name)
    const dest = join(to, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      written.push(...copyTree(source, dest, rel))
    } else if (entry.isFile()) {
      copyFileSync(source, dest)
      written.push(rel)
    }
  }
  return written
}

/**
 * Lay a fixture's starting state down at `root`.
 *
 * @param {{ startDir: string }} fixture
 * @param {string} root
 * @returns {string[]} the paths written
 */
export function applyStartingState(fixture, root) {
  return copyTree(fixture.startDir, root)
}

/**
 * Overlay a fixture's reference implementation onto `root`.
 *
 * Held outside the starting state, so this is the only way the solved form of a
 * fixture ever appears on disk.
 *
 * @param {{ referenceDir: string }} fixture
 * @param {string} root
 * @returns {string[]} the paths written
 */
export function applyReference(fixture, root) {
  return copyTree(fixture.referenceDir, root)
}

/**
 * The unit command a fixture's own testing profile names, read from the
 * starting state. Never guessed: a fixture with no profile is a defect, and the
 * caller is told so rather than handed `npm test`.
 *
 * @param {{ id: string, startDir: string }} fixture
 * @returns {{ command: string, cwd: string }}
 */
export function readUnitCommand(fixture) {
  const path = join(fixture.startDir, '.claude', 'testing', 'profile.json')
  if (!existsSync(path)) {
    throw new Error(`${fixture.id}: no .claude/testing/profile.json — the unit command is not guessed`)
  }
  const profile = JSON.parse(readFileSync(path, 'utf8'))
  const command = profile && profile.unit && profile.unit.command
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error(`${fixture.id}: the testing profile names no unit command`)
  }
  return { command, cwd: (profile.unit && profile.unit.cwd) || '.' }
}

/**
 * Every path under a fixture directory, fixture-relative. Used by the suite to
 * assert no run state was ever committed.
 *
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function walkFixture(dir, prefix = '') {
  const out = []
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1
  )) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walkFixture(join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out
}
