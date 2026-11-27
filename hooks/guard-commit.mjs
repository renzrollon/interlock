#!/usr/bin/env node
// PreToolUse guard: no `git commit` outside the commit stage.
//
// `skills/commit/SKILL.md` and `skills/settle/SKILL.md` already set
// `disable-model-invocation: true` — the prose version of "do not commit until
// the commit stage." This guard is the deterministic half of the same intent: a
// Bash command that performs a `git commit` is denied unless the run's stage is
// `commit`. It bounds IN-RUN agents; it deliberately does NOT bound the human's
// own shell, so when there is no active run marker it fails open — blocking a
// developer's own commit on a stray marker would be the worse failure.
//
// The match canonicalises enough to catch `git commit`, `git -C <path> commit`,
// `git -c key=val commit`, and a leading-env invocation (`FOO=bar git commit`),
// across `&&`/`;`/`|` chains AND newlines — a multi-line script is the ordinary
// shape of a Bash tool call, not an evasion, so a chain split by a line break
// must segment the same way one split by `&&` does. A segment led by a shell
// keyword (`then`, `do`, `else`) is scanned past it, so `if …; then git commit;
// fi` is seen. It is a guardrail against the wrong-stage mistake, not a sandbox
// against a determined adversary.

import { readStage, owedClose } from '../lib/ship-stage.mjs'
import { isChangeName } from '../lib/artifact-snapshot.mjs'
import { readEvent, allow, deny, toolName, toolInput, projectRoot } from './_shared.mjs'

const GUARD = 'guard-commit'

// git global options that take an argument, so the scan can step past the value
// and still find the `commit` subcommand after them.
const OPTS_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

// Shell keywords that can lead a segment and are followed by the command
// itself: `if true; then git commit`, `for f in *; do git commit`.
const LEADING_KEYWORDS = new Set(['then', 'do', 'else'])

/** Does `command` perform a git commit in any of its chained segments? */
export function isGitCommit(command) {
  if (typeof command !== 'string') return false
  for (const segment of command.split(/&&|\|\||;|\||\r?\n|\r/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    let i = 0
    // Leading environment assignments: FOO=bar git commit.
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++
    // …then a leading shell keyword, so `then git commit` is scanned like
    // `git commit`.
    while (i < tokens.length && LEADING_KEYWORDS.has(tokens[i])) i++
    if (tokens[i] !== 'git') continue
    i++
    // git's own global options, some of which consume the next token.
    while (i < tokens.length && tokens[i].startsWith('-')) {
      const opt = tokens[i]
      i++
      if (OPTS_WITH_ARG.has(opt) && !opt.includes('=')) i++ // step past its argument
    }
    if (tokens[i] === 'commit') return true
  }
  return false
}

// A run id the denial may quote: a plain identifier, never free text.
const PLAIN_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

/**
 * What the denial says after its first sentence: an `agent:` line for an agent
 * inside an active run (do not commit, do not close or halt the run), then a
 * `person:` line for a person whose run has already stopped (the way to clear
 * the marker). Each line leads with its remedy, and the condition it applies
 * under comes after.
 *
 * The advice to close rests on the run manifest being USABLE and MATCHING — the
 * one condition under which `interlock run close --halt` clears this very file
 * (`runClose` clears only `stagePath(manifest.change)`). Anything else — no
 * manifest, an unreadable or foreign one, another change's, a marker stored
 * outside its own change's directory, a read that threw — names the marker to
 * remove by hand and no run id. A failed read changes this text, never the
 * decision to deny. The denied command is never quoted, so two different commit
 * commands give one reason.
 *
 * @returns {Promise<{ text: string, change?: string, runId?: string, error?: string }>}
 */
async function wayOut(marker, root) {
  const path = typeof marker.path === 'string' ? marker.path : null
  const change = isChangeName(marker.change) ? marker.change : null
  const where = path ? `the stage marker at ${path}` : 'the stage marker'
  const inRun =
    `agent: do not commit, and do not close or halt the run — inside an active run, ` +
    `the run's own commit step makes the commit.`

  let runId = null
  let error = null
  let usable = false
  try {
    if (change && path === `.claude/ship/${change}/stage.json`) {
      const { inspectManifest } = await import('../lib/run.mjs')
      const inspected = inspectManifest(root)
      if (inspected.status === 'ok' && inspected.manifest && inspected.manifest.change === change) {
        usable = true
        const id = inspected.manifest.runId
        if (typeof id === 'string' && PLAIN_RUN_ID.test(id)) runId = id
      }
    }
  } catch (err) {
    usable = false
    runId = null
    error = (err && err.message) || String(err)
  }

  const subject = change ? `the run for change ${change}${runId ? ` (run ${runId})` : ''}` : 'the run'
  if (usable && path) {
    const { command } = owedClose(path)
    return {
      text: `${inRun}\nperson: run \`${command}\` to clear ${where} — if ${subject} has already stopped.`,
      change,
      runId,
      error
    }
  }
  return {
    text:
      `${inRun}\nperson: remove ${where} by hand — if ` +
      `${change ? `the run for change ${change}` : 'the run'} has already stopped.`,
    change,
    error
  }
}

try {
  const event = await readEvent()
  if (toolName(event) !== 'Bash') allow()

  const command = toolInput(event).command
  if (!isGitCommit(command)) allow()

  const marker = readStage({ root: projectRoot(event) })
  const { stage } = marker
  if (stage === 'commit') allow() // the commit stage is exactly when a commit is legal
  if (stage === 'unknown') allow() // no active run to bound — the human's own shell is not our business

  const way = await wayOut(marker, projectRoot(event))
  const detail = { guard: GUARD, command: String(command), stage }
  if (way.change) detail.change = way.change
  if (way.runId) detail.runId = way.runId
  if (way.error) detail.manifestError = way.error

  deny(
    `${GUARD}: \`git commit\` is blocked during the ${stage} stage of a ship run — commits are made ` +
      `only in the commit stage, by the commit step, as one feature-level commit. This is the ` +
      `deterministic form of the disable-model-invocation flag on skills/commit.\n` +
      way.text,
    detail
  )
} catch (err) {
  allow(`${GUARD}: internal error, allowing by default: ${(err && err.message) || String(err)}`)
}
