// The settle meter's text rules (observe-the-settle-run-live design D1-D27).
//
// `/interlock:settle`, with or without `--review`, is a prose skill that
// drives `interlock`, `gh`, `glab` and `git` through the Bash tool and fans
// review agents out through the Agent tool. The hooks module draws it anyway, from what already crossed
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
//   endedAt          the clock reading the drift line, or a failed pull
//                    request lookup in a pass loaded without --create, crossed at
//   review, create   whether the load carried --review, --create
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

import { LIMITS } from './limits.mjs'
import { clockText, durationText } from './meter-time.mjs'
import { UNKNOWN_CHANGE, findJson } from './spec-meter.mjs'
import { SKEPTIC_ROLES } from './review-roles.mjs'

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
  // A pass loaded without `--review` opens this in place of `review`: the skill's §2 word (draw-the-settle-and-spec-panes-as-cards D4).
  Object.freeze({ key: 'resolve', label: 'resolve', rank: 0 }),
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
  'pr-lookup',
  'routing',
  'surface',
  'domain-context',
  'gate',
  'changes',
  'review-policy',
  'autonomy',
  'note-derive',
  'graph-covers',
  'review-brief',
  'review',
  'review-draft',
  'review-proof',
  'comment',
  'replies',
  'tree-check',
  'staging-pathspecs',
  'archived-change',
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
  ['staging-pathspecs', 'staging-pathspecs'],
  ['archived-change', 'archived-change'],
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
  ['pipeline', 'pipeline']
])

const VERIFY_VERBS = new Set(['plan', 'exec', 'judge', 'coverage'])

/** The words of the engine's failed-command prefix line (probe 3 of the spec meter). */
const ENGINE_PREFIX = /^Exit code (\d+)\r?\n?/

const UNPARSED_CUT = 200

/** Control characters, a line break and a tab among them: none reaches the pane, the status line or a toast as written. */
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g

/**
 * Text as the pane, the status line and a toast show it (the review's M10):
 * control characters made spaces, cut to the published cap with an ellipsis.
 * Argv, a path list or a dimension heading reaches here as it was written.
 */
