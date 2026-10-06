// The spec meter's text rules (observe-the-spec-run-live design D1-D9).
//
// `/interlock:spec` has no CLI spine to draw from: it is a prose skill that
// drives `openspec` and `interlock` through the Bash tool and writes its
// artifacts with the Write tool. The hooks module draws it anyway, from what
// already crossed the engine, and this module holds every rule it draws by:
// which load starts a run (D1), which command lines are the flow's keyed lines
// and how a compound line is cut (D3), where a line names its change (D2), the
// fields each line's JSON must carry (D3), which writes are counted (D4), and
// every word the status line and the pane say (D6). The module keeps the
// record and makes the engine calls; nothing here does either.
//
// Every word drawn is the CLI's: a field it printed, composed from the field
// and never from its text, a count of events the engine raised, or a time the
// engine's clock gave. A line that cannot be read is said to be unread, with
// its first line. Nothing here compares a count against a number, names a
// threshold, or reads OpenSpec's own roll-up of the artifact ladder: the table
// is the ladder as printed, and the record is the artifacts on disk, the
// findings file and the gate's exit, which the pane says.
//
// It runs inside the engine through `hooks/mod.mjs`, so it is pure and imports
// nothing (`test/spine/mod-pins.test.mjs` walks it). It does not import the
// CLI's own modules for their shapes: they reach `node:fs`, and re-deriving a
// verdict from them is what the meter must not do (D9).

export const SPEC_PANE = 'interlock-spec'
export const SPEC_TITLE = 'Interlock spec'
export const NO_SPEC_LINE = 'no spec run is live in this session'
export const SPEC_RECORD_LINE = "the artifacts on disk, the findings file and the gate's exit are the record"
export const SPEC_UNPLACED_TOAST = '/interlock-spec opens the spec meter'
export const UNKNOWN_CHANGE = 'change: unknown until named'
export const SPEC_REPLACED_LINE = 'interlock spec: a new spec run replaced the previous one'

/**
 * The flow's keyed lines, by their command words, in the flow's order: the
 * spec skill's drift, change, ladder, ledger, validate, autonomy and checkpoint
 * lines, with review-artifacts' gate and continuity's readiness where they
 * fall (D3). The skill-lines pin reads the three skills against this list.
 */
export const KEYED_LINES = Object.freeze([
  Object.freeze({ kind: 'drift', words: Object.freeze(['interlock', 'drift']) }),
  Object.freeze({ kind: 'new-change', words: Object.freeze(['openspec', 'new', 'change']) }),
  Object.freeze({ kind: 'status', words: Object.freeze(['openspec', 'status']) }),
  Object.freeze({ kind: 'ledger', words: Object.freeze(['interlock', 'ledger']) }),
  Object.freeze({ kind: 'validate', words: Object.freeze(['interlock', 'validate']) }),
  Object.freeze({ kind: 'gate', words: Object.freeze(['interlock', 'gate']) }),
  Object.freeze({ kind: 'autonomy', words: Object.freeze(['interlock', 'autonomy', 'record']) }),
  Object.freeze({ kind: 'autonomy', words: Object.freeze(['interlock', 'autonomy', 'clean']) }),
  Object.freeze({ kind: 'ready', words: Object.freeze(['interlock', 'ready']) }),
  Object.freeze({ kind: 'checkpoint', words: Object.freeze(['interlock', 'notify', 'checkpoint']) })
])

/** Lines whose argv may name the change and whose result is never read (D2). */
export const NAMING_ONLY = Object.freeze([Object.freeze(['openspec', 'instructions'])])

/** The kinds whose result text is read; the rest are read by their argv alone (D3). */
export const TEXT_KINDS = Object.freeze(['status', 'drift', 'ledger', 'validate', 'gate', 'ready'])

/** The skills a load can be, by the name the engine carries (D1, as probe 1 left it). */
const SKILL_ROLES = new Map([
  ['interlock:spec', 'spec'],
  ['interlock:explore', 'explore'],
  ['interlock:review-artifacts', 'review-artifacts']
])

/** The line the engine puts before a failed command's output (probe 3). */
const ENGINE_PREFIX = /^Exit code \d+$/

const UNPARSED_CUT = 200

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isString = v => typeof v === 'string' && v !== ''
const countOf = v => (Array.isArray(v) ? v.length : null)
const shown = v => (v === null || v === undefined ? '?' : String(v))

