// The pure module behind the strict ship review's fan-out (change
// fan-out-the-strict-ship-review, design "The pure module"): the fold of the
// reviewers' answers, the fold of the skeptics' verdicts, the cap allocation and
// the step banners. Every function takes already-read contents, so none of them
// touches a disk, and `lib/run.mjs` adds only the reads and the step wiring.
//
// Imports `lib/findings.mjs` and `lib/prompts/review-skeptics.mjs` only.

import { findingId, normalizeSeverity } from './findings.mjs'
import { assembleSkepticPrompts } from './prompts/review-skeptics.mjs'

/** Where a reviewer writes its answer, named in every reason this module prints. */
const dimensionFile = name => `.claude/ship/review/dimensions/${name}.json`

const isText = v => typeof v === 'string' && v.trim() !== ''

/** Parse JSON text, saying why it did not parse instead of throwing. */
function parse(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Fold the reviewers' answers. `expected` is the selected dimensions in selection
 * order; `answers` holds each answer file's raw text, absent or null when no file
 * exists. A dimension counts as run only when its file parses to a ledger object
 * carrying a findings list under its own name: an empty list is a review that ran
 * and found nothing, any other shape says nothing the fold can attribute.
 *
 * @param {{ expected: string[], answers: Record<string, string|null|undefined> }} given
 * @returns {{ ledgers: Array<{ dimension: string, findings: object[], coverage?: unknown }>,
 *   ran: string[], notRun: Array<{ name: string, reason: string }>, completed: boolean }}
 */
export function foldDimensionAnswers({ expected, answers }) {
  const ledgers = []
  const ran = []
  const notRun = []
  const given = answers && typeof answers === 'object' ? answers : {}
  for (const name of Array.isArray(expected) ? expected : []) {
    const file = dimensionFile(name)
    const raw = Object.prototype.hasOwnProperty.call(given, name) ? given[name] : undefined
    if (!isText(raw)) {
      notRun.push({ name, reason: `no answer file at ${file}` })
      continue
    }
    const parsed = parse(raw)
    if (!parsed.ok) {
      notRun.push({ name, reason: `${file} did not parse as JSON (${parsed.reason})` })
      continue
    }
    const body = parsed.value
    if (Array.isArray(body)) {
      notRun.push({ name, reason: `${file} is a bare list, not a { dimension, findings, coverage } ledger with a findings list` })
      continue
    }
    if (!body || typeof body !== 'object' || !Array.isArray(body.findings)) {
      notRun.push({ name, reason: `${file} carries no findings list (an empty list is how to say nothing was found)` })
      continue
    }
    if (body.dimension !== undefined && body.dimension !== name) {
      notRun.push({ name, reason: `${file} names dimension ${JSON.stringify(body.dimension)}, expected ${name}` })
      continue
    }
    ledgers.push({
      ...body,
      dimension: name,
      // `coverage` stays as the reviewer wrote it, absent included: the proof
      // judges the ledger's own `{ checked, unread }`, and an absent one is
      // "coverage not recorded", never an empty one.
      findings: body.findings.map(f => (f && typeof f === 'object' && !f.dimension ? { ...f, dimension: name } : f))
    })
    ran.push(name)
  }
  return { ledgers, ran, notRun, completed: notRun.length === 0 }
}

/**
 * Fold the skeptics' verdicts. `expected` is `[{ label, role, findingIds }]` in
 * spawn order and `files` holds each verdict file's raw text. A file that is
 * absent, unparseable or not a list is unreadable; one unreadable file sets aside
 * both verdicts of its pair (the entries judging the same findings), so a finding
 * is never dismissed on a single verdict. `setAside` names the unreadable labels.
 *
 * @param {{ expected: Array<{ label: string, role: string, findingIds: string[] }>,
 *   files: Record<string, string|null|undefined> }} given
 * @returns {{ verdicts: object[], setAside: string[] }}
 */
export function foldSkepticVerdicts({ expected, files }) {
  const given = files && typeof files === 'object' ? files : {}
  const pairs = new Map()
  for (const entry of Array.isArray(expected) ? expected : []) {
    const key = (entry.findingIds || []).join('\u0000')
    if (!pairs.has(key)) pairs.set(key, [])
    pairs.get(key).push(entry)
  }
  const verdicts = []
  const setAside = []
  for (const members of pairs.values()) {
    const read = members.map(m => {
      const raw = Object.prototype.hasOwnProperty.call(given, m.label) ? given[m.label] : undefined
      const parsed = isText(raw) ? parse(raw) : { ok: false }
      return { label: m.label, list: parsed.ok && Array.isArray(parsed.value) ? parsed.value : null }
    })
    const unreadable = read.filter(r => r.list === null)
    if (unreadable.length) {
      for (const r of unreadable) setAside.push(r.label)
      continue
    }
    for (const r of read) verdicts.push(...r.list)
  }
  return { verdicts, setAside }
}

/**
 * Allocate the skeptic spawns under the cap. Judged findings (blockers and
 * warnings the prompts cover) go blockers first, then warnings, each in finding
 * order. While two more spawns fit, the next finding gets its pair. When findings
 * remain, the last pair inside the cap becomes a per-review pair over every
 * remaining finding. The cap counts spawns and the allocation is in pairs, so an
 * odd cap leaves one slot unused and a cap under 2 allocates nothing.
 *
 * @param {{ prompts: Array<{ skeptic: string, findingIds: string[], prompt: string }>,
 *   findings: object[], cap: number }} given
 *   `prompts` is `assembleSkepticPrompts`' per-finding list over `findings` (flat)
 * @returns {{ spawns: Array<{ skeptic: string, findingIds: string[], prompt: string }>,
 *   perFinding: number, perReview: number, capReached: boolean }}
 */
export function allocateSkeptics({ prompts, findings, cap }) {
  const single = new Map()
  for (const p of Array.isArray(prompts) ? prompts : []) {
    if (!p || !Array.isArray(p.findingIds) || p.findingIds.length !== 1) continue
    const id = p.findingIds[0]
    if (!single.has(id)) single.set(id, [])
    single.get(id).push(p)
  }
  // One unit per finding id the prompts cover, blockers before warnings.
  const byId = new Map()
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f || typeof f !== 'object' || typeof f.title !== 'string') continue
    const severity = normalizeSeverity(f.severity)
    if (severity !== 'blocker' && severity !== 'warning') continue
    const id = findingId(f)
    if (single.has(id) && !byId.has(id)) byId.set(id, { id, finding: f, severity })
  }
  const units = [...byId.values()]
  const ordered = [...units.filter(u => u.severity === 'blocker'), ...units.filter(u => u.severity !== 'blocker')]
  const pairs = Math.floor((Number.isFinite(cap) ? cap : 0) / 2)
  if (!ordered.length) return { spawns: [], perFinding: 0, perReview: 0, capReached: false }
  if (pairs < 1) return { spawns: [], perFinding: 0, perReview: 0, capReached: true }

  const fits = ordered.length <= pairs
  const individually = fits ? ordered : ordered.slice(0, pairs - 1)
  const remainder = fits ? [] : ordered.slice(pairs - 1)
  const spawns = []
  for (const u of individually) spawns.push(...single.get(u.id))
  if (remainder.length) {
    const shared = assembleSkepticPrompts({ findings: remainder.map(u => u.finding), skeptics: 'per-review' })
    spawns.push(...shared.prompts)
  }
  return {
    spawns,
    perFinding: individually.length,
    perReview: remainder.length,
    capReached: !fits
  }
}

