// The shipped-form pin: every `interlock` command a shipped surface tells a model
// or a driver to run is a command the CLI accepts, with flags it accepts, and one
// the post-install smoke runs.
//
// The surfaces are the ones a user's install actually carries and acts on: the
// skills, the shared prose, the agents, the ship driver, the argv the run program
// emits, the halt resume card and the hooks. Each of them spells commands the CLI
// has to keep accepting, and none of them is executed by a unit test, so a flag a
// skill gains or a leaf a step renames fails nothing until a user's run does.
//
// Three assertions, each over every extracted segment (design D22):
//
//   1. the leaf is a known subcommand;
//   2. each `--flag` is accepted for that leaf (`lib/cli-flags.mjs`, D7);
//   3. the leaf appears in the smoke's `INVENTORY` (`scripts/postinstall-smoke.mjs`, D21).
//
// A failure names the flag or the leaf and the file (and line) that spells it.
//
// The extractor is deliberately narrow, because prose is full of the word
// "interlock" and a pin that flags prose gets deleted. It reads only text that is
// marked as a command:
//
//   - markdown: fenced code blocks, and inline code spans that BEGIN with
//     `interlock` (or follow a `|`, `&&`, `;` or `$(` inside the span);
//   - JS: inline code inside a string (an escaped backtick pair), the lines the
//     resume card pushes, and the string literals of an argv array (`argv: [...]`, `cli([...])`, or the
//     array handed to the bundled binary).
//
// A segment ends at a pipe, a backtick, a `;`, `&&`, a redirect, a `)` or line end.
// Quoted strings, `<placeholders>`, `${expressions}` and `[` `]` are dropped, so a
// placeholder is a positional and is ignored.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// --- extraction begin ---------------------------------------------------------

function filesUnder(dir, ext) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(abs, ext))
    else if (entry.name.endsWith(ext)) out.push(abs)
  }
  return out.sort()
}

/**
 * The words of one command after `interlock `, or null when the text is not an
 * invocation (an interpolation, an ellipsis, a colon: prose that names the tool).
 */
function wordsOf(rest) {
  let s = rest
  s = s.replace(/"[^"]*"|'[^']*'/g, ' ')
  s = s.replace(/\$\{[^}]*\}|\$\([^)]*\)?/g, ' ')
  s = s.replace(/<[^<>\n]*>/g, ' ')
  s = s.split(/\||`|;|&&|\)|\s\d*>|\s#(?:\s|$)/)[0]
  s = s.replace(/[[\]{}]|\.\.\.|…/g, ' ')
  const tokens = s.split(/\s+/).filter(Boolean)
  if (!tokens.length || !/^[a-z][a-z-]*$/.test(tokens[0])) return null
  return tokens
}

/** Segments in markdown: fenced blocks, and inline spans that begin with the command. */
function fromMarkdown(text, file) {
  const out = []
  const prose = []
  let fenced = false
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      prose.push('')
      return
    }
    if (fenced) {
      const re = /(?:^|[\s("$])interlock (?=[a-z])/g
      let m
      while ((m = re.exec(line))) {
        const tokens = wordsOf(line.slice(m.index + m[0].length))
        if (tokens) out.push({ file, line: i + 1, tokens })
      }
      prose.push('')
    } else prose.push(line)
  })
  // Inline spans may wrap a line, so pair the backticks across the prose lines.
  const body = prose.join('\n')
  const re = /`([^`]+)`/g
  let m
  while ((m = re.exec(body))) {
    const line = body.slice(0, m.index).split('\n').length
    const span = m[1].replace(/\n\s*/g, ' ')
    const at = /(?:^\$ |^|\$\(|\|\|?\s+|&&\s+|;\s+)interlock (?=[a-z])/g
    let n
    while ((n = at.exec(span))) {
      const tokens = wordsOf(span.slice(n.index + n[0].length))
      if (tokens) out.push({ file, line, tokens })
    }
  }
  return out
}

/** The string literals of the array literal whose `[` is at `open`, nested spreads included. */
function literalsOfArray(text, open) {
  let depth = 0
  let end = -1
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"') {
      const close = text.indexOf(c, i + 1)
      if (close < 0) break
      i = close
    } else if (c === '[') depth++
    else if (c === ']' && --depth === 0) {
      end = i
      break
    }
  }
  if (end < 0) return null
  const out = []
  const re = /'([^'\n]*)'|"([^"\n]*)"/g
  const body = text.slice(open, end + 1)
  let m
  while ((m = re.exec(body))) out.push(m[1] !== undefined ? m[1] : m[2])
  return out
}

