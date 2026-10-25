// The binaries' argument contract, executed rather than read.
//
// `interlock` used to store any `--x` it was given and let each handler read the
// names it knew, so `autonomy record review-artifacts --blocker 2` exited 0
// having recorded nothing, and `--help` after a subcommand either ran the
// subcommand or called it unknown. These tests spawn the real binaries and pin
// the contract that replaced that: a flag nobody declared is refused by name
// with exit 2, help after a subcommand runs nothing, every binary reports its
// version, and a two-word subcommand reads its change from the positional that
// follows it.
//
// spec: cli/arguments (all five requirements); design D6-D9 and D16.
//
// Exit status is the load-bearing assertion. 2 is "you typed it wrong"; 1 is
// already "a gate blocked" for gate, ledger, ready, validate and run-log check,
// and a typo must never read as a verdict.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'bin', 'interlock')
const GRAPH_BIN = join(ROOT, 'bin', 'interlock-graph')
const RUN_BIN = join(ROOT, 'bin', 'interlock-run')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

let tmp

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-cli-arguments-'))
})

after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

/**
 * Run a real binary in a throwaway root. `cwd` is pinned to `root` for the same
 * reason cli.test.mjs pins it: `--root` defaults to `.`, and an unpinned child
 * resolves its root to this repository and writes into its live state.
 */
function exec(bin, args, root = tmp) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: 'utf8',
    input: '',
    env: { ...process.env, INTERLOCK_NTFY_TOPIC: '' }
  })
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

const cli = (args, root) => exec(BIN, args, root)

/** A repository root holding one active change with two unchecked tasks. */
function repoWithChange(name = 'c') {
  const root = mkdtempSync(join(tmp, 'repo-'))
  const change = join(root, 'openspec', 'changes', name)
  mkdirSync(change, { recursive: true })
  writeFileSync(join(change, 'proposal.md'), '# P\nwhy\n')
  writeFileSync(join(change, 'design.md'), '# D\nhow\n')
  writeFileSync(join(change, 'tasks.md'), '- [ ] 1.1 scaffold\n- [ ] 1.2 wire\n')
  return { root, change, tasksPath: join(change, 'tasks.md') }
}

/** Whatever a set holds, as bare flag names: Set, array, or object keys, with or without `--`. */
function names(value) {
  if (!value) return []
  const list = value instanceof Set || Array.isArray(value) ? [...value] : Object.keys(value)
  return list.map(n => String(n).replace(/^--/, ''))
}

async function loadFlagTable() {
  // Imported here, not at the top, so that a missing module fails the cases that
  // need it by name instead of failing the file before any case runs.
  const mod = await import('../../lib/cli-flags.mjs')
  assert.ok(mod.GLOBAL_FLAGS, 'lib/cli-flags.mjs must export GLOBAL_FLAGS')
  assert.ok(mod.SUBCOMMAND_FLAGS, 'lib/cli-flags.mjs must export SUBCOMMAND_FLAGS')
  const global = new Set(names(mod.GLOBAL_FLAGS))
  const entries = mod.SUBCOMMAND_FLAGS instanceof Map ? [...mod.SUBCOMMAND_FLAGS] : Object.entries(mod.SUBCOMMAND_FLAGS)
  const leaves = new Map(entries.map(([leaf, set]) => [leaf, new Set(names(set))]))
  return { global, leaves }
}

// --- unknown flags -----------------------------------------------------------

test('an unknown flag is refused by name with exit 2 and runs nothing', () => {
  const findings = join(tmp, 'f.json')
  writeFileSync(findings, '[]')
  const r = cli(['gate', '--findings', findings, '--bogus-flag'])
  assert.equal(r.code, 2, `stdout: ${r.stdout}\nstderr: ${r.stderr}`)
  assert.match(r.stderr, /--bogus-flag/)
  assert.match(r.stderr, /\bgate\b/)
  assert.ok(r.stderr.includes(VERSION), `stderr must carry the CLI version ${VERSION}: ${r.stderr}`)
})

test('the refusal also prints the subcommand help on stderr', () => {
  const r = cli(['gate', '--findings', 'x.json', '--bogus-flag'])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /interlock gate --findings/, 'the subcommand\'s usage line follows the refusal')
})

