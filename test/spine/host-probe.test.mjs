// The host probe harness, as data. `plan()` is the whole run before anything
// spawns, so these cases never start a `claude` and need no network.
//
// What is pinned is what makes the harness safe to allow-list: the child's
// environment is the four keys and nothing the parent session carries, the
// binary's argv is passed through `exec "$0" "$@"` untouched by a shell, the
// timeout is bounded, and the script never ships. Eval mode adds exactly one
// key, the eval harness's gate, and refuses to start a metered run without a
// cost ceiling.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, plan } from '../../scripts/host-probe.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const exists = () => true
const env = {
  HOME: '/Users/x',
  USER: 'x',
  TMPDIR: '/tmp/t',
  TERM: 'xterm-256color',
  ANTHROPIC_BASE_URL: 'https://gateway.invalid',
  ANTHROPIC_AUTH_TOKEN: 'secret',
}
const at = new Date('2026-10-05T12:00:00.000Z')
const make = argv => plan(parseArgs(argv), { env, now: at, exists })

test('host-probe: the child environment carries only HOME, USER, PATH and TERM', () => {
  const p = make(['--mode', 'headless', '--bin', '/opt/c/claude', '--plugin-dir', '/p', '--prompt', 'hi'])
  assert.deepEqual(Object.keys(p.env).sort(), ['HOME', 'PATH', 'TERM', 'USER'])
  assert.equal(p.env.PATH, '/usr/bin:/bin')
  assert.ok(!JSON.stringify(p).includes('secret'), 'no parent credential reaches the plan')
})

test('host-probe: argv reaches the binary through exec "$0" "$@", never a shell string', () => {
  const p = make(['--mode', 'headless', '--bin', '/opt/c/claude', '--plugin-dir', '/p', '--prompt', "it's $(x)", '--allow-tool', 'Bash', '--max-turns', '4'])
  assert.deepEqual(p.shell.slice(0, 5), ['/bin/zsh', '-l', '-c', 'exec "$0" "$@"', '/opt/c/claude'])
  assert.deepEqual(p.args, ['-p', "it's $(x)", '--plugin-dir', '/p', '--allowedTools', 'Bash', '--max-turns', '4'])
})

test('host-probe: --model is passed through for an older binary', () => {
  const p = make(['--mode', 'headless', '--bin', '/c', '--plugin-dir', '/p', '--prompt', 'hi', '--model', 'claude-haiku-4-5-20251001'])
  assert.deepEqual(p.args.slice(-2), ['--model', 'claude-haiku-4-5-20251001'])
})

test('host-probe: validate takes exactly one plugin dir and adds --strict', () => {
  assert.deepEqual(make(['--mode', 'validate', '--bin', '/c', '--plugin-dir', '/p']).args, ['plugin', 'validate', '/p', '--strict'])
  assert.throws(() => make(['--mode', 'validate', '--bin', '/c']), /exactly one --plugin-dir/)
})

test('host-probe: tty drops -p and keeps the prompt to type', () => {
  const p = make(['--mode', 'tty', '--bin', '/c', '--plugin-dir', '/p', '--prompt', 'hi'])
  assert.ok(!p.args.includes('-p'))
  assert.equal(p.prompt, 'hi')
  assert.match(p.tmuxSession, /^interlock-probe-/)
})

test('host-probe: refuses what it cannot bound', () => {
  assert.throws(() => make(['--mode', 'run', '--bin', '/c']), /--mode/)
  assert.throws(() => make(['--mode', 'headless', '--bin', 'claude', '--prompt', 'x']), /absolute/)
  assert.throws(() => make(['--mode', 'headless', '--bin', '/c']), /needs --prompt/)
  assert.throws(() => make(['--mode', 'headless', '--bin', '/c', '--prompt', 'x', '--timeout', '9999']), /--timeout/)
  assert.throws(() => parseArgs(['--frobnicate']), /unknown argument/)
  assert.throws(() => plan(parseArgs(['--mode', 'validate', '--bin', '/nope', '--plugin-dir', '/p']), { env, exists: p => p !== '/nope' }), /not found/)
})

