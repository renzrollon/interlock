// The spec skill's instructions filter. It keeps the fields an author fills
// and drops the rest, including an empty string, so a missing field is absent
// rather than present and blank.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'spec', 'scripts', 'compact-instructions.mjs')

function run(input) {
  return spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' })
}

test('compact-instructions keeps the author fields and drops the rest', () => {
  const result = run(
    JSON.stringify({
      instruction: 'write it',
      template: '# T',
      resolvedOutputPath: 'openspec/changes/x/proposal.md',
      context: 'ctx',
      rules: 'r',
      extra: 'no',
      empty: ''
    })
  )
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    instruction: 'write it',
    template: '# T',
    resolvedOutputPath: 'openspec/changes/x/proposal.md',
    context: 'ctx',
    rules: 'r'
  })
})

test('compact-instructions rejects stdin that is not JSON', () => {
  const result = run('not json')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /not JSON/)
})
