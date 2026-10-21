#!/usr/bin/env node
// The checkpoint advisor, end to end, on demand: prepare a scratch run, then
// read what the run left behind and say PASS or FAIL for each fact PR #20's
// review could only leave open.
//
// Development tooling only (`scripts/` is not in package.json `files`). It
// never launches `claude` itself: the two metered runs go through
// `node scripts/host-probe.mjs`, the one allow-listed launcher, and this script
// prints them. A live run is paid for once, by hand; `verify --write-fixtures`
// turns its output into scrubbed fixtures that `npm test` and
// `claude plugin test` then re-check for free.
//
//   setup  --out <dir>   rsync the plugin to <dir>/plugin (a --plugin-dir
//                        session writes tsconfig.json and types/ into the
//                        copy, never into this repository), write a logger mod
//                        to <dir>/logger, seed a scratch git repository at
//                        <dir>/repo from the Spec Range case's fixture, write
//                        the case's prompt to <dir>/prompt.md, and print the
//                        probe commands
//   verify --out <dir> [--only probe|eval] [--write-fixtures]
//                        probe: exactly one `interlock:advisor` agent.spawn
//                        whose resolved model is a string (what the spec
//                        meter's consult counter keys on), a draft the meter
//                        reads as `kind: 'draft'`, and advisor.md written.
//                        eval: the harness accepted the run, `interlock evals
//                        triage --eval-dir evals` on the real results file,
//                        the run's cost extrapolated against fullRunCostUsd,
//                        and every grader field the harness wrote.
//
// Exit codes: 0 every check passed, 1 a check failed (each one is named), 2 bad
// arguments.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeOf } from '../lib/spec-meter.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const CASE = 'spec-range-collapse-singleton'
export const CHANGE = 'collapse-singleton-waves'
const SPEC_RANGE_PREFIX = 'spec-range-'

const USAGE = `usage: advisor-e2e.mjs setup --out <dir> [--bin <abs path to claude>]
       advisor-e2e.mjs verify --out <dir> [--only probe|eval] [--write-fixtures]`

