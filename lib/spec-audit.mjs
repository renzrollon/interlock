// The spec audit: what a reviewer can rely on a living spec to say.
//
// Pure over gathered inputs — no fs, no git, no clock. The CLI walks
// `openspec/specs/**/spec.md`, reads the graph, and hands this module the texts,
// the reliable spec-to-file edges, the broken links and the graph's coverable
// files. Every measure is defined once here, by a rule the `spec/spec-audit`
// spec states, so a figure can be repeated and a second reader gets the same
// number. The audit judges nothing and blocks nothing: a measure it could not
// take is absent with its reason, never zero. design D5 of
// judge-against-base-and-living-specs.

import { parseSpec, capabilityOf } from './spec-text.mjs'

/** Whole-word bound or prohibition terms, case-insensitive. `nevertheless` is not `never`. */
const BOUND = /\b(?:shall not|must not|never|at most|at least|exactly once)\b/i
const NORMATIVE = /\b(?:SHALL|MUST)\b/
const INLINE_CODE = /`[^`\n]*`/g
// A standalone number: not welded to a word (`utf8`), not part of a dotted
// version or a decimal tail (`1.5.0`).
const NUMBER = /(?<![\w.])\d+(?:\.\d+)?(?![\w]|\.\d)/g
const LIST_MARKER = /^\s*\d+[.)]\s+/
const FENCE = /^\s*(```|~~~)/

const FLAG_ORDER = ['no-bound', 'no-failure-scenario', 'no-edge-case']

const startsWith = (title, word) => new RegExp(`^${word}`, 'i').test(String(title ?? '').trim())

/** The measures of one parsed spec. */
function measure(path, parsed) {
  const c = {
    capability: capabilityOf(path) ?? path,
    path,
    purpose: parsed.purpose !== null,
    requirements: parsed.requirements.length,
    nonNormative: [],
    scenarios: 0,
    missingGiven: 0,
    missingWhen: 0,
    missingThen: 0,
    failure: 0,
    edgeCase: 0,
    unclassified: 0,
    boundLines: 0,
    numericLiterals: [],
    flags: [],
    links: null
  }

  for (const req of parsed.requirements) {
    if (!NORMATIVE.test(`${req.heading}\n${req.prose}`)) c.nonNormative.push(req.heading)

    for (const s of req.scenarios) {
      c.scenarios++
      if (!s.given) c.missingGiven++
      if (!s.when) c.missingWhen++
      if (!s.then) c.missingThen++
      if (startsWith(s.title, 'failure')) c.failure++
      else if (startsWith(s.title, 'edge case')) c.edgeCase++
      else if (!startsWith(s.title, 'happy path')) c.unclassified++
    }

    // `text` opens on the heading line, so index i is line `req.line + i`.
    // Prose is everything before the first scenario heading.
    const lines = req.text.split('\n')
    const proseEnd = req.scenarios.length ? req.scenarios[0].line - req.line : lines.length
    let inFence = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (BOUND.test(line)) c.boundLines++
      if (FENCE.test(line)) {
        inFence = !inFence
        continue
      }
      if (i === 0 || i >= proseEnd || inFence) continue
      const bare = line.replace(INLINE_CODE, ' ').replace(LIST_MARKER, '')
      for (const m of bare.matchAll(NUMBER)) {
        c.numericLiterals.push({ spec: path, line: req.line + i, value: Number(m[0]) })
      }
    }
  }

  if (c.boundLines === 0) c.flags.push('no-bound')
  if (c.failure === 0) c.flags.push('no-failure-scenario')
  if (c.edgeCase === 0) c.flags.push('no-edge-case')
  c.flags.sort((a, b) => FLAG_ORDER.indexOf(a) - FLAG_ORDER.indexOf(b))
  return c
}

/**
 * @param {{
 *   specs: Array<{ path: string, text?: string, error?: string }>,
 *   edges?: Array<{ source_file?: string, target?: string }>|null,
 *   graphReason?: string|null,
 *   broken?: Array<{ spec: string, file: string }>,
 *   graphFiles?: string[]
 * }} input
 */
