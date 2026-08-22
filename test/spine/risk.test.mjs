import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyRisk,
  formatRisk,
  maxClass,
  RISK_CLASSES,
  CONTINUITY_ALLOWED_CLASSES,
  UNCLASSIFIABLE_CLASS,
  canonicalizePath
} from '../../lib/risk.mjs'

// classifyRisk is pure, so every case is "signals in, class out".
const classOf = (input, opts) => classifyRisk(input, opts).riskClass
const paths = (...changedPaths) => classifyRisk({ changedPaths })
const signalNames = (r) => r.signals.map(s => s.signal)

// --- the F3 table ---------------------------------------------------------

test('docs / typo / test-only paths are low', () => {
  for (const p of [
    ['README.md'],
    ['docs/getting-started.md', 'docs/faq.mdx'],
    ['openspec/changes/add-thing/proposal.md', 'openspec/changes/add-thing/tasks.md'],
    ['test/spine/waves.test.mjs'],
    ['src/components/Button.test.tsx', 'e2e/onboarding-flow.ts'],
    ['CHANGELOG.md', 'test/unit/util.spec.ts']
  ]) {
    const r = classifyRisk({ changedPaths: p })
    assert.equal(r.riskClass, 'low', `${p.join(',')} → ${r.riskClass} (${signalNames(r)})`)
    assert.ok(r.continuityAllowed)
  }
})

test('auth, session, permissions and tenancy paths are high', () => {
  for (const p of [
    'src/auth/login.ts',
    'app/api/session/route.ts',
    'src/permissions/check.ts',
    'server/rbac.ts',
    'src/tenancy/resolver.ts',
    'lib/acl/index.ts'
  ]) {
    assert.equal(classOf({ changedPaths: [p] }), 'high', p)
  }
})

test('auth signals also come from artifact text alone', () => {
  const r = classifyRisk({
    changedPaths: ['src/widget/render.ts'],
    artifacts: { 'design.md': 'We add role-based access control to the widget endpoint.' }
  })
  assert.equal(r.riskClass, 'high')
  assert.ok(signalNames(r).includes('auth-session-permissions-tenancy'))
})

test('a migration is high, from the path and from the prose', () => {
  assert.equal(classOf({ changedPaths: ['db/migrations/0004_add_email.sql'] }), 'high')
  assert.equal(classOf({ changedPaths: ['prisma/schema.prisma'] }), 'high')
  assert.equal(
    classOf({
      changedPaths: ['src/widget/render.ts'],
      artifacts: { 'proposal.md': 'This requires a database migration to add column `email`.' }
    }),
    'high'
  )
})

test('a new public API is high', () => {
  const r = classifyRisk({
    changedPaths: ['src/widget/render.ts'],
    artifacts: { 'proposal.md': 'Expose a new public API for third parties.' }
  })
  assert.equal(r.riskClass, 'high')
  assert.ok(signalNames(r).includes('api-schema-migration'))
})

test('deleting data is critical', () => {
  assert.equal(
    classOf({
      changedPaths: ['src/widget/render.ts'],
      artifacts: { 'design.md': 'The job will hard-delete orphaned rows; this is irreversible.' }
    }),
    'critical'
  )
  assert.equal(classOf({ changedPaths: ['db/migrations/0007_drop_legacy_users.sql'] }), 'critical')
})

test('payment is critical', () => {
  assert.equal(classOf({ changedPaths: ['src/billing/charge.ts'] }), 'critical')
  assert.equal(
    classOf({
      changedPaths: ['src/widget/render.ts'],
      artifacts: { 'proposal.md': 'Issue a refund through Stripe when the order is cancelled.' }
    }),
    'critical'
  )
})

test('changing idempotency is critical', () => {
  const r = classifyRisk({
    changedPaths: ['src/queue/worker.ts'],
    artifacts: { 'design.md': 'The handler becomes idempotent so retries cannot double-charge.' }
  })
  assert.equal(r.riskClass, 'critical')
  assert.ok(signalNames(r).includes('idempotency'))
})

test('an invariant sweep / shared value transform is at least medium', () => {
  const sweep = classifyRisk({
    changedPaths: ['src/widget/render.ts'],
    artifacts: { 'tasks.md': '- [ ] 1.1 Invariant sweep: update every call site of formatMoney' }
  })
  assert.ok(RISK_CLASSES.indexOf(sweep.riskClass) >= RISK_CLASSES.indexOf('medium'))
  assert.ok(signalNames(sweep).includes('shared-value-transform'))

  assert.ok(
    RISK_CLASSES.indexOf(classOf({ changedPaths: ['src/shared/currency.ts'] })) >=
      RISK_CLASSES.indexOf('medium')
  )
})

test('a single-module feature with no matching rule sits in the low-medium band, floored at medium', () => {
  const r = paths('src/widget/render.ts')
  assert.equal(r.riskClass, 'medium')
  assert.ok(signalNames(r).includes('unmatched-source-change'))
  assert.ok(r.continuityAllowed)
})

