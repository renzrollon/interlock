// The settings reader the doctor and the runner share, the redacted parse reason,
// and the import closure of the ACP runner.
//
// The runner (`bin/interlock-run`) may import only node builtins and the host
// port. `test/workflows.test.mjs` pins its DIRECT imports; this file walks the
// whole closure, because a direct import of an allowed module can still drag the
// policy modules in behind it (lib/host/advisor-banners.mjs once imported
// lib/doctor.mjs, which pulls in limits, verify and more).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { jsonParseReason, readAdvisorConfig } from '../../lib/advisor-tool.mjs'
import { settingsSources as fromDoctor } from '../../lib/doctor.mjs'
import { readSettingsSources, settingsSources } from '../../lib/settings-sources.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('doctor re-exports the one settingsSources', () => {
  assert.equal(fromDoctor, settingsSources)
  const list = settingsSources('/proj', '/home/me')
  assert.deepEqual(list.map(s => s.scope), ['managed', 'user', 'project', 'local'])
  assert.equal(list[1].path, join('/home/me', '.claude', 'settings.json'))
  assert.equal(list[3].path, join('/proj', '.claude', 'settings.local.json'))
})

test('readSettingsSources answers absent, text or error per source and never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'settings-sources-'))
  try {
    mkdirSync(join(dir, 'd'))
    writeFileSync(join(dir, 'ok.json'), '{"a":1}')
    const isDir = join(dir, 'd')
    const result = readSettingsSources([
      { scope: 'user', path: join(dir, 'missing.json') },
      { scope: 'project', path: join(dir, 'ok.json') },
      { scope: 'local', path: isDir },
      null,
      { scope: 'x' }
    ])
    assert.deepEqual(result[0], { scope: 'user', path: join(dir, 'missing.json'), absent: true })
    assert.deepEqual(result[1], { scope: 'project', path: join(dir, 'ok.json'), text: '{"a":1}' })
    assert.equal(result[2].scope, 'local')
    assert.ok('error' in result[2] && !('text' in result[2]) && !('absent' in result[2]))
    assert.equal(result.length, 3, 'entries without a path are dropped')
    assert.deepEqual(readSettingsSources('nope'), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('jsonParseReason keeps the position and drops every quoted excerpt', () => {
  const secret = 'SECRET-topic-123'
  const messages = [
    `Unexpected token '${secret[0]}', "${secret}: {"a"..." is not valid JSON`,
    `Unexpected token } in JSON at position 12`,
    `Expected ',' or '}' after property value in JSON at position 13 (line 1 column 14)`,
    `Unexpected string in JSON at position 7`,
    'Unexpected end of JSON input'
  ]
  const reasons = messages.map(m => jsonParseReason(new SyntaxError(m)))
  assert.deepEqual(reasons, [
    'not valid JSON: position not reported',
    'not valid JSON: at position 12',
    'not valid JSON: at position 13 (line 1 column 14)',
    'not valid JSON: at position 7',
    'not valid JSON: position not reported'
  ])
  for (const r of reasons) assert.doesNotMatch(r, new RegExp(secret))
  assert.equal(jsonParseReason(undefined), 'not valid JSON: position not reported')
})

test('readAdvisorConfig does not echo a secret from a file that fails to parse', () => {
  const secret = 'ntfy-SECRET-topic-abc'
  for (const text of [`${secret}: 1`, `{"t":"${secret}" "x":1}`]) {
    const read = readAdvisorConfig([{ scope: 'local', text }])
    assert.equal(read.unreadable.length, 1)
    assert.doesNotMatch(JSON.stringify(read), new RegExp(secret))
    assert.match(read.unreadable[0].reason, /^not valid JSON: \S/)
  }
})

// --- the runner's transitive import closure -----------------------------------------

const STATIC_FROM = /(?:^|\n)\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

/** Every repo file reachable from `entry` through relative static import/export-from specifiers. */
function importClosure(entry) {
  const seen = new Set()
  const bare = new Set()
  const queue = [resolve(entry)]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const m of source.matchAll(STATIC_FROM)) {
      const specifier = m[1] || m[2]
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier)
        assert.ok(existsSync(target), `${relative(ROOT, file)} imports ${specifier}, which does not exist`)
        queue.push(target)
      } else if (!specifier.startsWith('node:')) {
        bare.add(`${relative(ROOT, file)} → ${specifier}`)
      }
    }
  }
  return { files: [...seen].map(f => relative(ROOT, f)).sort(), bare: [...bare] }
}

test('the runner\'s whole import closure holds no policy module and no bare specifier', () => {
  const { files, bare } = importClosure(join(ROOT, 'bin', 'interlock-run'))
  assert.ok(files.length > 3, `failed to walk the runner's imports: ${files}`)
  assert.ok(files.includes(join('lib', 'host', 'advisor-banners.mjs')), 'the walk reaches the advisor banners')
  assert.ok(files.includes(join('lib', 'settings-sources.mjs')), 'and the shared settings reader')
  assert.deepEqual(bare, [], 'the runner reaches a non-builtin, non-relative import')
  const forbidden = files.filter(f => {
    const name = f.split('/').pop()
    return (
      f === join('lib', 'doctor.mjs') ||
      f === join('lib', 'limits.mjs') ||
      /^verify[^/]*\.mjs$/.test(name) && f.startsWith('lib/') ||
      f === join('lib', 'run.mjs') ||
      f === join('lib', 'waves.mjs')
    )
  })
  assert.deepEqual(forbidden, [], `the runner's import closure reaches policy modules: ${forbidden}\nclosure: ${files.join(', ')}`)
})