function shownText(text) {
  const clean = String(text).replace(CONTROL, ' ')
  return clean.length > LIMITS.settleTextChars ? `${clean.slice(0, LIMITS.settleTextChars - 1)}…` : clean
}

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
 * What a skill load starts: `settle` whenever the plugin's settle skill is
 * named, with or without `--review` (draw-the-settle-and-spec-panes-as-cards
 * D4; `settleLoadsReview` reads which), `review` when the review-code skill is
 * named (the run it joins is the settle run's, D21), else `null`. Only the
 * plugin's namespaced names count, a leading `/` dropped, as `skillRole` reads
 * them; that function is left as it is.
 */
export function settleLoad(name, args) {
  if (typeof name !== 'string') return null
  const skill = name.trim().replace(/^\//, '')
  if (skill === 'interlock:review-code') return 'review'
  return skill === 'interlock:settle' ? 'settle' : null
}

/** Whether a settle load's arguments, split on whitespace, carry `word` itself. */
const loadsWord = (args, word) => typeof args === 'string' && args.split(/\s+/).includes(word)

/** Whether a settle load's arguments carry the word `--review` itself. */
export const settleLoadsReview = args => loadsWord(args, '--review')

/** Whether a settle load's arguments carry the word `--create` itself (the PR #28 review's M1). */
export const settleLoadsCreate = args => loadsWord(args, '--create')

// --- the line reader (D8, D19) -------------------------------------------------

/**
 * A stage's words, unquoted: `{ value, plain }` for each, `plain` when no part
 * of the word was quoted. Unlike the spec reader's `argvOf` this does not stop
 * at `<` or `>`, because the skill's own lines carry `<n>` placeholders that
 * the pin reads; it stops at an unquoted `<<`, since a heredoc's body is never
 * a word the reader keys on. A backslash before a line break continues the
 * line. Never throws.
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
    } else if (c === '\\' && stage[i + 1] === '\n') {
      i++
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
    } else if (c === '<' && stage[i + 1] === '<') {
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

/**
 * Whether `gh pr view` or `glab mr view` names no pull request of its own: the
 * branch's lookup of the skill's §2, its fourth word a flag, a redirect or
 * absent, never a number or a `<n>` placeholder (the PR #28 review's M1).
 */
const isBranchLookup = values => values[3] === undefined || values[3].startsWith('-') || /^\d*>/.test(values[3])

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
export const settleLineKind = stage => kindOf(valuesOf(stage))

/** The kind of a stage by its words (`settleLineKind`), for a caller that already split it. */
function kindOf(w) {
  if (!w.length) return null
  if (w[0] === 'interlock') {
    const verb = w[1]
    if (verb === 'settle') return SETTLE_VERBS.get(w[2]) || null
    if (verb === 'verify') return VERIFY_VERBS.has(w[2]) ? 'verify' : null
    if (verb === 'merge-confidence') return w.includes('--label-names') ? 'label-names' : 'merge-confidence'
    if (verb === 'autonomy') return w[2] === 'record' ? 'autonomy' : null
    if (verb === 'note') return w[2] === 'derive' ? 'note-derive' : null
    // Only the pass's own drift line is keyed as drift: the spec flow runs `interlock drift --json` with no `--changed` (D6).
    if (verb === 'drift') return hasFlag(w, 'changed') ? 'drift' : null
    // The brief and proof lines are their own kinds, and a draft is never the round's record.
    if (verb === 'review') {
      if (w[2] === 'brief') return 'review-brief'
      if (w[2] === 'proof') return 'review-proof'
      if (hasFlag(w, 'draft')) return 'review-draft'
    }
    return WORD_KINDS.get(verb) || null
  }
  if (w[0] === 'interlock-graph') return w[1] === 'covers' ? 'graph-covers' : null
  if (w[0] === 'git') {
    if (w[1] === 'commit') return 'git-commit'
    if (w[1] === 'push') return 'git-push'
    return null
  }
  if (w[0] === 'gh' && w[1] === 'pr') {
    if (w[2] === 'view') return isBranchLookup(w) ? 'pr-lookup' : null
    if (w[2] === 'ready') return 'ready'
    if (w[2] === 'checks') return hasFlag(w, 'watch') ? 'checks' : null
    if (w[2] === 'edit') {
      if (hasFlag(w, 'add-label')) return 'label-add'
      if (hasFlag(w, 'remove-label')) return 'label-remove'
    }
    return null
  }
  if (leadOf(w, 3) === 'glab mr view') return isBranchLookup(w) ? 'pr-lookup' : null
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
 * A command cut into stages (D8): at an unquoted `|`, `||`, `&&`, `;` or line
 * break, and at `$(` (a `$(` inside double quotes included, since the GitLab
 * lines are written `--message "$(interlock …)"`), the stage inside a `$( )`
 * ending at its closing parenthesis. A quoted heredoc's body is one argument:
 * from an unquoted `<<` the rest of the command is not cut again. Answers
 * `{ stages, ops }`: each stage is `{ text, sub, seq }`, `sub` when it runs
 * inside a `$( )`, and `ops` the operators met outside every `$( )`, in order,
 * a line break as `;`; `ops.slice(seq)` are the ones after a stage began.
 * Never throws.
 */
function cutStages(command) {
  const stages = []
  const ops = []
  const frames = []
  let cur = ''
  let quote = null
  const flush = () => {
    const text = cur.trim()
    cur = ''
    if (!isJunk(text)) stages.push({ text, sub: frames.length > 0, seq: ops.length })
  }
  const op = word => {
    flush()
    if (!frames.length) ops.push(word)
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    const next = command[i + 1]
    if (quote === "'") {
      cur += c
      if (c === "'") quote = null
      continue
    }
    if (c === '\\' && i + 1 < command.length) {
      cur += c + next
      i++
      continue
    }
    if (quote === '"') {
      if (c === '"') {
        quote = null
        cur += c
      } else if (c === '$' && next === '(') {
        flush()
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
      flush()
      frames.push({ quote: null, depth: 0 })
      i++
    } else if (c === '<' && next === '<' && command[i + 2] !== '<') {
      cur += command.slice(i)
      break
    } else if (c === '#' && (cur === '' || /\s/.test(command[i - 1]))) {
      const stop = command.indexOf('\n', i)
      const to = stop === -1 ? command.length : stop
      cur += command.slice(i, to)
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
        flush()
        quote = frames.pop().quote
      }
    } else if ((c === '|' || c === '&') && next === c) {
      op(c + c)
      i++
    } else if (c === '|') {
      op('|')
    } else if (c === ';' || c === '\n') {
      op(';')
    } else {
      cur += c
    }
  }
  flush()
  return { stages, ops }
}

/**
 * Whether the call's exit code is this stage's own (D26), as `own(exit)`: the
 * stage runs outside every `$( )`, is the last stage of its pipeline, sits in
 * the command's last `;`-separated list, and that list joins its pipelines
 * with `&&` alone; with more than one pipeline in the list only an exit of 0
 * is known to be every one's. Anything else could be another stage's exit.
 */
function ownerOf(stage, ops) {
  if (stage.sub) return () => false
  const tail = ops.slice(stage.seq)
  if (tail[0] === '|' || tail.includes(';')) return () => false
  const head = ops.slice(0, stage.seq)
  const listStart = head.lastIndexOf(';') + 1
  const joins = [...head.slice(listStart), ...tail].filter(o => o !== '|')
  if (joins.includes('||')) return () => false
  return exit => joins.length === 0 || exit === 0
}

/**
 * Every stage of a command, in the command's order, as `{ kind, segment,
 * values, last, own }` (D8): `kind` is the stage's keyed kind or `null`,
 * `segment` its text, `values` its words, split once,
 * `last` whether it is the final stage of a top-level pipeline (its stdout
 * reaches the call's result), and `own(exit)` whether the call's exit code is
 * the stage's own. A `glab ci get` piped onward hands its JSON to the next
 * stage and is not the wait for the checks, so it is not keyed. Never throws.
 */
export function settleLines(command) {
  if (typeof command !== 'string') return []
  const { stages, ops } = cutStages(command)
  return stages.map(stage => {
    const piped = !stage.sub && ops[stage.seq] === '|'
    const values = valuesOf(stage.text)
    let kind = kindOf(values)
    if (kind === 'checks' && piped) kind = null
    return { kind, segment: stage.text, values, last: !stage.sub && !piped, own: ownerOf(stage, ops) }
  })
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
    // The roles a routing line named but whose figures could not be read; `*` for the whole-table line (M16).
    routingUnread: new Set(),
    listing: null,
    skeptics: null,
    banners: [],
    groups: [],
    open: null,
    lastRecord: null,
    reviews: new Map(),
    agents: new Map(),
    afterBoundary: flags.afterBoundary === true,
    // Whether the load carried `--review`: without it the pass opens `resolve` and never `review` or a round.
    review: flags.review === true,
    // Whether the load carried `--create`: without it a failed pull request lookup ends the pass (M1).
    create: flags.create === true,
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
 * such line opens as `review`, or as `resolve` in a pass loaded
 * without `--review`, which never opens a round either: a round target there
 * files as a line with no section of its own. A `soft` round target (the
 * brief, the result: lines that name a round but are not what starts one)
 * opens its round only from before the rounds, never from behind an earlier
 * round: a round after the first is opened by its own tree-check.
 */
function place(settle, target, at) {
  const open = settle.open
  if (settle.review !== true && target !== null && target.key === 'round') target = null
  if (target === null) return open || openGroup(settle, settle.review === true ? 'review' : 'resolve', null, at)
  if (!open) return openGroup(settle, target.key, target.round ?? null, at)
  const rank = GROUP_BY_KEY.get(target.key).rank
  if (rank > open.rank) return openGroup(settle, target.key, target.round ?? null, at)
  if (rank === open.rank && target.key === 'round' && !target.soft && target.round > open.round) return openGroup(settle, target.key, target.round, at)
  return open
}

function file(group, kind, text, words, at, verdict = null) {
  group.rows.push({ kind, text, words: words ?? null, at, ...(verdict === null ? null : { verdict }) })
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
 * printed (`body`, past the engine's failed-command line), what it wrote to
 * stderr on a clean exit (`stderr`; an errored call folds it into the body),
 * the exit code (0 unless the engine marked the call errored), and whether the
 * engine kept the output out of line.
 */
function outcomeOf(r) {
  const result = isObject(r) ? r : {}
  const tooLarge = isObject(result.result) && isString(result.result.persistedOutputPath)
  const stderr = isObject(result.result) && typeof result.result.stderr === 'string' ? result.result.stderr : ''
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
  return { body, stderr, exit, tooLarge }
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

/**
 * A stage's exit code in words (D26): `exit <n>` when the call's exit is the
 * stage's own, else `exit not its own`, since a later stage, a pipe or a
 * fallback could have set it.
 */
const exitText = outcome => (outcome.own === false ? 'exit not its own' : `exit ${outcome.exit}`)
/** The exit words a row appends only when they say something: an exit that is not 0, or not the stage's own. */
const exitNote = outcome => (outcome.own === false || outcome.exit !== 0 ? ` · ${exitText(outcome)}` : '')
const bare = (word, outcome, note) => `${word} ${exitText(outcome)}${note ? ` · ${note}` : ''}`
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
  ['note-derive', 'note derive'],
  ['graph-covers', 'graph covers'],
  ['staging-pathspecs', 'staging-pathspecs']
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
    const pull = pullOf(stage.values)
    if (pull !== null) settle.pr = pull
  }
  const own = stage => ({ ...outcome, own: stage.own(outcome.exit) })
  for (let i = 0; i < keyed.length; i++) {
    const stage = keyed[i]
    const values = stage.values
    nameFromArgv(settle, stage.kind, values)
    const push = stage.kind === 'git-commit' && keyed[i + 1] && keyed[i + 1].kind === 'git-push' ? keyed[i + 1] : null
    fileStage(settle, out, { stage, values, outcome: own(stage), background, at, command, pushOutcome: push ? own(push) : null })
    if (push) i++
    if (settle.phase === 'done') break
  }
  out.toasts = out.toasts.map(shownText)
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
    case 'pr-lookup': {
      into(null, bare(leadOf(values, 3), outcome), null)
      // The skill's §2 stop: no pull request for the branch and no `--create` to make one (the PR #28 review's M1).
      if (outcome.own !== false && outcome.exit !== 0 && settle.create !== true) {
        settle.phase = 'done'
        settle.endedAt = at
      }
      return
    }
    case 'routing': {
      const word = positionalRole(values)
      // The worker's routing line opens its section once the pass is past the review: before any round, a
      // routing lookup is the review's own, and the conformance brief opens the section by itself.
      const target = word === 'settle-conformance' && settle.open && settle.open.rank > 0 ? { key: 'conformance' } : null
      const read = jsonOf('routing', stage, outcome)
      const filed = read.value ? fileRouting(settle, read.value, word) : null
      if (!filed) settle.routingUnread.add(word || '*')
      if (read.row) return into(target, read.row.text, null)
      if (!read.value) return unparsed(target, 'routing', read.problem)
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
    case 'graph-covers':
    case 'staging-pathspecs':
      return into(null, bare(BARE_WORDS.get(kind), outcome), null)
    case 'review':
      return fileReview(settle, out, ctx, into, unparsed)
    case 'review-draft':
      return fileReview(settle, out, ctx, into, unparsed, true)
    case 'review-brief': {
      // The dimension name or `skeptics`, and the number of prompts; never the prompt text.
      const what = flagValue(values, 'dimension') || (hasFlag(values, 'skeptics') ? 'skeptics' : '?')
      const read = what === 'skeptics' && stage.last && outcome.body !== null && !outcome.tooLarge ? findJson(outcome.body) : null
      const prompts = read && Array.isArray(read.prompts) ? ` · ${read.prompts.length} prompt(s)` : ''
      return into(null, `brief ${what}${prompts} · ${exitText(outcome)}`, null)
    }
    case 'review-proof': {
      const line = stage.last && outcome.body !== null && !outcome.tooLarge ? firstLine(outcome.body) : ''
      return into(null, `proof${line ? ` ${line}` : ''} · ${exitText(outcome)}`, null)
    }
    case 'archived-change': {
      const read = stage.last && outcome.body !== null && !outcome.tooLarge ? findJson(outcome.body) : null
      const named = read && isString(read.change) ? read.change : outcome.exit === 0 ? firstLine(outcome.body) : firstLine(outcome.stderr)
      return into(null, `archived-change${named ? ` ${named}` : ''} · ${exitText(outcome)}`, null)
    }
    case 'comment': {
      const round = roundOf(values)
      return into(null, `comment${round === null ? '' : ` round ${round}`} · ${exitText(outcome)}`, null)
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
      let text = `commit ${subject === null ? '(message not read)' : subject}`.trim()
      const push = ctx.pushOutcome
      // `git commit && git push` that failed: the exit is the commit's or the push's, and nothing says which.
      if (push) text += push.own ? ` · push ${exitText(push)}` : ` · exit ${outcome.exit} from the commit or the push`
      else text += exitNote(outcome)
      return file(open, kind, text, null, at)
    }
    case 'git-push': {
      const open = settle.open
      if (!open || open.key !== 'round') return
      return file(open, kind, `push ${exitText(outcome)}`, null, at)
    }
    case 'ready':
      return into({ key: 'ready' }, `${values.slice(0, values[0] === 'gh' ? 4 : 5).join(' ')} · ${exitText(outcome)}`, null)
    case 'conformance-brief': {
      // A failed brief says why in its output; a brief with nothing to confirm prints no brief and says so on stderr.
      const silent = outcome.body === null || outcome.body.trim() === ''
      const line = outcome.exit !== 0 ? firstLine(outcome.body) : silent ? firstLine(outcome.stderr) : ''
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
      return into({ key: 'checks' }, `${words} · ${background ? 'background' : exitText(outcome)}`, null)
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
      return into({ key: 'publish' }, `${text}${exitNote(outcome)}`, null)
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

function fileReview(settle, out, ctx, into, unparsed, draft = false) {
  const { stage, values, outcome } = ctx
  // The `--out review-r<n>.json` argv names the round whether or not the stdout could be read; a draft names none.
  const n = outcome.exit === 0 && !draft ? noteRecord(settle, values) : null
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
  // `dimensions.skipped` is `{ name, reason }[]` (lib/review-core.mjs), `dimensions.unavailable` names.
  const skipped = Array.isArray(dims.skipped) ? dims.skipped.filter(d => isObject(d) && isString(d.name)).map(d => d.name) : []
  const unavailable = stringsOf(dims.unavailable)
  if (n !== null) {
    settle.reviews.set(n, {
      depth: isString(dims.depth) ? dims.depth : null,
      ran: stringsOf(dims.ran),
      skipped,
      unavailable,
      dimensionStats: isObject(v.dimensionStats) ? v.dimensionStats : {}
    })
  }
  const words = [`${counts.raised} raised`, `${counts.dismissed} dismissed`, `${counts.surviving} surviving`]
  if (isCount(counts.carried)) words.push(`${counts.carried} carried`)
  const head = headOf(v.head) || headOf(flagValue(values, 'head'))
  const degraded = Array.isArray(dims.degraded) ? dims.degraded.filter(d => isObject(d) && isString(d.name)).map(d => d.name) : []
  const notes = [
    head ? `head ${sha7(head)}` : null,
    skipped.length ? `skipped ${skipped.join(', ')}` : null,
    unavailable.length ? `unavailable ${unavailable.join(', ')}` : null,
    degraded.length ? `degraded ${degraded.join(', ')}` : null,
    proofNote(v.proof)
  ]
  const text = [words.join(' · '), ...notes.filter(Boolean)].join(' · ')
  return into(null, draft ? `draft · ${text}` : text, words.join(' · '))
}

/** The proof's words on a review row: the CLI's `proven`, or `not proven` with its counts; nothing for a record that carries none. */
function proofNote(proof) {
  if (!isObject(proof)) return null
  if (proof.proven === true) return 'proven'
  const n = key => (Array.isArray(proof[key]) ? proof[key].length : 0)
  return `not proven · ${n('unproven')} unproven · ${n('unread')} unread · ${n('uncited')} uncited`
}

function fileTreeCheck(settle, ctx, into, unparsed) {
  const { stage, outcome } = ctx
  const target = settle.lastRecord !== null ? { key: 'round', round: settle.lastRecord + 1 } : null
  if (!stage.last || outcome.body === null || outcome.tooLarge) return into(target, plainRow('tree-check', outcome), null)
  const lines = outcome.body.split('\n').map(l => l.trimEnd())
  if (!lines.some(l => l.trim() !== '')) return into(target, plainRow('tree-check', outcome), null)
  // The CLI's head line, wherever the engine folded a failed call's stderr sentence beside it.
  const at = lines.findIndex(l => /^(clean\b|dirty \(\d+\):)/.test(l.trim()))
  const text = at === -1 ? '' : lines[at].trim()
  if (/^clean\b/.test(text)) return into(target, `tree-check ${text} · ${exitText(outcome)}`, null)
  if (at !== -1) {
    // Only the indented lines the head counts are paths; the stderr sentence is not one of them.
    const count = Number(text.match(/^dirty \((\d+)\):/)[1])
    const paths = []
    for (const l of lines.slice(at + 1)) {
      if (paths.length === count) break
      if (l.trim() === '') continue
      if (!l.startsWith('  ')) break
      paths.push(l.trim())
    }
    return into(target, `tree-check ${text}${paths.length ? ` ${paths.join(', ')}` : ''} · ${exitText(outcome)}`, null)
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
  const into = (text, words, verdict = null) => file(place(settle, target, ctx.at), 'merge-confidence', text, words, ctx.at, verdict)
  if (hasFlag(values, 'markdown')) return into(`merge-confidence --markdown · ${exitText(outcome)}`, null)
  const read = jsonOf('merge-confidence', stage, outcome)
  if (read.row) return into(read.row.text, null)
  const v = read.value
  if (!v || !isString(v.verdict) || typeof v.score !== 'number') {
    return unparsed(target, 'merge-confidence', read.problem || 'fields missing: verdict, score')
  }
  nameFromValue(settle, v)
  const head = isObject(v.head) ? headOf(v.head.sha) : null
  const words = `${v.verdict} ${v.score}`
  const label = key => (isObject(v.labels) && isObject(v.labels[key]) && isString(v.labels[key].name) ? v.labels[key].name : null)
  const labels = [label('verdict'), label('score')].filter(Boolean)
  out.toasts.push(`merge-confidence: ${words}`)
  return into(`${words}${head ? ` · head ${sha7(head)}` : ''}${labels.length ? ` · labels ${labels.join(', ')}` : ''}`, words, v.verdict)
}

/**
 * The first line of the message a `git commit` names with `-m`; `''` when it
 * names none, and `null` when it names one the reader cannot see, as a
 * message written `"$(cat <<'EOF' …)"`, whose text is a stage of its own.
 */
function commitSubject(values) {
  for (let i = 0; i < values.length; i++) {
    let message
    if (values[i] === '-m' || values[i] === '--message') message = values[i + 1]
    else if (values[i].startsWith('--message=')) message = values[i].slice(10)
    else continue
    const subject = typeof message === 'string' ? message.split('\n')[0].trim() : ''
    return subject === '' ? null : subject
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
/** The first sentences the skeptic prompts open with, from the import-free roles module the skeptic assembler also reads. */
const SKEPTICS = SKEPTIC_ROLES

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
  // A brief copied with its blockquote marker (review-code's skeptic briefs are blockquotes) reads as the brief.
  const lines = prompt.split('\n').map(l => l.trim().replace(/^>\s?/, ''))
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
    out.toasts.push(shownText(`${agentName(a)}: ${a.reason}`))
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
  return shownText(settleLine(settle))
}

// --- the pane (D14, D24, D25) -------------------------------------------------

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
  parts.push(elapsed || (isTime(settle.startedAt) ? '' : 'time unknown'))
  return `interlock settle — ${parts.filter(Boolean).join(' · ')}`
}

/**
 * `routed <model> · <effort>` from the pass's routing lines; `routed: not read`
 * when a routing line for the role crossed and could not be read; else
 * `routed: not seen`, before one named the role (D2, M16).
 */
function routedText(settle, role) {
  const f = settle.routed.get(role)
  if (f) return `routed ${f.model ?? '—'} · ${f.effort ?? '—'}`
  return settle.routingUnread.has(role) || settle.routingUnread.has('*') ? 'routed: not read' : 'routed: not seen'
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
    const lines = head ? [{ key: `role-${role ?? 'none'}`, text: head(mine), kind: 'role', depth: 1 }] : []
    for (const a of mine) {
      const hint = { end: endWord(a), endTone: !a.ended ? 'running' : a.reason === 'answer' ? 'ok' : 'alarm' }
      lines.push({ key: `agent-${a.id}`, text: agentText(settle, a, full), kind: 'agent', depth: head ? 2 : 1, hint })
    }
    blocks.push({ at: Math.min(...mine.map(a => (isTime(a.firstAt) ? a.firstAt : Infinity))), lines })
  }
  block('dimension', mine => `review dimensions${settle.listing ? ` ${settle.listing.join(', ')}` : ': not seen'} · ${countsText(mine)} · ${routedText(settle, ROUTING_ROLE.dimension)}`)
  block('skeptic', mine => `skeptics${settle.skeptics ? ` ${settle.skeptics}` : ''} · ${countsText(mine)} · ${routedText(settle, ROUTING_ROLE.skeptic)}`)
  block('fixer', null)
  block('conformance', null)
  block(null, null)
  return blocks
}

// --- the pane's spans (draw-the-settle-and-spec-panes-as-cards D1, D2) ----------

const SEP = ' · '
const VERDICT_TONES = new Map([
  ['MERGE', 'ok'],
  ['HUMAN', 'warn'],
  ['BLOCK', 'alarm']
])
/** A row's leading clock reading, or the words that stand where it would be. */
const LEAD_CLOCK = /^(?:\d\d:\d\d:\d\d|time unknown)/
/** The words of a row body that carry a tone, each at the body's start or after a space. */
const BODY_WORDS = /(^|\s)(exit not its own|exit \d+|result not seen(?: \([^)]*\))?|\(unparsed\))/g
const clean = text => String(text).replace(CONTROL, ' ')

/** Spans from `[text, tone]` pieces: empty pieces dropped, neighbours of one tone joined. */
function spansFrom(pieces) {
  const spans = []
  for (const [text, tone] of pieces) {
    if (!text) continue
    const last = spans[spans.length - 1]
    if (last && last.tone === tone) last.text += text
    else spans.push({ text, tone })
  }
  return spans
}

/** The tone of one of `BODY_WORDS`: the stage's own exit 0 ok, any other own exit and `(unparsed)` alarm, the rest dim. */
function wordTone(word) {
  if (word === 'exit 0') return 'ok'
  if (word.startsWith('exit not') || word.startsWith('result')) return 'dim'
  return 'alarm'
}

/** A CLI row body's pieces: a `STOP: ` body wholly alarm, else its exit and unread words toned. */
function bodyPieces(body) {
  if (body.startsWith('STOP: ')) return [[body, 'alarm']]
  const pieces = []
  let from = 0
  for (const m of body.matchAll(BODY_WORDS)) {
    const start = m.index + m[1].length
    pieces.push([body.slice(from, start), null], [m[2], wordTone(m[2])])
    from = start + m[2].length
  }
  pieces.push([body.slice(from), null])
  return pieces
}

/** A row's clock piece, and its body after the one space that follows it. */
function clockPieces(text) {
  const m = text.match(LEAD_CLOCK)
  const lead = m ? [[m[0], 'clock']] : []
  const after = m ? text.slice(m[0].length) : text
  const space = m && after.startsWith(' ') ? ' ' : ''
  return { lead: [...lead, [space, null]], body: after.slice(space.length) }
}

/** The text split at its first ` · `: what comes before it, and the rest. */
function headOfText(text) {
  const cut = text.indexOf(SEP)
  return cut === -1 ? [text, ''] : [text.slice(0, cut), text.slice(cut)]
}

/**
 * The toned spans of one pane line, read from its final, capped text, so that
 * they always join to it (D1). A tone names what a word the CLI, the engine or
 * the clock supplied means (D2); a line with no rule is one span of no tone.
 */
function spansOf(line, text, hint) {
  switch (line.kind) {
    case 'row': {
      const { lead, body } = clockPieces(text)
      return spansFrom([...lead, ...bodyPieces(body)])
    }
    case 'verdict': {
      const { lead, body } = clockPieces(text)
      const word = typeof line.verdict === 'string' ? clean(line.verdict) : ''
      if (!word || !body.startsWith(word)) return spansFrom([...lead, [body, null]])
      return spansFrom([...lead, [word, VERDICT_TONES.get(line.verdict) ?? null], [body.slice(word.length), null]])
    }
    case 'heading':
      return hint && text.startsWith(hint.label) ? spansFrom([[hint.label, 'heading'], [text.slice(hint.label.length), 'dim']]) : spansFrom([[text, 'dim']])
    case 'agent': {
      const [name, rest] = headOfText(text)
      const end = hint ? clean(hint.end) : ''
      if (end && rest.endsWith(`${SEP}${end}`)) return spansFrom([[name, 'name'], [rest.slice(0, rest.length - end.length), null], [end, hint.endTone]])
      return spansFrom([[name, 'name'], [rest, null]])
    }
    case 'role': {
      const [words, rest] = headOfText(text)
      return spansFrom([[words, 'accent'], [rest, null]])
    }
    case 'banner':
      return spansFrom([[text, 'warn']])
    case 'mode':
    case 'done':
    case 'banners':
      return spansFrom([[text, 'dim']])
    default:
      return spansFrom([[text, null]])
  }
}

/**
 * Whether the settle pane draws its cards at `columns`, the engine's
 * `bodyColumns`: a width was reported, and it is at least the settle card
 * floor, so a folded agent row keeps its reason inside a card (the PR #28
 * review's M2). Below it, or with no width, the pane draws flat.
 */
export const settleDrawsCards = columns => isCount(columns) && columns >= LIMITS.settlePaneCardColumns

/** A pane line as it is drawn: its text shown and capped, its spans read from that text, its hint dropped. */
function finish(line) {
  const { hint, ...rest } = line
  const text = shownText(line.text)
  return { ...rest, text, spans: spansOf(rest, text, hint) }
}

/**
 * The `/interlock-settle` pane as keyed lines, `{ key, text, bold?, dim? }`
 * (D14, D24, D25): the header, the `with --review` or `without --review` line,
 * one group per section in the order it opened
 * (its heading carries the clock time it opened, the time of its last line
 * and the span), the group's CLI rows with their clock times and its agents
 * by role in the order they crossed, the time the run ended, and the
 * routing lines' banners. `columns` is the engine's `bodyColumns`; below
 * `LIMITS.settlePaneFullColumns` the agent rows fold. A row the clock could not
 * time says `time unknown` where its time would be (M16), and every text is
 * shown through `shownText`. The module maps the lines onto `Box` and `Text` and
 * nothing else; no row carries a tick, a colour or a threshold.
 *
 * Beside each text (draw-the-settle-and-spec-panes-as-cards D1): `kind`
 * (`none` `header` `mode` `heading` `row` `role` `agent` `verdict` `done`
 * `banners` `banner`), `group` (the index into `settle.groups` of a heading and
 * of every line under it), `open` on the open group's heading while the run is
 * live, `depth` (1 on a role line and on an agent row with no role line, 2 on
 * an agent row under one), `verdict` (the CLI's word on the verdict row), and
 * `spans`, `[{ text, tone }]`, read from the final text and joining to it.
 */
export function settlePaneLines(settle, columns) {
  if (!isObject(settle) || (settle.phase !== 'live' && settle.phase !== 'done')) return [finish({ key: 'settle-none', text: NO_SETTLE_LINE, dim: true, kind: 'none' })]
  const full = !(typeof columns === 'number' && columns < LIMITS.settlePaneFullColumns)
  const out = [
    { key: 'settle-header', text: headerText(settle), bold: true, kind: 'header' },
    { key: 'settle-mode', kind: 'mode', text: settle.review === true ? 'with --review' : 'without --review', dim: true }
  ]
  settle.groups.forEach((group, g) => {
    const window = [clockText(group.openedAt), clockText(group.lastAt)].filter(Boolean).join(' → ') || 'time unknown'
    const spanText = span(group.openedAt, group.lastAt)
    const open = settle.phase === 'live' && settle.open === group ? { open: true } : null
    out.push({ key: `settle-group-${g}`, text: [group.label, window, spanText].filter(Boolean).join(' · '), bold: true, kind: 'heading', group: g, ...open, hint: { label: group.label } })
    const items = group.rows.map((row, i) => ({
      at: isTime(row.at) ? row.at : Infinity,
      lines: [
        {
          key: `row-${i}`,
          text: `${isTime(row.at) ? clockText(row.at) : 'time unknown'} ${row.text}`,
          ...(isString(row.verdict) ? { kind: 'verdict', verdict: row.verdict } : { kind: 'row' })
        }
      ]
    }))
    // A stable sort: rows keep the order they crossed, and a role block sits where its first agent spawned.
    const ordered = [...items, ...agentBlocks(settle, group, full)].map((item, seq) => ({ ...item, seq })).sort((a, b) => a.at - b.at || a.seq - b.seq)
    for (const item of ordered) for (const { key, ...line } of item.lines) out.push({ key: `settle-group-${g}-${key}`, ...line, group: g })
  })
  if (settle.phase === 'done') out.push({ key: 'settle-done', text: iso(settle.endedAt) ? `done ${iso(settle.endedAt)}` : 'done, time unknown', kind: 'done' })
  if (!settle.banners.length) out.push({ key: 'settle-banners', text: 'banners: none', dim: true, kind: 'banners' })
  else {
    out.push({ key: 'settle-banners', text: 'banners', bold: true, kind: 'banners' })
    settle.banners.forEach((b, i) => out.push({ key: `settle-banner-${i}`, text: b, kind: 'banner' }))
  }
  return out.map(finish)
}