// --- fail closed ----------------------------------------------------------

test('empty input does not return low', () => {
  for (const input of [undefined, null, {}, { changedPaths: [] }, { changedPaths: [], artifacts: {} }]) {
    const r = classifyRisk(input)
    assert.notEqual(r.riskClass, 'low')
    assert.equal(r.riskClass, UNCLASSIFIABLE_CLASS)
    assert.equal(r.continuityAllowed, false)
    assert.deepEqual(signalNames(r), ['no-input'])
  }
})

test('junk-only paths are treated as no input, not as low', () => {
  const r = classifyRisk({ changedPaths: [null, 42, '   ', { path: 'x' }] })
  assert.equal(r.riskClass, UNCLASSIFIABLE_CLASS)
  assert.equal(r.basis, 'no-input')
})

test('artifact text with no changed paths stays above low (unbounded blast radius)', () => {
  const r = classifyRisk({ artifacts: { 'proposal.md': 'Rename a local variable.' } })
  assert.notEqual(r.riskClass, 'low')
  assert.ok(signalNames(r).includes('no-changed-paths'))
})

test('unreadable artifacts are dropped, not trusted as clean', () => {
  const r = classifyRisk({ changedPaths: [], artifacts: { 'design.md': '', 'tasks.md': null } })
  assert.equal(r.riskClass, UNCLASSIFIABLE_CLASS)
  assert.deepEqual(r.artifactNames, [])
})

test('every class above low carries at least one signal', () => {
  const cases = [
    {},
    { changedPaths: ['src/widget/render.ts'] },
    { changedPaths: ['src/auth/login.ts'] },
    { changedPaths: ['src/billing/charge.ts'] },
    { artifacts: { 'design.md': 'multi-tenant boundary change' } }
  ]
  for (const input of cases) {
    const r = classifyRisk(input)
    if (r.riskClass !== 'low') {
      assert.ok(r.signals.length > 0, `${JSON.stringify(input)} produced ${r.riskClass} with no signals`)
      for (const s of r.signals) {
        assert.ok(s.signal && s.class && s.evidence, `signal missing fields: ${JSON.stringify(s)}`)
      }
    }
  }
})

// --- maximum, never average ----------------------------------------------

test('the class is the max over signals, not the average', () => {
  // 4 docs paths + 1 payment path. An average would drown the payment signal.
  const r = classifyRisk({
    changedPaths: [
      'docs/a.md',
      'docs/b.md',
      'docs/c.md',
      'test/x.test.ts',
      'src/billing/charge.ts'
    ]
  })
  assert.equal(r.riskClass, 'critical')
  assert.ok(signalNames(r).includes('payment'))
})

test('a lower signal never pulls a higher one down', () => {
  const r = classifyRisk({
    changedPaths: ['src/shared/format.ts', 'src/auth/session.ts'],
    artifacts: { 'design.md': 'Shared helper sweep plus a session rewrite.' }
  })
  assert.equal(r.riskClass, 'high')
  const classes = r.signals.map(s => s.class)
  assert.ok(classes.includes('medium') && classes.includes('high'))
  // Severity-first ordering, so the driving signal reads first.
  assert.equal(r.signals[0].class, 'high')
})

test('a severity path beats docs-only, even when the file is a doc or a test', () => {
  // Intentional over-classification: max wins over the "docs are low" row of
  // the F3 table. A docs page or an e2e file about payments still costs one
  // human read — the alternative fails open.
  assert.equal(classOf({ changedPaths: ['docs/checkout.md'] }), 'critical')
  assert.equal(classOf({ changedPaths: ['e2e/auth/login.spec.ts'] }), 'high')
})

test('maxClass is monotonic and fails closed on unknown values', () => {
  assert.equal(maxClass('low', 'medium'), 'medium')
  assert.equal(maxClass('critical', 'low'), 'critical')
  assert.equal(maxClass('high', 'high'), 'high')
  assert.equal(maxClass('low', 'nonsense'), 'critical')
})

// --- continuity policy (§4.14 balanced) -----------------------------------

test('continuityAllowed matches the balanced policy', () => {
  assert.deepEqual([...CONTINUITY_ALLOWED_CLASSES], ['low', 'medium'])
  assert.equal(classifyRisk({ changedPaths: ['docs/a.md'] }).continuityAllowed, true)
  assert.equal(classifyRisk({ changedPaths: ['src/widget/render.ts'] }).continuityAllowed, true)
  assert.equal(classifyRisk({ changedPaths: ['src/auth/login.ts'] }).continuityAllowed, false)
  assert.equal(classifyRisk({ changedPaths: ['src/billing/charge.ts'] }).continuityAllowed, false)
})

