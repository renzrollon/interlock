#!/usr/bin/env node
// PreToolUse guard: no `git commit` outside the commit stage.
//
// `skills/commit/SKILL.md` and `skills/mr/SKILL.md` already set
// `disable-model-invocation: true` — the prose version of "do not commit until
// the commit stage." This guard is the deterministic half of the same intent: a
// Bash command that performs a `git commit` is denied unless the run's stage is
// `commit`. It bounds IN-RUN agents; it deliberately does NOT bound the human's
// own shell, so when there is no active run marker it fails open — blocking a
// developer's own commit on a stray marker would be the worse failure.
//
// The match canonicalises enough to catch `git commit`, `git -C <path> commit`,
// `git -c key=val commit`, and a leading-env invocation (`FOO=bar git commit`),
// across `&&`/`;`/`|` chains. It is a guardrail against the wrong-stage mistake,
// not a sandbox against a determined adversary.

import { readStage } from '../lib/ship-stage.mjs'
import { readEvent, allow, deny, toolName, toolInput, projectRoot } from './_shared.mjs'

const GUARD = 'guard-commit'

// git global options that take an argument, so the scan can step past the value
// and still find the `commit` subcommand after them.
const OPTS_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

/** Does `command` perform a git commit in any of its chained segments? */
export function isGitCommit(command) {
  if (typeof command !== 'string') return false
  for (const segment of command.split(/&&|\|\||;|\|/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    let i = 0
    // Leading environment assignments: FOO=bar git commit.
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++
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

try {
  const event = await readEvent()
  if (toolName(event) !== 'Bash') allow()

  const command = toolInput(event).command
  if (!isGitCommit(command)) allow()

  const { stage } = readStage({ root: projectRoot(event) })
  if (stage === 'commit') allow() // the commit stage is exactly when a commit is legal
  if (stage === 'unknown') allow() // no active run to bound — the human's own shell is not our business

  deny(
    `${GUARD}: \`git commit\` is blocked during the ${stage} stage of a ship run — commits are made ` +
      `only in the commit stage, by the commit step, as one feature-level commit. This is the ` +
      `deterministic form of the disable-model-invocation flag on skills/commit.`,
    { guard: GUARD, command: String(command), stage }
  )
} catch (err) {
  allow(`${GUARD}: internal error, allowing by default: ${(err && err.message) || String(err)}`)
}
