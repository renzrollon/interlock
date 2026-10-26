// The settle meter's text rules (observe-the-settle-run-live design D1-D27).
//
// `/interlock:settle --review` is a prose skill that drives `interlock`, `gh`,
// `glab` and `git` through the Bash tool and fans review agents out through
// the Agent tool. The hooks module draws it anyway, from what already crossed
// the engine, and this module holds every rule it draws by: which load starts
// a run (D4), how a compound command is cut into stages (D8), which stages are
// the pass's keyed lines and what each one's result says (D19, D26), which
// section each line opens or joins (D14, D20, D21), and when the run ends
// (D6). The hooks module keeps the record and makes the engine calls; nothing
// here does either.
//
// Every word a row carries is the CLI's: a field it printed, composed from the
// field and never from its prose, an exit code, or a count of events the
// engine raised. A result that cannot be read is said to be unread, with its
// first line, never as a verdict. Nothing here compares a count against a
// number, names a threshold, or keeps a timer.
//
// The record (`freshSettle`) holds, for the lines (this part of the module):
//   phase            'idle' | 'live' | 'done'; the hooks module makes it live
//   startedAt        the clock reading the run went live at (hooks module)
//   endedAt          the clock reading the drift line crossed at
//   change, pr, head the names the CLI's own lines gave, the latest of each
//   depth            the routing line's depth, else the review record's
//   routed           role -> { model, effort } from the pass's routing lines
//   listing          the routing line's review.dimensions, skeptics its
//                    review.skeptics, banners every banner printed, in order
//   groups           the sections opened, in the order they opened:
//                    { key, label, rank, round, openedAt, lastAt, rows }
//   open             the one open group, or null
//   lastRecord       the highest n of a review-r<n>.json record that crossed
//   reviews          n -> { depth, ran, skipped, dimensionStats }
//   agents           the agent tally; the spawn and turn rules fill it
// and a row is { kind, text, words, at }: `text` is the row as the pane draws
// it, `words` the part of it the status line may repeat (null when the row has
// none), `at` the clock reading it crossed at.
//
// The calling forms of the functions below are written at the top of
// test/spine/settle-meter.test.mjs.
//
// It runs inside the engine through `hooks/mod.mjs`, so it is pure and imports
// only its siblings (`test/spine/mod-pins.test.mjs` walks it).

import { clockText, durationText } from './meter-time.mjs'
import { UNKNOWN_CHANGE, findJson, segmentsOf } from './spec-meter.mjs'

export const SETTLE_PANE = 'interlock-settle'
export const SETTLE_TITLE = 'Interlock settle'
export const NO_SETTLE_LINE = 'no settle run is live in this session'
export const SETTLE_UNPLACED_TOAST = '/interlock-settle opens the settle meter'
export const SETTLE_REPLACED_LINE = 'interlock settle: a new settle run replaced the previous one'

/**
 * The sections of a pass, in the order the settle skill runs them (D14). A
 * section only ever opens behind one of lower rank, except a round, which also
 * opens behind an earlier round. `label` is the skill's own section word; a
 * round is drawn `round <n>`.
 */
export const GROUPS = Object.freeze([
  Object.freeze({ key: 'review', label: 'review', rank: 0 }),
  Object.freeze({ key: 'round', label: 'round', rank: 1 }),
  Object.freeze({ key: 'ready', label: 'ready', rank: 2 }),
  Object.freeze({ key: 'conformance', label: 'conformance', rank: 3 }),
  Object.freeze({ key: 'verify', label: 'verify', rank: 4 }),
  Object.freeze({ key: 'checks', label: 'checks', rank: 5 }),
  Object.freeze({ key: 'merge-confidence', label: 'merge confidence', rank: 6 }),
  Object.freeze({ key: 'publish', label: 'publish', rank: 7 }),
  Object.freeze({ key: 'drift', label: 'drift', rank: 8 })
])

const GROUP_BY_KEY = new Map(GROUPS.map(g => [g.key, g]))

/** Every kind `settleLineKind` can answer, in the order of the pass (D19). */
export const SETTLE_KINDS = Object.freeze([
  'routing',
  'surface',
  'domain-context',
  'gate',
  'changes',
  'review-policy',
  'autonomy',
  'note-derive',
  'review',
  'comment',
  'replies',
  'tree-check',
  'test-paths',
  'remediate-brief',
  'fixer-result',
  'git-commit',
  'git-push',
  'ready',
  'conformance-brief',
  'verify',
  'checks',
  'pipeline',
  'merge-confidence',
  'label-names',
  'label-add',
  'label-remove',
  'drift'
])

const SETTLE_VERBS = new Map([
  ['comment', 'comment'],
  ['replies', 'replies'],
  ['tree-check', 'tree-check'],
  ['test-paths', 'test-paths'],
  ['remediate-brief', 'remediate-brief'],
  ['fixer-result', 'fixer-result'],
  ['conformance-brief', 'conformance-brief']
])

/** The `interlock <word>` lines whose word alone names the kind. */
const WORD_KINDS = new Map([
  ['routing', 'routing'],
  ['surface', 'surface'],
  ['domain-context', 'domain-context'],
  ['gate', 'gate'],
  ['changes', 'changes'],
  ['review-policy', 'review-policy'],
  ['review', 'review'],
  ['pipeline', 'pipeline'],
  ['drift', 'drift']
])

const VERIFY_VERBS = new Set(['plan', 'exec', 'judge', 'coverage'])

/** The words of the engine's failed-command prefix line (probe 3 of the spec meter). */
const ENGINE_PREFIX = /^Exit code (\d+)\r?\n?/

const UNPARSED_CUT = 200

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isString = v => typeof v === 'string' && v !== ''
const isCount = v => Number.isInteger(v)
const isDigits = v => typeof v === 'string' && /^\d+$/.test(v)
const sha7 = sha => String(sha).slice(0, 7)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const stringsOf = v => (Array.isArray(v) ? v.filter(isString) : [])