test('with --json the refusal is also an object on stdout, for a relay that copies stdout only', () => {
  const r = cli(['gate', '--findings', 'x.json', '--bogus-flag', '--json'])
  assert.equal(r.code, 2)
  let out
  assert.doesNotThrow(() => {
    out = JSON.parse(r.stdout)
  }, `stdout must parse as JSON: ${r.stdout}`)
  assert.equal(typeof out.error, 'string')
  assert.ok(out.error.length > 0)
  assert.equal(out.unknownFlag, '--bogus-flag')
  assert.equal(out.subcommand, 'gate')
  assert.equal(out.cliVersion, VERSION)
})

test('a misspelled autonomy flag exits 2 and writes nothing to the record', () => {
  const root = mkdtempSync(join(tmp, 'autonomy-'))
  const r = cli(['autonomy', 'record', 'review-artifacts', '--blocker', '2', '--root', root], root)
  assert.equal(r.code, 2, `stdout: ${r.stdout}\nstderr: ${r.stderr}`)
  assert.match(r.stderr, /--blocker\b/)
  assert.match(r.stderr, /autonomy record/)
  assert.ok(r.stderr.includes(VERSION))
  assert.equal(existsSync(join(root, '.claude', 'autonomy.json')), false, 'a refused flag must record nothing')
})

test('a misspelled run flag exits 2, carries the object on stdout and writes no manifest', () => {
  const { root } = repoWithChange('c')
  const r = cli(['run', 'start', '--change', 'c', '--strcit', '--json', '--root', root], root)
  assert.equal(r.code, 2, `stdout: ${r.stdout}\nstderr: ${r.stderr}`)
  const out = JSON.parse(r.stdout)
  assert.equal(out.unknownFlag, '--strcit')
  assert.equal(out.cliVersion, VERSION)
  assert.equal(existsSync(join(root, '.claude', 'ship', 'run.json')), false, 'no manifest for a refused start')
})

test('an unknown subcommand keeps its refusal and exit code', () => {
  const r = cli(['frobnicate'])
  assert.equal(r.code, 1)
  assert.match(r.stderr, /frobnicate/)
})

// --- the flag table ------------------------------------------------------------

