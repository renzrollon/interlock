#!/usr/bin/env node
// SessionStart hook: run the preflight the run already owns, at the one moment
// it is cheap to act on — session start, before any wave.
//
// `interlock doctor` (lib/doctor.mjs) already computes the allowlist / Node /
// OpenSpec / writability preflight that decides whether a zero-touch run can
// even begin. The failure it catches — an un-allowlisted command that stalls
// wave four on an approval prompt no human is watching — is the expensive one.
// A human or a skill used to have to remember to run it; this hook fires it
// every session and surfaces any failure with the fix string the doctor emits.
//
// It NEVER blocks. `interlock doctor` is non-mutating, and a preflight that
// aborted the session because its own binary was missing would be worse than no
// preflight. Every path here exits 0.
//
// It also surfaces any interrupted-run note a previous session left — a run
// that ended with its session and never reached its close (lib/interrupted.mjs).
// A linked worktree's run writes its note into the state home — the main
// checkout — so the notes are read from the home the doctor resolved AND from
// the working directory (a run whose manifest recorded no home wrote there),
// each run spoken once. When the doctor gave no home — it could not run, or
// predates the field — the working directory alone, as before.
//
// It marks each note it speaks, in every directory the note was found in
// (show-preflight-and-interrupted-runs-at-session-start design D3). A session
// start now reaches the person as well as the model, through the hooks
// module's band, and a note nobody clears must not be said at every session
// start. The mark is `markSpoken`, the run program's own, and it fails toward
// speaking again: a note that cannot be marked stays unspoken on disk, so the
// next session start and the next `run start` say it again, and the report
// file below records why.
//
// In a project where a ship run can start — one whose working root holds
// `openspec/` — it leaves what it computed in `.claude/ship/preflight.json`
// (lib/preflight-file.mjs, design D1, D2): the doctor's verdict and checks,
// the notes it spoke and whether each mark landed, and the halt resume cards
// of open changes, listed from each card's first-line stamp and never read
// past it. The previous session's file is removed before the new one is
// written, so a failed write leaves no stale report; the failure is one line
// on stderr. Every other repository gets no file, no directory, and exactly
// the output it got before. The file is outcome-class: losing it costs the
// band, never the session.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Prefer the bundled binary (always present next to this hook), fall back to PATH. */
function interlockBin() {
  const bundled = join(PLUGIN_ROOT, 'bin', 'interlock')
  if (existsSync(bundled)) return bundled
  return 'interlock' // let PATH resolution decide; a miss throws ENOENT below
}

/**
 * The preflight's own report, as one message; the state home and surface the
 * doctor resolved — `null` when its output carried none or could not be read;
 * and the doctor's verdict as the report file carries it (design D1).
 *
 * @returns {{ message: string, stateHome: string|null, surface: string|null, doctor: object }}
 */
function run() {
  let raw
  try {
    raw = execFileSync(interlockBin(), ['doctor', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000
    })
  } catch (err) {
    // Two shapes of failure. A non-zero exit still carries JSON on stdout (the
    // doctor exits 1 when a check fails) — parse it. A spawn failure (ENOENT:
    // no binary) has no stdout, and that is the "binary not resolvable" case.
    if (err && typeof err.stdout === 'string' && err.stdout.trim()) {
      raw = err.stdout
    } else {
      return {
        message:
          `interlock preflight could not run: ${(err && err.message) || String(err)}\n` +
          `The \`interlock\` binary is not resolvable from this session. Inside Claude Code the ` +
          `plugin's bin/ is normally injected; if you see this, reinstall the plugin. The session ` +
          `continues — this preflight is advisory.`,
        stateHome: null,
        surface: null,
        doctor: { ran: false, parsed: false, ok: null, counts: null, checks: [] }
      }
    }
  }

  let doctor
  try {
    doctor = JSON.parse(raw)
  } catch {
    doctor = null
  }
  if (!doctor || typeof doctor !== 'object') {
    return {
      message: 'interlock preflight ran but its output could not be parsed; skipping. The session continues.',
      stateHome: null,
      surface: null,
      doctor: { ran: true, parsed: false, ok: null, counts: null, checks: [] }
    }
  }
  const stateHome =
    typeof doctor.stateHome === 'string' && doctor.stateHome ? resolve(process.cwd(), doctor.stateHome) : null

  const surface = typeof doctor.surface === 'string' && doctor.surface ? doctor.surface : null

  const checks = Array.isArray(doctor.checks) ? doctor.checks : []
  // The checks as the file carries them: the fix travels, the evidence does not (design D1).
  const verdict = {
    ran: true,
    parsed: true,
    ok: typeof doctor.ok === 'boolean' ? doctor.ok : null,
    counts: doctor.counts && typeof doctor.counts === 'object' ? doctor.counts : null,
    checks: checks.filter(c => c && typeof c === 'object').map(c => ({ id: c.id, status: c.status, detail: c.detail, fix: c.fix ?? null }))
  }
  const failures = checks.filter(c => c && c.status === 'fail')
  if (!failures.length) {
    const warns = (doctor.counts && doctor.counts.warn) || 0
    // A clean preflight is quiet, not a wall of output — one confirming line.
    return {
      message: `interlock preflight OK${warns ? ` (${warns} warning${warns === 1 ? '' : 's'})` : ''}.`,
      stateHome,
      surface,
      doctor: verdict
    }
  }

  const lines = ['interlock preflight found issues that can stall an unattended ship run:']
  for (const c of failures) {
    lines.push(`  [FAIL] ${c.id}: ${c.detail}`)
    if (c.fix) {
      const [first, ...rest] = String(c.fix).split('\n')
      lines.push(`     fix: ${first}`)
      for (const line of rest) lines.push(`          ${line.trim()}`)
    }
  }
  lines.push('The session still starts — apply the fixes above before /interlock:ship.')
  return { message: lines.join('\n'), stateHome, surface, doctor: verdict }
}

