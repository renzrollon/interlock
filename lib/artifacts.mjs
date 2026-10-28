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
import { LIMITS } from './limits.mjs'

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

/**
 * A tasks.md checkbox line: "- [ ] 1.1 Do the thing", "+ [x] ...", "1. [~] ...".
 *
 * OpenSpec 1.15.0's task-line shape, taken from its `dist/utils/task-progress.js`
 * (`^\s*(?:[-*+]|\d{1,9}[.)])\s*\[...\]\s*(.*)`): a `-`, `*` or `+` bullet or an
 * ordered `1.` / `1)` marker, then a box holding any one character or none, then
 * any text, empty included. The negative lookahead leaves link bullets such as
 * `- [A](./notes.md)` out, and there is no `$` anchor so a CRLF line still reads.
 * Only the capture groups differ from upstream's: the box is wrapped so a reader
 * can rewrite its span, and the `d` flag gives that span.
 *
 *   1 the whole box, `[` through `]`   (its span is `m.indices[1]`)
 *   2 the marker character, or undefined when the box holds none
 *   3 the rest of the line, untrimmed
 *
 * Done means the marker is `x` or `X`, as upstream counts it; every other marker
 * is open work. Exported so `hooks/guard-tasks.mjs` reads a checkbox the same way.
 */
export const TASK_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s*(\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\]))\s*(.*)/d

// The marker a TASK_LINE match holds; '' when the box has none.
const taskMarker = m => m[2] || ''
const isDoneMarker = marker => marker === 'x' || marker === 'X'

// Replace a TASK_LINE match's box span with `box`, every other byte untouched.
const rewriteBox = (line, m, box) => line.slice(0, m.indices[1][0]) + box + line.slice(m.indices[1][1])

// The leading `1.2` / `1.2.3` of a checkbox line: exactly the token
// `taskMatchesId` compares against, so an id read here is an id `tasks tick`
// would act on. A bare `3` counts, because the ticker accepts it — agreeing
// with the ticker matters more than guessing which numbers were meant as ids.
const TASK_ID = /^(\d+(?:\.\d+)*)(?:\s|$)/

/**
 * Rewrite every checkbox the reader matches to `[ ]`, whatever its marker, leaving
 * the rest of the line byte-identical. The span rewritten is the box `TASK_LINE`
 * matched, which is OpenSpec 1.15.0's own reading of a task line.
 *
 * The plan fingerprint (`lib/plan-fingerprint.mjs`) hashes `tasks.md` through
 * this, so ticking a task does not invalidate the plan covering the tasks that
 * remain — while adding, removing, reordering or rewording one still does,
 * because every other byte of the line is hashed as written. It lives here
 * rather than there so `TASK_LINE` stays the single reader of what a checkbox
 * looks like; a second regex for the same shape is how the two drift apart.
 */
export function normalizeTaskMarkers(markdown) {
  return (markdown || '')
    .split('\n')
    .map(line => {
      const m = TASK_LINE.exec(line)
      return m ? rewriteBox(line, m, '[ ]') : line
    })
    .join('\n')
}

/**
 * The heading token `/interlock:spec` writes above a TDD change's leading
 * failing-test section.
 *
 * Exported because it is the ONE contract between a prose surface and a code
 * surface in this repo: `skills/spec/SKILL.md` writes it and this module reads
 * it, so a reword on either side would silently stop every TDD change from
 * being detected as one. `test/skills.test.mjs` asserts the skill still writes
 * this exact value rather than a copy of it.
 */
export const RED_SECTION_MARKER = 'Failing tests first'

// A numbered tasks.md section heading: "## 1. Failing tests first". Separate
// from TASK_LINE because it reads a different line shape, and kept beside it so
// the two readers of tasks.md structure stay together.
const SECTION_HEADING = /^\s*##\s+(\d+)\s*\.\s*(.*?)\s*$/

/**
 * The group number of the leading failing-test section, or `null`.
 *
 * Deterministic and pure: the shape of a TDD run is decided by what the author
 * wrote in `tasks.md`, not by a model re-reading it at plan time. Only the
 * LOWEST matching section counts — a marker further down the file describes
 * tests that run after implementation, which is not a red wave, and treating it
 * as one would reorder a change its author did not write for TDD.
 *
 * The caller decides what to do with the answer; nothing here validates it
 * against a classification (see `resolveRedWave` in `lib/run.mjs`).
 */
