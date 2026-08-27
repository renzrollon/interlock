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

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Prefer the bundled binary (always present next to this hook), fall back to PATH. */
function interlockBin() {
  const bundled = join(PLUGIN_ROOT, 'bin', 'interlock')
  if (existsSync(bundled)) return bundled
  return 'interlock' // let PATH resolution decide; a miss throws ENOENT below
}

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
      report(
        `interlock preflight could not run: ${(err && err.message) || String(err)}\n` +
          `The \`interlock\` binary is not resolvable from this session. Inside Claude Code the ` +
          `plugin's bin/ is normally injected; if you see this, reinstall the plugin. The session ` +
          `continues — this preflight is advisory.`
      )
      return
    }
  }

  let doctor
  try {
    doctor = JSON.parse(raw)
  } catch {
    report('interlock preflight ran but its output could not be parsed; skipping. The session continues.')
    return
  }

  const checks = Array.isArray(doctor.checks) ? doctor.checks : []
  const failures = checks.filter(c => c && c.status === 'fail')
  if (!failures.length) {
    const warns = (doctor.counts && doctor.counts.warn) || 0
    // A clean preflight is quiet, not a wall of output — one confirming line.
    report(`interlock preflight OK${warns ? ` (${warns} warning${warns === 1 ? '' : 's'})` : ''}.`)
    return
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
  report(lines.join('\n'))
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
  run()
} catch (err) {
  // Belt and suspenders: nothing this hook does may abort the session.
  process.stderr.write(`interlock preflight hook error (ignored): ${(err && err.message) || String(err)}\n`)
}
process.exit(0)
