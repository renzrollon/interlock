// `interlock review-policy suggest`: the pure module (change
// `scope-suggest-and-evaluate-the-artifact-gate`, design §4, D12-D17, D30, D32).
//
// Plain inputs and the caps in, `{ window, candidates, stale, unquoted, sources }`
// out. It reads no LIMITS and no file: `lib/review-policy-cli.mjs` does the I/O
// and injects the caps. The gate verdict a joined findings file earned is decided
// by `evaluateGate`, never by a second reading of the file.
//
//   suggestPolicy({ window, notes, gates, ledgers, checks, caps, unjoined })
//   summaryLine(result)    'REVIEW.md candidates: <c+s> — interlock review-policy suggest' or ''
//   formatSuggest(result)  the text output

import { evaluateGate } from './findings.mjs'
import { canonicalizePath } from './risk.mjs'

const CHECK_TAG = n => `review-md.${n}`

function timeOf(iso) {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** Resolve the window: whether it is open, and the day and time it starts. */
function resolveWindow(window = {}) {
  const since = window.since && typeof window.since.day === 'string' ? window.since : null
  const commit = window.commit || null
  if (window.all) {
    return { open: true, since: null, commit, reason: '--all given: every record counts', start: null }
  }
  if (!since) {
    return {
      open: true,
      since: null,
      commit,
      reason: 'REVIEW.md has no commit to anchor the window, so every record counts',
      start: null
    }
  }
  return {
    open: false,
    since: since.day,
    commit,
    reason: `records on or after ${since.day}`,
    start: { day: since.day, time: timeOf(since.time) }
  }
}

// A closed window admits only what it can date: an undated or malformed row, and a
// gate whose timestamp does not parse, stay out of it. An open window admits all.
const DAY = /^\d{4}-\d{2}-\d{2}$/
const dayInWindow = (start, day) => !start || (typeof day === 'string' && DAY.test(day) && day >= start.day)
const timeInWindow = (start, iso) => {
  if (!start) return true
  const t = timeOf(iso)
  if (t === null) return false
  return start.time === null ? new Date(t).toISOString().slice(0, 10) >= start.day : t >= start.time
}

const distinct = rows => new Set(rows.map(r => r.change)).size

/** Every finding a gate's file holds, at any severity and past any band. */
function allFindings(content) {
  const r = evaluateGate(content, { band: null })
  return [...r.byFile.flatMap(g => g.findings), ...r.unscoped, ...r.malformed]
}

const recorded = g => g.depth != null || g.reviewer != null
// Only a field recorded on both gates can differ: `{ depth: null, reviewer: 'session' }`
// then `{ depth: 'lean', reviewer: 'session' }` is the same reader, one field unrecorded.
const differs = (a, b, key) => a[key] != null && b[key] != null && a[key] !== b[key]
const readerDiffers = (a, b) => differs(a, b, 'depth') || differs(a, b, 'reviewer')

function t1(notes, minChanges) {
  const byFile = new Map()
  for (const row of notes) {
    const file = canonicalizePath(row.file ?? '') ?? String(row.file ?? '').trim()
    if (!file) continue
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file).push(row)
  }
  const out = []
  for (const [file, rows] of byFile) {
    if (distinct(rows) < minChanges) continue
    out.push({
      trigger: 'T1',
      subject: file,
      evidence: rows.map(r => ({ id: r.id, date: r.date, change: r.change, rule: r.rule }))
    })
  }
  return out
}

function t2(gates, verdict) {
  const byChange = new Map()
  for (const g of gates) {
    if (!byChange.has(g.change)) byChange.set(g.change, [])
    byChange.get(g.change).push({ g, t: timeOf(g.timestamp) ?? 0 })
  }
  const out = []
  for (const [change, list] of byChange) {
    const ordered = list.sort((a, b) => a.t - b.t).map(e => e.g)
    const evidence = []
    for (let i = 0; i + 1 < ordered.length; i++) {
      const first = ordered[i]
      const next = ordered[i + 1]
      if (!recorded(first) || !recorded(next) || !readerDiffers(first, next)) continue
      if (!verdict(first).passed) continue
      const later = verdict(next)
      if (later.blockers.length === 0) continue
      evidence.push({
        change,
        passed: { findings: first.findings, depth: first.depth ?? null, reviewer: first.reviewer ?? null },
        blocked: { findings: next.findings, depth: next.depth ?? null, reviewer: next.reviewer ?? null },
        blockers: later.blockers.map(b => b.title)
      })
    }
    if (evidence.length) out.push({ trigger: 'T2', subject: change, evidence })
  }
  return out
}

function t3(gates, minChanges, verdict) {
  const byTag = new Map()
  for (const g of gates) {
    for (const b of verdict(g).blockers) {
      if (typeof b.check !== 'string' || !b.check) continue
      if (!byTag.has(b.check)) byTag.set(b.check, [])
      byTag.get(b.check).push({ change: g.change, findings: g.findings, title: b.title })
    }
  }
  const out = []
  for (const [tag, evidence] of byTag) {
    if (distinct(evidence) >= minChanges) out.push({ trigger: 'T3', subject: tag, evidence })
  }
  return out
}

