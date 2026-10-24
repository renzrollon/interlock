// The flags `interlock` accepts, as code (spec: cli/arguments; design D6-D8).
//
// `interlock` used to store any `--x` it was given and let each handler read the
// names it knew, so `autonomy record review-artifacts --blocker 2` exited 0
// having recorded nothing. This module holds what each subcommand reads, so the
// dispatcher can refuse the rest by name before anything runs.
//
// Three tests keep the table honest (test/spine/cli-arguments.test.mjs and
// test/spine/cli-inventory.test.mjs): every flag `bin/interlock` reads is in
// some set, every flag a USAGE line documents is accepted for its leaf, and every
// flag a shipped surface passes is accepted for its leaf. A flag added to a
// handler without a line here fails the first of them.
//
// Keys are leaf forms: the subcommand, or `<subcommand> <verb>` where the
// subcommand has verbs. Flags are bare names, without the leading `--`.

import { FLAG_FIELDS } from './run.mjs'

/** Read by the dispatcher or by every handler, so accepted for every subcommand. */
export const GLOBAL_FLAGS = Object.freeze(['json', 'root', 'state-home', 'change', 'help'])

const kebab = field => field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)

// A manifest field and the command-line spelling that sets it are not always the
// same word: `laneMode` is `--mode`, `tddMode` is `--tdd` or `--no-tdd`, and
// `mode` records `--continue`. Anything not listed is its own kebab-case name, so
// a flag added to FLAG_FIELDS is accepted by `run start` with no second edit.
const FIELD_SPELLING = Object.freeze({
  laneMode: ['mode'],
  tddMode: ['tdd', 'no-tdd'],
  mode: ['continue']
})

/** What `run start` accepts: every ship flag the manifest records, the host flags it reads, and the plugin root. */
function runStartFlags() {
  const out = new Set(['host', 'host-capabilities', 'plugin-root'])
  for (const field of FLAG_FIELDS) for (const name of FIELD_SPELLING[field] || [kebab(field)]) out.add(name)
  return [...out]
}

// Every `run` verb reads these before the verb is chosen.
const RUN_SHARED = ['results', 'host-records', 'report', 'baseline', 'compute-base']
const GATE_BAND = ['no-tolerance', 'min-quality']

const TABLE = {
  waves: ['classified', 'plan', 'format', 'mode', 'red-wave', 'tdd', 'no-tdd', 'state', 'columns', 'max-parallel'],
  surface: ['changed'],
  gate: ['findings', 'dismissed', 'metrics', ...GATE_BAND],
  validate: [],
  changes: [],
  drift: ['changed'],
  report: ['since', 'html', 'max-runs'],
  conformance: ['changed', 'living', 'base'],
  pipeline: ['github', 'gitlab-mr', 'gitlab', 'required', 'exclude', 'out', 'mr'],
  'merge-confidence': [
    'changed',
    'review',
    'verify',
    'handoff',
    'pipeline',
    'coverage',
    'run',
    'base',
    'require-merge',
    'markdown',
    'label-names'
  ],
  limits: [],
  version: [],
  notify: ['title', 'body', 'priority'],
  'merge-lanes': ['base', 'lanes'],
  doctor: [],
  'evals triage': ['results', 'eval-dir'],
  'evals capture': ['run', 'out', 'task'],
  'evals calibrate': ['results', 'labels'],
  'evals promote': ['history', 'agreement'],
  'paths touched': ['commit'],
  'paths predicted': ['plan'],
  remediate: ['findings', 'round', ...GATE_BAND],
  review: ['findings', 'verdicts', 'changed', 'metrics', 'base', ...GATE_BAND],
  'review-policy': ['base'],
  'domain-context': ['changed', 'base'],
  'spec-audit': [],
  risk: ['paths'],
  ledger: [],
  'note add': ['file', 'surprise', 'rule', 'source'],
  'note derive': ['findings', 'source'],
  'note match': ['paths'],
  ready: ['findings', 'review', 'paths'],
  'outcomes append': ['record', 'run-id', 'state'],
  'outcomes list': [],
  // `--format` is accepted by every run-log verb so a stray one reaches the
  // handler's own message ("read by run-log show only") rather than a refusal.
  'run-log append': ['format', 'event'],
  'run-log list': ['format'],
  'run-log show': ['format', 'columns'],
  'run-log query': ['format', 'run', 'type', 'halted'],
  'run-log check': ['format', 'run-id', 'state'],
  'tasks tick': ['ids'],
  'tasks coverage': ['classified'],
  'verify plan': [
    'profile',
    'e2e',
    'context',
    'changed',
    'no-profile',
    'no-coverage',
    'no-lint',
    'typecheck-command',
    'lint-command',
    'pre-existing',
    'elapsed-ms',
    'budget-ms'
  ],
  'verify judge': ['plan', 'results', 'context', 'state', 'run-id', 'baseline', 'pre-existing', 'pre-existing-signatures'],
  'verify unit': ['result', 'baseline', 'pre-existing', 'pre-existing-signatures'],
  'verify spill': ['kind', 'input', 'run-id'],
  'verify exec': ['kind', 'command', 'cwd'],
  'verify baseline': ['report', 'baseline'],
  'verify coverage': ['base', 'report', 'baseline', 'compute-base'],
  'verify cluster': ['failures'],
  'verify repair': ['state'],
  'plan fingerprint': ['max-parallel', 'red-wave', 'mode', 'write', 'fingerprint'],
  'plan reuse': ['max-parallel', 'red-wave', 'mode', 'plan', 'fingerprint', 'out'],
  'wave-state create': ['plan', 'max-parallel'],
  'wave-state next': ['state'],
  'wave-state record-batch': ['state', 'result', 'write-state'],
  'wave-state record-verify': ['state', 'result', 'write-state'],
  'wave-state replan': ['state', 'groups', 'write-state'],
  'autonomy level': [],
  'autonomy record': ['blockers', 'human-override'],
  'autonomy clean': [],
  'autonomy state': [],
  'run start': runStartFlags(),
  'run classified': [...RUN_SHARED, 'classified'],
  'run record-batch': RUN_SHARED,
  'run judge': [...RUN_SHARED, 'context'],
  'run verify-final': RUN_SHARED,
  'run reviewed': RUN_SHARED,
  'run remediated': [...RUN_SHARED, 'round'],
  'run commit': RUN_SHARED,
  'run replan': RUN_SHARED,
  'run next': RUN_SHARED,
  'run close': [...RUN_SHARED, 'halt', 'notify', 'host-banners', 'host-observed']
}