/** A name the CLI could have meant: a non-empty string with no unexpanded `$`, backtick or `<`. */
const nameOf = v => (isString(v) && !/[$`<]/.test(v) ? v : null)
/** A commit id: seven to forty hex digits. */
const headOf = v => (typeof v === 'string' && /^[0-9a-f]{7,40}$/i.test(v) ? v : null)

// --- the load reader (D4) ----------------------------------------------------

/**
 * What a skill load starts: `settle` when the plugin's settle skill is named
 * and its arguments carry the word `--review`, `review` when the review-code
 * skill is named (the run it joins is the settle run's, D21), else `null`.
 * Only the plugin's namespaced names count, a leading `/` dropped, as
 * `skillRole` reads them; that function is left as it is.
 */
export function settleLoad(name, args) {
  if (typeof name !== 'string') return null
  const skill = name.trim().replace(/^\//, '')
  if (skill === 'interlock:review-code') return 'review'
  if (skill !== 'interlock:settle') return null
  if (typeof args !== 'string') return null
  return args.split(/\s+/).includes('--review') ? 'settle' : null
}

// --- the line reader (D8, D19) -------------------------------------------------

/**
 * A stage's words, unquoted: `{ value, plain }` for each, `plain` when no part
 * of the word was quoted. Unlike the spec reader's `argvOf` this does not stop
 * at `<` or `>`, because the skill's own lines carry `<n>` placeholders that
 * the pin reads. Never throws.
 */
function wordsOf(stage) {
  if (typeof stage !== 'string') return []
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
  for (let i = 0; i < stage.length; i++) {
    const c = stage[i]
    if (quote === "'") {
      if (c === "'") quote = null
      else value += c
    } else if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '\\' && i + 1 < stage.length && '"\\$`'.includes(stage[i + 1])) value += stage[++i]
      else value += c
    } else if (c === "'" || c === '"') {
      quote = c
      plain = false
      open = true
    } else if (c === '\\' && i + 1 < stage.length) {
      value += stage[++i]
      open = true
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

/** The plain command words of a stage, as strings. */
const valuesOf = stage => wordsOf(stage).map(w => w.value)

/** The value of `--<flag> v` or `--<flag>=v` in `values`, or `null`. */
function flagValue(values, flag) {
  for (let i = 0; i < values.length; i++) {
    if (values[i] === `--${flag}`) return values[i + 1] === undefined ? null : values[i + 1]
    if (values[i].startsWith(`--${flag}=`)) return values[i].slice(flag.length + 3)
  }
  return null
}

/** Whether `values` carries the flag, bare or with `=`. */
const hasFlag = (values, flag) => values.some(v => v === `--${flag}` || v.startsWith(`--${flag}=`))

/** The positional at `index` when it is not a flag. */
const positional = (values, index) => (values[index] !== undefined && !values[index].startsWith('-') ? values[index] : null)

/** The first `n` words of `values`, joined: the command spelled whole. */
const leadOf = (values, n) => values.slice(0, n).join(' ')

// GitLab's own words, spelled as glab spells them: the settle skill's glab
// lines that carry the pull request's iid, and the flag `glab ci get` names it
// with. Written whole, so the name reads as GitLab's and not as ours.
const GLAB_PULL_LINES = new Set(['glab mr note', 'glab mr update', 'glab mr view'])
const GLAB_IID_FLAG = '--merge-request'.slice(2)

/**
 * The kind of one stage by its first words, after leading whitespace: a keyed
 * kind or `null` (D19). An `interlock` stage is keyed by its verb alone, so a
 * verb nobody keyed has no kind whatever precedes it in a pipe.
 */
export function settleLineKind(stage) {
  const w = valuesOf(stage)
  if (!w.length) return null
  if (w[0] === 'interlock') {
    const verb = w[1]
    if (verb === 'settle') return SETTLE_VERBS.get(w[2]) || null
    if (verb === 'verify') return VERIFY_VERBS.has(w[2]) ? 'verify' : null
    if (verb === 'merge-confidence') return w.includes('--label-names') ? 'label-names' : 'merge-confidence'
    if (verb === 'autonomy') return w[2] === 'record' ? 'autonomy' : null
    if (verb === 'note') return w[2] === 'derive' ? 'note-derive' : null
    return WORD_KINDS.get(verb) || null
  }
  if (w[0] === 'git') {
    if (w[1] === 'commit') return 'git-commit'
    if (w[1] === 'push') return 'git-push'
    return null
  }
  if (w[0] === 'gh' && w[1] === 'pr') {
    if (w[2] === 'ready') return 'ready'
    if (w[2] === 'checks') return hasFlag(w, 'watch') ? 'checks' : null
    if (w[2] === 'edit') {
      if (hasFlag(w, 'add-label')) return 'label-add'
      if (hasFlag(w, 'remove-label')) return 'label-remove'
    }
    return null
  }
  if (leadOf(w, 3) === 'glab mr update') {
    if (hasFlag(w, 'ready')) return 'ready'
    if (hasFlag(w, 'unlabel')) return 'label-remove'
    if (hasFlag(w, 'label')) return 'label-add'
    return null
  }
  if (leadOf(w, 3) === 'glab ci get') return hasFlag(w, GLAB_IID_FLAG) ? 'checks' : null
  return null
}

/** Whether a piece of a cut command carries nothing but quotes, parentheses and space. */
const isJunk = text => /^[\s"'()]*$/.test(text)

/**
 * One top-level segment cut into stages (D8): at an unquoted `|`, `||`, `&&`,
 * `;` or line break, and at `$(` (a `$(` inside double quotes included, since
 * the GitLab lines are written `--message "$(interlock …)"`), the stage inside
 * a `$( )` ending at its closing parenthesis. A quoted heredoc's body is one
 * argument: from an unquoted `<<` the rest of the segment is not cut again.
 * Each stage is `{ text, sub, pipedAfter }`. Never throws.
 */
function cutStages(segment) {
  const stages = []
  const frames = []
  let cur = ''
  let quote = null
  const flush = pipedAfter => {
    const text = cur.trim()
    cur = ''
    if (!isJunk(text)) stages.push({ text, sub: frames.length > 0, pipedAfter })
  }
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]
    const next = segment[i + 1]
    if (quote === "'") {
      cur += c
      if (c === "'") quote = null
      continue
    }
    if (c === '\\' && i + 1 < segment.length) {
      cur += c + next
      i++
      continue
    }
    if (quote === '"') {
      if (c === '"') {
        quote = null
        cur += c
      } else if (c === '$' && next === '(') {
        flush(false)
        frames.push({ quote: '"', depth: 0 })
        quote = null
        i++
      } else {
        cur += c
      }
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      cur += c
    } else if (c === '$' && next === '(') {
      flush(false)
      frames.push({ quote: null, depth: 0 })
      i++
    } else if (c === '<' && next === '<' && segment[i + 2] !== '<') {
      cur += segment.slice(i)
      break
    } else if (c === '#' && (cur === '' || /\s$/.test(cur))) {
      const stop = segment.indexOf('\n', i)
      const to = stop === -1 ? segment.length : stop
      cur += segment.slice(i, to)
      i = to - 1
    } else if (c === '(' && frames.length) {
      frames[frames.length - 1].depth++
      cur += c
    } else if (c === ')' && frames.length) {
      const frame = frames[frames.length - 1]
      if (frame.depth > 0) {
        frame.depth--
        cur += c
      } else {
        flush(false)
        quote = frames.pop().quote
      }
    } else if (c === '|' && next === '|') {
      flush(false)
      i++
    } else if (c === '&' && next === '&') {
      flush(false)
      i++
    } else if (c === '|') {
      flush(true)
    } else if (c === ';' || c === '\n') {
      flush(false)
    } else {
      cur += c
    }
  }
  flush(false)
  return stages
}

/**
 * Every stage of a command, in the command's order, as `{ kind, segment, last }`
 * (D8): `kind` is the stage's keyed kind or `null`, `segment` its text, and
 * `last` whether it is the final stage of a top-level pipeline, the one whose
 * stdout is the call's result. Never throws.
 */
export function settleLines(command) {
  const out = []
  for (const segment of segmentsOf(command)) {
    for (const stage of cutStages(segment)) {
      out.push({ kind: settleLineKind(stage.text), segment: stage.text, last: !stage.sub && !stage.pipedAfter })
    }
  }
  return out
}

/** Whether a stage sends its stdout to a file: an unquoted `>` that is not a bare stderr redirect. */
function hasRedirect(text) {
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"') i++
      continue
    }
    if (c === "'" || c === '"') quote = c
    else if (c === '\\') i++
    else if (c === '>') {
      if (text[i - 1] === '<') continue
      if (/[2-9]/.test(text[i - 1] || '')) continue
      return true
    }
  }
  return false
}

