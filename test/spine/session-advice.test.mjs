// The session suggestion (spec: session-advice). The table is published by
// `lib/limits.mjs`; `lib/session-advice.mjs` is its one reader. These tests pin
// the table's vocabulary and keys, the suggestion line, the four fits against
// the observed `CLAUDE_EFFORT`, the follow line, the override banner, the error
// for a name with no row, the module's freedom from Node, and the reader sweep.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SESSION_ADVICE, SESSION_ADVICE_BASIS } from '../../lib/limits.mjs'
import {
  ADVISED_SKILLS,
  SESSION_MODELS,
  EFFORT_LEVELS,
  adviceLine,
  resolveAdvice,
  listAdvice,
  formatAdvice,
  AdviceError
} from '../../lib/session-advice.mjs'
import { walkModule } from '../helpers/module-walk.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const KEYS = ['explore', 'spec', 'review-artifacts', 'bootstrap', 'ship', 'settle', 'review-code', 'fix-tests']

/** The text lines of one resolved answer, banners included. */
const textOf = out => formatAdvice(out).replace(/\n$/, '').split('\n')
const fitAt = (skill, effort) => resolveAdvice(skill, effort === undefined ? {} : { CLAUDE_EFFORT: effort }).fit

// --- the table ----------------------------------------------------------------

test('the table holds the eight advised skills in order, each a directory under skills/', () => {
  assert.deepEqual(Object.keys(SESSION_ADVICE), KEYS)
  assert.deepEqual([...ADVISED_SKILLS], KEYS)
  for (const key of Object.keys(SESSION_ADVICE)) {
    const dir = join(ROOT, 'skills', key)
    assert.ok(existsSync(dir) && statSync(dir).isDirectory(), `table key ${key} is not a directory under skills/`)
  }
  assert.equal(typeof SESSION_ADVICE_BASIS, 'string')
  assert.ok(SESSION_ADVICE_BASIS.trim() !== '', 'the table names the guidance it was read from')
})

test('the vocabulary is three models and five efforts in rising order', () => {
  assert.deepEqual([...SESSION_MODELS], ['sonnet', 'opus', 'fable'])
  assert.deepEqual([...EFFORT_LEVELS], ['low', 'medium', 'high', 'xhigh', 'max'])
})

test('every row is inside the vocabulary, its ceiling is not below its effort, and its best-results pair is inside it too', () => {
  for (const [skill, row] of Object.entries(SESSION_ADVICE)) {
    assert.ok(SESSION_MODELS.includes(row.model), `${skill}: model ${row.model} is outside the vocabulary`)
    assert.ok(EFFORT_LEVELS.includes(row.effort), `${skill}: effort ${row.effort} is outside the vocabulary`)
    if (row.upTo !== undefined) {
      assert.ok(EFFORT_LEVELS.includes(row.upTo), `${skill}: upTo ${row.upTo} is outside the vocabulary`)
      assert.ok(
        EFFORT_LEVELS.indexOf(row.upTo) >= EFFORT_LEVELS.indexOf(row.effort),
        `${skill}: upTo ${row.upTo} is below effort ${row.effort}`
      )
    }
    if (row.best !== undefined) {
      assert.ok(SESSION_MODELS.includes(row.best.model), `${skill}: best.model ${row.best.model} is outside the vocabulary`)
      assert.ok(EFFORT_LEVELS.includes(row.best.effort), `${skill}: best.effort ${row.best.effort} is outside the vocabulary`)
    }
  }
})

test('the table is frozen, rows and nested pairs included', () => {
  assert.ok(Object.isFrozen(SESSION_ADVICE))
  for (const [skill, row] of Object.entries(SESSION_ADVICE)) {
    assert.ok(Object.isFrozen(row), `${skill} row is not frozen`)
    if (row.best) assert.ok(Object.isFrozen(row.best), `${skill} best pair is not frozen`)
  }
})

// --- the suggestion line --------------------------------------------------------