export function auditSpecs(input = {}) {
  const specs = Array.isArray(input.specs) ? input.specs : []
  const edges = Array.isArray(input.edges) ? input.edges : null
  const broken = Array.isArray(input.broken) ? input.broken : []
  const graphFiles = Array.isArray(input.graphFiles) ? input.graphFiles : []

  const graph = { available: edges !== null, reason: null, unspecified: null }
  if (!graph.available) {
    graph.reason = input.graphReason || 'no graph is available'
  }

  const unreadable = []
  const capabilities = []
  for (const s of specs) {
    if (!s || typeof s.path !== 'string') continue
    if (typeof s.text !== 'string') {
      unreadable.push({ path: s.path, reason: s.error ? String(s.error) : 'the file could not be read' })
      continue
    }
    capabilities.push(measure(s.path, parseSpec(s.text)))
  }
  capabilities.sort((a, b) => a.capability.localeCompare(b.capability))

  const coverage = { specs: capabilities.length, corpus: specs.length }

  if (specs.length === 0) {
    return {
      absent: true,
      reason: 'no living spec exists — openspec/specs/ is missing or holds no spec.md',
      coverage,
      unreadable,
      capabilities: [],
      totals: null,
      graph
    }
  }

  if (edges) {
    const bySpec = new Map()
    const named = new Set()
    for (const e of edges) {
      const spec = e && typeof e.source_file === 'string' ? e.source_file : null
      const target = e && typeof e.target === 'string' ? e.target : ''
      if (!spec || !target.startsWith('file:')) continue
      const file = target.slice('file:'.length)
      if (!bySpec.has(spec)) bySpec.set(spec, new Set())
      bySpec.get(spec).add(file)
      named.add(file)
    }
    for (const c of capabilities) {
      const missing = [...new Set(broken.filter(b => b && b.spec === c.path).map(b => b.file))].sort()
      c.links = { files: (bySpec.get(c.path) ?? new Set()).size, missing }
    }
    const files = [...new Set(graphFiles)].filter(f => !named.has(f)).sort()
    const total = new Set(graphFiles).size
    graph.unspecified = {
      count: files.length,
      total,
      percent: total ? Math.round((files.length / total) * 100) : 0,
      files
    }
  }

  const sum = key => capabilities.reduce((n, c) => n + c[key], 0)
  const totals = {
    specs: capabilities.length,
    requirements: sum('requirements'),
    nonNormative: capabilities.reduce((n, c) => n + c.nonNormative.length, 0),
    scenarios: sum('scenarios'),
    missingGiven: sum('missingGiven'),
    missingWhen: sum('missingWhen'),
    missingThen: sum('missingThen'),
    failure: sum('failure'),
    edgeCase: sum('edgeCase'),
    unclassified: sum('unclassified'),
    boundLines: sum('boundLines'),
    numericLiterals: capabilities.reduce((n, c) => n + c.numericLiterals.length, 0),
    flagged: capabilities.filter(c => c.flags.length > 0).length
  }

  return { absent: false, reason: null, coverage, unreadable, capabilities, totals, graph }
}

/** The human report. Every measure not taken is named with its reason. */
export function formatSpecAudit(report) {
  const out = ['SPEC AUDIT']
  if (report.absent) {
    out.push(`  not measured: ${report.reason}`)
    for (const u of report.unreadable) out.push(`  unreadable: ${u.path} (${u.reason})`)
    return out.join('\n')
  }

  const { coverage, totals, graph } = report
  out.push(`  covers ${coverage.specs} of ${coverage.corpus} spec${coverage.corpus === 1 ? '' : 's'}`)
  for (const u of report.unreadable) out.push(`  unreadable, left out of the totals: ${u.path} (${u.reason})`)

  out.push(
    `  requirements ${totals.requirements} (${totals.nonNormative} without SHALL or MUST)` +
      `, scenarios ${totals.scenarios}` +
      ` (no GIVEN ${totals.missingGiven}, no WHEN ${totals.missingWhen}, no THEN ${totals.missingThen})`
  )
  out.push(
    `  failure ${totals.failure}, edge case ${totals.edgeCase}, untitled by kind ${totals.unclassified}` +
      `, bound lines ${totals.boundLines}, numeric literals ${totals.numericLiterals}`
  )

  const flagged = report.capabilities.filter(c => c.flags.length > 0)
  out.push('', `FLAGS — ${flagged.length} of ${report.capabilities.length} capabilities`)
  if (!flagged.length) out.push('  none')
  for (const c of flagged) out.push(`  ${c.capability}  ${c.flags.join(' ')}`)

  const nonNormative = report.capabilities.filter(c => c.nonNormative.length > 0)
  if (nonNormative.length) {
    out.push('', 'REQUIREMENTS WITH NEITHER SHALL NOR MUST')
    for (const c of nonNormative) for (const h of c.nonNormative) out.push(`  ${c.path}  ${h}`)
  }

  const literals = report.capabilities.flatMap(c => c.numericLiterals)
  out.push('', `NUMERIC LITERALS IN REQUIREMENT PROSE — ${literals.length}, for a person to classify`)
  for (const n of literals) out.push(`  ${n.spec}:${n.line}  ${n.value}`)

  out.push('')
  if (!graph.available) {
    out.push(`FILE LINKS — not measured: ${graph.reason}`)
    out.push(`UNSPECIFIED SOURCE — not measured: ${graph.reason}`)
  } else {
    const gone = report.capabilities.filter(c => c.links && c.links.missing.length > 0)
    out.push(`FILE LINKS — ${gone.length} capabilit${gone.length === 1 ? 'y' : 'ies'} name a file that no longer exists`)
    for (const c of gone) for (const f of c.links.missing) out.push(`  ${c.path}  →  ${f}  (missing)`)
    const u = graph.unspecified
    out.push(`UNSPECIFIED SOURCE — ${u.count} of ${u.total} coverable files (${u.percent}%) are named by no living spec`)
    for (const f of u.files) out.push(`  ${f}`)
  }
  return out.join('\n')
}