// --- the record --------------------------------------------------------------

/**
 * A settle run record (D12): `phase` is `idle`, `live` or `done`. The hooks
 * module makes it live; everything else here only files into it.
 */
export function freshSettle(flags = {}) {
  return {
    phase: 'idle',
    startedAt: null,
    endedAt: null,
    change: null,
    pr: null,
    head: null,
    depth: null,
    routed: new Map(),
    listing: null,
    skeptics: null,
    banners: [],
    groups: [],
    open: null,
    lastRecord: null,
    reviews: new Map(),
    agents: new Map(),
    afterBoundary: flags.afterBoundary === true,
    // Whether a keyed line with no run to draw it has been named on the debug log.
    lateNamed: false
  }
}

/** The group open now, or `null`. */
export const currentGroup = settle => (isObject(settle) && settle.open ? settle.open : null)

/** The group of this key (and round, for a round), or `null`. */
export function findGroup(settle, key, round = null) {
  if (!isObject(settle) || !Array.isArray(settle.groups)) return null
  return settle.groups.find(g => g.key === key && (key !== 'round' || g.round === round)) || null
}

function openGroup(settle, key, round, at) {
  const def = GROUP_BY_KEY.get(key)
  const group = {
    key,
    label: key === 'round' ? `round ${round}` : def.label,
    rank: def.rank,
    round: key === 'round' ? round : null,
    openedAt: at,
    lastAt: at,
    rows: []
  }
  settle.groups.push(group)
  settle.open = group
  return group
}

/**
 * The group a line files into (D14): the line's own section when it ranks
 * above the one open, or is a later round, else the one open; a line with no
 * section of its own (`target` null) files into the one open, which the first
 * such line opens as `review`. A `soft` round target (the brief, the result:
 * lines that name a round but are not what starts one) opens its round only
 * from before the rounds, never from behind an earlier round: a round after
 * the first is opened by its own tree-check.
 */
function place(settle, target, at) {
  const open = settle.open
  if (target === null) return open || openGroup(settle, 'review', null, at)
  if (!open) return openGroup(settle, target.key, target.round ?? null, at)
  const rank = GROUP_BY_KEY.get(target.key).rank
  if (rank > open.rank) return openGroup(settle, target.key, target.round ?? null, at)
  if (rank === open.rank && target.key === 'round' && !target.soft && target.round > open.round) return openGroup(settle, target.key, target.round, at)
  return open
}

function file(group, kind, text, words, at) {
  group.rows.push({ kind, text, words: words ?? null, at })
  if (Number.isFinite(at)) group.lastAt = at
}

// --- reading one stage's result --------------------------------------------------

/** The first non-empty line of a text, cut. */
function firstLine(text) {
  const line = (typeof text === 'string' ? text : '')
    .split('\n')
    .map(l => l.trim())
    .find(Boolean)
  return line && line.length > UNPARSED_CUT ? line.slice(0, UNPARSED_CUT) : line || ''
}

/**
 * What a Bash tool result says, as the engine raised it: the text the command
 * printed (`body`, past the engine's failed-command line), the exit code (0
 * unless the engine marked the call errored), and whether the engine kept the
 * output out of line.
 */
function outcomeOf(r) {
  const result = isObject(r) ? r : {}
  const tooLarge = isObject(result.result) && isString(result.result.persistedOutputPath)
  let text = null
  if (isObject(result.result) && typeof result.result.stdout === 'string') text = result.result.stdout
  else if (typeof result.text === 'string') text = result.text
  let exit = 0
  let body = text
  if (result.isError === true) {
    exit = 1
    const m = text === null ? null : text.match(ENGINE_PREFIX)
    if (m) {
      exit = Number(m[1])
      body = text.slice(m[0].length)
    }
  }
  return { body, exit, tooLarge }
}

/** The one JSON object a body printed: `{ value }` or `{ problem }`. */
function readJson(body) {
  const found = findJson(body)
  if (found.value) return found
  try {
    const value = JSON.parse(String(body).trim())
    if (isObject(value)) return { value }
  } catch {
    // not JSON; the problem below says so
  }
  return { problem: found.problem }
}

const bare = (word, outcome, note) => `${word} exit ${outcome.exit}${note ? ` · ${note}` : ''}`
/** The row for a stage whose result is not drawn from its text: the exit code, and why the text is not read when the engine kept it out of line. */
const plainRow = (word, outcome) => bare(word, outcome, outcome.tooLarge ? 'result not seen (too large)' : '')

/**
 * The JSON a stage printed, or the reason it is not read: `{ value }`, or
 * `{ row: { text, words } }` for a stage whose result is not drawn from its
 * fields (not the pipeline's stdout, too large, redirected to a file), or
 * `{ problem }` for a result that is not JSON.
 */
function jsonOf(word, stage, outcome) {
  if (outcome.tooLarge) return { row: { text: bare(word, outcome, 'result not seen (too large)'), words: null } }
  if (!stage.last) return { row: { text: bare(word, outcome), words: null } }
  if (outcome.body === null) return { problem: 'no result text' }
  if (outcome.body.trim() === '' && hasRedirect(stage.segment)) {
    return { row: { text: bare(word, outcome, 'result not seen (redirected)'), words: null } }
  }
  return readJson(outcome.body)
}

// --- the keyed lines (D19, D26) ------------------------------------------------

const BARE_WORDS = new Map([
  ['surface', 'surface'],
  ['domain-context', 'domain-context'],
  ['gate', 'gate'],
  ['changes', 'changes'],
  ['review-policy', 'review-policy'],
  ['autonomy', 'autonomy record'],
  ['note-derive', 'note derive']
])

/** The label names a label line carries, as the pane draws them. */
function labelNames(values) {
  const flag = ['add-label', 'remove-label', 'label', 'unlabel'].find(f => hasFlag(values, f))
  const raw = flag ? flagValue(values, flag) : null
  return (raw || '')
    .split(',')
    .map(n => n.trim())
    .filter(Boolean)
    .join(', ')
}

/** The first line of a failed command's output that carries a `STOP: ` word, from the word on. */
function stopLine(body) {
  for (const line of String(body || '').split('\n')) {
    const at = line.indexOf('STOP: ')
    if (at !== -1) return line.slice(at).trim()
  }
  return null
}

/** The round a line names with `--round`, or `null`. */
function roundOf(values) {
  const v = flagValue(values, 'round')
  return isDigits(v) ? Number(v) : null
}

/** The pull request number a gh or glab stage carries, or `null` (D19). */
function pullOf(values) {
  if (values[0] === 'gh' && values[1] === 'pr' && isDigits(values[3])) return Number(values[3])
  if (GLAB_PULL_LINES.has(leadOf(values, 3)) && isDigits(values[3])) return Number(values[3])
  if (values[0] === 'glab' && values[1] === 'ci') {
    const iid = flagValue(values, GLAB_IID_FLAG)
    return isDigits(iid) ? Number(iid) : null
  }
  return null
}

