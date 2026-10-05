// The host probe harness, as data. `plan()` is the whole run before anything
// spawns, so these cases never start a `claude` and need no network.
//
// What is pinned is what makes the harness safe to allow-list: the child's
// environment is the four keys and nothing the parent session carries, the
// binary's argv is passed through `exec "$0" "$@"` untouched by a shell, the
// timeout is bounded, and the script never ships.

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

test('host-probe: output defaults under TMPDIR, stamped', () => {
  assert.equal(make(['--mode', 'validate', '--bin', '/c', '--plugin-dir', '/p']).out, '/tmp/t/interlock-host-probe/validate-2026-10-05T12-00-00-000Z')
})

test('host-probe: scripts/ is not in the published whitelist', () => {
  const { files } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.ok(!files.some(f => f === 'scripts' || f.startsWith('scripts/')))
})
