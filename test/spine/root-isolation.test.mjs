// The suite must not write into the corpora the suite measures.
//
// `--root` defaults to `.`, so any test that spawns the real binary without
// either `--root` or a pinned `cwd` resolves its root to this repository. Every
// corpus append it then makes — a trajectory event, a review-metrics record —
// lands in the developer's live `.claude/`, where `interlock report` reads it.
// That is two defects at once: the report ends up measuring the test suite
// rather than the loop, and a test can pass on state some earlier run left
// behind rather than on state it wrote itself.
//
// This guard spawns the test files that reach the binary and asserts the
// repository's own corpora are byte-identical afterwards. It is dynamic rather
// than a source-level lint on purpose: a new test file that spawns the binary
// unpinned fails here without anyone having to teach a regex about it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
const REPO = join(dirname(HERE), '..', '..')
const TEST_DIR = join(REPO, 'test')

/** The corpora `interlock report` reads. A write to either is the defect. */
const CORPORA = [join('.claude', 'ship'), join('.claude', 'metrics')]

/** Set on the child so the guard does not spawn itself. */
const CHILD_ENV = 'INTERLOCK_ROOT_ISOLATION_CHILD'

function walk(abs, base, into) {
  if (!existsSync(abs)) return into
  for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1
  )) {
    const next = join(abs, entry.name)
    if (entry.isDirectory()) walk(next, base, into)
    else if (entry.isFile()) {
      const s = statSync(next)
      into.push(`${relative(base, next)}\t${s.size}\t${s.mtimeMs}`)
    }
  }
  return into
}

/** Size and mtime of every file in the corpora — a modification shows as well as a creation. */
function snapshot() {
  const into = []
  for (const corpus of CORPORA) walk(join(REPO, corpus), REPO, into)
  return into
}

/** Every test file that reaches the real binary, self excluded. */
function binarySpawningTestFiles(dir = TEST_DIR, into = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1
  )) {
    const next = join(dir, entry.name)
    if (entry.isDirectory()) binarySpawningTestFiles(next, into)
    else if (entry.isFile() && entry.name.endsWith('.test.mjs') && next !== HERE) {
      const src = readFileSync(next, 'utf8')
      if (/INTERLOCK_BIN|['"]bin['"],\s*['"]interlock/.test(src)) into.push(next)
    }
  }
  return into
}

test('no test that spawns the binary writes into this repository\'s corpora', () => {
  if (process.env[CHILD_ENV]) return

  const files = binarySpawningTestFiles()
  assert.ok(
    files.length > 0,
    'found no test file spawning the binary — the discovery heuristic has gone stale'
  )

  // `node --test` refuses to run files when it detects it is already inside a
  // test context, and signals that context through the environment. Dropping
  // the marker is what makes the child actually execute the files rather than
  // print a recursion warning and exit 0 — which would make this guard pass by
  // never having run anything.
  const env = { ...process.env, [CHILD_ENV]: '1' }
  delete env.NODE_TEST_CONTEXT
  // FORCE_COLOR wraps the spec reporter's `ℹ pass N` line in CSI sequences,
  // which would make the summary regex below miss a run that did execute.
  delete env.FORCE_COLOR
  env.NO_COLOR = '1'
  env.FORCE_COLOR = '0'

  const before = snapshot()
  const r = spawnSync(process.execPath, ['--test', ...files], {
    cwd: REPO,
    encoding: 'utf8',
    env
  })
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  const stdout = (r.stdout || '').replace(/\u001b\[[0-9;]*m/g, '')
  assert.match(
    stdout,
    /^(?:#|ℹ) pass \d+$/m,
    `the child test run produced no summary, so nothing was exercised:\n${r.stdout}\n${r.stderr}`
  )
  const after = snapshot()

  const created = after.filter(line => !before.includes(line))
  assert.deepEqual(
    created,
    [],
    'a test spawned the binary against this repository rather than a temp root, so the ' +
      'suite wrote into the corpora it measures. Pin `cwd` or pass `--root` at the spawn ' +
      `site. Files touched under ${CORPORA.join(' and ')}:\n` +
      created.map(line => `  ${line.split('\t')[0].split(sep).join('/')}`).join('\n')
  )
  assert.deepEqual(before.length, after.length, 'a corpus file was removed by the suite')
})
