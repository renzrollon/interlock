// The host registry (spec: run-host-adapters — the runner selects a host
// adapter by id and records its declared capabilities).
//
// The registry's value is not the lookup — it is the DECLARATION. Every
// capability names a way a host is weaker than the default one, the run program
// branches on those declarations rather than on an id, and the runner banners
// each degradation. A fifth adapter arriving with a silently absent key would
// therefore be a run that quietly stopped bannering something, so the sweep
// below is over `CAPABILITY_KEYS` rather than over a list any one test wrote
// down.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CAPABILITY_KEYS,
  CAPABILITY_VALUES,
  HOSTS,
  HOST_IDS,
  WORKFLOW_HOST_ID,
  createHost,
  drivesClaudeBinary
} from '../../lib/host/registry.mjs'
import { HOST_PORTS } from '../../lib/host.mjs'
import { ACP_COMMAND_ENV } from '../../lib/host/acp.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('every adapter declares every capability key, with an allowed value', () => {
  assert.ok(HOST_IDS.length >= 4, 'the registry must hold the four shipped adapters')
  for (const id of HOST_IDS) {
    const entry = HOSTS[id]
    assert.equal(entry.id, id, `${id}: the entry's id must match its key`)
    assert.equal(typeof entry.create, 'function', `${id}: an adapter must have a factory`)
    for (const key of CAPABILITY_KEYS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(entry.capabilities, key),
        `${id} declares no ${key} — every degradation a host implies must be declarable`
      )
      assert.ok(
        CAPABILITY_VALUES[key].includes(entry.capabilities[key]),
        `${id}.${key} is ${JSON.stringify(entry.capabilities[key])}, not one of ${JSON.stringify(CAPABILITY_VALUES[key])}`
      )
    }
  }
})

test('the ids are unique and none of them is the Workflow host', () => {
  assert.equal(new Set(HOST_IDS).size, HOST_IDS.length)
  assert.ok(!HOST_IDS.includes(WORKFLOW_HOST_ID), 'the Workflow host is not a runner adapter')
})

test('every runner host owns its own lane worktrees', () => {
  // The isolation gap this change closed: nothing on the runner created a
  // worktree, so parallel lanes shared one tree. `driver` on every adapter is
  // what makes the run program emit a path instead of the runtime's
  // `isolation: 'worktree'`.
  for (const id of HOST_IDS) {
    assert.equal(HOSTS[id].capabilities.worktree, 'driver', `${id} must own its lane worktrees`)
  }
})

test('createHost throws on an unknown id, and names the ones it knows', () => {
  assert.throws(() => createHost('gemini', { cwd: ROOT }), /unknown host "gemini"/)
  assert.throws(() => createHost('gemini', { cwd: ROOT }), new RegExp(HOST_IDS.join(', ')))
  assert.throws(() => createHost('', { cwd: ROOT }), /known hosts/)
})

test('createHost refuses the Workflow host and says where it is reached', () => {
  assert.throws(() => createHost(WORKFLOW_HOST_ID, { cwd: ROOT }), /\/interlock:ship/)
})

test('a created host satisfies the three-function port and carries its capabilities', () => {
  const host = createHost('claude', { cwd: ROOT, env: {} })
  for (const port of HOST_PORTS) {
    assert.equal(typeof host[port], 'function', `a created host is missing ${port}`)
  }
  assert.equal(host.id, 'claude')
  for (const key of CAPABILITY_KEYS) {
    assert.notEqual(host.capabilities[key], undefined, `the created host dropped ${key}`)
  }
})

test('the ACP adapter refines hooks and billing when its command is the Claude binary', () => {
  // Declared `local`/`false` for the general case, because the agent behind
  // INTERLOCK_ACP_COMMAND is whatever the operator configured. A run that IS
  // driving Claude Code has this repository's hooks and IS spending a Claude
  // subscription, and declaring otherwise would suppress the two banners that
  // matter most on that path.
  const generic = createHost('acp', { cwd: ROOT, env: { [ACP_COMMAND_ENV]: 'some-acp-agent' } })
  assert.equal(generic.capabilities.hooks, false)
  assert.equal(generic.capabilities.billing, 'local')

  const overClaude = createHost('acp', { cwd: ROOT, env: { [ACP_COMMAND_ENV]: 'claude --acp' } })
  assert.equal(overClaude.capabilities.hooks, true)
  assert.equal(overClaude.capabilities.billing, 'claude-subscription-programmatic')
})

test('drivesClaudeBinary is true for claude and for ACP over the Claude binary only', () => {
  assert.equal(drivesClaudeBinary('claude', {}), true)
  assert.equal(drivesClaudeBinary('codex', {}), false)
  assert.equal(drivesClaudeBinary('qwen', {}), false)
  assert.equal(drivesClaudeBinary('acp', { [ACP_COMMAND_ENV]: 'claude --acp' }), true)
  assert.equal(drivesClaudeBinary('acp', { [ACP_COMMAND_ENV]: 'gemini --acp' }), false)
  // An unusable command is not a Claude run, and asking must not throw: the
  // adapter's own creation error is what the operator sees.
  assert.equal(drivesClaudeBinary('acp', {}), false)
  // An explicit --acp-command beats the environment, both ways.
  assert.equal(drivesClaudeBinary('acp', { [ACP_COMMAND_ENV]: 'gemini' }, 'claude'), true)
})

test('only Claude passes an unmapped slug through; the map-only hosts do not', () => {
  // The capability the model map reads. Claude's CLI accepts `haiku`/`sonnet`/
  // `opus`; Codex and Qwen have no idea what those mean, so an unmapped spawn
  // there is bannered rather than run on the operator's default in silence.
  assert.equal(HOSTS.claude.capabilities.modelSelect, 'flag')
  assert.equal(HOSTS.acp.capabilities.modelSelect, 'negotiated')
  assert.equal(HOSTS.codex.capabilities.modelSelect, 'map-only')
  assert.equal(HOSTS.qwen.capabilities.modelSelect, 'map-only')
})