/** Files what a stage's argv names: the change, the pull request, the head (spec requirement 1). */
function nameFromArgv(settle, kind, values) {
  if (values[0] !== 'interlock') return
  let change = flagValue(values, 'change')
  if (!nameOf(change)) {
    change = null
    if (kind === 'conformance-brief') change = positional(values, 3)
    else if (kind === 'merge-confidence' || kind === 'domain-context') change = positional(values, 2)
    else if (kind === 'review') change = flagValue(values, 'metrics')
  }
  if (nameOf(change)) settle.change = change
  const pr = flagValue(values, 'pr')
  if (isDigits(pr)) settle.pr = Number(pr)
  const head = headOf(flagValue(values, 'head'))
  if (head) settle.head = head
}

/** Files what a result's JSON names: `change`, `pr`, `head` or `head.sha`. */
function nameFromValue(settle, value) {
  if (nameOf(value.change)) settle.change = value.change
  if (isDigits(String(value.pr))) settle.pr = Number(value.pr)
  const head = headOf(value.head) || (isObject(value.head) ? headOf(value.head.sha) : null)
  if (head) settle.head = head
}

/** Notes a review record's number, once it has crossed. */
function noteRecord(settle, values) {
  const out = flagValue(values, 'out')
  const m = out ? out.match(/review-r(\d+)\.json$/) : null
  if (!m) return null
  const n = Number(m[1])
  if (settle.lastRecord === null || n > settle.lastRecord) settle.lastRecord = n
  return n
}

const unreadLine = (word, reason, command) => `interlock settle: ${word} result not read (${reason}): ${String(command).slice(0, 80)}`

/**
 * The debug line for a keyed line that crossed when no settle run could draw
 * it (D6): after the drift line, or with no run live.
 */
export function lateSettleLineText(kind, phase) {
  return phase === 'done'
    ? `interlock settle: a ${kind} line crossed after the run was done; not drawn`
    : `interlock settle: a ${kind} line crossed with no live settle run; not drawn`
}

/**
 * Files one Bash call into the settle record (spec requirement 2): every stage
 * of `input.command`, in the command's order, that is a keyed line, read from
 * the call's `result` and filed in the section it opens or joins. Returns the
 * toasts the call raises (`toasts`, texts) and the lines for the debug log
 * (`debug`); the caller shows them. A call with no keyed stage, or a record
 * with no live run, files nothing. Never throws on a result it cannot read.
 */
export function applySettleLines(settle, input, result, at) {
  const out = { toasts: [], debug: [] }
  if (!isObject(settle)) return out
  const command = isObject(input) ? input.command : null
  const stages = settleLines(command)
  const keyed = stages.filter(s => s.kind !== null)
  if (!keyed.length) return out
  if (settle.phase !== 'live') {
    const late = settle.phase === 'done' || settle.afterBoundary
    if (late && !settle.lateNamed) {
      settle.lateNamed = true
      out.debug.push(lateSettleLineText(keyed[0].kind, settle.phase))
    }
    return out
  }
  const outcome = outcomeOf(result)
  const background = isObject(input) && input.run_in_background === true
  for (const stage of stages) {
    const pull = pullOf(valuesOf(stage.segment))
    if (pull !== null) settle.pr = pull
  }
  for (let i = 0; i < keyed.length; i++) {
    const stage = keyed[i]
    const values = valuesOf(stage.segment)
    nameFromArgv(settle, stage.kind, values)
    const followedByPush = stage.kind === 'git-commit' && keyed[i + 1] && keyed[i + 1].kind === 'git-push'
    fileStage(settle, out, { stage, values, outcome, background, at, command, followedByPush })
    if (followedByPush) i++
    if (settle.phase === 'done') break
  }
  return out
}

/** Files one keyed stage: the row it draws, the section it opens, and what it names. */
function fileStage(settle, out, ctx) {
  const { stage, values, outcome, background, at, command } = ctx
  const kind = stage.kind
  const into = (target, text, words) => file(place(settle, target, at), kind, text, words, at)
  const unparsed = (target, word, reason) => {
    const line = firstLine(outcome.body)
    const label = `${word} (unparsed)`
    into(target, `${label}${line ? ` · ${line}` : ''}`, label)
    out.debug.push(unreadLine(word, reason, command))
  }

  switch (kind) {
    case 'routing': {
      const word = positionalRole(values)
      // The worker's routing line opens its section once the pass is past the review: before any round, a
      // routing lookup is the review's own, and the conformance brief opens the section by itself.
      const target = word === 'settle-conformance' && settle.open && settle.open.rank > 0 ? { key: 'conformance' } : null
      const read = jsonOf('routing', stage, outcome)
      if (read.row) return into(target, read.row.text, null)
      if (!read.value) return unparsed(target, 'routing', read.problem)
      const filed = fileRouting(settle, read.value, word)
      if (!filed) return unparsed(target, 'routing', 'fields missing')
      if (isString(read.value.depth)) settle.depth = read.value.depth
      return into(target, filed, null)
    }
    case 'surface':
    case 'domain-context':
    case 'gate':
    case 'changes':
    case 'review-policy':
    case 'autonomy':
    case 'note-derive':
      return into(null, bare(BARE_WORDS.get(kind), outcome), null)
    case 'review':
      return fileReview(settle, out, ctx, into, unparsed)
    case 'comment': {
      const round = roundOf(values)
      return into(null, `comment${round === null ? '' : ` round ${round}`} · exit ${outcome.exit}`, null)
    }
    case 'replies':
      return into(null, bare('replies', outcome), null)
    case 'tree-check':
      return fileTreeCheck(settle, ctx, into, unparsed)
    case 'test-paths':
      return fileTestPaths(ctx, into, unparsed)
    case 'remediate-brief':
      return fileBrief(settle, out, ctx, unparsed)
    case 'fixer-result': {
      const round = roundOf(values)
      const target = round === null ? null : { key: 'round', round, soft: true }
      const m = stage.last && outcome.body !== null ? outcome.body.match(/^round (\d+): (.+)$/m) : null
      if (!m) {
        if (!stage.last || outcome.body === null || outcome.tooLarge) return into(target, plainRow('fixer-result', outcome), null)
        return unparsed(target, 'fixer-result', 'no result line')
      }
      return into(target ?? { key: 'round', round: Number(m[1]), soft: true }, m[0].trim(), m[2].trim())
    }
    case 'git-commit': {
      const open = settle.open
      if (!open || open.key !== 'round') return
      const subject = commitSubject(values)
      let text = `commit${subject ? ` ${subject}` : ''}`
      if (ctx.followedByPush) text += ` · push exit ${outcome.exit}`
      else if (outcome.exit !== 0) text += ` · exit ${outcome.exit}`
      return file(open, kind, text, null, at)
    }
    case 'git-push': {
      const open = settle.open
      if (!open || open.key !== 'round') return
      return file(open, kind, `push exit ${outcome.exit}`, null, at)
    }
    case 'ready':
      return into({ key: 'ready' }, `${values.slice(0, values[0] === 'gh' ? 4 : 5).join(' ')} · exit ${outcome.exit}`, null)
    case 'conformance-brief': {
      const line = outcome.exit !== 0 ? firstLine(outcome.body) : ''
      return into({ key: 'conformance' }, bare('conformance-brief', outcome, line), null)
    }
    case 'verify': {
      const sub = values[2]
      const word = sub === 'exec' ? `exec ${flagValue(values, 'kind') || '?'}` : sub
      const note = hasRedirect(stage.segment) ? 'result not seen (redirected)' : ''
      return into({ key: 'verify' }, bare(word, outcome, note), null)
    }
    case 'checks': {
      const words = values.slice(0, 5).join(' ')
      return into({ key: 'checks' }, `${words} · ${background ? 'background' : `exit ${outcome.exit}`}`, null)
    }
    case 'pipeline': {
      const target = { key: 'merge-confidence' }
      const m = stage.last && outcome.body !== null ? outcome.body.match(/^(pipeline|pending) ([0-9a-f]{7,40}):.*$/m) : null
      if (!m) {
        if (!stage.last || outcome.body === null || outcome.tooLarge) return into(target, plainRow('pipeline', outcome), null)
        return unparsed(target, 'pipeline', 'no pipeline line')
      }
      return into(target, m[0].trim(), `${m[1]} ${sha7(m[2])}`)
    }
    case 'merge-confidence':
      return fileMergeConfidence(settle, out, ctx, unparsed)
    case 'label-names': {
      const target = { key: 'publish' }
      const read = jsonOf('label-names', stage, outcome)
      if (read.row) return into(target, read.row.text, null)
      const labels = read.value && isObject(read.value.labels) ? read.value.labels : null
      if (!labels || !Array.isArray(labels.verdictNames) || !isString(labels.scorePrefix)) {
        return unparsed(target, 'label-names', read.problem || 'fields missing: labels.verdictNames, labels.scorePrefix')
      }
      return into(target, `label names ${stringsOf(labels.verdictNames).join(', ')} · score prefix ${labels.scorePrefix}`, null)
    }
    case 'label-add':
    case 'label-remove': {
      const names = labelNames(values)
      const text = `${kind === 'label-add' ? 'labels' : 'removed'} ${names}`.trim()
      return into({ key: 'publish' }, outcome.exit !== 0 ? `${text} · exit ${outcome.exit}` : text, null)
    }
    case 'drift': {
      const target = { key: 'drift' }
      const read = jsonOf('drift', stage, outcome)
      if (read.row) into(target, read.row.text, null)
      else {
        const stale = read.value && isObject(read.value.stale) ? read.value.stale : null
        if (read.value && Array.isArray(read.value.unarchived) && stale && Array.isArray(stale.broken)) {
          nameFromValue(settle, read.value)
          into(target, `unarchived ${read.value.unarchived.length} · broken ${stale.broken.length}`, null)
        } else {
          unparsed(target, 'drift', read.problem || 'fields missing: unarchived, stale.broken')
        }
      }
      settle.phase = 'done'
      settle.endedAt = at
      return
    }
    default:
  }
}