test('the policy can be re-tuned in one place without touching classification', () => {
  const input = { changedPaths: ['src/widget/render.ts'] }
  const strict = classifyRisk(input, { allowedClasses: ['low'] })
  assert.equal(strict.riskClass, 'medium')
  assert.equal(strict.continuityAllowed, false)
  assert.ok(strict.reasons.some(r => r.includes('continuity refused')))
})

// --- hygiene --------------------------------------------------------------

test('the input is never mutated', () => {
  const changedPaths = ['./src/Auth/Login.ts', 'docs/a.md']
  const artifacts = { 'proposal.md': 'Add a migration.' }
  const before = JSON.stringify({ changedPaths, artifacts })
  classifyRisk({ changedPaths, artifacts })
  assert.equal(JSON.stringify({ changedPaths, artifacts }), before)
})

test('paths are normalized for matching but reported verbatim', () => {
  const r = classifyRisk({ changedPaths: ['./src\\Auth\\login.ts'] })
  assert.equal(r.riskClass, 'high')
  assert.ok(r.signals.some(s => s.evidence.includes('src/Auth/login.ts')))
})

test('formatRisk renders class, signals and reasons', () => {
  const out = formatRisk(classifyRisk({ changedPaths: ['src/billing/charge.ts'] }))
  assert.match(out, /RISK CRITICAL/)
  assert.match(out, /continuity NOT allowed/)
  assert.match(out, /\[critical\] payment:/)
  assert.match(out, /reason:/)
  assert.ok(out.endsWith('\n'))
})

// --- the one canonical path transform (spec: ship/wave-isolation) ----------
//
// Exported from here because this module already owns path interpretation for
// the repo (DOC_PATH, isDocsPath, the risk path regexes). Every consumer that
// compares two paths reads this and nothing else — scattering the transform
// across call sites is precisely how `lib/waves.mjs` ended up keying its
// collision map on raw text while its sibling read a normalized form.

test('canonicalizePath collapses every spelling of one file to one key', () => {
  const cases = [
    ['src/a.ts', 'src/a.ts'],
    ['  src/a.ts  ', 'src/a.ts'],
    ['./src/a.ts', 'src/a.ts'],
    ['././src/a.ts', 'src/a.ts'],
    ['src/foo/../a.ts', 'src/a.ts'],
    ['src//a.ts', 'src/a.ts'],
    ['src///a.ts', 'src/a.ts'],
    ['src\\a.ts', 'src/a.ts'],
    ['src/./a.ts', 'src/a.ts'],
    ['./src\\foo/..//a.ts', 'src/a.ts'],
    ['src/a.ts/', 'src/a.ts'],
    ['lib/', 'lib']
  ]
  for (const [input, expected] of cases) {
    assert.equal(canonicalizePath(input), expected, `canonicalizePath(${JSON.stringify(input)})`)
  }
})

test('canonicalizePath keeps genuinely different files apart', () => {
  const distinct = ['src/a.ts', 'src/b.ts', 'src/sub/a.ts', 'srcx/a.ts', 'lib/a.mts']
  const seen = new Set(distinct.map(canonicalizePath))
  assert.equal(seen.size, distinct.length, 'canonicalization must not merge distinct files')
})

test('canonicalizePath rejects rather than rewrites what it cannot place in the repo', () => {
  for (const input of [
    '/etc/passwd',
    '/',
    'C:/Windows/system32',
    'c:\\Windows',
    '../outside/a.ts',
    '..',
    'src/../../outside.ts',
    '.',
    './',
    '',
    '   ',
    null,
    undefined,
    42,
    ['src/a.ts']
  ]) {
    assert.equal(
      canonicalizePath(input),
      null,
      `${JSON.stringify(input)} must be rejected, never silently rewritten into scope`
    )
  }
})

test('the transform is idempotent — canonicalizing a canonical path changes nothing', () => {
  for (const input of ['src/a.ts', './src//foo/../a.ts', 'docs/06-why-it-works.md']) {
    const once = canonicalizePath(input)
    assert.equal(canonicalizePath(once), once)
  }
})

test('classifyRisk still classifies a path canonicalization would reject', () => {
  // Keying and classification want opposite things from an unusable path.
  // Dropping an absolute payments path here would *lower* the blast radius of a
  // change that touches payments, which is the one fail-open this module
  // cannot afford.
  assert.equal(canonicalizePath('/srv/payments/charge.ts'), null)
  assert.equal(classOf({ changedPaths: ['/srv/payments/charge.ts'] }), 'critical')
})

test('classifyRisk is unchanged by the stronger transform', () => {
  assert.equal(classOf({ changedPaths: ['./docs/06-why-it-works.md'] }), 'low')
  assert.equal(classOf({ changedPaths: ['docs/06-why-it-works.md'] }), 'low')
  assert.equal(classOf({ changedPaths: ['lib\\auth\\session.ts'] }), 'high')
  assert.equal(classOf({ changedPaths: ['lib/foo/../auth/session.ts'] }), 'high')
})