export function detectRedSection(markdown) {
  const marker = RED_SECTION_MARKER.toLowerCase()
  let lowest = null
  for (const line of (markdown || '').split('\n')) {
    const m = SECTION_HEADING.exec(line)
    if (!m) continue
    if (!m[2].toLowerCase().includes(marker)) continue
    const group = Number(m[1])
    if (!Number.isInteger(group)) continue
    if (lowest === null || group < lowest) lowest = group
  }
  return lowest
}

export function parseTasks(markdown) {
  const tasks = []
  const lines = (markdown || '').split('\n')
  lines.forEach((line, i) => {
    const m = TASK_LINE.exec(line)
    if (!m) return
    const text = m[3].trim()
    tasks.push({
      done: isDoneMarker(taskMarker(m)),
      text,
      // The id a caller would tick, resolved here rather than by every reader.
      // A host that has to split the text itself is a host that can get it
      // wrong, and `null` says "this line carries no id" instead of inventing
      // one from prose.
      id: TASK_ID.exec(text) ? TASK_ID.exec(text)[1] : null,
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
 * Tick the matched box to `[x]` for checkbox lines whose text matches an id,
 * whatever bullet or marker the line carries. Missing ids are reported, never
 * invented. An `x`/`X` box is listed as already, not re-written.
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
    const id = wanted.find(i => taskMatchesId(m[3].trim(), i))
    if (!id) return line
    found.add(id)
    if (isDoneMarker(taskMarker(m))) {
      if (!already.includes(id)) already.push(id)
      return line
    }
    if (!ticked.includes(id)) ticked.push(id)
    return rewriteBox(line, m, '[x]')
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
 *   specFiles: string[], problems: string[],
 *   width: {capabilities: number, tasks: number, caps: object, wide: boolean, over: string[]}
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
      tasks: { total: 0, done: 0, remaining: 0, items: [], redSection: null },
      specFiles: [],
      width: measureWidth([], 0),
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
  // The leading failing-test section, read from the same bytes as the tasks so
  // the shape of a change and its task list can never disagree about which file
  // they came from. `null` for a change with no tasks.md at all.
  let redSection = null
  if (present.includes('tasks.md')) {
    const markdown = readFileSync(join(dir, 'tasks.md'), 'utf8')
    items = parseTasks(markdown)
    redSection = detectRedSection(markdown)
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
    tasks: { total: items.length, done, remaining: items.length - done, items, redSection },
    specFiles,
    width: measureWidth(specFiles, items.length),
    problems
  }
}

/**
 * How wide a change is: its capabilities (`spec.md` files under `specs/`, at any
 * depth, so a stray note is not one) and its tasks, each against the cap
 * `interlock limits` publishes. Advisory: it never touches `ready`.
 */
function measureWidth(specFiles, taskTotal) {
  const capabilities = specFiles.filter(f => f === 'spec.md' || f.endsWith('/spec.md')).length
  const caps = { maxChangeCapabilities: LIMITS.maxChangeCapabilities, maxChangeTasks: LIMITS.maxChangeTasks }
  const over = []
  if (capabilities > caps.maxChangeCapabilities) over.push('capabilities')
  if (taskTotal > caps.maxChangeTasks) over.push('tasks')
  return { capabilities, tasks: taskTotal, caps, wide: over.length > 0, over }
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
  const w = r.width
  if (w && w.wide) {
    if (w.over.includes('capabilities')) {
      lines.push(`CHANGE WIDE: ${w.capabilities} capabilities (max ${w.caps.maxChangeCapabilities})`)
      for (const f of r.specFiles) {
        if (f === 'spec.md' || f.endsWith('/spec.md')) lines.push(`  capability: ${f.slice(0, -'spec.md'.length).replace(/\/$/, '') || '.'}`)
      }
    }
    if (w.over.includes('tasks')) lines.push(`CHANGE WIDE: ${w.tasks} tasks (max ${w.caps.maxChangeTasks})`)
  }
  for (const p of r.problems) lines.push(`  problem: ${p}`)
  return lines.join('\n') + '\n'
}