/** Two paths naming one directory — through a symlink too — so one directory is read once. */
function sameDirectory(a, b) {
  const canonical = p => {
    try {
      return realpathSync(p)
    } catch {
      return resolve(p)
    }
  }
  return canonical(a) === canonical(b)
}

/**
 * One line per interrupted-run note not yet spoken, and one per note that
 * could not be read, from the state home and then the working directory, each
 * spoken note marked in every directory it was found in (design D3). A run
 * whose note is in both is one interrupted run, spoken once and marked in
 * both. Loaded on demand rather than imported, so a hook that finds its
 * library missing still exits 0 — and says so instead of falling silent.
 *
 * @returns {Promise<{lines: string[], spoken: object[], unreadable: Array<{file: string, reason: string}>}>}
 */
async function interruptedNotes(cwd, stateHome) {
  let lib
  try {
    lib = await import(new URL('../lib/interrupted.mjs', import.meta.url).href)
  } catch (err) {
    const reason = (err && err.message) || String(err)
    return { lines: [`interrupted-run notes could not be read: ${reason}`], spoken: [], unreadable: [{ file: 'lib/interrupted.mjs', reason }] }
  }
  const roots = stateHome && !sameDirectory(stateHome, cwd) ? [stateHome, cwd] : [cwd]
  const found = new Map()
  const unreadable = []
  for (const root of roots) {
    const { notes, unreadable: bad } = lib.readInterruptedNotes(root)
    for (const note of notes.filter(lib.isUnspoken)) {
      if (!found.has(note.runId)) found.set(note.runId, { note, roots: [] })
      found.get(note.runId).roots.push(root)
    }
    // The working directory's notes keep their root-relative names; the home's are named in full.
    for (const u of bad) unreadable.push({ file: root === cwd ? u.file : join(root, u.file), reason: u.reason })
  }
  const banners = []
  const spoken = []
  for (const { note, roots: where } of found.values()) {
    const banner = lib.formatInterruptedBanner(note)
    banners.push(banner)
    // Spoken, then marked: a mark that fails leaves the note to be said again.
    const at = new Date().toISOString()
    const marks = where.map(root => {
      const m = lib.markSpoken(root, note.runId, at)
      return { root, marked: m.marked === true, reason: m.marked === true ? null : m.reason }
    })
    spoken.push({ runId: note.runId, change: note.change, stage: note.stage, banner, marked: marks.every(m => m.marked), marks })
  }
  return {
    lines: [...banners, ...unreadable.map(u => `An interrupted-run note could not be read: ${u.file}: ${u.reason}`)],
    spoken,
    unreadable
  }
}

/**
 * The halt resume cards of open changes under the state home and the working
 * directory, listed from each card's stamp (design D4). The listing reads no
 * card past its first line, and the advisory output never mentions a card.
 */
async function resumeCards(cwd, stateHome) {
  const roots = stateHome && !sameDirectory(stateHome, cwd) ? [stateHome, cwd] : [cwd]
  try {
    const lib = await import(new URL('../lib/resume-card.mjs', import.meta.url).href)
    return lib.listResumeCards({ roots, changesDir: join(cwd, 'openspec', 'changes') })
  } catch (err) {
    const reason = `halt resume cards could not be listed: ${(err && err.message) || String(err)}`
    return { listed: [], archived: 0, unreadable: [{ path: join(cwd, '.claude', 'handoff'), reason }], lookedIn: [] }
  }
}