export function parseArgs(argv) {
  const o = { command: argv[0], writeFixtures: false }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    const need = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`)
      return argv[++i]
    }
    switch (a) {
      case '--out': o.out = need(); break
      case '--bin': o.bin = need(); break
      case '--only': o.only = need(); break
      case '--write-fixtures': o.writeFixtures = true; break
      case '-h': case '--help': o.help = true; break
      default: throw new Error(`unknown argument: ${a}`)
    }
  }
  if (o.help) return o
  if (!['setup', 'verify'].includes(o.command)) throw new Error('the first argument is setup or verify')
  if (!o.out) throw new Error('--out <dir> is required')
  if (o.only !== undefined && !['probe', 'eval'].includes(o.only)) throw new Error('--only is probe or eval')
  return o
}

/**
 * The case's `execution.prompt` block scalar, dedented. case.yaml has no
 * parser in this zero-dependency repository; the one block this needs is a
 * literal `prompt: |` under `execution:`.
 */
export function casePrompt(yaml) {
  const lines = yaml.split('\n')
  const at = lines.findIndex(l => /^\s+prompt: \|\s*$/.test(l))
  if (at === -1) throw new Error('case.yaml has no `prompt: |` block')
  const keyIndent = lines[at].search(/\S/)
  const body = []
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= keyIndent) break
    body.push(line)
  }
  while (body.length && body[body.length - 1].trim() === '') body.pop()
  const indent = Math.min(...body.filter(l => l.trim()).map(l => l.search(/\S/)))
  return body.map(l => l.slice(indent)).join('\n') + '\n'
}

/**
 * A logger hooks module that appends one JSON line per event to a per-session
 * file under `eventsDir`. One named function per event: the engine refuses a
 * module whose `on()` names are not string literals.
 */
export function loggerModule(eventsDir) {
  return `// Scratch logger for scripts/advisor-e2e.mjs. Observes, never changes an event.
const FILE = ${JSON.stringify(eventsDir)} + '/events-' + Date.now() + '.jsonl'
const lines = []

async function log($, event, input, resolved) {
  lines.push(JSON.stringify({ event, at: new Date().toISOString(), input, resolved }))
  try {
    await $.fs.write(FILE, lines.join('\\n') + '\\n')
  } catch {
    // A logger that cannot write must not break the session it watches.
  }
}

async function onSpawn($, e, next) {
  const resolved = await next(e)
  await log($, 'agent.spawn', e, resolved)
  return resolved
}

async function onToolCall($, e, next) {
  const resolved = await next(e)
  await log($, 'tool.call', e, resolved)
  return resolved
}

async function onTurnComplete($, e, next) {
  const resolved = await next(e)
  await log($, 'turn.complete', e, null)
  return resolved
}

export function register(on) {
  on('agent.spawn', onSpawn)
  on('tool.call', onToolCall)
  on('turn.complete', onTurnComplete)
}
`
}

/** Every JSON line of every per-session events file, in file then line order. */
export function readEvents(eventsDir) {
  if (!existsSync(eventsDir)) return []
  return readdirSync(eventsDir)
    .filter(f => /^events-\d+\.jsonl$/.test(f))
    .sort()
    .flatMap(f => readFileSync(join(eventsDir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)))
}

const check = (name, ok, detail) => ({ name, ok: Boolean(ok), detail })

/** The probe half: the spawn the consult counter keys on, the draft and advisor.md. */
export function probeChecks({ events, repo, change = CHANGE }) {
  const checks = []
  if (!events.length) {
    return [check('logger captured events', false, 'no events file: the probe did not run, or the logger mod did not load')]
  }
  const spawns = events.filter(e => e.event === 'agent.spawn')
  const advisor = spawns.filter(e => e.input && e.input.subagentType === 'interlock:advisor')
  checks.push(check(
    'exactly one interlock:advisor agent.spawn',
    advisor.length === 1,
    `${advisor.length} advisor spawn(s) of ${spawns.length}; subagentTypes seen: ${JSON.stringify(spawns.map(s => s.input && s.input.subagentType))}`
  ))
  const model = advisor[0] && advisor[0].resolved ? advisor[0].resolved.model : undefined
  checks.push(check('the advisor spawn resolved a string model', typeof model === 'string', `resolved.model = ${JSON.stringify(model)}`))

  const metrics = join(repo, '.claude', 'metrics')
  const drafts = existsSync(metrics)
    ? readdirSync(metrics).map(f => `.claude/metrics/${f}`).filter(p => {
        const w = writeOf(p)
        return w && w.kind === 'draft' && w.change === change
      })
    : []
  checks.push(check('a draft the spec meter reads as kind: draft', drafts.length >= 1, drafts.length ? drafts.join(', ') : `no .claude/metrics/advisor-${change}-<stamp>.json in ${repo}`))

  // renderAdvisor's status line is `drafted <stamp> from <brief>`; a consult the
  // CLI wrote down as failed reads `did not run: <reason>` instead (lib/advisor.mjs).
  const md = join(repo, 'openspec', 'changes', change, 'advisor.md')
  const lines = existsSync(md) ? readFileSync(md, 'utf8').split('\n') : null
  const drafted = lines && lines.find(l => /^drafted \S/.test(l))
  const failed = lines && lines.find(l => l.startsWith('did not run:'))
  checks.push(check(
    'advisor.md records a drafted consult',
    Boolean(drafted),
    lines === null ? `${md} is absent` : drafted || failed || 'neither a drafted nor a did-not-run line'
  ))
  return checks
}

/** Every grader key the harness wrote on a trial, by key, with the graders that carry it. */
export function graderFields(results) {
  const fields = {}
  for (const kase of results.cases || []) {
    for (const [arm, trials] of Object.entries(kase.arms || {})) {
      for (const trial of trials || []) {
        for (const g of trial.graders || []) {
          for (const key of Object.keys(g)) {
            fields[key] ??= new Set()
            fields[key].add(`${arm}:${g.name}`)
          }
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, [...v].sort()]))
}

/**
 * The eval half's cost line: the captured run's cost per agent run, scaled to
 * the Spec Range share of the scheduled full job (every Spec Range case, the
 * job's runs per case, both arms) and set beside the job's ceiling. A without
 * arm runs no advisor, so the scaled figure is an upper bound.
 */
export function costEstimate({ results, evals, specRangeCases }) {
  const all = (results.cases || []).flatMap(k => Object.values(k.arms || {}).flatMap(t => t || []))
  const trials = all.length
  if (trials === 0) return null
  // Each trial carries its own agent and judge cost; the top-level costUsd is the fallback.
  const priced = all.every(t => typeof t.costUsd === 'number')
  const total = priced ? all.reduce((n, t) => n + t.costUsd + (typeof t.judgeCostUsd === 'number' ? t.judgeCostUsd : 0), 0) : results.costUsd
  if (typeof total !== 'number') return null
  const perRun = total / trials
  const share = perRun * specRangeCases * evals.runsPerCase * 2
  return { perRun, trials, share, ceiling: evals.fullRunCostUsd, fits: share <= evals.fullRunCostUsd }
}

function interlock(args) {
  return spawnSync(process.execPath, [join(ROOT, 'bin', 'interlock'), ...args], { cwd: ROOT, encoding: 'utf8' })
}

export function evalChecks({ resultsPath, meta, triage, evals, specRangeCases }) {
  if (!existsSync(resultsPath)) {
    const why = meta ? `the harness exited ${meta.exitCode}${meta.timedOut ? ' (timed out)' : ''}; read stderr.txt beside meta.json` : 'the eval was not run'
    return [check('the harness wrote results.json', false, `${resultsPath} is absent: ${why}`)]
  }
  const results = JSON.parse(readFileSync(resultsPath, 'utf8'))
  const checks = [check('the harness wrote results.json', true, `${resultsPath}`)]
  checks.push(check('the run completed (not partial)', results.partial === false, `partial = ${JSON.stringify(results.partial)}, costUsd = ${results.costUsd}`))
  // The harness says before a run when a grader cannot pass with the tools it
  // was granted; a run like that measures the grant, not the plugin.
  const advisories = (results.cases || []).flatMap(k => (k.advisories || []).map(a => `${k.name || k.id}: ${a}`))
  checks.push(check('the harness raised no advisory', advisories.length === 0, advisories.length ? advisories.join(' | ') : 'none'))
  const errored = (results.cases || []).flatMap(k => Object.entries(k.arms || {}).flatMap(([arm, t]) => (t || []).filter(x => x.error).map(x => `${k.name || k.id} ${arm}: ${x.error}`)))
  checks.push(check('no trial errored', errored.length === 0, errored.length ? errored.join(' | ') : 'none'))
  checks.push(check(
    `the run includes ${CASE}`,
    (results.cases || []).some(k => (k.name || k.id) === CASE),
    `cases: ${(results.cases || []).map(k => k.name || k.id).join(', ') || '(none)'}`
  ))
  let verdict
  try {
    verdict = JSON.parse(triage.stdout)
  } catch {
    verdict = null
  }
  // Exit 0 or 1 is a verdict on the run; 2 and 3 say triage could not read it.
  // A grader triage cannot type is treated as deterministic, so it is a fail here.
  const untyped = verdict ? (verdict.cases || []).flatMap(c => (c.untyped || []).map(g => `${c.id}:${g}`)) : []
  checks.push(check(
    'evals triage --eval-dir evals reads the real results file',
    verdict !== null && [0, 1].includes(triage.status) && untyped.length === 0,
    verdict
      ? `exit ${triage.status}, verdict ${verdict.verdict}; ${(verdict.cases || []).map(c => `${c.id}: ${c.classification}${c.graders.length ? ` (${c.graders.join(', ')})` : ''}`).join('; ')}${untyped.length ? `; type unknown: ${untyped.join(', ')}` : ''}`
      : `exit ${triage.status}; ${triage.stderr.trim() || 'no JSON on stdout'}`
  ))
  const cost = costEstimate({ results, evals, specRangeCases })
  checks.push(check(
    'the Spec Range share of the full job fits fullRunCostUsd',
    cost !== null && cost.fits,
    cost === null
      ? 'no costUsd or no trials in results.json'
      : `$${cost.perRun.toFixed(3)} per agent run over ${cost.trials} run(s) → ${specRangeCases} cases × ${evals.runsPerCase} runs × 2 arms ≈ $${cost.share.toFixed(2)} (upper bound) against the $${cost.ceiling} ceiling, before the other cases`
  ))
  return { checks, results, fields: graderFields(results) }
}

/** Replace every occurrence of each scratch path with its stand-in. */
export function scrub(value, replacements) {
  let text = JSON.stringify(value)
  for (const [from, to] of replacements) text = text.split(from).join(to)
  return JSON.parse(text)
}

/**
 * Removal-only redaction, as test/fixtures/evals/README.md sets out: drop the
 * prompt text, the trace pointers and excerpts, and the runner's own paths.
 * Every scoring field is kept as the harness wrote it.
 */
export function redactResults(results) {
  const copy = structuredClone(results)
  if (copy.suite) {
    delete copy.suite.root
    for (const p of copy.suite.plugins || []) delete p.path
  }
  for (const kase of copy.cases || []) {
    delete kase.promptMarkdown
    for (const trials of Object.values(kase.arms || {})) {
      for (const t of trials || []) {
        delete t.tracePath
        for (const g of t.graders || []) delete g.evidence
      }
    }
  }
  return copy
}

/** Local paths (any of `markers`) still left in a value; a fixture that holds one is not written. */
export function leakedPaths(value, markers) {
  const found = new Set()
  const walk = v => {
    if (typeof v === 'string') { if (markers.some(m => m && v.includes(m))) found.add(v.length > 120 ? v.slice(0, 120) + '…' : v) }
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(value)
  return [...found]
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** The binary to print: --bin, else the first `claude` on this process's PATH (a login shell's may be an older one). */
function claudeBin(given) {
  const bin = given || spawnSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).stdout.trim()
  if (!bin) return { bin: '<abs path to claude>', version: 'not found on PATH; pass --bin' }
  const v = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30000 })
  return { bin, version: (v.stdout || '').trim() || 'version unknown' }
}

function setup(out, given) {
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty; give a fresh --out`)
  const plugin = join(out, 'plugin')
  const logger = join(out, 'logger')
  const repo = join(out, 'repo')
  const events = join(out, 'events')
  for (const d of [plugin, join(logger, '.claude-plugin'), join(logger, 'hooks'), repo, events]) mkdirSync(d, { recursive: true })

  const rsync = spawnSync('rsync', ['-a', '--exclude', '.git', '--exclude', 'node_modules', '--exclude', '.claude', '--exclude', 'evals/results', `${ROOT}/`, `${plugin}/`], { encoding: 'utf8' })
  if (rsync.status !== 0) throw new Error(`rsync failed: ${rsync.stderr.trim()}`)

  writeFileSync(join(logger, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'advisor-e2e-logger', version: '0.0.0', description: 'Scratch event logger for scripts/advisor-e2e.mjs', author: { name: 'interlock dev' } }, null, 2) + '\n')
  writeFileSync(join(logger, 'hooks', 'hooks.json'), JSON.stringify({ hooks: {}, modules: ['./mod.mjs'] }) + '\n')
  writeFileSync(join(logger, 'hooks', 'mod.mjs'), loggerModule(events))

  const caseDir = join(ROOT, 'evals', CASE)
  const seeded = spawnSync('bash', [join(caseDir, 'fixture.sh')], { cwd: repo, encoding: 'utf8' })
  if (seeded.status !== 0) throw new Error(`fixture.sh failed: ${seeded.stderr.trim()}`)
  const git = args => spawnSync('git', ['-c', 'user.name=advisor-e2e', '-c', 'user.email=advisor-e2e@invalid', ...args], { cwd: repo, encoding: 'utf8' })
  for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'seed']]) {
    const r = git(args)
    if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim()}`)
  }
  writeFileSync(join(out, 'prompt.md'), casePrompt(readFileSync(join(caseDir, 'case.yaml'), 'utf8')))

  const { bin, version } = claudeBin(given)
  console.log(`advisor-e2e: scratch run prepared in ${out}