test('adviceLine names the skill, the model and the effort for a plain row', () => {
  const row = SESSION_ADVICE.ship
  assert.equal(row.upTo, undefined, 'the fixture row must hold no ceiling')
  assert.equal(row.best, undefined, 'the fixture row must hold no best-results pair')
  assert.equal(adviceLine('ship'), `session suggestion for ship: model ${row.model} · effort ${row.effort}`)
})

test('adviceLine names the ceiling and the best-results pair after the model and effort when the row holds them', () => {
  const row = SESSION_ADVICE.spec
  assert.ok(row.upTo && row.best, 'the fixture row must hold a ceiling and a pair')
  assert.equal(
    adviceLine('spec'),
    `session suggestion for spec: model ${row.model} · effort ${row.effort}, up to ${row.upTo} · best results: model ${row.best.model} · effort ${row.best.effort}`
  )
})

// --- the four fits ---------------------------------------------------------------

test('the spec row fits at its boundaries: below, within at effort and at ceiling, above', () => {
  assert.equal(fitAt('spec', 'low'), 'below')
  assert.equal(fitAt('spec', 'high'), 'within')
  assert.equal(fitAt('spec', 'xhigh'), 'within')
  assert.equal(fitAt('spec', 'max'), 'above')
})

test('the ship row, with no ceiling, has its effort as its ceiling', () => {
  assert.equal(fitAt('ship', 'low'), 'below')
  assert.equal(fitAt('ship', 'medium'), 'within')
  assert.equal(fitAt('ship', 'xhigh'), 'above')
})

test('CLAUDE_EFFORT unset, blank or unknown is unobserved and prints effort not observed', () => {
  for (const env of [{}, { CLAUDE_EFFORT: '' }, { CLAUDE_EFFORT: '   ' }, { CLAUDE_EFFORT: 'turbo' }]) {
    const out = resolveAdvice('spec', env)
    assert.equal(out.fit, 'unobserved', JSON.stringify(env))
    assert.equal(out.observed.effort, null, JSON.stringify(env))
    const session = out.lines[1]
    assert.ok(session.includes('effort not observed'), session)
    for (const level of EFFORT_LEVELS) {
      assert.ok(!new RegExp(`\\b${level}\\b`).test(session), `${JSON.stringify(env)}: the session line prints ${level}`)
    }
  }
})

test('CLAUDE_EFFORT is trimmed and not case-folded', () => {
  assert.equal(fitAt('spec', ' high '), 'within')
  assert.equal(resolveAdvice('spec', { CLAUDE_EFFORT: ' high ' }).observed.effort, 'high')
  assert.equal(fitAt('spec', 'High'), 'unobserved')
  assert.equal(resolveAdvice('spec', { CLAUDE_EFFORT: 'High' }).observed.effort, null)
})

test('the session line names the observed effort and its fit, and says the model was not observed', () => {
  const within = resolveAdvice('spec', { CLAUDE_EFFORT: 'high' })
  assert.equal(within.lines[1], 'this session: effort high, within the suggestion · model not observed')
  assert.match(resolveAdvice('spec', { CLAUDE_EFFORT: 'low' }).lines[1], /effort low, below the suggestion/)
  assert.match(resolveAdvice('ship', { CLAUDE_EFFORT: 'xhigh' }).lines[1], /effort xhigh, above the suggestion/)
  assert.equal(within.observed.model, null)
})

// --- the JSON shape ------------------------------------------------------------