/** A project where a ship run can start: the working root holds an `openspec/` directory (design D2). */
function isOpenSpecProject(cwd) {
  try {
    return statSync(join(cwd, 'openspec')).isDirectory()
  } catch {
    return false
  }
}

/**
 * Leave this session's report in `.claude/ship/preflight.json` (design D1,
 * D2): the previous file removed first, so a write that fails leaves no stale
 * report, then the new one written whole. A failure is one stderr line, and
 * the session starts as before.
 */
async function writeReport(cwd, input) {
  let path = join(cwd, '.claude', 'ship', 'preflight.json')
  try {
    const lib = await import(new URL('../lib/preflight-file.mjs', import.meta.url).href)
    path = join(cwd, lib.PREFLIGHT_FILE)
    rmSync(path, { force: true })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(lib.buildPreflightReport(input), null, 2) + '\n')
  } catch (err) {
    process.stderr.write(`interlock preflight: report not written: ${path}: ${(err && err.message) || String(err)}\n`)
  }
}

/**
 * The session-start source from the host's event on stdin (`startup`,
 * `resume`, `clear`, `compact`), or `null`: the report records it so the
 * hooks module keeps a band hidden across a compaction (design D5).
 */
async function sessionSource() {
  try {
    if (process.stdin.isTTY) return null
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8').trim()
    const event = raw ? JSON.parse(raw) : null
    return event && typeof event.source === 'string' ? event.source : null
  } catch {
    return null
  }
}

/**
 * Surface advisory context to the session. SessionStart stdout is folded into
 * the session context by the host; the structured form makes the intent
 * explicit and is ignored harmlessly by a host that does not read it.
 */
function report(message) {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: message
    }
  }
  process.stdout.write(JSON.stringify(out) + '\n')
}

/** A single-quoted shell word. A value with a newline or a NUL is refused. */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function publishable(value) {
  return typeof value === 'string' && value.trim() && !/[\0\r\n]/.test(value)
}

/**
 * Copy a plugin option into the session so `interlock notify` can see it.
 *
 * The host injects `userConfig` into hook processes only. A ship run's notify
 * call is not a hook, so without this copy a topic typed into the plugin
 * options would never reach the CLI. An operator who already provided the
 * shell variable keeps that value. Nothing is printed, and a failure here
 * does not change the preflight.
 */
function publishNotifyOptions() {
  const file = process.env.CLAUDE_ENV_FILE
  if (typeof file !== 'string' || !file) return
  const lines = []
  const topic = process.env.CLAUDE_PLUGIN_OPTION_NTFY_TOPIC
  const url = process.env.CLAUDE_PLUGIN_OPTION_NTFY_URL
  if (publishable(topic) && !publishable(process.env.INTERLOCK_NTFY_TOPIC)) {
    lines.push(`export INTERLOCK_NTFY_TOPIC=${shellQuote(topic.trim())}`)
  }
  if (publishable(url) && !publishable(process.env.INTERLOCK_NTFY_URL)) {
    lines.push(`export INTERLOCK_NTFY_URL=${shellQuote(url.trim())}`)
  }
  if (!lines.length) return
  appendFileSync(file, lines.join('\n') + '\n')
}

try {
  try {
    publishNotifyOptions()
  } catch (err) {
    process.stderr.write(
      `interlock preflight could not publish notify options (ignored): ${(err && err.message) || err}\n`
    )
  }
  const cwd = process.cwd()
  const source = await sessionSource()
  const { message, stateHome, surface, doctor } = run()
  const notes = await interruptedNotes(cwd, stateHome)
  const lines = [message, ...notes.lines].filter(Boolean)
  // Written before stdout, so a session that reads the context has the file on disk already (design D10).
  if (isOpenSpecProject(cwd)) {
    await writeReport(cwd, {
      writtenAt: new Date().toISOString(),
      source,
      root: cwd,
      stateHome,
      surface,
      message,
      doctor,
      notes: { spoken: notes.spoken, unreadable: notes.unreadable },
      cards: await resumeCards(cwd, stateHome)
    })
  }
  if (lines.length) report(lines.join('\n'))
} catch (err) {
  // Belt and suspenders: nothing this hook does may abort the session.
  process.stderr.write(`interlock preflight hook error (ignored): ${(err && err.message) || String(err)}\n`)
}
process.exit(0)