claude: ${bin} (${version})

Run each as its own command (the allow-list matches a plain host-probe call):

1. The consult, headless, with the logger watching:
node scripts/host-probe.mjs --mode headless --bin ${bin} --cwd ${repo} --plugin-dir ${logger} --plugin-dir ${plugin} --prompt-file ${join(out, 'prompt.md')} --allow-tool Agent --allow-tool Bash --allow-tool Read --allow-tool Write --allow-tool Glob --allow-tool Grep --timeout 900 --out ${join(out, 'probe')}

2. The Spec Range case through the eval harness, as the full job runs it (metered; read the ceiling from \`node bin/interlock limits\`):
node scripts/host-probe.mjs --mode eval --bin ${bin} --plugin-dir ${plugin} --case ${CASE} --allow-tool Bash --allow-tool Write --max-cost-usd <usd> --out ${join(out, 'eval')}
   (Bash and Write are operator-gated: without the grant the harness withholds them and the case cannot pass.)

3. Then:
node scripts/advisor-e2e.mjs verify --out ${out}`)
}

function verify(o) {
  const out = o.out
  const checks = []
  let fields = null
  let results = null
  const probeMeta = readJson(join(out, 'probe', 'meta.json'))
  const evalMeta = readJson(join(out, 'eval', 'meta.json'))
  const events = readEvents(join(out, 'events'))

  if (o.only !== 'eval') {
    console.log(`probe: ${probeMeta ? `${probeMeta.version ?? 'version unknown'}, exit ${probeMeta.exitCode}, ${probeMeta.durationMs} ms` : 'no probe/meta.json (the probe was not run through host-probe --out <dir>/probe)'}`)
    checks.push(...probeChecks({ events, repo: join(out, 'repo') }))
  }
  if (o.only !== 'probe') {
    const resultsPath = join(out, 'eval', 'results.json')
    const limits = JSON.parse(interlock(['limits', '--json']).stdout)
    const specRangeCases = readdirSync(join(ROOT, 'evals')).filter(d => d.startsWith(SPEC_RANGE_PREFIX)).length
    const triage = existsSync(resultsPath) ? interlock(['evals', 'triage', '--results', resultsPath, '--eval-dir', 'evals', '--json']) : null
    console.log(`eval: ${evalMeta ? `${evalMeta.version ?? 'version unknown'}, exit ${evalMeta.exitCode}, ${evalMeta.durationMs} ms` : 'no eval/meta.json'}`)
    const r = evalChecks({ resultsPath, meta: evalMeta, triage, evals: limits.evals, specRangeCases })
    if (Array.isArray(r)) checks.push(...r)
    else ({ fields, results } = r, checks.push(...r.checks))
  }

  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n      ${c.detail}`)
  if (fields) {
    console.log('grader fields the harness wrote on a trial (key: arm:grader):')
    for (const [k, v] of Object.entries(fields)) console.log(`  ${k}: ${v.join(', ')}`)
  }

  if (o.writeFixtures) writeFixtures({ out, events, results, probeMeta, evalMeta })
  const failed = checks.filter(c => !c.ok).length
  console.log(failed ? `advisor-e2e: ${failed} of ${checks.length} checks FAILED` : `advisor-e2e: all ${checks.length} checks passed`)
  return failed ? 1 : 0
}

function writeFixtures({ out, events, results, probeMeta, evalMeta }) {
  const markers = [process.env.HOME, '/private/', '/tmp/', '/var/folders/']
  const date = new Date().toISOString().slice(0, 10)
  const spawn = events.find(e => e.event === 'agent.spawn' && e.input && e.input.subagentType === 'interlock:advisor')
  if (spawn) {
    const payload = scrub({ input: spawn.input, resolved: spawn.resolved }, [[join(out, 'repo'), '/repo'], [out, '/scratch']])
    const leaks = leakedPaths(payload, markers)
    if (leaks.length) {
      console.log(`fixture NOT written: agent-spawn-advisor.json still names local paths: ${leaks.join(', ')}`)
    } else {
      const fixture = {
        _provenance: {
          capturedWith: `claude ${probeMeta?.version ?? 'version unknown'} -p (headless), scratch logger mod, scratch repository seeded from evals/${CASE}`,
          date,
          change: 'advisor-e2e live capture (PR #20 consult counter)',
          note: 'the interlock:advisor spawn of the checkpoint consult; scratch paths are scrubbed to /repo and /scratch'
        },
        ...payload
      }
      const path = join(ROOT, 'test', 'fixtures', 'mod', 'agent-spawn-advisor.json')
      writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n')
      console.log(`fixture written: ${path}`)
    }
  } else {
    console.log('fixture NOT written: no interlock:advisor spawn was captured')
  }
  if (results) {
    const redacted = redactResults(results)
    const leaks = leakedPaths(redacted, markers)
    if (leaks.length) {
      console.log(`fixture NOT written: the results file still names local paths after removal-only redaction: ${leaks.join(', ')}`)
    } else {
      const path = join(ROOT, 'test', 'fixtures', 'evals', `spec-range-${date}.json`)
      writeFileSync(path, JSON.stringify(redacted, null, 2) + '\n')
      console.log(`fixture written: ${path} (harness ${evalMeta?.version ?? 'version unknown'}); record it in test/fixtures/evals/README.md`)
    }
  }
}

function main() {
  let o
  try {
    o = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`advisor-e2e: ${err.message}\n${USAGE}`)
    return 2
  }
  if (o.help) {
    console.log(USAGE)
    return 0
  }
  o.out = resolve(o.out)
  if (o.command === 'setup') {
    try {
      setup(o.out, o.bin)
    } catch (err) {
      console.error(`advisor-e2e: ${err.message}`)
      return 1
    }
    return 0
  }
  return verify(o)
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main()