test('one skill emits the ten keys, with null for a row\'s missing ceiling and pair', () => {
  const spec = resolveAdvice('spec', { CLAUDE_EFFORT: 'low' })
  assert.deepEqual(Object.keys(spec), ['skill', 'model', 'effort', 'upTo', 'best', 'basis', 'observed', 'fit', 'banners', 'lines'])
  assert.equal(spec.skill, 'spec')
  assert.equal(spec.model, SESSION_ADVICE.spec.model)
  assert.equal(spec.effort, SESSION_ADVICE.spec.effort)
  assert.equal(spec.upTo, SESSION_ADVICE.spec.upTo)
  assert.deepEqual(spec.best, { ...SESSION_ADVICE.spec.best })
  assert.equal(spec.basis, SESSION_ADVICE_BASIS)
  assert.deepEqual(spec.observed, { effort: 'low', model: null })
  assert.equal(spec.lines[0], adviceLine('spec'))
  const ship = resolveAdvice('ship', {})
  assert.equal(ship.upTo, null)
  assert.equal(ship.best, null)
  assert.equal(ship.observed.model, null)
})

test('the list form carries the table, the observation and the lines, and no fit', () => {
  const out = listAdvice({ CLAUDE_EFFORT: 'low' })
  assert.deepEqual(Object.keys(out), ['basis', 'skills', 'observed', 'banners', 'lines'])
  assert.equal(out.fit, undefined)
  assert.equal(out.basis, SESSION_ADVICE_BASIS)
  assert.deepEqual(Object.keys(out.skills), KEYS)
  for (const skill of KEYS) {
    const row = SESSION_ADVICE[skill]
    assert.deepEqual(out.skills[skill], {
      model: row.model,
      effort: row.effort,
      upTo: row.upTo ?? null,
      best: row.best ? { ...row.best } : null
    })
  }
  assert.deepEqual(out.lines, KEYS.map(adviceLine))
  assert.deepEqual(out.observed, { effort: 'low', model: null })
  assert.deepEqual(out.banners, [])
  const text = textOf(out)
  assert.deepEqual(text, KEYS.map(adviceLine))
  assert.ok(!text.some(line => line.startsWith('this session') || line.includes('/effort')))
})

// --- the follow line ----------------------------------------------------------

test('the follow line is printed for below, above and unobserved and not for within', () => {
  const follow = out => out.lines.find(line => line.includes('/effort'))
  for (const env of [{ CLAUDE_EFFORT: 'low' }, { CLAUDE_EFFORT: 'xhigh' }, {}]) {
    const out = resolveAdvice('ship', env)
    assert.equal(out.lines.length, 3, JSON.stringify(env))
    const line = out.lines[2]
    assert.equal(follow(out), line)
    assert.ok(line.includes(`/effort ${SESSION_ADVICE.ship.effort}`), line)
    assert.ok(line.includes(`/model ${SESSION_ADVICE.ship.model}`), line)
    assert.match(line, /at a break in the work/)
    assert.match(line, /if this session is on another model/)
  }
  const within = resolveAdvice('ship', { CLAUDE_EFFORT: 'medium' })
  assert.equal(within.lines.length, 2)
  assert.equal(follow(within), undefined)
})

test('a row with a best-results pair names both models and tells neither to leave', () => {
  const out = resolveAdvice('spec', { CLAUDE_EFFORT: 'low' })
  const line = out.lines.at(-1)
  assert.ok(line.includes(`/effort ${SESSION_ADVICE.spec.effort}`), line)
  assert.ok(line.includes(`/model ${SESSION_ADVICE.spec.model}`), line)
  assert.ok(line.includes(`/model ${SESSION_ADVICE.spec.best.model}`), line)
  assert.match(line, /if this session is on neither/)
  assert.match(line, /at a break in the work/)
})

test('the design\'s three lines for spec at low, word for word', () => {
  assert.deepEqual(textOf(resolveAdvice('spec', { CLAUDE_EFFORT: 'low' })), [
    'session suggestion for spec: model opus · effort high, up to xhigh · best results: model fable · effort high',
    'this session: effort low, below the suggestion · model not observed',
    'to follow it: /effort high, and /model opus (or /model fable for best results) if this session is on neither; ' +
      'change models at a break in the work, because the first turn on a new model rewrites the prompt cache'
  ])
})

