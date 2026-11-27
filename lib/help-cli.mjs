// The help surface of `interlock`: the grouped index a bare invocation prints,
// the `help` subcommand, and the refusal an unknown command gets (spec:
// cli/arguments; design D2-D4 of answer-the-design-critique).
//
// `interlock --help` keeps printing the full usage, so everything that reads it
// as the whole text (tests, the postinstall smoke, CI) is unaffected. The
// refusal keeps `Unknown command: <name>` as its first stderr line and exit 1,
// which `lib/doctor.mjs` and the spec skill's version-skew check key on; only
// what follows that line changed.
//
// The usage text and the settle help stay in `cli/interlock` and
// `lib/settle-cli.mjs`; they are passed in, so this module reads no file and
// holds no second copy of either.

import { GLOBAL_FLAGS, SUBCOMMAND_FLAGS, helpFor, suggestCommand } from './cli-flags.mjs'

/** What bare `interlock` and `interlock help` print: every command, grouped by the part of the loop it serves. */
export const INDEX = `interlock — deterministic decisions for the spec-driven flow

Set up and check
  doctor  version  openspec  limits  help
Spec a change
  validate  changes  drift  conformance  domain-context  spec-audit
  risk  ledger  checkpoint  note  notify
Ship it
  run  waves  tasks  verify  plan  merge-lanes  remediate
Review and settle
  gate  review  review-policy  ready  merge-confidence  pipeline  settle
Read the record
  report  outcomes  run-log  evals  autonomy
Called by the loop
  wave-state  surface  paths  routing  suggest

interlock help <command>   one command's usage
interlock --help --all     every command, every flag
`

/** The top-level command names a usage text's synopsis documents, in order. */
export function commandNames(usage) {
  const names = []
  for (const m of String(usage).matchAll(/^ {2}interlock ([a-z][a-z0-9-]*)/gm)) {
    if (!names.includes(m[1])) names.push(m[1])
  }
  return names
}

/**
 * The refusal for a command that does not exist: the unchanged first line, the
 * closest command when one is near, and a pointer to `interlock help`. Never the
 * full usage. A line with flags and no command (`interlock --verbose`) has no name
 * to quote, so it gets `noCommand` instead of `Unknown command: undefined`.
 */
export function unknownCommand(name, usage, flags) {
  if (name === undefined || name === '') return noCommand(flags, usage)
  const closest = suggestCommand(String(name), commandNames(usage))
  return (
    `Unknown command: ${name}\n` +
    (closest ? `Did you mean: interlock ${closest}?\n` : '') +
    'Run `interlock help` to list the commands.\n'
  )
}

/**
 * The refusal for a line that names no command: which flag led it, whether any
 * command takes that flag, and the line it was probably meant to be. A flag that
 * is not boolean reads the next word as its value, so `interlock --verbose doctor`
 * arrives with no command and `doctor` as the value: say so, and show the order.
 */
export function noCommand(flags, usage) {
  const entries = Object.entries(flags || {})
  const tail = 'Run `interlock help` to list the commands.\n'
  if (!entries.length) return `No command given.\n${tail}`
  const [key, value] = entries[0]
  const flag = `--${key}`
  const takes = cmd =>
    GLOBAL_FLAGS.includes(key) ||
    Object.entries(SUBCOMMAND_FLAGS).some(([leaf, set]) => (cmd === undefined || leaf === cmd || leaf.startsWith(`${cmd} `)) && set.includes(key))
  if (typeof value === 'string' && commandNames(usage).includes(value)) {
    return takes(value)
      ? `No command given: ${flag} read "${value}" as its value.\nPut the flag after the command: interlock ${value} ${flag}\n${tail}`
      : `No command given: ${flag} read "${value}" as its value, and ${value} takes no ${flag}.\nWithout the flag: interlock ${value}\n${tail}`
  }
  if (!takes(undefined)) return `No command given, and no command takes ${flag}.\n${tail}`
  const shown = typeof value === 'string' && /^\S+$/.test(value) ? `${flag} ${value}` : flag
  return `No command given: ${flag} is a flag. Put it after a command: interlock <command> ${shown}\n${tail}`
}

/**
 * `interlock help [<command>] [--all]` as `{ code, stdout, stderr }`.
 * `--all` is the full usage; a command is what `<command> --help` prints.
 */
export function helpCommand(positional, flags, usage, settleHelp) {
  const name = positional[1]
  if (name === undefined) {
    return { code: 0, stdout: flags && flags.all ? usage : INDEX, stderr: '' }
  }
  if (!commandNames(usage).includes(name)) {
    return { code: 1, stdout: '', stderr: unknownCommand(name, usage) }
  }
  return { code: 0, stdout: name === 'settle' ? settleHelp : helpFor(usage, name), stderr: '' }
}
