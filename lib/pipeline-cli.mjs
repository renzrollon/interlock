// The `interlock pipeline` subcommand, moved out of `cli/interlock` to keep that
// file inside the plugin directory's size headroom (test/spine/package.test.mjs).
//
// The entry file's own output and exit helpers come in as `io` — `emit`, `die`,
// `warn`, `readStdin`, `writeJsonAtomic` — so stdout, stderr and exit codes stay
// exactly the CLI's. `lib/pipeline.mjs` decides everything; this owns the files.

import { existsSync, readFileSync, rmSync } from 'node:fs'

import { pendingFromGitlabPr, pipelineFromGithub, pipelineFromGitlab } from './pipeline.mjs'

/** A repeatable name flag as a list: absent is none, one use is a list of one. A use with no value ends the command. */
function nameList(flags, key, fail) {
  const value = flags[key]
  if (value === undefined) return []
  const given = [].concat(value)
  if (given.some(v => typeof v !== 'string' || !v)) fail(`--${key} needs a check name`)
  return given
}

/**
 * `interlock pipeline`: a platform's own check document in, the pipeline input
 * `merge-confidence --pipeline` reads out (design D2 of
 * label-and-harden-the-merge-verdict). Offline by construction: it reads the
 * document it is handed, from a file or standard input, and never gh, glab or
 * the network. `lib/pipeline.mjs` decides everything; this owns the files.
 *
 * Every way this command produces no input goes through `refuse`, which removes
 * an earlier file at `--out` first and says so. A fixed output path that kept
 * its last good file would hand the next command an earlier moment's checks,
 * with a commit that may still match.
 */
export function pipelineCommand(io, flags, json) {
  const outPath = typeof flags.out === 'string' && flags.out ? flags.out : null
  const refuse = message => {
    if (outPath && existsSync(outPath)) {
      try {
        rmSync(outPath, { force: true })
        io.warn(`removed ${outPath}: no pipeline input was produced, so the earlier file there is not left for the next command to read`)
      } catch (err) {
        io.warn(`${outPath} could not be removed (${err.message}): it still holds an earlier file, which describes an earlier moment`)
      }
    }
    io.die(message)
  }
  if (flags.out === true) refuse('--out needs a file')

  const platforms = ['github', 'gitlab-pr', 'gitlab'].filter(key => flags[key] !== undefined)
  if (platforms.length !== 1) {
    refuse(
      `pipeline needs exactly one of --github, --gitlab-pr or --gitlab, each with the platform's document ` +
        `(a file, or "-" for stdin)${platforms.length ? `; got ${platforms.map(p => `--${p}`).join(' and ')}` : ''}`
    )
  }
  const platform = platforms[0]
  const source = flags[platform]
  if (source === true) refuse(`--${platform} needs the platform's document: a file, or "-" for stdin`)

  const required = nameList(flags, 'required', refuse)
  const exclude = nameList(flags, 'exclude', refuse)
  if (platform !== 'github' && required.length) {
    refuse(`--required is read with --github only: on GitLab a job is required when its allow_failure is false`)
  }
  if (platform === 'gitlab-pr' && exclude.length) {
    refuse('--exclude is read with --github and --gitlab: the pull request document carries no checks to leave out')
  }
  if (platform === 'gitlab-pr' && !outPath) {
    refuse('--gitlab-pr needs --out <file>: the head commit travels to "interlock pipeline --gitlab --pending <file>" in that file')
  }

  // The record of the first GitLab step, read before anything at --out is
  // touched: --pending and --out may name the same path.
  let record = null
  if (platform === 'gitlab') {
    if (typeof flags.pending !== 'string' || !flags.pending || flags.pending === '-') {
      refuse('--gitlab needs --pending <file>: the file "interlock pipeline --gitlab-pr --out <file>" wrote, which carries the head commit')
    }
    try {
      record = JSON.parse(readFileSync(flags.pending, 'utf8'))
    } catch (err) {
      refuse(`--pending ${flags.pending} could not be read as JSON: ${err.message}`)
    }
  }

  let raw
  try {
    raw = source === '-' ? io.readStdin() : readFileSync(source, 'utf8')
  } catch (err) {
    refuse(`--${platform} ${source} could not be read: ${err.message}`)
  }
  let doc
  try {
    doc = JSON.parse(raw)
  } catch (err) {
    refuse(`--${platform} ${source === '-' ? '(stdin)' : source} is not valid JSON: ${err.message}`)
  }

  const read =
    platform === 'github'
      ? pipelineFromGithub(doc, { required, exclude })
      : platform === 'gitlab-pr'
        ? pendingFromGitlabPr(doc)
        : pipelineFromGitlab(doc, record, { exclude })
  if (!read.ok) refuse(`--${platform} ${source === '-' ? '(stdin)' : source}: ${read.reason}`)
  for (const note of read.notes || []) io.warn(note)

  const produced = read.pending || read.input
  if (outPath) {
    try {
      io.writeJsonAtomic(outPath, produced)
    } catch (err) {
      refuse(`--out ${outPath} could not be written: ${err.message}`)
    }
  }

  if (read.pending) {
    io.emit(json, read.pending, `pending ${read.pending.sha}: head pipeline ${read.pending.headPipeline}\n`)
    return
  }
  const { input } = read
  const count = state => input.checks.filter(c => c.state === state).length
  const requiredNames = input.checks.filter(c => c.required).map(c => c.name)
  // GitHub's required set is the caller's to give; GitLab states it per job.
  const requiredText = platform === 'github' && !required.length ? 'not given' : requiredNames.join(', ') || 'none'
  io.emit(
    json,
    input,
    `pipeline ${input.sha}: ${input.checks.length} check(s) (${count('pass')} pass, ${count('fail')} fail, ` +
      `${count('pending')} pending, ${count('skipped')} skipped); required: ${requiredText}; ` +
      `excluded: ${input.excluded.join(', ') || 'none'}\n`
  )
}
