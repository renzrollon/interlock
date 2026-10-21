// The `interlock advisor` and `interlock note` subcommands: the checkpoint
// consult's CLI brackets and the compound-notes table (add-checkpoint-advisor).
//
// These are the thin I/O around lib/advisor.mjs, lib/prompts/advisor.mjs and
// lib/notes.mjs, moved out of bin/interlock so the entry file stays a
// dispatcher under the plugin directory's per-file size limit. The entry
// file's own output and exit helpers come in as `io` — `emit`, `die`,
// `requireChange`, `readFindingsInput`, `readStdin`, `splitPaths` — so
// stdout, exit codes and the one-stdin-read guard stay exactly the CLI's.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { RISK_KINDS, checkDraft, didNotRun, headingIndex, renderAdvisor, verdictFromLabels } from './advisor.mjs'
import { inspectChange } from './artifacts.mjs'
import { carriesFindingsList, NO_FINDINGS_LIST } from './findings.mjs'
import { LIMITS } from './limits.mjs'
import { NOTES_PATH, appendNotes, deriveNotes, matchNotes, parseNotes } from './notes.mjs'
import { planBrief } from './prompts/advisor.mjs'
import { specMentionedPaths } from './spec-text.mjs'

const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')
const fileStamp = iso => iso.replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
const readOr = path => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** The flat finding list of any shape `gate` accepts, or null when it carries none. */
function findingsListOf(input) {
  if (!carriesFindingsList(input)) return null
  const list = Array.isArray(input) ? input : Array.isArray(input.surviving) ? input.surviving : input.findings
  return list.flatMap(f => (f && Array.isArray(f.findings) ? f.findings : [f]))
}

export function advisorBrief(io, root, name, flags, json) {
  const info = inspectChange(root, name)
  const index = headingIndex(info.path)
  // An artifact that cannot be read reaches the brief as undefined, which it
  // renders as `<file>: absent` rather than as an empty quoted block.
  const text = file => readOr(join(info.path, file))
  let findings = null
  if (flags.findings !== undefined) {
    try {
      const input = JSON.parse(readFileSync(String(flags.findings), 'utf8'))
      findings = findingsListOf(input) ?? { unreadable: NO_FINDINGS_LIST }
    } catch (err) {
      findings = { unreadable: err.message }
    }
  }
  const raw = readOr(join(root, NOTES_PATH))
  let notes = { rows: [], omitted: 0, unreadableRows: 0 }
  if (raw !== undefined) {
    const table = parseNotes(raw)
    if (!table.parseable) notes = { unreadable: table.problems.map(p => p.reason).join('; ') || 'no readable table' }
    else notes = { ...matchNotes(table.rows, specMentionedPaths(text('tasks.md') ?? '')), unreadableRows: table.problems.length }
  }
  const iso = isoNow()
  const rel = join('.claude', 'metrics', `advisor-brief-${name}-${fileStamp(iso)}.md`)
  const plan = planBrief({
    change: name,
    stamp: iso,
    briefPath: rel,
    proposal: text('proposal.md'),
    design: text('design.md'),
    tasks: text('tasks.md'),
    specs: Object.keys(index).filter(f => f.startsWith('specs/')).map(path => ({ path, text: text(path) })),
    ledger: readOr(join(info.path, 'decisions.md')),
    findings,
    notes,
    limits: LIMITS,
    riskKinds: RISK_KINDS
  })
  try {
    mkdirSync(join(root, '.claude', 'metrics'), { recursive: true })
    writeFileSync(join(root, rel), plan.text)
  } catch (err) {
    io.die(err.message)
  }
  io.emit(
    json,
    { step: 'brief', change: name, path: rel, chars: plan.chars, omitted: plan.omitted, overrun: plan.overrun, notes: plan.notes, findings: plan.findings },
    `${rel}\n`
  )
}

