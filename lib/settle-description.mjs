// The rules behind `interlock settle description-brief` and `description-check`
// (spec: review/pull-request-description; design D18 of
// say-what-must-hold-and-how-to-undo-it).
//
// A pull request description the settle skill writes carries seven sections and
// names its change first. The model writes it (D3); this module says what it is
// written from, and checks what the platform holds afterwards. It judges no
// section's quality: presence, emptiness, a bare `None` in the two sections that
// always have an answer, and the `Change:` line (D6, D16).
//
// Pure: text in, plain structures out. No file, process or network access;
// `lib/settle-cli.mjs` does the reads and hands the texts in.

import { parseSpec, requirementKey } from './spec-text.mjs'

/** The template's sections, in template order. */
export const DESCRIPTION_SECTIONS = Object.freeze([
  'Summary',
  'Changes',
  'Must Not Change',
  'High Risk Changes',
  'Prerequisites to Production',
  'How to Roll Back',
  'Testing'
])

/** The sections a bare `None` never answers (D6): something is always left alone, and there is always a way back or a reason there is none. */
export const REASONED_SECTIONS = Object.freeze(['Must Not Change', 'How to Roll Back'])

/** Where in a change's artifacts each section's source sits (D9). */
export const SECTION_SOURCES = Object.freeze([
  Object.freeze({ section: 'Must Not Change', artifact: 'design.md', heading: 'Goals / Non-Goals' }),
  Object.freeze({ section: 'High Risk Changes', artifact: 'design.md', heading: 'Risks / Trade-offs' }),
  Object.freeze({ section: 'Prerequisites to Production', artifact: 'proposal.md', heading: 'Impact' }),
  Object.freeze({ section: 'How to Roll Back', artifact: 'design.md', heading: 'Migration Plan' })
])

/** What the incomplete verdict's reason starts with (D21); no broken-input refusal carries it. */
export const INCOMPLETE_PREFIX = 'DESCRIPTION INCOMPLETE: '

/** The `Change:` line of a pass with no change (D4). */
export const NO_CHANGE_LINE = 'Change: none'

const FENCE = /^\s*(```|~~~)/
const H2 = /^##\s+(.*?)\s*#*\s*$/
const BARE_NONE = /^(?:none|n\/a)\.?$/i

const slashed = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * The line that names the change, as the description's first line under
 * `## Summary` carries it: `` Change: `<change>` (<dir>/proposal.md) ``, or
 * `Change: none` when there is no change. The path is named whether or not the
 * proposal exists (D22).
 *
 * @param {{ change?: string|null, dir?: string|null }} input
 * @returns {string}
 */
export function changeLineFor({ change, dir } = {}) {
  if (typeof change !== 'string' || !change.trim()) return NO_CHANGE_LINE
  const name = change.trim()
  const home = typeof dir === 'string' && dir.trim() ? slashed(dir.trim()) : `openspec/changes/${name}`
  return `Change: \`${name}\` (${home}/proposal.md)`
}

/**
 * The level-2 headings of a markdown text, outside code fences, with their
 * 1-based line numbers.
 *
 * @param {unknown} markdown
 * @returns {{ heading: string, line: number }[]}
 */
export function headingLines(markdown) {
  const out = []
  let inFence = false
  String(markdown ?? '')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.replace(/\r$/, '')
      if (FENCE.test(line)) {
        inFence = !inFence
        return
      }
      if (inFence) return
      const m = H2.exec(line)
      if (m && m[1]) out.push({ heading: m[1], line: i + 1 })
    })
  return out
}

/** Each level-2 section's body, keyed by heading; the first of a repeated heading wins. */
function sectionBodies(markdown) {
  const lines = String(markdown ?? '').split('\n').map(l => l.replace(/\r$/, ''))
  const headings = headingLines(markdown)
  const bodies = new Map()
  headings.forEach((h, k) => {
    if (bodies.has(h.heading)) return
    const end = k + 1 < headings.length ? headings[k + 1].line - 1 : lines.length
    bodies.set(h.heading, lines.slice(h.line, end))
  })
  return bodies
}