/** The role a `routing <role>` line names in its argv: the first word that is not a flag or a flag's value. */
function positionalRole(values) {
  for (let i = 2; i < values.length; i++) {
    if (values[i] === '--depth') i++
    else if (!values[i].startsWith('-')) return values[i]
  }
  return null
}

/** Files one routing line's figures into the record and answers its row text, or `null` when it lacks them. */
function fileRouting(settle, value, roleArg) {
  const figure = v => ({ model: isString(v && v.model) ? v.model : null, effort: isString(v && v.effort) ? v.effort : null })
  const banners = stringsOf(value.banners)
  const addBanners = () => {
    for (const b of banners) if (!settle.banners.includes(b)) settle.banners.push(b)
  }
  const role = roleArg || (isString(value.role) ? value.role : null)
  if (role) {
    if (!('model' in value) && !('effort' in value)) return null
    settle.routed.set(role, figure(value))
    addBanners()
    const f = settle.routed.get(role)
    return `routing ${role} · ${f.model ?? '—'} · ${f.effort ?? '—'}`
  }
  if (!isObject(value.roles)) return null
  for (const [name, entry] of Object.entries(value.roles)) settle.routed.set(name, figure(entry))
  if (isObject(value.review)) {
    if (Array.isArray(value.review.dimensions)) settle.listing = stringsOf(value.review.dimensions)
    if (isString(value.review.skeptics)) settle.skeptics = value.review.skeptics
  }
  addBanners()
  return isString(value.depth) ? `routing · depth ${value.depth}` : 'routing'
}

function fileReview(settle, out, ctx, into, unparsed) {
  const { stage, values, outcome } = ctx
  const read = jsonOf('review', stage, outcome)
  if (read.row) return into(null, read.row.text, null)
  const v = read.value
  const counts = v && isObject(v.counts) ? v.counts : null
  if (!counts || !isCount(counts.raised) || !isCount(counts.dismissed) || !isCount(counts.surviving)) {
    return unparsed(null, 'review', read.problem || 'fields missing: counts.raised, counts.dismissed, counts.surviving')
  }
  nameFromValue(settle, v)
  const dims = isObject(v.dimensions) ? v.dimensions : {}
  if (isString(dims.depth)) settle.depth = dims.depth
  const n = noteRecord(settle, values)
  if (n !== null) {
    settle.reviews.set(n, {
      depth: isString(dims.depth) ? dims.depth : null,
      ran: stringsOf(dims.ran),
      skipped: stringsOf(dims.skipped),
      dimensionStats: isObject(v.dimensionStats) ? v.dimensionStats : {}
    })
  }
  const words = [`${counts.raised} raised`, `${counts.dismissed} dismissed`, `${counts.surviving} surviving`]
  if (isCount(counts.carried)) words.push(`${counts.carried} carried`)
  const head = headOf(v.head) || headOf(flagValue(values, 'head'))
  return into(null, `${words.join(' · ')}${head ? ` · head ${sha7(head)}` : ''}`, words.join(' · '))
}

function fileTreeCheck(settle, ctx, into, unparsed) {
  const { stage, outcome } = ctx
  const target = settle.lastRecord !== null ? { key: 'round', round: settle.lastRecord + 1 } : null
  if (!stage.last || outcome.body === null || outcome.tooLarge) return into(target, plainRow('tree-check', outcome), null)
  const lines = outcome.body.split('\n').map(l => l.replace(/\s+$/, ''))
  const head = lines.find(l => l.trim() !== '')
  if (head === undefined) return into(target, plainRow('tree-check', outcome), null)
  const text = head.trim()
  if (/^clean\b/.test(text)) return into(target, `tree-check ${text} · exit ${outcome.exit}`, null)
  if (/^dirty \(\d+\):/.test(text)) {
    const paths = lines
      .slice(lines.indexOf(head) + 1)
      .map(l => l.trim())
      .filter(Boolean)
    return into(target, `tree-check ${text}${paths.length ? ` ${paths.join(', ')}` : ''} · exit ${outcome.exit}`, null)
  }
  return unparsed(target, 'tree-check', 'neither clean nor dirty')
}

function fileTestPaths(ctx, into, unparsed) {
  const { stage, values, outcome } = ctx
  if (!hasFlag(values, 'json')) return into(null, bare('test-paths', outcome), null)
  const read = jsonOf('test-paths', stage, outcome)
  if (read.row) return into(null, read.row.text, null)
  const v = read.value
  if (!v || !Array.isArray(v.protected) || !Array.isArray(v.unprotected)) {
    return unparsed(null, 'test-paths', read.problem || 'fields missing: protected, unprotected')
  }
  if (v.profile === null && isString(v.reason)) return into(null, `test-paths · ${v.reason}`, null)
  const paths = stringsOf(v.protected)
  return into(null, `test-paths ${v.protected.length} protected · ${v.unprotected.length} unprotected${paths.length ? ` · ${paths.join(', ')}` : ''}`, null)
}