/**
 * What a skill name loads: `spec`, `explore`, `review-artifacts`, or `null`.
 * Only the plugin's namespaced names count, a leading `/` dropped: neither
 * event that carries a load carries the skill's text, so a bare `spec` could
 * be anyone's (D1).
 */
export function skillRole(name) {
  if (typeof name !== 'string') return null
  return SKILL_ROLES.get(name.trim().replace(/^\//, '')) || null
}

/** The skill a submitted prompt names by its first word (`/interlock:spec …`), or `null`. Nothing else is read. */
export function promptSkill(text) {
  if (typeof text !== 'string') return null
  const m = text.match(/^\s*\/([A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?)(?=\s|$)/)
  return m ? m[1] : null
}

/**
 * A shell command's words, unquoted, up to the first unquoted `|`, `;`, `&`,
 * `>` or `<`. Each word is `{ value, plain }`, `plain` when no part of it was
 * quoted. Never throws.
 */
export function argvOf(command) {
  if (typeof command !== 'string') return []
  const words = []
  let value = ''
  let plain = true
  let open = false
  let quote = null
  const end = () => {
    if (open) words.push({ value, plain })
    value = ''
    plain = true
    open = false
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote === "'") {
      if (c === "'") quote = null
      else value += c
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '\\' && i + 1 < command.length && '"\\$`'.includes(command[i + 1])) value += command[++i]
      else value += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      plain = false
      open = true
    } else if (c === '\\' && i + 1 < command.length) {
      value += command[++i]
      open = true
    } else if ('|;&><'.includes(c)) {
      break
    } else if (/\s/.test(c)) {
      end()
    } else {
      value += c
      open = true
    }
  }
  end()
  return words
}

/** Whether `words` begins with the plain words `prefix`. */
const startsWith = (words, prefix) => prefix.every((w, i) => words[i] && words[i].plain && words[i].value === w)

/**
 * The kind of one command line by its first words, after leading whitespace:
 * a keyed kind, `naming-only`, or `null`. It keys on the command words and not
 * on `--json`, so a line on the previous skill text is classified and shown
 * unparsed rather than ignored (D3).
 */
export function lineKind(command) {
  const words = argvOf(command)
  for (const { kind, words: prefix } of KEYED_LINES) if (startsWith(words, prefix)) return kind
  for (const prefix of NAMING_ONLY) if (startsWith(words, prefix)) return 'naming-only'
  return null
}

/**
 * A command cut at every unquoted `&&`, `||`, `;` and line break, each segment
 * trimmed; past an unquoted `<<` the rest is one segment, so a heredoc's body
 * is never read as commands. Never throws.
 */
export function segmentsOf(command) {
  if (typeof command !== 'string') return []
  const out = []
  let start = 0
  let quote = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"') i++
      continue
    }
    if (c === "'" || c === '"') quote = c
    else if (c === '\\') i++
    else if (c === '<' && command[i + 1] === '<') break
    else if (c === ';' || c === '\n') {
      out.push(command.slice(start, i))
      start = i + 1
    } else if ((c === '&' && command[i + 1] === '&') || (c === '|' && command[i + 1] === '|')) {
      out.push(command.slice(start, i))
      start = i + 2
      i++
    }
  }
  out.push(command.slice(start))
  return out.map(s => s.trim()).filter(Boolean)
}

/**
 * The keyed segments of a command, in order: `{ kind, segment }` for each
 * segment `lineKind` classifies, `naming-only` included (D3, the compound
 * split probe 1 asked for).
 */
export function specLines(command) {
  return segmentsOf(command)
    .map(segment => ({ kind: lineKind(segment), segment }))
    .filter(line => line.kind !== null)
}

