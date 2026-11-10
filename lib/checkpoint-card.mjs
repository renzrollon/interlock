// The spec checkpoint card (make-the-run-surfaces-interactive, spec
// spec/checkpoint-card, design D5, D7, D12, D14, D24): what a person reads where
// `/interlock:spec` stops, as keyed lines.
//
// One renderer for two callers, so the CLI verb `interlock checkpoint <change>`
// and the spec pane cannot drift. It reads no file and decides nothing: every
// word but the last line's is a field the caller passed or a title the
// checkpoint document prints, and a field that was not passed reads `not observed`, never a zero, a pass or
// a clear. It combines nothing into a verdict of its own; the person picks the
// outcome.
//
// The questions and the five outcome titles are `docs/02-the-checkpoint.md`'s,
// and `test/spine/checkpoint-card.test.mjs` reads that file and fails when either
// list differs, both ways.
//
// One line is neither a field nor a title of the document: the last,
// `checkpoint-session`, is the published session-advice table's suggestion for
// the `ship` run, read through `lib/session-advice.mjs` (session-advice, design
// D16). It takes no field, so both callers print it the same by construction,
// and it states nothing about the session the card is read in.
//
// Node-free: `hooks/mod.mjs` runs inside the engine with no Node and imports
// this module, so it holds no Node-module import and no bare specifier
// (`test/spine/mod-pins.test.mjs` pins that for the module's import walk). Pure:
// fields in, lines out.

import { adviceLine } from './session-advice.mjs'

/** What a field the caller did not pass reads. */
export const NOT_OBSERVED = 'not observed'

/**
 * The question asked of each artifact, in the checkpoint document's reading
 * order: `id` is the artifact's key, `file` the name the document gives it.
 */
export const QUESTIONS = Object.freeze(
  [
    { id: 'proposal', file: 'proposal.md', question: 'Is this the change I asked for?' },
    { id: 'design', file: 'design.md', question: 'Would I have made these decisions?' },
    { id: 'tasks', file: 'tasks.md', question: 'Could someone else do this without asking me anything?' },
    { id: 'specs', file: 'specs/**', question: 'Does this describe behavior I can verify?' }
  ].map(entry => Object.freeze(entry))
)

/**
 * The five outcomes, in the document's order: the four ways it can look wrong,
 * then looking right. `title` is the document's wording.
 */
export const OUTCOMES = Object.freeze(
  [
    { id: 'wrong-idea', title: 'Wrong idea — the proposal is not your change' },
    { id: 'wrong-approach', title: 'Right idea, wrong approach' },
    { id: 'small-gaps', title: 'Right idea, small gaps' },
    { id: 'blockers', title: 'Blockers were reported' },
    { id: 'right', title: 'When it looks right' }
  ].map(entry => Object.freeze(entry))
)

const SPEC = '/interlock:spec'

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = value => typeof value === 'string' && value.trim() !== ''
const code = command => `\`${command}\``

// A name or path that can sit inside a code span and a command line unbroken.
const printable = value => isText(value) && !/[\s`<>]/.test(value)

/** A whole line the caller passed, kept as passed; `label: not observed` when it passed none. */
const passed = (value, label) => (isText(value) ? value : `${label}: ${NOT_OBSERVED}`)

/** The artifact line: its path and status beside its question. */
function artifactLine(question, given) {
  const path = isObject(given) && isText(given.path) ? given.path : NOT_OBSERVED
  const status = isObject(given) && isText(given.status) ? given.status : NOT_OBSERVED
  return { key: `checkpoint-artifact-${question.id}`, text: `${path} · ${status} · ${question.question}` }
}

/** One outcome's line: its title, what to do, and the command it runs when it has one. */
function outcomeLine(outcome, n, { change, findings }) {
  const named = printable(change) ? change : null
  const missingChange = 'no change name was observed, so no command is printed'
  let body
  switch (outcome.id) {
    case 'wrong-idea':
      body = `re-run ${code(SPEC)} with a sharper intent that states the boundary`
      break
    case 'wrong-approach':
      body = `say what you want instead and re-run ${code(SPEC)}`
      break
    case 'small-gaps':
      body = named
        ? `edit design.md or tasks.md yourself, then run ${code(`interlock validate ${named}`)}`
        : `edit design.md or tasks.md yourself; ${missingChange}`
      break
    case 'blockers':
      if (!named) body = `fix the cause, not the report; ${missingChange}`
      else if (printable(findings)) {
        body = `fix the cause, not the report, then re-gate with ${code(`/interlock:review-artifacts ${named} --since ${findings}`)}`
      } else {
        body = `fix the cause, not the report; no findings file was observed, so no re-gate command is printed`
      }
      break
    default:
      body = named ? `start the run with ${code(`/interlock:ship ${named}`)}` : `start the run; ${missingChange}`
  }
  return { key: `checkpoint-outcome-${n}`, text: `${outcome.title}: ${body}` }
}

/**
 * The card as `{ key, text }` lines, in print order: `checkpoint-artifact-<id>`
 * for each question, `checkpoint-ledger` and a `checkpoint-ledger-row-<id>` per
 * row, `checkpoint-validate`, `checkpoint-gate`, `checkpoint-findings`, then
 * `checkpoint-outcome-<n>` for n = 1..5, then `checkpoint-session`: the
 * table's session suggestion for the run, which takes no field.
 *
 * The ledger, validate and gate fields are whole lines the caller built from its
 * own readers, printed as passed; the card adds no verdict to them. Any field
 * absent reads `not observed`. A change name or findings path that could not sit
 * in a command unbroken is treated as absent for the command and the line says
 * so.
 *
 * @param {{change?: string, artifacts?: Array<{id: string, path?: string, status?: string}>,
 *   ledger?: string, ledgerRows?: Array<{id: string, question?: string}>,
 *   validate?: string, gate?: string, findings?: string}} [fields]
 * @returns {Array<{key: string, text: string}>}
 */
export function checkpointCard(fields) {
  const f = isObject(fields) ? fields : {}
  const artifacts = Array.isArray(f.artifacts) ? f.artifacts.filter(isObject) : []
  const lines = []
  for (const question of QUESTIONS) {
    lines.push(artifactLine(question, artifacts.find(a => a.id === question.id)))
  }
  lines.push({ key: 'checkpoint-ledger', text: passed(f.ledger, 'ledger') })
  for (const row of Array.isArray(f.ledgerRows) ? f.ledgerRows.filter(isObject) : []) {
    if (!isText(row.id)) continue
    lines.push({
      key: `checkpoint-ledger-row-${row.id}`,
      text: `  ${row.id}${isText(row.question) ? ` — ${row.question}` : ''}`
    })
  }
  lines.push({ key: 'checkpoint-validate', text: passed(f.validate, 'validate') })
  lines.push({ key: 'checkpoint-gate', text: passed(f.gate, 'gate') })
  lines.push({
    key: 'checkpoint-findings',
    text: isText(f.findings) ? `findings file: ${f.findings}` : `findings file: ${NOT_OBSERVED}`
  })
  OUTCOMES.forEach((outcome, i) => lines.push(outcomeLine(outcome, i + 1, f)))
  lines.push({ key: 'checkpoint-session', text: adviceLine('ship') })
  return lines
}