function fileBrief(settle, out, ctx, unparsed) {
  const { stage, values, outcome, command } = ctx
  const argRound = roundOf(values)
  const into = (round, text, words) => file(place(settle, round === null ? null : { key: 'round', round, soft: true }, ctx.at), 'remediate-brief', text, words, ctx.at)
  if (outcome.exit !== 0) {
    const stop = stopLine(outcome.body)
    if (stop) {
      out.toasts.push(stop)
      return into(argRound, stop, 'STOP')
    }
    return unparsed(argRound === null ? null : { key: 'round', round: argRound, soft: true }, 'remediate-brief', 'no STOP line')
  }
  const read = jsonOf('remediate-brief', stage, outcome)
  if (read.row) return into(argRound, read.row.text, null)
  const v = read.value
  if (!v || !Array.isArray(v.findings) || !Array.isArray(v.deferred)) {
    out.debug.push(unreadLine('remediate-brief', read.problem || 'fields missing: findings, deferred', command))
    const line = firstLine(outcome.body)
    return into(argRound, `remediate-brief (unparsed)${line ? ` · ${line}` : ''}`, 'remediate-brief (unparsed)')
  }
  nameFromValue(settle, v)
  const round = argRound ?? (isCount(v.round) ? v.round : null)
  const words = `${plural(v.findings.length, 'finding', 'findings')} · ${v.deferred.length} deferred`
  const dims = stringsOf(v.reReviewDimensions)
  return into(round, `brief ${words}${dims.length ? ` · re-review ${dims.join(', ')}` : ''}`, words)
}

function fileMergeConfidence(settle, out, ctx, unparsed) {
  const { stage, values, outcome } = ctx
  const target = { key: 'merge-confidence' }
  const into = (text, words) => file(place(settle, target, ctx.at), 'merge-confidence', text, words, ctx.at)
  if (hasFlag(values, 'markdown')) return into(`merge-confidence --markdown · exit ${outcome.exit}`, null)
  const read = jsonOf('merge-confidence', stage, outcome)
  if (read.row) return into(read.row.text, null)
  const v = read.value
  if (!v || !isString(v.verdict) || typeof v.score !== 'number') {
    return unparsed(target, 'merge-confidence', read.problem || 'fields missing: verdict, score')
  }
  nameFromValue(settle, v)
  const head = isObject(v.head) ? headOf(v.head.sha) : null
  const words = `${v.verdict} ${v.score}`
  out.toasts.push(`merge-confidence: ${words}`)
  return into(`${words}${head ? ` · head ${sha7(head)}` : ''}`, words)
}

/** The first line of the message a `git commit` names with `-m`, or `''`. */
function commitSubject(values) {
  for (let i = 0; i < values.length; i++) {
    let message = null
    if (values[i] === '-m' || values[i] === '--message') message = values[i + 1]
    else if (values[i].startsWith('--message=')) message = values[i].slice(10)
    if (typeof message === 'string') return message.split('\n')[0].trim()
  }
  return ''
}

// --- the role matcher (D1) ---------------------------------------------------

/** The first line `assembleSettleRemediatePrompt` prints (lib/prompts/settle-remediate.mjs). */
const FIXER_LINE = /^Fix round (\d+) for change "[^"]+", .+, at head \S+\.$/
/** The first line `interlock settle conformance-brief` prints (lib/settle-cli.mjs). */
const WORKER_LINE = /^Confirm change "[^"]+" against its diff at head \S+\.$/
/** The heading each bundled brief under skills/review-code/dimensions/ opens with. */
const DIMENSION_LINE = /^# Dimension: (\S.*)$/
/** The first sentences of review-code's two skeptic blockquotes, handed to the agent verbatim. */
const SKEPTICS = Object.freeze([
  Object.freeze({ sentence: 'You are a skeptical code reviewer.', label: 'refute' }),
  Object.freeze({ sentence: 'You are an independent reviewer giving a second opinion.', label: 'second opinion' })
])

/** Whether `line` opens with the whole of `sentence`: nothing before it, and a space or the line's end after it. */
const opensWith = (line, sentence) => line.startsWith(sentence) && (line.length === sentence.length || /\s/.test(line[sentence.length]))

/**
 * The role a spawn's prompt names (D1): `{ role: 'fixer', round }` or
 * `{ role: 'conformance' }` when the first non-blank line is the line the CLI
 * printed for it; else, read from the top and stopping at the first match,
 * `{ role: 'dimension', label }` for a `# Dimension: <words>` line or
 * `{ role: 'skeptic', label }` for a skeptic's opening sentence; else `null`.
 * Each match is a whole line, after leading space: a source quoted inside a
 * sentence never matches. The CLI-printed lines win, so a fixer brief quoting
 * a finding is still the fixer; reading past the first line is what keeps a
 * repository policy block, prepended to a reviewer's brief, from hiding it.
 */
export function roleOf(prompt) {
  if (typeof prompt !== 'string') return null
  const lines = prompt.split('\n').map(l => l.trim())
  const first = lines.find(Boolean)
  if (first === undefined) return null
  const fixer = first.match(FIXER_LINE)
  if (fixer) return { role: 'fixer', round: Number(fixer[1]) }
  if (WORKER_LINE.test(first)) return { role: 'conformance' }
  for (const line of lines) {
    const dimension = line.match(DIMENSION_LINE)
    if (dimension) return { role: 'dimension', label: dimension[1].trim() }
    const skeptic = SKEPTICS.find(s => opensWith(line, s.sentence))
    if (skeptic) return { role: 'skeptic', label: skeptic.label }
  }
  return null
}

// --- the agent record (D12, D22, D3, D2, D23) ----------------------------------

/** The `interlock routing` role whose figure each attributed role draws (the living spawn-routing spec's keys). */
const ROUTING_ROLE = Object.freeze({
  dimension: 'review-dimension',
  skeptic: 'review-skeptic',
  fixer: 'settle-fixer',
  conformance: 'settle-conformance'
})

const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']
const isTime = v => typeof v === 'number' && Number.isFinite(v)

/** An agent's name on its row and in its toast: its role's words, or its type and `unattributed` (D9). */
function agentName(a) {
  switch (a.role) {
    case 'dimension':
      return a.label
    case 'skeptic':
      return `skeptic (${a.label})`
    case 'fixer':
      return 'fixer'
    case 'conformance':
      return 'conformance'
    default:
      return `${a.subagentType || 'agent'} · unattributed`
  }
}

/**
 * Files one `agent.spawn` the engine let through into a live run's tally
 * (D12): its role read off its prompt (D1), the section it joins (D22: the
 * fixer the round its first line names, the conformance worker its own
 * section, every other agent the section open), the model the call named or
 * `inherit` and the model the engine resolved (D3). The Agent call's
 * description is never kept. Answers the record, or `null` when nothing was
 * filed. Never throws on an input it cannot read.
 */