/** What a `Change:` line says: a named change, none, or neither. */
function readChangeLine(line) {
  const rest = line.replace(/^\s*Change:\s*/, '')
  if (/^none\.?\s*$/i.test(rest)) return { none: true, change: null }
  const named = /^`([^`\s]+)`/.exec(rest)
  return { none: false, change: named ? named[1] : null }
}

/**
 * Check a description. `change` is the change it must name, when one resolved.
 *
 * Problems, in the order they are reported: for each section in template order,
 * one of `missing section`, `empty section`, `bare None in`; then, when
 * `## Summary` is present, at most one problem with its `Change:` line.
 *
 * @param {unknown} text
 * @param {{ change?: string|null }} [opts]
 * @returns {{
 *   ok: boolean, problems: string[],
 *   sections: { heading: string, present: boolean, empty: boolean, bareNone: boolean }[],
 *   changeLine: { found: boolean, none: boolean, change: string|null, line: string|null }
 * }}
 */
export function checkDescription(text, { change } = {}) {
  const expected = typeof change === 'string' && change.trim() ? change.trim() : null
  const bodies = sectionBodies(typeof text === 'string' ? text : '')
  const problems = []
  const sections = DESCRIPTION_SECTIONS.map(heading => {
    const body = bodies.get(heading)
    const present = body !== undefined
    const content = present ? body.join('\n').trim() : ''
    const empty = present && content === ''
    const bareNone = present && !empty && REASONED_SECTIONS.includes(heading) && BARE_NONE.test(content)
    if (!present) problems.push(`missing section: ## ${heading}`)
    else if (empty) problems.push(`empty section: ## ${heading}`)
    else if (bareNone) problems.push(`bare None in ## ${heading}`)
    return { heading, present, empty, bareNone }
  })

  const changeLine = { found: false, none: false, change: null, line: null }
  const summary = bodies.get('Summary')
  if (summary !== undefined) {
    const line = summary.find(l => /^\s*Change:/.test(l))
    if (line === undefined) {
      problems.push('no Change: line under ## Summary')
    } else {
      const read = readChangeLine(line)
      Object.assign(changeLine, { found: true, none: read.none, change: read.change, line: line.trim() })
      if (!read.none && read.change === null) problems.push('Change: line names no change')
      else if (expected && read.none) problems.push(`Change: line says none, not ${expected}`)
      else if (expected && read.change !== expected) problems.push(`Change: line names ${read.change}, not ${expected}`)
    }
  }
  return { ok: problems.length === 0, problems, sections, changeLine }
}

/**
 * Every requirement a change's delta specs add, modify, remove or rename. A
 * rename is `section: 'RENAMED'` with `heading` the old name and `to` the new.
 *
 * @param {{ capability: string, text: string }[]} specFiles
 * @returns {{ capability: string, section: string, heading: string, to?: string }[]}
 */
export function deltaRequirements(specFiles) {
  const rows = []
  for (const file of Array.isArray(specFiles) ? specFiles : []) {
    if (!file || typeof file.capability !== 'string' || !file.capability) continue
    const parsed = parseSpec(typeof file.text === 'string' ? file.text : '')
    for (const req of parsed.requirements) {
      if (!req.section) continue
      rows.push({ capability: file.capability, section: req.section, heading: req.key })
    }
    for (const rename of parsed.renamed) {
      rows.push({ capability: file.capability, section: 'RENAMED', heading: rename.from, to: rename.to })
    }
  }
  return rows
}

/**
 * The living requirements in force, split by what the change does to them
 * (D13): `held` is every one no delta row modifies, removes or renames, matched
 * by capability and requirement key; `modifiedByChange` is each requirement the
 * delta rows modify, remove or rename. An added requirement subtracts nothing.
 *
 * @param {{ capability: string, title: string }[]} requirements  the living list's entries
 * @param {{ capability: string, section: string, heading: string }[]} delta  from `deltaRequirements`
 * @returns {{ held: object[], modifiedByChange: { capability: string, section: string, heading: string }[] }}
 */
export function splitLiving(requirements, delta) {
  const id = (capability, heading) => `${capability}\u0000${requirementKey(heading)}`
  const modifiedByChange = []
  const gone = new Set()
  for (const row of Array.isArray(delta) ? delta : []) {
    if (!row || row.section === 'ADDED' || !['MODIFIED', 'REMOVED', 'RENAMED'].includes(row.section)) continue
    const key = id(row.capability, row.heading)
    if (gone.has(key)) continue
    gone.add(key)
    modifiedByChange.push({ capability: row.capability, section: row.section, heading: requirementKey(row.heading) })
  }
  const held = (Array.isArray(requirements) ? requirements : []).filter(r => r && !gone.has(id(r.capability, r.title)))
  return { held, modifiedByChange }
}

/**
 * Where the artifacts answer each section (D9): the heading's line, or `null`
 * when the artifact or the heading is absent. A heading inside a fence does not count.
 *
 * @param {{ proposal?: string|null, design?: string|null }} texts
 * @returns {{ section: string, artifact: string, heading: string, line: number|null }[]}
 */
