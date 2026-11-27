// The unreachable-close fallback (spec: ship/close-summary). Both drivers say
// the same core sentence; a source-equality test keeps them from drifting, and
// the Workflow host's behaviour is driven through the ship harness.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runShip } from '../helpers/ship-harness.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHIP = readFileSync(join(ROOT, 'workflows', 'ship.js'), 'utf8')
const RUNNER = readFileSync(join(ROOT, 'cli', 'interlock-run'), 'utf8')

/** The fallback's core sentence: from its first literal to the one that ends `clears it.`. */
function coreOf(source) {
  const start = source.indexOf('The close itself could not be reached')
  assert.ok(start >= 0, 'the fallback sentence is missing')
  const end = source.indexOf('clears it.', start)
  assert.ok(end > start, 'the fallback sentence has no ending')
  return source.slice(start, end + 'clears it.'.length)
}

test('both drivers carry the identical core sentence, and neither names a marker path', () => {
  const a = coreOf(SHIP)
  const b = coreOf(RUNNER)
  assert.equal(a, b, 'the two drivers\' fallback sentences drifted apart')
  for (const [name, text] of [['ship.js', a], ['interlock-run', b]]) {
    assert.match(text, /no receipt was written/, `${name}: no receipt was written is preserved`)
    assert.match(text, /interlock run close --halt/, `${name}: names the close to run`)
    assert.match(text, /git commit/, `${name}: says the marker may block a commit`)
    assert.match(text, /from the directory the run started in/, `${name}: names the directory`)
    assert.doesNotMatch(text, /nothing was recorded/, `${name}: that phrase is reserved for the no-manifest close`)
    assert.doesNotMatch(text, /from the project root/, `${name}: never the project root`)
    assert.doesNotMatch(text, /stage\.json|\.claude\/ship/, `${name}: spells out no marker path`)
  }
})

test('SHIP HALTED still leads both fallbacks and interlock-run prints cwd:', () => {
  assert.match(SHIP, /`SHIP HALTED — \$\{reason\}\\n\\n` \+\n\s+`The close itself could not be reached/)
  assert.match(RUNNER, /`SHIP HALTED — \$\{reason\}\\n\\n` \+\n\s+`The close itself could not be reached/)
  assert.match(RUNNER, /cwd: \$\{resolve\(root\)\}/)
  assert.match(RUNNER, /import \{[^}]*\bresolve\b[^}]*\} from 'node:path'/)
})

test('a close relay that returns nothing leaves a SHIP HALTED summary carrying the fallback', async () => {
  const { output, root } = await runShip({
    keepRepo: true,
    responses: {
      // The run halts on an unreadable relay copy, and the close relay that follows returns nothing.
      'cli-2': stdout => stdout.replace('"action"', '"action" "'),
      'cli-3': null,
      'cli-4': null,
      'cli-5': null,
      'cli-6': null
    }
  })
  try {
    assert.match(output, /^SHIP HALTED — /m, output)
    assert.match(output, /so the close was not recorded: no receipt was written/, output)
    assert.match(output, /stage marker may still block `git commit`/, output)
    assert.match(output, /from the directory the run started in/, output)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