function t4(ledgers, start) {
  const out = []
  for (const ledger of ledgers) {
    if (!dayInWindow(start, ledger.date)) continue
    for (const row of ledger.rows || []) {
      if (!/human decision/i.test(String(row.evidence ?? ''))) continue
      out.push({
        trigger: 'T4',
        subject: `${ledger.change} ${row.id}`,
        evidence: [{ change: ledger.change, id: row.id, question: row.question, resolution: row.resolution }]
      })
    }
  }
  return out
}

/**
 * @param {object} input see the header
 */
export function suggestPolicy({ window, notes, gates = [], ledgers = [], checks, caps, unjoined = {} }) {
  const win = resolveWindow(window)
  const { start } = win
  const minChanges = caps.minSuggestChanges

  const rows = notes ? (notes.rows || []).filter(r => dayInWindow(start, r.date)) : []
  const inGates = gates.filter(g => timeInWindow(start, g.timestamp))
  const inLedgers = ledgers.filter(l => dayInWindow(start, l.date))

  // One default-band verdict per gate, shared by T2 and T3.
  const verdicts = new Map()
  const verdict = g => {
    if (!verdicts.has(g)) verdicts.set(g, evaluateGate(g.content))
    return verdicts.get(g)
  }

  const candidates = [...t1(rows, minChanges), ...t2(inGates, verdict), ...t3(inGates, minChanges, verdict), ...t4(inLedgers, start)]

  const stale = []
  const unquoted = []
  let checksLine
  if (!Array.isArray(checks)) {
    checksLine = 'REVIEW.md Artifact Checks not read (no REVIEW.md at HEAD, or it carries none)'
  } else {
    const raised = new Set()
    for (const g of inGates) for (const f of allFindings(g.content)) if (typeof f.check === 'string') raised.add(f.check)
    const judged = inGates.length >= caps.staleCheckGates
    checks.forEach((text, i) => {
      const n = i + 1
      const tag = CHECK_TAG(n)
      if (n > caps.maxArtifactChecks) unquoted.push({ tag, text })
      else if (judged && !raised.has(tag)) stale.push({ tag, text, gates: inGates.length })
    })
    checksLine = judged
      ? `${checks.length} Artifact Check(s) at HEAD, judged against ${inGates.length} joined gate(s)`
      : `${checks.length} Artifact Check(s) at HEAD, not judged: ${inGates.length} joined gate(s) read, ${caps.staleCheckGates} needed`
    if (unquoted.length) checksLine += `; ${unquoted.length} past the first ${caps.maxArtifactChecks}, which no brief quotes`
  }

  const noFindings = unjoined.noFindings ?? 0
  const unreadable = unjoined.unreadable ?? 0
  const sources = {
    notes: notes
      ? `docs/notes/compound.md: ${notes.rows.length} row(s) read, ${rows.length} in the window` +
        (notes.problems ? `; ${notes.problems} unreadable row(s)` : '')
      : 'docs/notes/compound.md: absent or unreadable, so T1 read nothing',
    records:
      `review-metrics records: ${inGates.length} joined gate(s) in the window; ` +
      `${noFindings} left out for naming no findings file, ${unreadable} for an unreadable findings file`,
    ledgers: `archived decision ledgers: ${inLedgers.length} in the window, ${ledgers.length} read`,
    checks: checksLine
  }

  return { window: { open: win.open, since: win.since, commit: win.commit, reason: win.reason }, candidates, stale, unquoted, sources }
}

/** One line for a hand-off to print, or '' when there is nothing to say. */
export function summaryLine(result) {
  const n = result.candidates.length + result.stale.length
  return n > 0 ? `REVIEW.md candidates: ${n} — interlock review-policy suggest` : ''
}

function evidenceLine(e) {
  return Object.entries(e)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')
}

/** The text output. */
export function formatSuggest(result) {
  const { window: w } = result
  const anchor = w.open
    ? `evidence window open (${w.reason})`
    : `evidence since ${w.since}${w.commit ? ` (REVIEW.md at ${String(w.commit).slice(0, 7)})` : ''}`
  const lines = [`REVIEW POLICY SUGGEST: ${result.candidates.length} candidate(s), ${result.stale.length} stale — ${anchor}`]
  for (const c of result.candidates) {
    lines.push('', `${c.trigger} ${c.subject}`)
    for (const e of c.evidence) lines.push(`  ${evidenceLine(e)}`)
  }
  if (result.stale.length) {
    lines.push('', 'STALE (no gate in the window raised these):')
    for (const s of result.stale) lines.push(`  ${s.tag} ${JSON.stringify(s.text)} (${s.gates} gate(s) read)`)
  }
  if (result.unquoted.length) {
    lines.push('', 'UNQUOTED (past the cap, never shown to a reader):')
    for (const u of result.unquoted) lines.push(`  ${u.tag} ${JSON.stringify(u.text)}`)
  }
  lines.push('', 'SOURCES:')
  for (const key of ['notes', 'records', 'ledgers', 'checks']) lines.push(`  ${result.sources[key]}`)
  return lines.join('\n') + '\n'
}