export function locateSources({ proposal = null, design = null } = {}) {
  const texts = { 'proposal.md': proposal, 'design.md': design }
  const found = {}
  for (const [artifact, text] of Object.entries(texts)) found[artifact] = typeof text === 'string' ? headingLines(text) : []
  return SECTION_SOURCES.map(({ section, artifact, heading }) => {
    const hit = found[artifact].find(h => h.heading === heading)
    return { section, artifact, heading, line: hit ? hit.line : null }
  })
}

const LIVING_NOT_BUILT = 'the living-requirements gather is not available to this caller'

/**
 * The brief `description-brief` prints, as text and as the `--json` object.
 *
 * @param {{
 *   change?: string|null, dir?: string|null, archived?: boolean,
 *   changedPaths?: string[], base?: string|null,
 *   requirements?: { capability: string, section: string, heading: string, to?: string }[],
 *   living?: { skipped?: string|null, partial?: string|null, requirements?: object[], omitted?: object[], source?: string }|null,
 *   sources?: { section: string, artifact: string, heading: string, line: number|null }[]
 * }} facts
 * @returns {{ text: string, json: object }}
 */
export function assembleDescriptionBrief(facts = {}) {
  const change = typeof facts.change === 'string' && facts.change ? facts.change : null
  const dir = change && typeof facts.dir === 'string' && facts.dir ? slashed(facts.dir) : change ? `openspec/changes/${change}` : null
  const changedPaths = Array.isArray(facts.changedPaths) ? facts.changedPaths : []
  const base = typeof facts.base === 'string' ? facts.base : null
  const requirements = change && Array.isArray(facts.requirements) ? facts.requirements : []
  const sources = change && Array.isArray(facts.sources) ? facts.sources : []
  const given = facts.living && typeof facts.living === 'object' ? facts.living : { skipped: LIVING_NOT_BUILT, source: 'none' }
  const skipped = typeof given.skipped === 'string' && given.skipped ? given.skipped : null
  const { held, modifiedByChange } = skipped ? { held: [], modifiedByChange: [] } : splitLiving(given.requirements, requirements)
  const omitted = skipped ? [] : Array.isArray(given.omitted) ? given.omitted : []
  const partial = typeof given.partial === 'string' && given.partial ? given.partial : null
  const source = typeof given.source === 'string' ? given.source : 'none'
  const changeLine = changeLineFor({ change, dir })

  const lines = [
    change
      ? `description facts for "${change}" (${dir}): ${changedPaths.length} changed path(s), base ${base}`
      : `description facts with no change named: ${changedPaths.length} changed path(s), base ${base}`,
    '',
    'Copy this line as the first line under ## Summary:',
    changeLine,
    ''
  ]
  if (!change) {
    lines.push('Delta requirements: none — no change was named, so no delta spec was read.')
  } else if (!requirements.length) {
    lines.push("Delta requirements: none — the change's delta specs hold no requirement.")
  } else {
    lines.push(`Delta requirements (${requirements.length}):`)
    for (const r of requirements) {
      lines.push(`  ${r.section} ${r.capability}: ${r.section === 'RENAMED' ? `${r.heading} -> ${r.to}` : r.heading}`)
    }
  }
  lines.push('')
  if (skipped) {
    lines.push(`Living requirements — not built: ${skipped}`)
  } else {
    lines.push(
      `Living requirements in force over the changed paths (read from ${source}): ${held.length} held, ${modifiedByChange.length} modified by the change`
    )
    if (partial) lines.push(`  Partial: ${partial}`)
    for (const r of held) lines.push(`  ${r.capability}: ${r.title}  ${r.artifact}:${r.line}`)
    if (omitted.length) lines.push(`  ${omitted.length} requirement(s) left out by the size bound`)
  }
  lines.push('')
  if (!change) {
    lines.push('Section sources: none — no change was named, so no artifact was read.')
  } else {
    lines.push('Section sources:')
    for (const s of sources) {
      lines.push(`  ## ${s.section} <- ${s.artifact} ## ${s.heading}${s.line === null ? ': not found' : `, line ${s.line}`}`)
    }
  }

  return {
    text: `${lines.join('\n')}\n`,
    json: {
      change,
      dir,
      archived: change ? facts.archived === true : false,
      changeLine,
      changedPaths,
      base,
      requirements,
      living: { held, modifiedByChange, omitted, skipped, partial, source },
      sources
    }
  }
}
