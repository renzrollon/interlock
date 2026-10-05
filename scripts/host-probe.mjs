#!/usr/bin/env node
// Host probe harness: run one Claude Code binary against scratch plugin
// folders, in a clean login environment, and keep everything it printed.
//
// Development tooling only. `scripts/` is not in package.json `files`, so
// this never ships. It exists so an agent can run the older-host and engine
// probes OpenSpec tasks ask for (validate, a `--plugin-dir` session, a
// TTY session for what only an interactive surface shows) through one
// narrowly allow-listed entry point, instead of composing ad-hoc unsandboxed
// `claude` launches.
//
// Why the clean environment: a `claude` spawned from a Desktop Code session
// inherits its gateway variables (ANTHROPIC_BASE_URL, model overrides) and
// dies on them; a plain terminal has none. The child gets HOME, USER, a
// minimal PATH and TERM, and a login zsh adds what the user's profile sets.
//
// Modes:
//   validate   claude plugin validate <plugin-dir> --strict
//   headless   claude -p <prompt> --plugin-dir ... (non-interactive)
//   tty        the same session interactively, inside a detached tmux
//              session; the prompt is typed, the screen captured until it
//              settles, then the session is killed
//
// Outputs land in --out (default $TMPDIR/interlock-host-probe/<stamp>):
// stdout.txt, stderr.txt (or screen.txt for tty) and meta.json.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

export const MODES = ['validate', 'headless', 'tty']
const DEFAULT_TIMEOUT_S = 180
const MAX_TIMEOUT_S = 900

const USAGE = `usage: host-probe.mjs --mode validate|headless|tty --bin <abs path to claude>
       [--plugin-dir <dir>]... [--prompt <text> | --prompt-file <file>]
       [--cwd <dir>] [--model <id>] [--allow-tool <tool>]... [--max-turns <n>]
       [--timeout <seconds>] [--settle <seconds>] [--out <dir>] [--dry-run]`

export function parseArgs(argv) {
  const o = { pluginDirs: [], allowTools: [], dryRun: false }
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`)
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--mode': o.mode = need(i, a); i++; break
      case '--bin': o.bin = need(i, a); i++; break
      case '--plugin-dir': o.pluginDirs.push(need(i, a)); i++; break
      case '--prompt': o.prompt = need(i, a); i++; break
      case '--prompt-file': o.promptFile = need(i, a); i++; break
      case '--cwd': o.cwd = need(i, a); i++; break
      case '--model': o.model = need(i, a); i++; break
      case '--allow-tool': o.allowTools.push(need(i, a)); i++; break
      case '--max-turns': o.maxTurns = Number(need(i, a)); i++; break
      case '--timeout': o.timeout = Number(need(i, a)); i++; break
      case '--settle': o.settle = Number(need(i, a)); i++; break
      case '--out': o.out = need(i, a); i++; break
      case '--dry-run': o.dryRun = true; break
      case '-h': case '--help': o.help = true; break
      default: throw new Error(`unknown argument: ${a}`)
    }
  }
  return o
}

// Pure: the whole run as data, so a test can assert it without spawning.
export function plan(o, { env = process.env, now = new Date(), exists = existsSync } = {}) {
  if (!MODES.includes(o.mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`)
  if (!o.bin || !isAbsolute(o.bin)) throw new Error('--bin must be an absolute path to a claude binary')
  if (!exists(o.bin)) throw new Error(`--bin not found: ${o.bin}`)
  const pluginDirs = o.pluginDirs.map(d => resolve(d))
  for (const d of pluginDirs) if (!exists(d)) throw new Error(`--plugin-dir not found: ${d}`)
  if (o.mode === 'validate' && pluginDirs.length !== 1) throw new Error('validate takes exactly one --plugin-dir')
  if (o.prompt !== undefined && o.promptFile !== undefined) throw new Error('give --prompt or --prompt-file, not both')
  const prompt = o.promptFile !== undefined ? readFileSync(o.promptFile, 'utf8') : o.prompt
  if (o.mode !== 'validate' && !prompt) throw new Error(`${o.mode} needs --prompt or --prompt-file`)
  const timeout = o.timeout ?? DEFAULT_TIMEOUT_S
  if (!(timeout > 0 && timeout <= MAX_TIMEOUT_S)) throw new Error(`--timeout must be in (0, ${MAX_TIMEOUT_S}]`)
  const settle = o.settle ?? 20
  if (!(settle > 0 && settle < timeout)) throw new Error('--settle must be positive and below --timeout')

  let args
  if (o.mode === 'validate') {
    args = ['plugin', 'validate', pluginDirs[0], '--strict']
  } else {
    args = pluginDirs.flatMap(d => ['--plugin-dir', d])
    if (o.allowTools.length) args.push('--allowedTools', o.allowTools.join(','))
    if (o.maxTurns !== undefined) args.push('--max-turns', String(o.maxTurns))
    // An older binary refuses the current default model; name one it serves.
    if (o.model !== undefined) args.push('--model', o.model)
    if (o.mode === 'headless') args.unshift('-p', prompt)
  }

  const childEnv = {
    HOME: env.HOME,
    USER: env.USER,
    PATH: '/usr/bin:/bin',
    TERM: env.TERM && env.TERM !== 'dumb' ? env.TERM : 'xterm-256color',
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const out = resolve(o.out ?? join(env.TMPDIR || tmpdir(), 'interlock-host-probe', `${o.mode}-${stamp}`))
  // `exec "$0" "$@"` runs the binary with its argv untouched by the shell.
  const shell = ['/bin/zsh', '-l', '-c', 'exec "$0" "$@"', o.bin, ...args]
  return {
    mode: o.mode,
    bin: o.bin,
    cwd: resolve(o.cwd ?? process.cwd()),
    args,
    shell,
    env: childEnv,
    prompt: prompt ?? null,
    timeoutMs: timeout * 1000,
    settleMs: settle * 1000,
    out,
    tmuxSession: `interlock-probe-${stamp}`.slice(0, 60),
  }
}

