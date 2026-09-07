import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('README documents every public export under an API heading', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  assert.match(readme, /^## API$/m, 'README has no "## API" section')
  for (const name of ['formatCount', 'formatBytes', 'formatDuration', 'summarize']) {
    assert.ok(readme.includes(name), `README does not document ${name}`)
  }
})
