// The interrupted-run note (design D7) — what a session that ended mid-run
// leaves behind, since it never reached `run close`.
//
// A session that ends while a ship run is live kills the background workflow
// before its close: no receipt, no resume card, no terminal trajectory event, in
// exactly the place a reader most needs one. The SessionEnd recorder
// (`hooks/recorder.mjs`) writes one small note here instead, and three readers
// speak it from the one text below: `interlock run start`, the SessionStart
// preflight, and `interlock report`.
//
// ONE FILE PER RUN, NEVER DELETED. `.claude/ship/interrupted/<runId>.json`. Keyed
// by run, not by change, so two interrupted runs of one change do not overwrite
// each other; marked spoken rather than deleted, so `interlock report` can still
// join it to its trajectory after `run start` has spoken it.
//
// OUTCOME-CLASS, NOT FATAL. A failed write is a stderr line from the hook; an
// unreadable note or a failed mark is a note on the manifest. Nothing here moves
// an exit code. That is the opposite of the run trajectory (`.claude/ship/runs`),
// whose failed append exits 1 — and the difference is deliberate: the note points
// at records written elsewhere, while the trajectory IS the record. See
// docs/13-the-guards.md before making the two consistent.
//
// Every function collapses a failure to a value and never throws, because two of
// its callers are hooks, and a hook whose own crash is its output is worse than
// no hook.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SHIP_DIR } from './ship-stage.mjs'

export const INTERRUPTED_SCHEMA = 'interlock.interrupted/1'

/** Where the notes live, under the ship directory the doctor already probes. */
export const INTERRUPTED_DIR = join(SHIP_DIR, 'interrupted')

/**
 * The host's end reason is stored verbatim but bounded, to the same length the
 * trajectory bounds its own free text to (`MAX_TEXT` in `lib/run-log.mjs`;
 * `test/hooks.test.mjs` pins the two equal). Restated rather than imported so a
 * hook loads two small modules and not the trajectory writer.
 */
export const REASON_MAX = 500

function messageOf(err) {
  return (err && err.message) || String(err)
}

/** The note's path for a run, rooted at `root`. */
export function interruptedPath(root, runId) {
  return join(root, INTERRUPTED_DIR, `${runId}.json`)
}

/** A run id safe to name a file after: the shape `createRunState` mints, and nothing with a separator. */
function usableRunId(runId) {
  return typeof runId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId) && runId.length <= 200
}

/**
 * Write the note for one interrupted run: one `mkdirSync`, one `writeFileSync`,
 * no subprocess. The reason is the host's, stored as given and bounded; nothing
 * branches on its value, because the host's enum is not verified.
 *
 * @param {string} root
 * @param {{runId: string, change: string, sessionId: string, reason?: string, stage: string, at?: string}} note
 * @returns {{written: true, path: string} | {written: false, reason: string}}
 */
export function writeInterruptedNote(root, { runId, change, sessionId, reason, stage, at } = {}) {
  if (!usableRunId(runId)) return { written: false, reason: `not a usable run id: ${JSON.stringify(runId)}` }
  const text = typeof reason === 'string' ? reason : reason === undefined || reason === null ? null : String(reason)
  const note = {
    schema: INTERRUPTED_SCHEMA,
    runId,
    change: typeof change === 'string' ? change : null,
    sessionId: typeof sessionId === 'string' ? sessionId : null,
    reason: text === null ? null : text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 1)}…` : text,
    stage: typeof stage === 'string' ? stage : null,
    at: typeof at === 'string' ? at : new Date().toISOString(),
    spokenAt: null
  }
  const path = interruptedPath(root, runId)
  try {
    mkdirSync(join(root, INTERRUPTED_DIR), { recursive: true })
    writeFileSync(path, JSON.stringify(note, null, 2) + '\n')
    return { written: true, path }
  } catch (err) {
    return { written: false, reason: `${path}: ${messageOf(err)}` }
  }
}

/**
 * Every note in the root. A note that does not parse, or parses to something
 * that is not a note, is returned under `unreadable` by name and reason — never
 * skipped, because a note nobody can read is still a run nobody closed.
 *
 * `file` is the note's path relative to `root`, which is how every reader names
 * it. An absent directory is no notes and no error.
 *
 * @returns {{notes: object[], unreadable: Array<{file: string, reason: string}>}}
 */
export function readInterruptedNotes(root) {
  const dir = join(root, INTERRUPTED_DIR)
  let names
  try {
    names = readdirSync(dir).filter(name => name.endsWith('.json')).sort()
  } catch (err) {
    if (err && err.code === 'ENOENT') return { notes: [], unreadable: [] }
    return { notes: [], unreadable: [{ file: INTERRUPTED_DIR, reason: messageOf(err) }] }
  }
  const notes = []
  const unreadable = []
  for (const name of names) {
    const file = join(INTERRUPTED_DIR, name)
    let value
    try {
      value = JSON.parse(readFileSync(join(root, file), 'utf8'))
    } catch (err) {
      unreadable.push({ file, reason: messageOf(err) })
      continue
    }
    if (!value || typeof value !== 'object' || typeof value.runId !== 'string' || !value.runId) {
      unreadable.push({ file, reason: 'not an interrupted-run note: no runId' })
      continue
    }
    notes.push({ ...value, file })
  }
  return { notes, unreadable }
}

/** A note not yet spoken by a run start. */
export function isUnspoken(note) {
  return Boolean(note) && (note.spokenAt === null || note.spokenAt === undefined)
}

/**
 * Mark a note spoken, rewriting it in place with `spokenAt` set. A note that
 * cannot be marked is spoken again at the next run start — the right direction
 * to fail in — and the caller says so.
 *
 * @returns {{marked: true} | {marked: false, reason: string}}
 */
export function markSpoken(root, runId, at = new Date().toISOString()) {
  if (!usableRunId(runId)) return { marked: false, reason: `not a usable run id: ${JSON.stringify(runId)}` }
  const path = interruptedPath(root, runId)
  try {
    const note = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify({ ...note, spokenAt: at }, null, 2) + '\n')
    return { marked: true }
  } catch (err) {
    return { marked: false, reason: `${path}: ${messageOf(err)}` }
  }
}

/** The one line every reader prints for a note. */
export function formatInterruptedBanner(note) {
  const n = note && typeof note === 'object' ? note : {}
  const change = typeof n.change === 'string' && n.change ? n.change : '(unnamed change)'
  const stage = typeof n.stage === 'string' && n.stage ? n.stage : 'unknown'
  return (
    `PREVIOUS RUN INTERRUPTED: ${change} run ${n.runId} ended at stage ${stage} — ` +
    `no resume card was written; interlock run-log show ${n.runId}`
  )
}

/** The line a reader prints for a note it could not read. */
export function formatUnreadableNote(entry) {
  return `INTERRUPTED NOTE UNREADABLE: ${entry.file}: ${entry.reason}`
}