/** A name the CLI could have meant: a non-empty string with no unexpanded `$`, backtick or `<`. */
const nameOf = v => (isString(v) && !/[$`<]/.test(v) ? v : null)

/** The value of `--<flag> v` or `--<flag>=v` in `words`, or `null`. */
function flagValue(words, flag) {
  for (let i = 0; i < words.length; i++) {
    const w = words[i].value
    if (w === `--${flag}`) return words[i + 1] ? words[i + 1].value : null
    if (w.startsWith(`--${flag}=`)) return w.slice(flag.length + 3)
  }
  return null
}

/** The positional at `index` when it is not a flag. */
const positional = (words, index) => (words[index] && !words[index].value.startsWith('-') ? words[index].value : null)

/**
 * The change a line names (D2): from its argv first, the positional after
 * `openspec new change`, `--change` on any `openspec` line, the name after
 * `interlock ledger|validate|ready` and `interlock notify checkpoint`,
 * `--metrics` on `interlock gate`; then a non-empty `changeName` or `change`
 * in the parsed result. Never a path, a prompt or another tool's input.
 */
export function changeOf(kind, command, value) {
  const words = argvOf(command)
  let named = null
  if (kind === 'new-change') named = positional(words, 3)
  else if (words[0] && words[0].value === 'openspec') named = flagValue(words, 'change')
  else if (kind === 'ledger' || kind === 'validate' || kind === 'ready') named = positional(words, 2)
  else if (kind === 'checkpoint') named = positional(words, 3)
  else if (kind === 'gate') named = flagValue(words, 'metrics')
  if (nameOf(named)) return named
  if (isObject(value)) return nameOf(value.changeName) || nameOf(value.change)
  return null
}

/**
 * The one JSON object a command printed, as `emit` prints it: from the first
 * line that is exactly `{` to the last that is exactly `}`, so an engine
 * prefix line and a stderr tail do not defeat it. `{ value }` or `{ problem }`.
 */
export function findJson(text) {
  if (typeof text !== 'string') return { problem: 'no result text' }
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''))
  const first = lines.indexOf('{')
  const last = lines.lastIndexOf('}')
  if (first === -1 || last < first) return { problem: 'output not JSON' }
  try {
    const value = JSON.parse(lines.slice(first, last + 1).join('\n'))
    return isObject(value) ? { value } : { problem: 'output not JSON' }
  } catch {
    return { problem: 'output not JSON' }
  }
}

/** The text a result carries: the command's own stdout when the engine kept it, else what the model reads. */
function resultText(r) {
  if (!isObject(r)) return null
  if (isObject(r.result) && typeof r.result.stdout === 'string') return r.result.stdout
  return typeof r.text === 'string' ? r.text : null
}

/** The first non-empty line of a result, past the engine's failed-command prefix, cut. */
function firstLine(text) {
  const lines = (typeof text === 'string' ? text : '').split('\n').map(l => l.trim())
  const line = lines.find(l => l && !ENGINE_PREFIX.test(l)) || ''
  return line.length > UNPARSED_CUT ? line.slice(0, UNPARSED_CUT) : line
}

/** An entry for a line that ran and was not read: its first line and why (D3). */
export const unparsedEntry = (kind, text, reason) => ({ kind, unparsed: firstLine(text), reason })

const isBool = v => typeof v === 'boolean'
const isCount = v => Number.isInteger(v)

/** Each text kind's needed fields, and what it keeps of them (D3). */
const READERS = {
  status(v) {
    const ok = Array.isArray(v.artifacts) && v.artifacts.every(a => isObject(a) && isString(a.id) && isString(a.status))
    if (!ok) return { missing: ['artifacts'] }
    return {
      entry: {
        artifacts: v.artifacts.map(a => ({
          id: a.id,
          status: a.status,
          outputPath: isString(a.outputPath) ? a.outputPath : null,
          requires: Array.isArray(a.requires) ? a.requires.filter(isString) : []
        })),
        applyRequires: Array.isArray(v.applyRequires) ? v.applyRequires.filter(isString) : null,
        changeName: isString(v.changeName) ? v.changeName : null,
        schemaName: isString(v.schemaName) ? v.schemaName : null
      }
    }
  },
  drift(v) {
    const stale = isObject(v.stale) ? v.stale : {}
    const missing = [
      ...(Array.isArray(v.unarchived) ? [] : ['unarchived']),
      ...(Array.isArray(stale.broken) ? [] : ['stale.broken']),
      ...(Array.isArray(stale.aging) ? [] : ['stale.aging'])
    ]
    if (missing.length) return { missing }
    return { entry: { unarchived: v.unarchived.length, broken: stale.broken.length, aging: stale.aging.length } }
  },
  ledger(v) {
    if (!isBool(v.blocking)) return { missing: ['blocking'] }
    const entry = { blocking: v.blocking }
    for (const f of ['needsHuman', 'invalidCount']) if (isCount(v[f])) entry[f] = v[f]
    for (const f of ['missing', 'unparseable']) if (isBool(v[f])) entry[f] = v[f]
    return { entry }
  },
  validate(v) {
    const missing = [...(isBool(v.ready) ? [] : ['ready']), ...(Array.isArray(v.problems) ? [] : ['problems'])]
    if (missing.length) return { missing }
    return { entry: { ready: v.ready, problems: v.problems.map(p => (typeof p === 'string' ? p : JSON.stringify(p))) } }
  },
  gate(v) {
    const counts = isObject(v.counts) ? v.counts : {}
    const missing = [
      ...(isBool(v.passed) ? [] : ['passed']),
      ...['blocker', 'warning', 'suggestion'].filter(s => !isCount(counts[s])).map(s => `counts.${s}`),
      ...(Array.isArray(v.malformed) ? [] : ['malformed'])
    ]
    if (missing.length) return { missing }
    const entry = {
      passed: v.passed,
      counts: { blocker: counts.blocker, warning: counts.warning, suggestion: counts.suggestion },
      malformed: v.malformed.length,
      metrics: null
    }
    if (isObject(v.metrics)) {
      entry.metrics = {
        written: isBool(v.metrics.written) ? v.metrics.written : null,
        path: isString(v.metrics.path) ? v.metrics.path : null,
        reason: isString(v.metrics.reason) ? v.metrics.reason : null
      }
    }
    return { entry }
  },
  ready(v) {
    const missing = [...(isBool(v.ready) ? [] : ['ready']), ...(Array.isArray(v.blockers) ? [] : ['blockers'])]
    if (missing.length) return { missing }
    return { entry: { ready: v.ready, blockers: v.blockers.length } }
  }
}

/** The kinds a name that does not resolve answers `{ error, candidates }` for (`requireChange`). */
const RESOLVING = new Set(['ledger', 'validate', 'ready'])
const VERDICT = { ledger: 'blocking', validate: 'ready', ready: 'ready' }

/**
 * What one keyed line's result says, as an entry the record keeps, with the
 * change it names as `name` (D2, D3). Only the fields a kind needs are kept:
 * a result lacking them, or not JSON, or too large to have been kept inline,
 * is an unparsed entry with its first line and the reason. `new-change`,
 * `autonomy` and `checkpoint` read no text; `autonomy` keeps only `record` or
 * `clean`. OpenSpec's own roll-up of the ladder is never read.
 */
export function readResult(kind, command, r) {
  if (kind === 'new-change' || kind === 'checkpoint') return { kind, name: changeOf(kind, command, null) }
  if (kind === 'autonomy') {
    const words = argvOf(command)
    return { kind, command: words[2] ? words[2].value : null, name: null }
  }
  if (!READERS[kind]) return null
  if (isObject(r) && isObject(r.result) && isString(r.result.persistedOutputPath)) {
    return { ...unparsedEntry(kind, resultText(r), 'output too large to read inline'), name: changeOf(kind, command, null) }
  }
  const text = resultText(r)
  if (text === null) return { ...unparsedEntry(kind, '', 'no result text'), name: changeOf(kind, command, null) }
  const { value, problem } = findJson(text)
  if (!value) return { ...unparsedEntry(kind, text, problem), name: changeOf(kind, command, null) }
  const name = changeOf(kind, command, value)
  if (RESOLVING.has(kind) && isString(value.error) && Array.isArray(value.candidates) && !(VERDICT[kind] in value)) {
    return { kind, error: value.error, candidates: value.candidates.filter(isString), name }
  }
  const { entry, missing } = READERS[kind](value)
  if (!entry) return { ...unparsedEntry(kind, text, `fields missing: ${missing.join(', ')}`), name }
  return { kind, ...entry, name }
}

/**
 * Which write a path is (D4): an artifact under `openspec/changes/<dir>/`
 * (`archive` excluded), the explore brief, or a review-artifacts findings
 * file; otherwise `null`. A path files a write under its directory and never
 * names the change.
 */
export function writeOf(path) {
  if (typeof path !== 'string' || !path) return null
  const p = path.replace(/\\/g, '/')
  const artifact = p.match(/(?:^|\/)openspec\/changes\/([^/]+)\/(.+)$/)
  if (artifact) return artifact[1] === 'archive' ? null : { kind: 'artifact', change: artifact[1], file: artifact[2] }
  if (/(?:^|\/)\.claude\/handoff\/explore-[^/]*\.md$/.test(p)) return { kind: 'brief', path }
  const findings = p.match(/(?:^|\/)\.claude\/metrics\/review-artifacts-(.+)-\d{8}-\d{6}\.json$/)
  if (findings) return { kind: 'findings', change: findings[1], path }
  return null
}

/** The status line's stage for an entry, in the CLI's words (D6's table). */
export function stageText(entry, spawned = 0) {
  if (!isObject(entry)) return null
  const { kind } = entry
  if (typeof entry.unparsed === 'string') return `${kind} (unparsed)`
  if (isString(entry.error)) return `${kind}: change not resolved (candidates ${countOf(entry.candidates) ?? 0})`
  switch (kind) {
    case 'explore':
      return spawned ? `explore (${spawned} investigators)` : 'explore'
    case 'review-artifacts':
      return 'review-artifacts'
    case 'new-change':
      return 'new change'
    case 'status': {
      const done = entry.artifacts.filter(a => a.status === 'done').length
      const next = entry.artifacts.find(a => a.status === 'ready')
      return `status ${done}/${entry.artifacts.length} done${next ? ` · next: ${next.id}` : ''}`
    }
    case 'drift':
      return `drift (unarchived ${entry.unarchived} · broken ${entry.broken} · aging ${entry.aging})`
    case 'ledger':
      if (entry.missing === true) return 'ledger missing'
      if (entry.unparseable === true) return 'ledger unparseable'
      return `ledger ${entry.blocking ? 'blocking' : 'clear'} (needs_human ${shown(entry.needsHuman)} · invalid ${shown(entry.invalidCount)})`
    case 'validate':
      return entry.ready ? 'validate READY' : `validate NOT READY (problems ${entry.problems.length})`
    case 'gate': {
      const notes = [
        ...(entry.malformed ? [`malformed ${entry.malformed}`] : []),
        ...(entry.metrics && entry.metrics.written === false ? ['metrics not written'] : [])
      ]
      if (entry.passed) return `gate PASS${notes.length ? ` (${notes.join(' · ')})` : ''}`
      const { blocker, warning } = entry.counts
      return `gate BLOCKED (${[`blocker ${blocker}`, `warning ${warning}`, ...notes].join(' · ')})`
    }
    case 'autonomy':
      return `autonomy ${entry.command || '?'}`
    case 'ready':
      return entry.ready ? 'ready true' : `ready false (blockers ${entry.blockers})`
    case 'checkpoint':
      return 'checkpoint'
    default:
      return null
  }
}

/** `interlock spec: <change> · <stage>`, the stage omitted until there is one (D6). */
export function specStatusText(spec) {
  const stage = stageText(spec.stage, spec.explore.spawned)
  return `interlock spec: ${spec.current || UNKNOWN_CHANGE}${stage ? ` · ${stage}` : ''}`
}

const iso = at => (Number.isFinite(at) ? new Date(at).toISOString() : null)

/** A result line on the pane, by its JSON names, or why it is absent (D6). */
function resultLine(kind, entry) {
  if (!entry) return `${kind}: not run yet`
  if (typeof entry.unparsed === 'string') return `${kind}: not read (${entry.reason}) · ${entry.unparsed}`
  if (isString(entry.error)) return `${kind}: change not resolved · candidates ${entry.candidates.join(', ') || 'none'}`
  switch (kind) {
    case 'drift':
      return `drift: unarchived ${entry.unarchived} · broken ${entry.broken} · aging ${entry.aging}`
    case 'ledger':
      return `ledger: ${['blocking', 'needsHuman', 'invalidCount', 'missing', 'unparseable']
        .filter(f => f in entry)
        .map(f => `${f} ${entry[f]}`)
        .join(' · ')}`
    case 'validate':
      return `validate: ready ${entry.ready} · problems ${entry.problems.length}`
    case 'gate': {
      const { blocker, warning, suggestion } = entry.counts
      const m = entry.metrics
      const metrics = !m
        ? ''
        : m.written === false
          ? ` · metrics not written (${m.reason || 'no reason given'})`
          : m.path
            ? ` · metrics ${m.path}`
            : ''
      return `gate: passed ${entry.passed} · blocker ${blocker} · warning ${warning} · suggestion ${suggestion} · malformed ${entry.malformed}${metrics}`
    }
    case 'ready':
      return `ready: ready ${entry.ready} · blockers ${entry.blockers}`
    default:
      return `${kind}: not run yet`
  }
}

/**
 * The `/interlock-spec` pane as keyed lines, `{ key, text, bold?, dim? }`
 * (D6): the module maps them onto the engine's `Box` and `Text` and nothing
 * else. No row carries a tick, a colour or a threshold.
 */
export function specPaneLines(spec) {
  if (!spec || spec.phase === 'idle') return [{ key: 'spec-none', text: NO_SPEC_LINE, dim: true }]
  const change = spec.current ? spec.changes.get(spec.current) || {} : {}
  const status = change.status
  const out = []
  const schema = status && !status.unparsed && !status.error && status.schemaName
  out.push({ key: 'spec-header', text: `${spec.current || UNKNOWN_CHANGE}${schema ? ` · schema ${schema}` : ''}`, bold: true })
  if (!status || typeof status.unparsed === 'string' || isString(status.error)) {
    out.push({ key: 'spec-status', text: resultLine('status', status) })
  } else {
    for (const a of status.artifacts) out.push({ key: `spec-artifact-${a.id}`, text: `${a.id} · ${a.status} · ${a.outputPath || '?'}` })
    if (status.applyRequires) out.push({ key: 'spec-apply-requires', text: `applyRequires: ${status.applyRequires.join(', ') || 'none'}` })
  }
  const spawned = spec.explore.spawned
  out.push({
    key: 'spec-explore',
    text: `explore: ${spawned ? `${spawned} investigators spawned` : 'none reported by this host'} · ${
      spec.explore.brief ? `brief ${spec.explore.brief}` : 'no brief written yet'
    }`
  })
  out.push({ key: 'spec-drift', text: resultLine('drift', spec.drift) })
  for (const kind of ['ledger', 'validate', 'gate', 'ready']) {
    out.push({ key: `spec-${kind}`, text: resultLine(kind, change[kind]) })
    if (kind === 'validate' && change.validate && Array.isArray(change.validate.problems)) {
      change.validate.problems.forEach((p, i) => out.push({ key: `spec-validate-problem-${i}`, text: p }))
    }
  }
  out.push({ key: 'spec-autonomy', text: `autonomy: ${spec.autonomy || 'not run yet'}` })
  out.push({ key: 'spec-writes', text: 'writes', bold: true })
  const writes = spec.current ? spec.writes.get(spec.current) : null
  if (!writes || !writes.size) out.push({ key: 'spec-writes-none', text: 'no artifact writes yet', dim: true })
  for (const [file, w] of writes || []) {
    out.push({ key: `spec-write-${file}`, text: `${file} · written ${w.count}× · ${iso(w.at) ? `last ${iso(w.at)}` : 'last time unknown'}` })
  }
  const findings = spec.current ? spec.findings.get(spec.current) : null
  if (findings) out.push({ key: 'spec-findings', text: `findings file: ${findings}` })
  out.push({ key: 'spec-last-activity', text: iso(spec.lastActivityAt) ? `last activity ${iso(spec.lastActivityAt)}` : 'last activity unknown' })
  if (spec.checkpointCrossed) {
    out.push({
      key: 'spec-checkpoint',
      text: iso(spec.checkpointAt) ? `checkpoint reached ${iso(spec.checkpointAt)}` : 'checkpoint reached, time unknown'
    })
  }
  if (spec.handedOver) {
    out.push({
      key: 'spec-handover',
      text: iso(spec.handedOverAt) ? `handed over to ship at ${iso(spec.handedOverAt)}` : 'handed over to ship, time unknown'
    })
  }
  const others = spec.order.filter(name => name !== spec.current)
  if (others.length) out.push({ key: 'spec-other-changes', text: `other changes named this run: ${others.join(', ')}` })
  out.push({ key: 'spec-record', text: SPEC_RECORD_LINE, dim: true })
  return out
}

/** The debug line for a keyed line that crossed when no spec run could draw it (D3). */
export function lateLineText(kind, phase) {
  return phase === 'checkpoint'
    ? `interlock spec: a ${kind} line crossed after the checkpoint; not drawn`
    : `interlock spec: a ${kind} line crossed with no live spec run; not drawn`
}

/** The debug line for a keyed line's result that was not read (D3). */
export function unreadLineText(entry, command) {
  return `interlock spec: ${entry.kind} result not read (${entry.reason}): ${String(command).slice(0, 80)}`
}

/**
 * A spec run record (D7): `phase` is `idle`, `live`, `checkpoint` or
 * `handed-over`. `changes` holds each named change's results; the unnamed
 * slot is `null`'s, never drawn. Writes and findings are filed by directory.
 */
export function freshSpec(flags = {}) {
  return {
    phase: 'idle',
    current: null,
    changes: new Map(),
    order: [],
    explore: { spawned: 0, brief: null },
    drift: null,
    autonomy: null,
    stage: null,
    writes: new Map(),
    findings: new Map(),
    startedAt: null,
    lastActivityAt: null,
    checkpointCrossed: false,
    checkpointAt: null,
    handedOver: false,
    handedOverAt: null,
    clockFailed: false,
    afterBoundary: flags.afterBoundary === true,
    // Whether a keyed line with no run to draw it has been named on the debug log.
    lateNamed: false
  }
}