function runPiped(p) {
  return new Promise(done => {
    const started = Date.now()
    const child = spawn(p.shell[0], p.shell.slice(1), { cwd: p.cwd, env: p.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, p.timeoutMs)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      writeFileSync(join(p.out, 'stdout.txt'), stdout)
      writeFileSync(join(p.out, 'stderr.txt'), stderr)
      done({ exitCode: code, signal, timedOut, durationMs: Date.now() - started })
    })
  })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const tmux = (...a) => spawnSync('tmux', a, { encoding: 'utf8' })

async function runTty(p) {
  const started = Date.now()
  // A tmux server keeps the environment of whoever started it, so the pane's
  // command clears it with `env -i` rather than trusting the server's.
  const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`
  const envWords = Object.entries(p.env).map(([k, v]) => q(`${k}=${v}`)).join(' ')
  const made = tmux('new-session', '-d', '-s', p.tmuxSession, '-x', '200', '-y', '60', '-c', p.cwd, `env -i ${envWords} ${p.shell.map(q).join(' ')}`)
  if (made.status !== 0) throw new Error(`tmux new-session failed: ${made.stderr.trim()}`)
  const capture = () => tmux('capture-pane', '-p', '-J', '-S', '-2000', '-t', p.tmuxSession).stdout ?? ''
  try {
    await sleep(Math.min(p.settleMs, 15000))
    tmux('send-keys', '-t', p.tmuxSession, '-l', p.prompt)
    tmux('send-keys', '-t', p.tmuxSession, 'Enter')
    let last = ''
    let quietSince = Date.now()
    let timedOut = true
    while (Date.now() - started < p.timeoutMs) {
      await sleep(2000)
      const screen = capture()
      if (screen !== last) { last = screen; quietSince = Date.now() } else if (Date.now() - quietSince >= p.settleMs) { timedOut = false; break }
    }
    writeFileSync(join(p.out, 'screen.txt'), last)
    return { exitCode: null, signal: null, timedOut, durationMs: Date.now() - started }
  } finally {
    tmux('kill-session', '-t', p.tmuxSession)
  }
}

async function main() {
  let o
  try { o = parseArgs(process.argv.slice(2)) } catch (err) { console.error(`host-probe: ${err.message}\n${USAGE}`); return 2 }
  if (o.help) { console.log(USAGE); return 0 }
  let p
  try { p = plan(o) } catch (err) { console.error(`host-probe: ${err.message}\n${USAGE}`); return 2 }
  if (o.dryRun) { console.log(JSON.stringify(p, null, 2)); return 0 }
  mkdirSync(p.out, { recursive: true })
  const version = spawnSync(p.shell[0], ['-l', '-c', 'exec "$0" --version', p.bin], { env: p.env, encoding: 'utf8', timeout: 30000 })
  const result = p.mode === 'tty' ? await runTty(p) : await runPiped(p)
  const meta = { ...p, env: Object.keys(p.env), version: (version.stdout || '').trim() || null, ...result }
  writeFileSync(join(p.out, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
  const files = p.mode === 'tty' ? ['screen.txt'] : ['stdout.txt', 'stderr.txt']
  console.log(`host-probe: ${meta.version ?? 'version unknown'} ${p.mode} exit=${result.exitCode} timedOut=${result.timedOut} ${result.durationMs}ms`)
  for (const f of files) {
    const path = join(p.out, f)
    console.log(`--- ${f} (${statSync(path).size} bytes) ${path}`)
    console.log(readFileSync(path, 'utf8'))
  }
  return result.timedOut || (result.exitCode !== null && result.exitCode !== 0) ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main()
