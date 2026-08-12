// OpenSpec change-artifact inspection.
//
// Answers two questions the flow asks constantly, without a model call:
// "is this change ready to implement?" and "how far through tasks.md are we?"
//
// Deliberately thin. OpenSpec's own CLI (`openspec status --json`,
// `openspec validate`) is the authority on schema conformance; this module only
// covers the filesystem-level checks the flow gates on, so a skill can branch
// before spending a turn.
//
// Exposed to skills as `specflow validate --change <name>`.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Extensions whose lines a coverage tool can meaningfully attribute. Anything
// outside this set (docs, JSON/YAML/TOML config, lockfiles, shell) is dropped
// before we ever ask an agent to measure it.
const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.tsx', '.mts', '.cts',
  '.py', '.go', '.rs', '.rb', '.java', '.kt', '.kts',
  '.swift', '.php', '.cs', '.scala', '.vue', '.svelte'
])

const EXCLUDED_DIR =
  /(^|\/)(node_modules|dist|build|out|coverage|vendor|__tests__|__mocks__|__fixtures__|tests?|e2e|fixtures)(\/|$)/i

function extensionOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

// Diff coverage is only reported for real source files. Test files, config
// files, generated output and docs are skipped — covering them is meaningless
// and warning about them is noise.
export function isCoverableSource(path) {
  if (typeof path !== 'string' || path.length === 0) return false
  const p = path.replace(/\\/g, '/')
  if (p.split('/').some(seg => seg.startsWith('.'))) return false
  if (!SOURCE_EXTENSIONS.has(extensionOf(p))) return false
  if (EXCLUDED_DIR.test(p)) return false
  const base = p.slice(p.lastIndexOf('/') + 1)
  if (/\.(test|spec)\./i.test(base)) return false
  if (/\.(config|conf|d)\./i.test(base)) return false
  return true
}

const CHANGES_DIR = join('openspec', 'changes')

/** List change directories under openspec/changes/, excluding archive/. */
export function listChanges(root = '.') {
  const dir = join(root, CHANGES_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== 'archive')
    .map(e => e.name)
    .sort()
}

/**
 * Resolve which change to act on.
 * Returns { name } on success, or { error, candidates } when ambiguous/absent —
 * the caller decides whether to ask a human or halt.
 */
export function resolveChange(root = '.', requested) {
  const changes = listChanges(root)
  if (requested) {
    if (changes.includes(requested)) return { name: requested }
    return { error: `change "${requested}" not found under ${CHANGES_DIR}/`, candidates: changes }
  }
  if (changes.length === 1) return { name: changes[0] }
  if (changes.length === 0) return { error: `no changes found under ${CHANGES_DIR}/`, candidates: [] }
  return { error: 'multiple active changes — name one explicitly', candidates: changes }
}

// A tasks.md checkbox line: "- [ ] 1.1 Do the thing" / "- [x] ..."
const TASK_LINE = /^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*$/

export function parseTasks(markdown) {
  const tasks = []
  const lines = (markdown || '').split('\n')
  lines.forEach((line, i) => {
    const m = TASK_LINE.exec(line)
    if (!m) return
    tasks.push({
      done: m[1].toLowerCase() === 'x',
      text: m[2],
      line: i + 1
    })
  })
  return tasks
}

const REQUIRED = ['proposal.md', 'design.md', 'tasks.md']

/**
 * Filesystem readiness of one change.
 * @returns {{
 *   change: string, path: string, exists: boolean, ready: boolean,
 *   present: string[], missing: string[],
 *   tasks: {total: number, done: number, remaining: number, items: Array},
 *   specFiles: string[], problems: string[]
 * }}
 */
export function inspectChange(root = '.', changeName) {
  const dir = join(root, CHANGES_DIR, changeName)
  const problems = []

  if (!existsSync(dir)) {
    return {
      change: changeName,
      path: dir,
      exists: false,
      ready: false,
      present: [],
      missing: [...REQUIRED],
      tasks: { total: 0, done: 0, remaining: 0, items: [] },
      specFiles: [],
      problems: [`change directory does not exist: ${dir}`]
    }
  }

  const present = []
  const missing = []
  for (const f of REQUIRED) {
    const p = join(dir, f)
    if (existsSync(p) && statSync(p).size > 0) present.push(f)
    else missing.push(f)
  }

  let items = []
  if (present.includes('tasks.md')) {
    items = parseTasks(readFileSync(join(dir, 'tasks.md'), 'utf8'))
    if (items.length === 0) problems.push('tasks.md contains no checkbox task lines')
  }

  const specDir = join(dir, 'specs')
  const specFiles = existsSync(specDir) ? walkSpecs(specDir, specDir) : []

  for (const f of missing) problems.push(`missing or empty: ${f}`)

  const done = items.filter(t => t.done).length
  return {
    change: changeName,
    path: dir,
    exists: true,
    ready: missing.length === 0 && items.length > 0,
    present,
    missing,
    tasks: { total: items.length, done, remaining: items.length - done, items },
    specFiles,
    problems
  }
}

function walkSpecs(dir, base) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkSpecs(p, base))
    else if (entry.name.endsWith('.md')) out.push(p.slice(base.length + 1))
  }
  return out.sort()
}

export function formatInspection(r) {
  const lines = []
  lines.push(
    r.ready
      ? `READY — ${r.change}: ${r.tasks.remaining} of ${r.tasks.total} task(s) remaining`
      : `NOT READY — ${r.change}`
  )
  if (r.present.length) lines.push(`  present: ${r.present.join(', ')}`)
  if (r.specFiles.length) lines.push(`  specs: ${r.specFiles.length} file(s)`)
  for (const p of r.problems) lines.push(`  problem: ${p}`)
  return lines.join('\n') + '\n'
}