test('no line holds a code span, so no control is offered on it', () => {
  for (const out of [resolveAdvice('spec', {}), listAdvice({ CLAUDE_CODE_EFFORT_LEVEL: 'max' })]) {
    for (const line of [...out.lines, ...out.banners]) assert.ok(!line.includes('`'), line)
  }
})

// --- the override banner -------------------------------------------------------

test('a set CLAUDE_CODE_EFFORT_LEVEL is bannered in the JSON and the text, and a blank one is not', () => {
  const env = Object.freeze({ CLAUDE_CODE_EFFORT_LEVEL: 'max' })
  const out = resolveAdvice('ship', env)
  assert.equal(out.banners.length, 1)
  assert.equal(
    out.banners[0],
    'EFFORT SUGGESTION OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=max — /effort does not change this session\'s effort while it is set'
  )
  assert.equal(textOf(out).at(-1), out.banners[0])
  assert.deepEqual({ ...env }, { CLAUDE_CODE_EFFORT_LEVEL: 'max' }, 'the resolver changed the environment')
  const list = listAdvice(env)
  assert.deepEqual(list.banners, out.banners)
  assert.deepEqual(textOf(list), [...KEYS.map(adviceLine), out.banners[0]])
  assert.deepEqual(resolveAdvice('ship', { CLAUDE_CODE_EFFORT_LEVEL: '' }).banners, [])
  assert.deepEqual(resolveAdvice('ship', { CLAUDE_CODE_EFFORT_LEVEL: '  ' }).banners, [])
})

// --- a name with no row --------------------------------------------------------

test('a name with no row throws AdviceError naming the advised skills, never a default', () => {
  for (const name of ['graph', 'not-a-skill', undefined, '', 'constructor', 'toString']) {
    assert.throws(
      () => resolveAdvice(name, {}),
      err => err instanceof AdviceError && KEYS.every(key => err.message.includes(key)),
      String(name)
    )
    assert.throws(() => adviceLine(name), AdviceError, String(name))
  }
})

// --- the module ---------------------------------------------------------------

test('the module and everything it imports are free of node: specifiers', () => {
  const entry = join(ROOT, 'lib', 'session-advice.mjs')
  const { files, problems } = walkModule(entry, ROOT)
  assert.deepEqual(problems, [], problems.join('\n'))
  assert.deepEqual(
    files.map(f => f.slice(ROOT.length + 1)).sort(),
    ['lib/host/effort.mjs', 'lib/limits.mjs', 'lib/session-advice.mjs']
  )
  const source = readFileSync(entry, 'utf8')
  assert.ok(!source.includes('process.'), 'lib/session-advice.mjs reads process instead of the env it is handed')
})

/** Every `.mjs`/`.js` file under a directory, as repository-relative paths. */
function sourcesUnder(dir) {
  const out = []
  const walk = abs => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const path = join(abs, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(mjs|js)$/.test(entry.name)) out.push(path.slice(ROOT.length + 1))
    }
  }
  walk(join(ROOT, dir))
  return out
}

test('only lib/session-advice.mjs names SESSION_ADVICE, and the bare forward in cli/interlock is not a reader', () => {
  const names = ['lib', 'hooks', 'workflows']
    .flatMap(sourcesUnder)
    .filter(rel => rel !== 'lib/limits.mjs')
    .filter(rel => /\bSESSION_ADVICE\b/.test(readFileSync(join(ROOT, rel), 'utf8')))
  assert.deepEqual(names, ['lib/session-advice.mjs'])
  // The forward exists, so the sweep must be refusing it on purpose.
  const cli = readFileSync(join(ROOT, 'cli', 'interlock'), 'utf8')
  assert.match(cli, /sessionAdvice: SESSION_ADVICE\b/)
  assert.doesNotMatch(cli, /\bSESSION_ADVICE\[|Object\.\w+\(SESSION_ADVICE\)/, 'cli/interlock indexes the table instead of forwarding it')
})