test("host-probe: eval runs the full eval job's flags for one case, writing into --out", () => {
  const p = make(['--mode', 'eval', '--bin', '/c', '--plugin-dir', '/p', '--case', 'spec-range-*', '--max-cost-usd', '3', '--out', '/o'])
  assert.deepEqual(p.args, [
    'plugin', 'eval', '/p', '--case', 'spec-range-*',
    '--scaffold', '--trust-plugin', '--runs', '1', '--ablation', 'none', '--no-publish', '--keep-temp',
    '--max-cost-usd', '3', '--output-dir', '/o/results', '--report', '/o/report.html', '--json', '/o/results.json'
  ])
  assert.equal(p.prompt, null, 'an eval case carries its own prompt')
})

test('host-probe: eval adds only the eval gate to the clean environment', () => {
  const p = make(['--mode', 'eval', '--bin', '/c', '--plugin-dir', '/p', '--max-cost-usd', '1'])
  assert.deepEqual(Object.keys(p.env).sort(), ['CLAUDE_CODE_WALNUT_SPIRE', 'HOME', 'PATH', 'TERM', 'USER'])
  assert.equal(p.env.CLAUDE_CODE_WALNUT_SPIRE, '1')
  assert.ok(!JSON.stringify(p).includes('secret'), 'no parent credential reaches the plan')
  const headless = make(['--mode', 'headless', '--bin', '/c', '--plugin-dir', '/p', '--prompt', 'hi'])
  assert.equal(headless.env.CLAUDE_CODE_WALNUT_SPIRE, undefined, 'the gate is eval mode only')
})

test('host-probe: eval passes runs, ablation, tools and model through, and can drop --trust-plugin as CI does', () => {
  const p = make([
    '--mode', 'eval', '--bin', '/c', '--plugin-dir', '/p', '--max-cost-usd', '5', '--runs', '3',
    '--ablation', 'with-without', '--allow-tool', 'Bash', '--allow-tool', 'Write', '--model', 'm', '--no-trust-plugin'
  ])
  assert.ok(!p.args.includes('--trust-plugin'))
  assert.deepEqual(p.args.slice(p.args.indexOf('--runs'), p.args.indexOf('--runs') + 4), ['--runs', '3', '--ablation', 'with-without'])
  assert.deepEqual(p.args.slice(-5), ['--allow-tools', 'Bash', 'Write', '--model', 'm'])
})

test('host-probe: eval refuses a run with no cost ceiling, a bad ablation, or a second plugin dir', () => {
  const base = ['--mode', 'eval', '--bin', '/c', '--plugin-dir', '/p']
  assert.throws(() => make(base), /--max-cost-usd/)
  assert.throws(() => make([...base, '--max-cost-usd', '0']), /--max-cost-usd/)
  assert.throws(() => make([...base, '--max-cost-usd', '1', '--ablation', 'both']), /--ablation/)
  assert.throws(() => make([...base, '--max-cost-usd', '1', '--runs', '0']), /--runs/)
  assert.throws(() => make([...base, '--plugin-dir', '/q', '--max-cost-usd', '1']), /exactly one --plugin-dir/)
  assert.throws(() => make([...base, '--max-cost-usd', '1', '--timeout', '9999']), /--timeout/)
  assert.equal(make([...base, '--max-cost-usd', '1', '--timeout', '1500']).timeoutMs, 1500 * 1000, 'a Spec Range case may outlast the session ceiling')
})

test('host-probe: output defaults under TMPDIR, stamped', () => {
  assert.equal(make(['--mode', 'validate', '--bin', '/c', '--plugin-dir', '/p']).out, '/tmp/t/interlock-host-probe/validate-2026-10-05T12-00-00-000Z')
})

test('host-probe: scripts/ is not in the published whitelist', () => {
  const { files } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.ok(!files.some(f => f === 'scripts' || f.startsWith('scripts/')))
})