export function noteSettleSpawn(settle, input, spawned, at) {
  if (!isObject(settle) || settle.phase !== 'live') return null
  const id = isObject(spawned) && isString(spawned.agentId) ? spawned.agentId : null
  if (!id) return null
  const call = isObject(input) ? input : {}
  const found = roleOf(call.prompt)
  let group
  if (found && found.role === 'fixer') group = findGroup(settle, 'round', found.round) || place(settle, { key: 'round', round: found.round, soft: true }, at)
  else if (found && found.role === 'conformance') group = place(settle, { key: 'conformance' }, at)
  else group = place(settle, null, at)
  const record = {
    id,
    role: found ? found.role : null,
    label: found && isString(found.label) ? found.label : null,
    subagentType: isString(call.subagentType) ? call.subagentType : null,
    group: group.label,
    round: group.round,
    requested: isString(call.model) ? call.model : 'inherit',
    resolved: isObject(spawned) && isString(spawned.model) ? spawned.model : null,
    served: [],
    stepEffort: null,
    firstStepEffort: null,
    requests: 0,
    known: 0,
    partial: false,
    sums: null,
    firstAt: isTime(at) ? at : null,
    lastAt: isTime(at) ? at : null,
    endAt: null,
    durationMs: null,
    reason: null,
    ended: false,
    endToasted: false
  }
  settle.agents.set(id, record)
  return record
}

/** Field by field: a field one request omitted leaves that figure unknown (`null`), never a guessed zero. */
function addUsage(a, usage) {
  a.requests++
  if (!isObject(usage)) {
    a.partial = true
    return
  }
  a.known++
  if (!a.sums) a.sums = Object.fromEntries(TOKEN_FIELDS.map(f => [f, 0]))
  for (const f of TOKEN_FIELDS) a.sums[f] = a.sums[f] === null || typeof usage[f] !== 'number' ? null : a.sums[f] + usage[f]
  if (isString(usage.model) && !a.served.includes(usage.model)) a.served.push(usage.model)
}

/**
 * Files one `turn.step` of a settle agent (D12, D23): a request, the tokens
 * and model its result reported, the level the engine stepped it at (the
 * latest, the first kept), and the clock reading its elapsed figure runs to.
 * An agent the tally does not hold is not this run's. Answers the record or `null`.
 */
export function noteSettleStep(settle, input, result, at) {
  if (!isObject(settle) || settle.phase !== 'live' || !isObject(input) || !isString(input.agentId)) return null
  const a = settle.agents.get(input.agentId)
  if (!a) return null
  if (isString(input.effort)) {
    if (a.firstStepEffort === null) a.firstStepEffort = input.effort
    a.stepEffort = input.effort
  }
  addUsage(a, isObject(result) ? result.usage : null)
  if (isTime(at)) a.lastAt = a.lastAt === null ? at : Math.max(a.lastAt, at)
  return a
}

/**
 * Files a settle agent's turn end (D12, D15): the host's own reason word, its
 * duration and the clock reading. Answers `{ toasts }`: one toast, in the
 * host's word, the first time an agent's turn ends with a reason other than
 * `answer`. The caller shows it.
 */
export function noteSettleEnd(settle, input, at) {
  const out = { toasts: [] }
  if (!isObject(settle) || settle.phase !== 'live' || !isObject(input) || !isString(input.agentId)) return out
  const a = settle.agents.get(input.agentId)
  if (!a) return out
  a.ended = true
  a.reason = isString(input.reason) ? input.reason : null
  a.durationMs = isTime(input.durationMs) && input.durationMs >= 0 ? input.durationMs : null
  a.endAt = isTime(at) ? at : null
  if (a.reason && a.reason !== 'answer' && !a.endToasted) {
    a.endToasted = true
    out.toasts.push(`${agentName(a)}: ${a.reason}`)
  }
  return out
}

/**
 * A review-code Skill load during a live run (D21): it changes no section, and
 * only opens `review` when it is the run's first event. Answers nothing.
 */
export function noteSettleSkill(settle, at) {
  if (isObject(settle) && settle.phase === 'live' && !settle.open) place(settle, null, at)
}

// --- the status line (D25, D5) ------------------------------------------------

const MERGE_RANK = GROUP_BY_KEY.get('merge-confidence').rank

/** How long an agent has run: its turn's duration once it ended, else from its spawn to its latest step. */
function elapsedOf(a) {
  if (a.ended && isTime(a.durationMs)) return a.durationMs
  const to = a.ended && isTime(a.endAt) ? a.endAt : a.lastAt
  return isTime(a.firstAt) && isTime(to) ? Math.max(0, to - a.firstAt) : null
}

/** The agents filed under a group, in the order they spawned. */
const agentsOf = (settle, group) => [...settle.agents.values()].filter(a => a.group === group.label)

/**
 * The group the status line names (D25): the one open, except that from the
 * merge-confidence section on the line keeps the last section that ranks no
 * later than it, so `publish` and `drift` never retarget it.
 */
function statusGroup(settle) {
  const open = currentGroup(settle)
  if (!open || open.rank <= MERGE_RANK) return open
  const kept = settle.groups.filter(g => g.rank <= MERGE_RANK)
  return kept.length ? kept[kept.length - 1] : open
}

/**
 * A group's figure (D25): while attributed agents of the group run, the
 * longest-running one (`<k> live · ` before it when several run); else the
 * last words a row of the group carries, or the last row itself when none
 * carries words. An unattributed agent never takes the figure.
 */
function figureOf(settle, group) {
  if (settle.phase === 'live') {
    const running = agentsOf(settle, group).filter(a => a.role !== null && !a.ended)
    if (running.length) {
      const longest = running.reduce((best, a) => ((elapsedOf(a) ?? -1) > (elapsedOf(best) ?? -1) ? a : best))
      const elapsed = durationText(elapsedOf(longest))
      return `${running.length > 1 ? `${running.length} live · ` : ''}${agentName(longest)}${elapsed ? ` ${elapsed}` : ''} · ${longest.requests} req`
    }
  }
  const worded = group.rows.filter(r => isString(r.words))
  if (worded.length) return worded[worded.length - 1].words
  return group.rows.length ? group.rows[group.rows.length - 1].text : ''
}

/**
 * `interlock settle <change> #<n>: <group> · <figure>`; until a line names the
 * change, `change: unknown until named` leads the words after the colon.
 */
function settleLine(settle) {
  const group = statusGroup(settle)
  const figure = group ? figureOf(settle, group) : ''
  const words = [settle.change ? null : UNKNOWN_CHANGE, group ? `${group.label}${figure ? ` · ${figure}` : ''}` : null].filter(Boolean)
  const head = `interlock settle${settle.change ? ` ${settle.change}` : ''}${settle.pr !== null ? ` #${settle.pr}` : ''}`
  return words.length ? `${head}: ${words.join(' · ')}` : head
}

/**
 * The settle run's status line, or `null` when another run holds it (D5): a
 * live ship run, then a live spec run, then a live settle run, then a spec
 * run at its checkpoint, then a done settle run. `others` is
 * `{ shipLive, specPhase }`, as the hooks module knows them.
 */
export function settleStatusText(settle, others = {}) {
  if (!isObject(settle) || (settle.phase !== 'live' && settle.phase !== 'done')) return null
  const o = isObject(others) ? others : {}
  if (o.shipLive === true || o.specPhase === 'live') return null
  if (settle.phase === 'done' && o.specPhase === 'checkpoint') return null
  return settleLine(settle)
}

// --- the pane (D14, D24, D25) -------------------------------------------------

/** The width at which the engine seats an unasked pane; below it an agent row folds (D24). */
const FULL_COLUMNS = 110

const iso = at => (isTime(at) ? new Date(at).toISOString() : null)
const span = (from, to) => (isTime(from) && isTime(to) ? durationText(Math.max(0, to - from)) : '')

