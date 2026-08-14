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
// Exposed to skills as `interlock validate --change <name>`.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
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

/** True when checkbox text is exactly `id` or starts with `id` plus a space. */
export function taskMatchesId(text, id) {
  if (typeof text !== 'string' || typeof id !== 'string' || !id) return false
  return text === id || text.startsWith(`${id} `)
}

/**
 * Flip `- [ ]` to `- [x]` for checkbox lines whose text matches an id.
 * Missing ids are reported, never invented. Already-checked matches are listed
 * as already, not re-written.
 */
export function tickTasks(root, changeName, ids) {
  const wanted = [...new Set((ids || []).map(String).map(s => s.trim()).filter(Boolean))]
  const path = join(root, CHANGES_DIR, changeName, 'tasks.md')
  if (!existsSync(path)) {
    return { change: changeName, path, ticked: [], already: [], missing: wanted, written: false }
  }
  const lines = readFileSync(path, 'utf8').split('\n')
  const ticked = []
  const already = []
  const found = new Set()
  const next = lines.map(line => {
    const m = TASK_LINE.exec(line)
    if (!m) return line
    const id = wanted.find(i => taskMatchesId(m[2], i))
    if (!id) return line
    found.add(id)
    if (m[1].toLowerCase() === 'x') {
      if (!already.includes(id)) already.push(id)
      return line
    }
    if (!ticked.includes(id)) ticked.push(id)
    return line.replace(/\[ \]/, '[x]')
  })
  const missing = wanted.filter(id => !found.has(id))
  if (ticked.length) writeFileSync(path, next.join('\n'))
  return { change: changeName, path, ticked, already, missing, written: ticked.length > 0 }
}

/**
 * Every remaining unchecked checkbox must be claimed by a classified id.
 * Omitted entries are the checkbox text, so a halt names what was dropped.
 */
export function planCoverage(parsedTasks, classifiedTasks) {
  const items = Array.isArray(parsedTasks) ? parsedTasks : []
  const classified = Array.isArray(classifiedTasks) ? classifiedTasks : []
  const ids = classified.map(t => t && t.id).filter(Boolean)
  const remaining = items.filter(t => !t.done)
  const omitted = remaining
    .filter(t => !ids.some(id => taskMatchesId(t.text, id)))
    .map(t => t.text)
  return {
    ok: omitted.length === 0,
    remaining: remaining.length,
    classified: ids.length,
    omitted
  }
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