export function advisorCheck(io, root, name, flags, json) {
  const info = inspectChange(root, name)
  const iso = isoNow()
  let result
  let briefPath
  // Once the change resolves, every path exits 0: a draft that is missing or
  // unreadable is written down as a consult that did not run, never an exit.
  let raw
  if (flags.failed !== undefined) {
    result = { status: 'did-not-run', reason: flags.failed === true ? '' : String(flags.failed) }
  } else if (flags.check === true) {
    result = { status: 'did-not-run', reason: 'no draft given to --check' }
  } else {
    try {
      raw = flags.check === '-' ? io.readStdin() : readFileSync(String(flags.check), 'utf8')
    } catch (err) {
      result = { status: 'did-not-run', reason: `draft unreadable: ${err.message}` }
    }
  }
  if (result === undefined) {
    let draft
    try {
      draft = JSON.parse(raw)
    } catch {
      draft = undefined
    }
    result = checkDraft(draft, headingIndex(info.path), readOr(join(info.path, 'tasks.md')) ?? '', LIMITS)
    try {
      const prefix = `advisor-brief-${name}-`
      const briefs = readdirSync(join(root, '.claude', 'metrics')).filter(f => f.startsWith(prefix) && f.endsWith('.md')).sort()
      if (briefs.length) briefPath = `.claude/metrics/${briefs[briefs.length - 1]}`
    } catch {
      // No brief on disk: the status line leaves out its source.
    }
  }
  const reason = result.status === 'drafted' ? undefined : String(result.reason ?? '').trim() || 'no reason given'
  const body = reason === undefined ? renderAdvisor(result, { change: name, stamp: iso, briefPath }) : didNotRun(reason, { change: name, stamp: iso })
  const path = `openspec/changes/${name}/advisor.md`
  try {
    writeFileSync(join(info.path, 'advisor.md'), body)
  } catch (err) {
    // Spoken like `noteWrite`'s banner: the consult is advice, so a file that
    // could not be written is a reason to report, never an exit code.
    const why = `advisor.md not written: ${err.message}`
    const line = `advisor: did not run: ${why}`
    io.emit(json, { step: 'check', change: name, status: 'did-not-run', reason: why, questions: [], dropped: 0, risks: 0, written: false, path }, line + '\n')
    if (json) process.stderr.write(line + '\n')
    return
  }
  const out = {
    step: 'check',
    change: name,
    status: reason === undefined ? 'drafted' : 'did-not-run',
    ...(reason === undefined ? {} : { reason }),
    questions: reason === undefined ? result.questions.map(q => ({ id: q.id, question: q.question })) : [],
    dropped: reason === undefined ? result.dropped.length : 0,
    risks: reason === undefined ? result.risks.length : 0,
    path
  }
  const lines = reason === undefined
    ? [`advisor: drafted ${out.questions.length} questions, ${out.risks} risks, ${out.dropped} dropped`, ...out.questions.map(q => `  ${q.id} ${q.question}`)]
    : [`advisor: did not run: ${reason}`]
  io.emit(json, out, [...lines, `  ${path}`].join('\n') + '\n')
}

export function advisorVerdict(io, root, flags, json) {
  const { reasons, ...out } = verdictFromLabels(typeof flags.labels === 'string' ? flags.labels : join(root, 'evals'), LIMITS)
  const c = out.caps
  io.emit(json, out, [
    `advisor verdict: ${out.verdict}`,
    `  labelled ${out.labelled} (min ${c.minLabels})`,
    `  matches ${out.matches} (keepMinMatches ${c.keepMinMatches})`,
    `  repeats ${out.repeats} (repeatMaxPercent ${c.repeatMaxPercent}%)`,
    ...reasons.map(x => `  ${x}`),
    ...out.problems.map(p => `  problem: ${p}`)
  ].join('\n') + '\n')
}

function noteWrite(io, root, rows, json) {
  let out
  try {
    out = appendNotes(root, rows)
  } catch (err) {
    const banner = `COMPOUND NOTES NOT WRITTEN: ${err.message}`
    io.emit(json, { appended: 0, skipped: 0, written: false, banner }, banner + '\n')
    if (json) process.stderr.write(banner + '\n')
    return
  }
  io.emit(json, out, `notes: appended ${out.appended}, skipped ${out.skipped} (${out.path})\n`)
}

export function noteCommand(io, root, positional, flags, json) {
  const sub = positional[1]
  const str = k => (typeof flags[k] === 'string' ? flags[k] : '')
  if (sub === 'add') {
    for (const k of ['change', 'file', 'surprise', 'rule']) if (!str(k).trim()) io.die(`note add requires --${k}`)
    noteWrite(io, root, [{ change: str('change'), file: str('file'), surprise: str('surprise'), rule: str('rule'), source: str('source') || 'manual' }], json)
  } else if (sub === 'derive') {
    const list = findingsListOf(io.readFindingsInput(flags.findings))
    if (!str('change').trim()) io.die('note derive requires --change <change>')
    noteWrite(io, root, deriveNotes(list, { change: str('change'), source: str('source') || 'review' }), json)
  } else if (sub === 'match') {
    if (!positional[2]) io.die('note match requires a change')
    const name = io.requireChange(root, positional[2], json)
    const text = readOr(join(root, NOTES_PATH))
    const table = text === undefined ? { parseable: true, rows: [] } : parseNotes(text)
    if (!table.parseable) io.die(`${NOTES_PATH}: ${table.problems.map(p => p.reason).join('; ')}`)
    const paths = [
      ...specMentionedPaths(readOr(join(root, 'openspec', 'changes', name, 'tasks.md')) ?? ''),
      ...(str('paths') ? io.splitPaths(str('paths')) : [])
    ]
    const m = matchNotes(table.rows, paths, LIMITS)
    io.emit(json, { change: name, rows: m.rows, omitted: m.omitted }, [
      ...m.rows.map(r => `${r.id} ${r.file} (${r.change}) — ${r.surprise} Rule: ${r.rule}`),
      ...(m.rows.length ? [] : ['(no notes matched)']),
      ...(m.omitted ? [`${m.omitted} more omitted (over the matched-notes cap)`] : [])
    ].join('\n') + '\n')
  } else {
    io.die(`unknown note subcommand: ${sub || '(none)'} — expected add|derive|match`)
  }
}