/** The latest clock reading the record holds: a row's or an agent's. */
function latestReading(settle) {
  let latest = null
  const see = t => {
    if (isTime(t) && (latest === null || t > latest)) latest = t
  }
  for (const g of settle.groups) see(g.lastAt)
  for (const a of settle.agents.values()) {
    see(a.lastAt)
    see(a.endAt)
  }
  return latest
}

function headerText(settle) {
  const parts = [settle.change || UNKNOWN_CHANGE]
  if (settle.pr !== null) parts.push(`PR #${settle.pr}`)
  parts.push(settle.depth || 'depth: not seen')
  if (settle.head) parts.push(`head ${sha7(settle.head)}`)
  const elapsed = span(settle.startedAt, isTime(settle.endedAt) ? settle.endedAt : latestReading(settle))
  if (elapsed) parts.push(elapsed)
  return `interlock settle — ${parts.join(' · ')}`
}

/** `routed <model> · <effort>` from the pass's routing lines, or `routed: not seen` before one named the role (D2). */
function routedText(settle, role) {
  const f = settle.routed.get(role)
  return f ? `routed ${f.model ?? '—'} · ${f.effort ?? '—'}` : 'routed: not seen'
}

/** `step <latest>`, or `step <first> → <latest>` when the engine's level changed (D23). */
function stepText(a) {
  if (a.stepEffort === null) return 'step: not seen'
  return a.firstStepEffort !== null && a.firstStepEffort !== a.stepEffort ? `step ${a.firstStepEffort} → ${a.stepEffort}` : `step ${a.stepEffort}`
}

/** The token sums, field by field, in the ship meter's words. */
function tokensText(a) {
  if (a.known === 0) return a.requests ? 'tokens unknown (partial)' : 'no requests yet'
  const f = n => (n === null ? '?' : String(n))
  const t = a.sums
  return `in ${f(t.input_tokens)} · out ${f(t.output_tokens)} · cache read ${f(t.cache_read_input_tokens)} · cache write ${f(t.cache_creation_input_tokens)}${a.partial ? ' (partial)' : ''}`
}

const endWord = a => (a.ended ? a.reason || 'reason not seen' : 'live')

/** One agent's row (D3, D2, D23, D9); below the full width, role, served model, elapsed time and reason only (D24). */
function agentText(settle, a, full) {
  const served = a.served.length ? a.served.join(', ') : null
  const elapsed = durationText(elapsedOf(a))
  if (!full) return [agentName(a), served || a.resolved || '—', elapsed, endWord(a)].filter(Boolean).join(' · ')
  const parts = [agentName(a), `${a.requested} → ${a.resolved || '—'}`]
  if (a.role === 'fixer' || a.role === 'conformance') parts.push(routedText(settle, ROUTING_ROLE[a.role]))
  parts.push(stepText(a), `${a.requests} req`, tokensText(a))
  if (served) parts.push(`served ${served}`)
  if (!a.ended && isTime(a.lastAt)) parts.push(`last ${clockText(a.lastAt)}`)
  if (elapsed) parts.push(elapsed)
  parts.push(endWord(a))
  return parts.join(' · ')
}

/** `<k> spawned · <m> <reason>…`: the engine's counts for a set of agents, the live ones last (D22). */
function countsText(agents) {
  const ends = new Map()
  for (const a of agents.filter(x => x.ended)) ends.set(endWord(a), (ends.get(endWord(a)) || 0) + 1)
  const live = agents.filter(a => !a.ended).length
  const parts = [`${agents.length} spawned`, ...[...ends].map(([word, n]) => `${n} ${word}`)]
  if (live) parts.push(`${live} live`)
  return parts.join(' · ')
}

/** The role blocks of a group: a role row for the dimensions and the skeptics, then each agent's row (D22). */
function agentBlocks(settle, group, full) {
  const agents = agentsOf(settle, group)
  const blocks = []
  const block = (role, head) => {
    const mine = agents.filter(a => a.role === role)
    if (!mine.length) return
    const lines = head ? [{ key: `role-${role ?? 'none'}`, text: head(mine) }] : []
    for (const a of mine) lines.push({ key: `agent-${a.id}`, text: agentText(settle, a, full) })
    blocks.push({ at: Math.min(...mine.map(a => (isTime(a.firstAt) ? a.firstAt : Infinity))), lines })
  }
  block('dimension', mine => `review dimensions${settle.listing ? ` ${settle.listing.join(', ')}` : ': not seen'} · ${countsText(mine)} · ${routedText(settle, ROUTING_ROLE.dimension)}`)
  block('skeptic', mine => `skeptics${settle.skeptics ? ` ${settle.skeptics}` : ''} · ${countsText(mine)} · ${routedText(settle, ROUTING_ROLE.skeptic)}`)
  block('fixer', null)
  block('conformance', null)
  block(null, null)
  return blocks
}

/**
 * The `/interlock-settle` pane as keyed lines, `{ key, text, bold?, dim? }`
 * (D14, D24, D25): the header, one group per section in the order it opened
 * (its heading carries the clock time it opened, the time of its last line
 * and the span), the group's CLI rows with their clock times and its agents
 * by role in the order they crossed, the time the run ended, and the
 * routing lines' banners. `columns` is the engine's `bodyColumns`; below 110
 * the agent rows fold. The module maps the lines onto `Box` and `Text` and
 * nothing else; no row carries a tick, a colour or a threshold.
 */
export function settlePaneLines(settle, columns) {
  if (!isObject(settle) || (settle.phase !== 'live' && settle.phase !== 'done')) return [{ key: 'settle-none', text: NO_SETTLE_LINE, dim: true }]
  const full = !(typeof columns === 'number' && columns < FULL_COLUMNS)
  const out = [{ key: 'settle-header', text: headerText(settle), bold: true }]
  settle.groups.forEach((group, g) => {
    const window = [clockText(group.openedAt), clockText(group.lastAt)].filter(Boolean).join(' → ')
    const spanText = span(group.openedAt, group.lastAt)
    out.push({ key: `settle-group-${g}`, text: [group.label, window, spanText].filter(Boolean).join(' · '), bold: true })
    const items = group.rows.map((row, i) => ({
      at: isTime(row.at) ? row.at : Infinity,
      lines: [{ key: `row-${i}`, text: isTime(row.at) ? `${clockText(row.at)} ${row.text}` : row.text }]
    }))
    // A stable sort: rows keep the order they crossed, and a role block sits where its first agent spawned.
    const ordered = [...items, ...agentBlocks(settle, group, full)].map((item, seq) => ({ ...item, seq })).sort((a, b) => a.at - b.at || a.seq - b.seq)
    for (const item of ordered) for (const line of item.lines) out.push({ key: `settle-group-${g}-${line.key}`, text: line.text })
  })
  if (settle.phase === 'done') out.push({ key: 'settle-done', text: iso(settle.endedAt) ? `done ${iso(settle.endedAt)}` : 'done, time unknown' })
  if (!settle.banners.length) out.push({ key: 'settle-banners', text: 'banners: none', dim: true })
  else {
    out.push({ key: 'settle-banners', text: 'banners', bold: true })
    settle.banners.forEach((b, i) => out.push({ key: `settle-banner-${i}`, text: b }))
  }
  return out
}