const inherit = v => (typeof v === 'string' && v ? v : 'inherit')
const routed = r => `${inherit(r && r.model)}/${inherit(r && r.effort)}`

/**
 * The review step's banner: how many reviewers and skeptics the wave carries and
 * what each was routed to. A null model or effort prints `inherit`, so a reviewer
 * at the session default is a published value and never a silence.
 *
 * @param {{ reviewers: number, reviewerRouting: {model: string|null, effort: string|null},
 *   skeptics: number, skepticRouting: {model: string|null, effort: string|null} }} given
 */
export function reviewWaveBanner({ reviewers, reviewerRouting, skeptics, skepticRouting }) {
  return `REVIEW WAVE: ${reviewers} reviewers (${routed(reviewerRouting)}), ${skeptics} skeptics (${routed(skepticRouting)})`
}

/**
 * The skeptics step's banner when the cap forced findings onto a shared pair.
 *
 * @param {{ perFinding: number, perReview: number }} given
 */
export function skepticCapBanner({ perFinding, perReview }) {
  return `SKEPTIC CAP REACHED: ${perFinding} of ${perFinding + perReview} findings judged per finding, ${perReview} judged per review`
}

/**
 * A review or skeptics step wider than the `--max-parallel` the operator asked
 * for, or null. That flag is the planner's lane-batch width; a review step is
 * sized by the selected dimensions and a skeptics step by the published skeptic
 * cap, and no driver chunks a step (host chunking is a later change of the
 * epic). A runner host starts every spawn of a step at once, so the width is
 * said rather than left for the operator to notice. Null when no width was
 * asked for: the step's own published bounds are then the whole story.
 *
 * @param {{ action: string, spawns: number, maxParallel?: number|null }} given
 */
export function stepWidthBanner({ action, spawns, maxParallel }) {
  if (!Number.isInteger(maxParallel) || maxParallel <= 0 || !(spawns > maxParallel)) return null
  return (
    `REVIEW WIDER THAN MAX PARALLEL: the ${action} step spawns ${spawns} agents and --max-parallel is ` +
    `${maxParallel} — the flag bounds implementer batches only; this step is not chunked, so a runner ` +
    `host starts all ${spawns} at once`
  )
}
