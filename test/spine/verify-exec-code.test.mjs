import test from 'node:test'
import assert from 'node:assert/strict'
import { constants } from 'node:os'
import { execExitCode } from '../../lib/verify-exec.mjs'

test('execExitCode: the shapes of a finished spawnSync', () => {
  const warned = []
  const warn = m => warned.push(m)
  assert.equal(execExitCode({ error: new Error('ENOENT') }, warn), 127)
  assert.equal(warned.length, 1)
  assert.equal(execExitCode({ status: 3 }, warn), 3)
  assert.equal(execExitCode({ status: 0 }, warn), 0)
  assert.equal(execExitCode({ status: null, signal: 'SIGKILL' }, warn), 128 + constants.signals.SIGKILL)
  assert.equal(execExitCode({ status: null, signal: 'SIGBOGUS' }, warn), 1)
  assert.equal(execExitCode({ status: null, signal: null }, warn), 1)
  assert.equal(warned.length, 1)
})
