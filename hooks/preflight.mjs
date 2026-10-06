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
// It marks nothing: the next `interlock run start`, where the reader is about to
// spend agents, is the moment that marks a note spoken. A linked worktree's run
// writes its note into the state home — the main checkout — so the notes are
// read from the home the doctor resolved AND from the working directory (a run
// whose manifest recorded no home wrote there), each run spoken once. When the
// doctor gave no home — it could not run, or predates the field — the working
// directory alone, as before.

import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
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
 * The preflight's own report, as one message, and the state home the doctor
 * resolved — `null` when its output carried none or could not be read.
 *
 * @returns {{ message: string, stateHome: string|null }}
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
        stateHome: null
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
      stateHome: null
    }
  }
  const stateHome =
    typeof doctor.stateHome === 'string' && doctor.stateHome ? resolve(process.cwd(), doctor.stateHome) : null

  const checks = Array.isArray(doctor.checks) ? doctor.checks : []
  const failures = checks.filter(c => c && c.status === 'fail')
  if (!failures.length) {
    const warns = (doctor.counts && doctor.counts.warn) || 0
    // A clean preflight is quiet, not a wall of output — one confirming line.
    return { message: `interlock preflight OK${warns ? ` (${warns} warning${warns === 1 ? '' : 's'})` : ''}.`, stateHome }
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
  return { message: lines.join('\n'), stateHome }
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
 * could not be read, from the state home and then the working directory. A run
 * whose note is in both is one interrupted run, spoken once. Loaded on demand
 * rather than imported, so a hook that finds its library missing still exits 0
 * — and says so instead of falling silent.
 */
async function interruptedLines(cwd, stateHome) {
  let lib
  try {
    lib = await import(new URL('../lib/interrupted.mjs', import.meta.url).href)
  } catch (err) {
    return [`interrupted-run notes could not be read: ${(err && err.message) || String(err)}`]
  }
  const roots = stateHome && !sameDirectory(stateHome, cwd) ? [stateHome, cwd] : [cwd]
  const spoken = new Set()
  const banners = []
  const unreadableLines = []
  for (const root of roots) {
    const { notes, unreadable } = lib.readInterruptedNotes(root)
    for (const note of notes.filter(lib.isUnspoken)) {
      if (spoken.has(note.runId)) continue
      spoken.add(note.runId)
      banners.push(lib.formatInterruptedBanner(note))
    }
    // The working directory's notes keep their root-relative names; the home's are named in full.
    for (const u of unreadable) {
      unreadableLines.push(`An interrupted-run note could not be read: ${root === cwd ? u.file : join(root, u.file)}: ${u.reason}`)
    }
  }
  return [...banners, ...unreadableLines]
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

try {
  const { message, stateHome } = run()
  const lines = [message, ...(await interruptedLines(process.cwd(), stateHome))].filter(Boolean)
  if (lines.length) report(lines.join('\n'))
} catch (err) {
  // Belt and suspenders: nothing this hook does may abort the session.
  process.stderr.write(`interlock preflight hook error (ignored): ${(err && err.message) || String(err)}\n`)
}
process.exit(0)