/** leaf form -> the flags that leaf accepts beyond GLOBAL_FLAGS. */
export const SUBCOMMAND_FLAGS = Object.freeze(Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [k, Object.freeze([...v])])))

// `run start` carries its ship flags in one place; the other run verbs read the
// shared set. A key here is a subcommand with verbs, and a verb outside its list
// is the handler's own "unknown subcommand" message, not this module's call.
const GROUPS = new Set(Object.keys(TABLE).filter(k => k.includes(' ')).map(k => k.split(' ')[0]))

/**
 * The key of `SUBCOMMAND_FLAGS` the positional words name, or null when they name
 * none (an unknown subcommand, or a verb the handler will itself refuse).
 *
 * A group named with no verb (`outcomes`, which lists) resolves to a union of its
 * verbs' sets, because the handler may default to any of them.
 */
export function leafOf(positional) {
  const [sub, verb] = positional
  if (typeof sub !== 'string') return null
  if (typeof verb === 'string' && Object.hasOwn(TABLE, `${sub} ${verb}`)) return `${sub} ${verb}`
  if (Object.hasOwn(TABLE, sub)) return sub
  if (GROUPS.has(sub) && verb === undefined) return `${sub} *`
  return null
}

function acceptedFor(leaf) {
  const accepted = new Set(GLOBAL_FLAGS)
  if (Object.hasOwn(TABLE, leaf)) {
    for (const f of TABLE[leaf]) accepted.add(f)
  } else if (leaf.endsWith(' *')) {
    const head = leaf.slice(0, -2)
    for (const [key, flags] of Object.entries(TABLE)) if (key.startsWith(`${head} `)) for (const f of flags) accepted.add(f)
  }
  return accepted
}

/**
 * The first flag in `flags` the leaf the positionals name does not accept, as
 * `{ flag: '--x', leaf }`, or null. A subcommand the table does not know is not
 * this function's to refuse.
 */
export function firstUnknownFlag(positional, flags) {
  const leaf = leafOf(positional)
  if (!leaf) return null
  const accepted = acceptedFor(leaf)
  for (const name of Object.keys(flags || {})) {
    if (!accepted.has(name)) return { flag: `--${name}`, leaf: leaf.replace(/ \*$/, '') }
  }
  return null
}

/**
 * The help for the subcommand a reader asked about: the synopsis lines that begin
 * `  interlock <sub>`, with their continuation lines, and a pointer to the full
 * text (spec: cli/arguments, design D8). The full text when nothing matches.
 *
 * The long `<sub>:` sections further down the text are left to `interlock
 * --help`: several quote other subcommands, so including them would make one
 * subcommand's help read as another's.
 */
export function helpFor(usage, sub) {
  if (typeof sub !== 'string' || !sub) return usage
  const lines = usage.split('\n')
  const first = lines.findIndex(l => l.trim() === 'Usage:')
  const options = lines.findIndex((l, i) => i > first && /^[A-Z][A-Za-z ]*:$/.test(l))
  if (first < 0 || options < 0) return usage
  const head = new RegExp(`^  interlock ${sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`)
  const out = []
  let inside = false
  for (const line of lines.slice(first + 1, options)) {
    if (/^ {2}interlock\s/.test(line)) inside = head.test(line)
    if (inside && line.trim()) out.push(line)
  }
  if (!out.length) return usage
  return `Usage:\n${out.join('\n')}\n\nThe full text, with every flag described: interlock --help\n`
}