/** Segments in JS: inline code in strings, resume-card lines, argv literals. Comments are not read. */
function fromJs(text, file, opts = {}) {
  const out = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    // Inline code inside a template literal or a string is an escaped backtick
    // pair. A comment is not read: it names commands that used to exist.
    const re = /\\`([^`]*?)\\`/g
    let m
    while ((m = re.exec(line))) {
      const at = /(?:^|\|\|?\s+|&&\s+|;\s+)interlock (?=[a-z])/g
      let n
      while ((n = at.exec(m[1]))) {
        const tokens = wordsOf(m[1].slice(n.index + n[0].length))
        if (tokens) out.push({ file, line: i + 1, tokens })
      }
    }
    // The resume card pushes whole command lines as template literals.
    if (opts.templateLines) {
      const t = /lines\.push\(`interlock (?=[a-z])([^`]*)`/.exec(line)
      if (t) {
        const tokens = wordsOf(t[1])
        if (tokens) out.push({ file, line: i + 1, tokens })
      }
    }
  })
  // argv arrays: the run program's `argv: [...]`, the driver's `cli([...])`, and
  // the array handed to the bundled binary. The first literal is the leaf.
  const arrays = /(?:\bargv:\s*|\bcli\(|interlockBin\(\),\s*)\[/g
  let m
  while ((m = arrays.exec(text))) {
    const open = m.index + m[0].length - 1
    const words = literalsOfArray(text, open)
    if (!words || !words.length) continue
    const line = text.slice(0, open).split('\n').length
    if (!/^[a-z][a-z-]*$/.test(words[0])) continue
    out.push({ file, line, tokens: words })
  }
  return out
}

/** Every segment the shipped surfaces spell, tagged by surface. */
function extractAll() {
  const out = []
  const rel = abs => relative(ROOT, abs)
  for (const dir of ['skills', 'shared', 'agents']) {
    for (const f of filesUnder(join(ROOT, dir), '.md')) {
      for (const s of fromMarkdown(readFileSync(f, 'utf8'), rel(f))) out.push({ ...s, surface: dir })
    }
  }
  const js = [
    ['workflows/ship.js', 'driver', {}],
    ['lib/run.mjs', 'run', {}],
    ['bin/interlock-run', 'run-driver', {}],
    ['lib/resume-card.mjs', 'resume-card', { templateLines: true }]
  ]
  for (const f of filesUnder(join(ROOT, 'hooks'), '.mjs')) js.push([rel(f), 'hooks', {}])
  // The briefings carry commands too: lib/prompts assembles every one a step hands out.
  for (const f of filesUnder(join(ROOT, 'lib', 'prompts'), '.mjs')) js.push([rel(f), 'prompts', {}])
  for (const [file, surface, opts] of js) {
    for (const s of fromJs(readFileSync(join(ROOT, file), 'utf8'), file, opts)) out.push({ ...s, surface })
  }
  return out
}

// --- extraction end -----------------------------------------------------------

// --- the checks ---------------------------------------------------------------

const names = set => new Set([...(set || [])].map(f => String(f).replace(/^--/, '')))

/**
 * The leaf a segment names, against the keys of the flag table. A two-word key
 * wins; otherwise the first word, when it is a key itself. A first word that is
 * only the head of two-word keys (`run`, `verify`) is a bare group: known, with
 * no leaf of its own.
 */
export function resolveLeaf(tokens, keys) {
  const [sub, second] = tokens
  if (second && keys.has(`${sub} ${second}`)) return { leaf: `${sub} ${second}`, group: false, known: true }
  if (keys.has(sub)) return { leaf: sub, group: false, known: true }
  const groups = [...keys].filter(k => k.startsWith(`${sub} `))
  if (groups.length) {
    // `run` alone is a group; `run bogus` names a leaf that does not exist.
    const bare = tokens.length === 1 || !/^[a-z][a-z-]*$/.test(second)
    return { leaf: bare ? sub : `${sub} ${second}`, group: true, known: bare }
  }
  return { leaf: tokens.length > 1 && /^[a-z][a-z-]*$/.test(second) ? `${sub} ${second}` : sub, group: false, known: false }
}

/** Whether the smoke inventory runs `leaf` through the `interlock` binary. */
export function inventoryCovers(inventory, resolved) {
  const words = resolved.leaf.split(' ')
  return inventory.some(entry => {
    if (!entry || !/(^|\/)interlock$/.test(String(entry.bin || 'interlock'))) return false
    const argv = (entry.argv || []).filter(a => typeof a === 'string')
    return argv.slice(0, words.length).join(' ') === resolved.leaf
  })
}

/** Every failure, as one line each naming the flag or leaf and where it was found. */
export function checkSegments(segments, { globalFlags, subcommandFlags, inventory }) {
  const keys = new Set(Object.keys(subcommandFlags))
  const global = names(globalFlags)
  const failures = []
  for (const seg of segments) {
    const where = `${seg.file}:${seg.line}`
    const shown = `interlock ${seg.tokens.join(' ')}`
    const resolved = resolveLeaf(seg.tokens, keys)
    if (!resolved.known) {
      failures.push(`${where}: unknown subcommand "${resolved.leaf}" in \`${shown}\``)
      continue
    }
    const accepted = new Set([...global, ...names(subcommandFlags[resolved.leaf])])
    for (const token of seg.tokens) {
      if (!token.startsWith('--')) continue
      // The parser does not split `--k=v`: it reads a flag named `k=v` and refuses it.
      if (/^--[^=]+=/.test(token)) {
        failures.push(`${where}: ${token.replace(/=.*$/, '=…')} is the --flag=value form, which the CLI refuses as an unknown flag (in \`${shown}\`)`)
        continue
      }
      const flag = token.replace(/^--/, '')
      if (flag && !accepted.has(flag)) {
        failures.push(`${where}: --${flag} is not accepted for "${resolved.leaf}" (in \`${shown}\`)`)
      }
    }
    if (!inventoryCovers(inventory, resolved)) {
      failures.push(`${where}: "${resolved.leaf}" is not in the smoke INVENTORY (in \`${shown}\`)`)
    }
  }
  return failures
}

// --- the checker, against a table small enough to read ------------------------

const TABLE = {
  globalFlags: ['json', 'change'],
  subcommandFlags: {
    gate: ['findings'],
    review: ['findings', 'base'],
    'tasks tick': ['ids'],
    'run start': ['strict'],
    'run close': ['halt'],
    doctor: []
  },
  inventory: [
    { bin: 'interlock', argv: ['gate'] },
    { bin: 'interlock', argv: ['tasks', 'tick', 'c'] },
    { bin: 'interlock', argv: ['run', 'start'] },
    { bin: 'interlock', argv: ['run', 'close'] },
    { bin: 'interlock-graph', argv: ['doctor'] }
  ]
}
const seg = (text, file = 'skills/x/SKILL.md') => ({ file, line: 7, tokens: wordsOf(text) })

test('checker: a covered, declared command passes', () => {
  assert.deepEqual(checkSegments([seg('gate --findings <f> --json')], TABLE), [])
  assert.deepEqual(checkSegments([seg('tasks tick <change> --ids 1.1 --json')], TABLE), [])
  assert.deepEqual(checkSegments([seg('run')], TABLE), [])
})

test('checker: an undeclared flag fails naming the flag, the leaf and the file', () => {
  const [failure, ...rest] = checkSegments([seg('gate --findings f --since b')], TABLE)
  assert.equal(rest.length, 0)
  assert.match(failure, /skills\/x\/SKILL\.md:7/)
  assert.match(failure, /--since/)
  assert.match(failure, /"gate"/)
})

test('checker: a declared flag in the --flag=value form fails, because the parser refuses it', () => {
  const [failure, ...rest] = checkSegments([seg('gate --findings=f.json --json')], TABLE)
  assert.equal(rest.length, 0)
  assert.match(failure, /skills\/x\/SKILL\.md:7/)
  assert.match(failure, /--findings=… is the --flag=value form/)
})

test('checker: an unknown subcommand fails naming it and the file', () => {
  const [failure] = checkSegments([seg('spec-audit --json', 'skills/y/SKILL.md')], TABLE)
  assert.match(failure, /skills\/y\/SKILL\.md:7/)
  assert.match(failure, /unknown subcommand "spec-audit"/)
  const [bogus] = checkSegments([seg('run bogus')], TABLE)
  assert.match(bogus, /unknown subcommand "run bogus"/)
})

test('checker: a leaf the smoke does not run fails naming the leaf and the file', () => {
  const [failure, ...rest] = checkSegments([seg('review --findings f --base b')], TABLE)
  assert.equal(rest.length, 0)
  assert.match(failure, /"review" is not in the smoke INVENTORY/)
  // A different binary's entry covers nothing.
  assert.match(checkSegments([seg('doctor')], TABLE)[0], /"doctor" is not in the smoke INVENTORY/)
})

test('checker: a flag-less two-word leaf is covered by its own entry, not its group', () => {
  const narrow = { ...TABLE, inventory: [{ bin: 'interlock', argv: ['run', 'start'] }] }
  assert.deepEqual(checkSegments([seg('run start --strict')], narrow), [])
  assert.match(checkSegments([seg('run close --halt x')], narrow)[0], /"run close" is not in the smoke INVENTORY/)
})

// --- the extractor, against text it must and must not read --------------------

test('extractor: markdown reads fenced blocks and leading inline spans, not prose', () => {
  const text = [
    'The interlock skill runs `interlock gate --findings <f> --json` and then:',
    '',
    '```bash',
    'interlock autonomy record review-code --blockers <n>   # or --blockers 0',
    'out=$(interlock verify plan --context inter-wave --json | jq .)',
    'interlock-graph build .',
    '```',
    '',
    'Print `GOAL MET: interlock ship` when `interlock review --findings',
    '<f>` returns, and see `interlock` and the interlock docs.'
  ].join('\n')
  const got = fromMarkdown(text, 'x.md').map(s => s.tokens.join(' '))
  assert.deepEqual(got, [
    'autonomy record review-code --blockers',
    'verify plan --context inter-wave --json',
    'gate --findings --json',
    'review --findings'
  ])
})

test('extractor: JS reads escaped inline code and argv literals, not comments or log text', () => {
  const text = [
    "// `interlock conformance` used to be a command, and `interlock run close --notify` still is",
    'const a = `The tick is written by \\`interlock tasks tick\\` from the record`',
    "const b = `interlock preflight could not run: ${err}`",
    "const then = { argv: ['run', 'remediated', '--round', String(plan.round)] }",
    'let step = await cli([',
    "  'run',",
    "  'start',",
    "  ...(strict ? ['--strict'] : []),",
    '])'
  ].join('\n')
  const got = fromJs(text, 'x.mjs').map(s => s.tokens.join(' '))
  assert.deepEqual(got, [
    'tasks tick',
    'run remediated --round',
    'run start --strict'
  ])
})

test('extractor: the resume card pushes whole command lines', () => {
  const text = 'lines.push(`interlock tasks tick ${name} --ids <the ids>`)\nlines.push(`interlock run-log show ${runId}`)'
  const got = fromJs(text, 'lib/resume-card.mjs', { templateLines: true }).map(s => s.tokens.join(' '))
  assert.deepEqual(got, ['tasks tick --ids', 'run-log show'])
})

// --- the shipped surfaces -----------------------------------------------------

const segments = extractAll()

test('extraction finds commands on every surface (a dead extractor passes nothing vacuously)', () => {
  const count = surface => segments.filter(s => s.surface === surface).length
  assert.ok(count('skills') >= 40, `skills: ${count('skills')} segments`)
  assert.ok(count('shared') >= 8, `shared: ${count('shared')} segments`)
  assert.ok(count('run') >= 8, `lib/run.mjs: ${count('run')} segments`)
  assert.ok(count('driver') >= 1, `workflows/ship.js: ${count('driver')} segments`)
  assert.ok(count('resume-card') >= 3, `lib/resume-card.mjs: ${count('resume-card')} segments`)
  assert.ok(count('hooks') >= 2, `hooks: ${count('hooks')} segments`)
  const leaves = new Set(segments.map(s => s.tokens.slice(0, 2).join(' ')))
  for (const sentinel of ['run close', 'run start', 'tasks tick', 'doctor', 'gate', 'verify plan', 'autonomy record']) {
    assert.ok(leaves.has(sentinel), `no surface spells "interlock ${sentinel}"`)
  }
})

async function load(path) {
  try {
    return { mod: await import(path) }
  } catch (err) {
    return { error: err }
  }
}

test('every command a shipped surface spells is known, accepted and smoked', async () => {
  const flags = await load('../../lib/cli-flags.mjs')
  const smoke = await load('../../scripts/postinstall-smoke.mjs')
  assert.ok(!flags.error, `lib/cli-flags.mjs does not load: ${flags.error && flags.error.message}`)
  assert.ok(!smoke.error, `scripts/postinstall-smoke.mjs does not load: ${smoke.error && smoke.error.message}`)
  assert.ok(flags.mod.GLOBAL_FLAGS, 'lib/cli-flags.mjs exports GLOBAL_FLAGS')
  assert.ok(flags.mod.SUBCOMMAND_FLAGS, 'lib/cli-flags.mjs exports SUBCOMMAND_FLAGS')
  assert.ok(Array.isArray(smoke.mod.INVENTORY), 'scripts/postinstall-smoke.mjs exports INVENTORY')
  const failures = checkSegments(segments, {
    globalFlags: flags.mod.GLOBAL_FLAGS,
    subcommandFlags: flags.mod.SUBCOMMAND_FLAGS,
    inventory: smoke.mod.INVENTORY
  })
  assert.deepEqual([...new Set(failures)], [])
})

test('routing is a known subcommand, accepts --depth, and is in the smoke INVENTORY', async () => {
  const flags = await load('../../lib/cli-flags.mjs')
  const smoke = await load('../../scripts/postinstall-smoke.mjs')
  assert.ok(!flags.error && !smoke.error, 'the flag table and the smoke inventory must load')
  const table = {
    globalFlags: flags.mod.GLOBAL_FLAGS,
    subcommandFlags: flags.mod.SUBCOMMAND_FLAGS,
    inventory: smoke.mod.INVENTORY
  }
  assert.deepEqual(checkSegments([seg('routing review-dimension --depth strict --json'), seg('routing --json')], table), [])
  assert.match(checkSegments([seg('routing --nonsense')], table)[0], /--nonsense is not accepted for "routing"/)
  const routed = smoke.mod.INVENTORY.filter(entry => entry.argv[0] === 'routing')
  assert.ok(routed.length >= 2, 'the smoke runs routing for the table and for an unknown role')
})