test('every flag bin/interlock reads is in the global set or some subcommand set', async () => {
  const { global, leaves } = await loadFlagTable()
  const declared = new Set([...global])
  for (const set of leaves.values()) for (const n of set) declared.add(n)

  // The dotted form is not read out of a file name: `cli-flags.mjs` in an import
  // specifier is a path, and the lookbehind keeps it from reading as `flags.mjs`.
  // `flags.x`, `flags['x']` and `num(flags, 'x')` are the three spellings a
  // handler reads a flag by. A helper that receives the whole object is scanned
  // too: note-cli is handed `flags` through the entry file's io bundle.
  const sources = [join(ROOT, 'bin', 'interlock'), join(ROOT, 'lib', 'note-cli.mjs')]
  const read = new Map()
  for (const file of sources) {
    const text = readFileSync(file, 'utf8')
    const rel = file.slice(ROOT.length + 1)
    const add = (name, how) => {
      if (!read.has(name)) read.set(name, `${rel} (${how})`)
    }
    for (const m of text.matchAll(/(?<![\w-])flags\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) add(m[1], `flags.${m[1]}`)
    for (const m of text.matchAll(/\bflags\[\s*'([^']+)'\s*\]/g)) add(m[1], `flags['${m[1]}']`)
    for (const m of text.matchAll(/\bnum\(\s*flags\s*,\s*'([^']+)'\s*\)/g)) add(m[1], `num(flags, '${m[1]}')`)
  }
  assert.ok(read.size >= 60, `expected to find the CLI's flag reads, found ${read.size}`)

  const missing = [...read].filter(([name]) => !declared.has(name)).map(([name, where]) => `--${name} in ${where}`)
  assert.deepEqual(missing, [], `flags read but declared nowhere in lib/cli-flags.mjs:\n  ${missing.join('\n  ')}`)
})

test('run start accepts every flag the ship drivers forward, plus --plugin-root', async () => {
  const { global, leaves } = await loadFlagTable()
  const runStart = leaves.get('run start')
  assert.ok(runStart, 'SUBCOMMAND_FLAGS needs a "run start" entry')
  // The kebab-case spelling of what the manifest records (FLAG_FIELDS in
  // lib/run.mjs) and of what the drivers pass. `run start`'s entry is derived
  // from that list in code; this is the contract it must satisfy.
  for (const flag of [
    'change',
    'apply-only',
    'no-commit',
    'skip-e2e',
    'skip-coverage',
    'isolate-waves',
    'tdd',
    'no-tdd',
    'max-parallel',
    'mode',
    'review',
    'handoff',
    'conformance',
    'strict',
    'host',
    'plugin-root'
  ]) {
    assert.ok(runStart.has(flag) || global.has(flag), `run start must accept --${flag}`)
  }
})

test('run close accepts every flag the ship drivers pass it', async () => {
  // The drivers spread these in from closeArgs() and the loop, so the shipped-text
  // sweep in cli-inventory.test.mjs never sees them spelled out.
  const { global, leaves } = await loadFlagTable()
  const runClose = leaves.get('run close')
  assert.ok(runClose, 'SUBCOMMAND_FLAGS needs a "run close" entry')
  for (const flag of ['host-banners', 'host-observed', 'notify', 'results', 'host-records', 'halt']) {
    assert.ok(runClose.has(flag) || global.has(flag), `run close must accept --${flag}`)
  }
})

test('routing accepts --depth and --json, refuses any other flag by name with exit 2, and documents its form', async () => {
  const { global, leaves } = await loadFlagTable()
  const routing = leaves.get('routing')
  assert.ok(routing, 'SUBCOMMAND_FLAGS needs a "routing" entry')
  assert.ok(routing.has('depth'), 'routing must accept --depth')
  assert.ok(global.has('json'), 'routing reads --json from the global flags')
  const refused = cli(['routing', 'review-dimension', '--bogus-flag'])
  assert.equal(refused.code, 2, `stdout: ${refused.stdout}\nstderr: ${refused.stderr}`)
  assert.match(refused.stderr, /--bogus-flag/)
  assert.equal(refused.stdout, '')
  const help = cli(['--help'])
  assert.ok(documentedForms(help.stdout).some(f => f.leaf[0] === 'routing' && f.flags.has('depth')), 'the usage block must document routing --depth')
  const own = cli(['routing', '--help'])
  assert.equal(own.code, 0)
  assert.match(own.stdout, /--depth lean\|strict/)
})

// --- documented forms -----------------------------------------------------------

/**
 * The `Usage:` synopsis lines of `interlock --help`, as `{ leaf, flags }`.
 *
 * A head line is `  interlock <words> <args…>`; the synopsis is what sits left of
 * the first run of two spaces, because the description column follows. A
 * continuation line (indent under 32, starting with `[` or `--`) adds flags to
 * the head above it. Description-column lines sit at indent 40 or more and are
 * prose, so they document no flag.
 */
function documentedForms(usage) {
  const lines = usage.split('\n')
  const start = lines.findIndex(l => l.trim() === 'Usage:')
  const end = lines.findIndex((l, i) => i > start && l.startsWith('Common options:'))
  assert.ok(start >= 0 && end > start, 'interlock --help must print a Usage: block')
  const forms = []
  let current = null
  for (const line of lines.slice(start + 1, end)) {
    const indent = line.length - line.trimStart().length
    const head = line.match(/^ {2}interlock\s+(.*)$/)
    if (head) {
      const synopsis = head[1].split(/ {2,}/)[0]
      const words = []
      for (const tok of synopsis.split(/\s+/)) {
        if (!/^[a-z][a-z0-9-]*$/.test(tok)) break
        words.push(tok)
      }
      current = { leaf: words, flags: new Set([...synopsis.matchAll(/--([a-z][a-z0-9-]*)/g)].map(m => m[1])) }
      forms.push(current)
      continue
    }
    if (current && indent >= 10 && indent < 32 && /^(\[|--)/.test(line.trim())) {
      const synopsis = line.trim().split(/ {2,}/)[0]
      for (const m of synopsis.matchAll(/--([a-z][a-z0-9-]*)/g)) current.flags.add(m[1])
    }
  }
  return forms
}

test('every flag a USAGE line documents for a leaf is accepted for that leaf', async () => {
  const { global, leaves } = await loadFlagTable()
  const help = cli(['--help'])
  assert.equal(help.code, 0)
  const forms = documentedForms(help.stdout)
  assert.ok(forms.length >= 40, `expected to parse the usage synopsis, found ${forms.length} lines`)

  const refused = []
  for (const { leaf, flags } of forms) {
    // The longest prefix of the leaf's words that the table keys: `tasks tick`
    // before `tasks`, `run start` before `run`.
    let accepted = new Set()
    for (let n = leaf.length; n >= 1; n--) {
      const key = leaf.slice(0, n).join(' ')
      if (leaves.has(key)) {
        accepted = leaves.get(key)
        break
      }
    }
    for (const flag of flags) {
      if (!accepted.has(flag) && !global.has(flag)) refused.push(`--${flag} for "interlock ${leaf.join(' ')}"`)
    }
  }
  assert.deepEqual(refused, [], `documented but not accepted:\n  ${refused.join('\n  ')}`)
})

// --- help ---------------------------------------------------------------------------

test('doctor --help prints the doctor usage and runs no check', () => {
  const r = cli(['doctor', '--help'])
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.match(r.stdout, /interlock doctor/)
  assert.match(r.stdout, /Preflight the host/)
  assert.doesNotMatch(r.stdout, /PREFLIGHT/, 'no check ran')
  assert.doesNotMatch(r.stdout, /interlock waves/, 'the help is filtered to the subcommand')
})

test('verify --help and tasks tick -h exit 0 with usage rather than reporting an unknown subcommand', () => {
  const verify = cli(['verify', '--help'])
  assert.equal(verify.code, 0, `stderr: ${verify.stderr}`)
  assert.match(verify.stdout, /interlock verify /)
  assert.doesNotMatch(verify.stderr, /unknown/i)

  const tick = cli(['tasks', 'tick', '-h'])
  assert.equal(tick.code, 0, `stderr: ${tick.stderr}`)
  assert.match(tick.stdout, /interlock tasks tick/)
})

test('--help with no subcommand still prints the full usage', () => {
  const r = cli(['--help'])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /interlock waves/)
  assert.match(r.stdout, /interlock doctor/)
})

test('interlock-run -h is help, never a change name', () => {
  const r = exec(RUN_BIN, ['-h'])
  assert.equal(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`)
  assert.match(r.stdout, /interlock-run/)
  assert.match(r.stdout, /--host/)
})

// --- version -----------------------------------------------------------------------

test('interlock --version prints the package version', () => {
  const r = cli(['--version'])
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.equal(r.stdout.trim(), VERSION)
})

test('interlock version --json carries the version and the resolved binary path', () => {
  const r = cli(['version', '--json'])
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const out = JSON.parse(r.stdout)
  assert.equal(out.version, VERSION)
  assert.equal(out.path, realpathSync(BIN))
})

test('interlock-graph and interlock-run report the same version', () => {
  for (const bin of [GRAPH_BIN, RUN_BIN]) {
    const r = exec(bin, ['--version'])
    assert.equal(r.code, 0, `${bin}: ${r.stderr}`)
    assert.equal(r.stdout.trim(), VERSION, bin)
  }
})

// --- the positional after a two-word subcommand -------------------------------------

test('tasks tick <change> --ids ticks the task and exits 0', () => {
  const { root, tasksPath } = repoWithChange('c')
  const r = cli(['tasks', 'tick', 'c', '--ids', '1.1', '--json', '--root', root], root)
  assert.equal(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`)
  assert.deepEqual(JSON.parse(r.stdout).ticked, ['1.1'])
  assert.match(readFileSync(tasksPath, 'utf8'), /- \[x\] 1\.1 scaffold/)
  assert.match(readFileSync(tasksPath, 'utf8'), /- \[ \] 1\.2 wire/)
  assert.doesNotMatch(r.stdout + r.stderr, /change "tick"/, 'the subcommand word is never read as the change')
})

test('tasks tick --change still wins over the positional', () => {
  const { root, tasksPath } = repoWithChange('c')
  const r = cli(['tasks', 'tick', 'no-such-change', '--change', 'c', '--ids', '1.2', '--json', '--root', root], root)
  assert.equal(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`)
  assert.match(readFileSync(tasksPath, 'utf8'), /- \[x\] 1\.2 wire/)
})

test('tasks coverage <change> --classified reads the named change', () => {
  const { root } = repoWithChange('c')
  const classified = join(root, 'classified.json')
  writeFileSync(
    classified,
    JSON.stringify({
      tasks: [
        { id: '1.1', group: 1, description: 'scaffold', tier: 2, model: 'sonnet', isTestTask: false },
        { id: '1.2', group: 1, description: 'wire', tier: 2, model: 'sonnet', isTestTask: false }
      ]
    })
  )
  const r = cli(['tasks', 'coverage', 'c', '--classified', classified, '--json', '--root', root], root)
  assert.equal(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`)
  const out = JSON.parse(r.stdout)
  assert.equal(out.change, 'c')
  assert.equal(out.ok, true)
  assert.doesNotMatch(r.stdout + r.stderr, /change "coverage"/)
})
