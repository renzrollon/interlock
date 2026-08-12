import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySurface, UI_TESTABLE, UI_INDIRECT, NOT_UI_TESTABLE } from '../../lib/surface.mjs'

// classifySurface is pure, so every case is just "path in, class out". These
// helpers classify a single path and pull the one file record back out.
const one = (path) => classifySurface([path]).files[0]
const classOf = (path) => one(path).class

// Assert a whole batch of paths lands in the same class, naming the offender.
function allAre(paths, expected) {
  for (const path of paths) {
    assert.equal(classOf(path), expected, `${path} should be ${expected}, got ${classOf(path)} (${one(path).reason})`)
  }
}

test('UI-TESTABLE: component extensions, UI directories, styles', () => {
  allAre([
    'src/components/Button.tsx',
    'Widget.jsx',
    'src/ui/Card.vue',
    'src/ui/Card.svelte',
    'app/dashboard/page.tsx',
    'pages/about.ts',
    'src/pages/Home.ts',
    'src/components/legacy/helper.ts',
    'views/Profile.ts',
    'src/screens/Login.ts',
    'styles/main.css',
    'src/theme/vars.scss',
    'a.sass',
    'a.less',
    'a.styl'
  ], UI_TESTABLE)
})

test('UI-INDIRECT: routes, server modules, state and data layers', () => {
  allAre([
    'app/api/users/route.ts',
    'pages/api/health.ts',
    'src/routes/blog/+server.ts',
    'src/actions/createUser.ts',
    'src/server-actions/submit.ts',
    'src/user.server.ts',
    'src/hooks/useUser.ts',
    'src/store/cart.ts',
    'src/stores/cart.ts',
    'src/context/auth.ts',
    'src/providers/query.ts',
    'src/reducers/cart.ts',
    'src/selectors/cart.ts',
    'src/lib/format.ts',
    'src/services/billing.ts',
    'src/models/user.ts',
    'src/schemas/user.ts',
    'src/db/client.ts',
    'prisma/seed.ts',
    'src/graphql/schema.ts',
    'src/resolvers/user.ts',
    'src/controllers/user.ts',
    'src/middleware/auth.ts'
  ], UI_INDIRECT)
})

test('NOT-UI-TESTABLE: tests, docs, config/tooling, type-only', () => {
  allAre([
    'src/lib/format.test.ts',
    'src/lib/format.spec.ts',
    '__tests__/format.ts',
    'e2e/login.ts',
    'tests/helpers.ts',
    'cypress/support/e2e.ts',
    'playwright/fixtures.ts',
    'README.md',
    'notes.mdx',
    'notes.txt',
    'docs/methodology.ts',
    'openspec/changes/x/design.ts',
    'LICENSE',
    'CHANGELOG.md',
    'package.json',
    'config.yml',
    'config.yaml',
    'Cargo.toml',
    'setup.ini',
    'yarn.lock',
    '.eslintrc',
    '.github/workflows/ci.yml',
    'scripts/build.ts',
    'tools/codegen.ts',
    'Dockerfile',
    'Dockerfile.prod',
    'Makefile',
    'next.config.js',
    'vitest.config.ts',
    '.claude/settings.json',
    '.copilot/config.json',
    'types.ts',
    'src/api-client.d.ts',
    'src/types/user.ts',
    'go.mod'
  ], NOT_UI_TESTABLE)
})

test('exclusions beat UI directories', () => {
  assert.equal(classOf('tests/components/Foo.tsx'), NOT_UI_TESTABLE)
  assert.equal(classOf('e2e/pages/checkout.tsx'), NOT_UI_TESTABLE)
  assert.equal(classOf('src/components/Button.test.tsx'), NOT_UI_TESTABLE)
  assert.equal(classOf('docs/components/usage.tsx'), NOT_UI_TESTABLE)
  assert.equal(classOf('app/README.md'), NOT_UI_TESTABLE)
})

test('tailwind.config.* beats the generic *.config.* exclusion', () => {
  assert.equal(classOf('tailwind.config.js'), UI_TESTABLE)
  assert.equal(classOf('tailwind.config.ts'), UI_TESTABLE)
  assert.equal(one('tailwind.config.js').reason, 'tailwind config')
  // ...but only tailwind: every other *.config.* is still excluded.
  assert.equal(classOf('next.config.js'), NOT_UI_TESTABLE)
  assert.equal(classOf('jest.config.ts'), NOT_UI_TESTABLE)
  // and a tailwind config living under tests/ is still a test fixture.
  assert.equal(classOf('tests/tailwind.config.js'), NOT_UI_TESTABLE)
})

test('route/API handlers under UI dirs are UI-INDIRECT, not UI-TESTABLE', () => {
  assert.equal(classOf('app/api/users/route.ts'), UI_INDIRECT)
  assert.equal(classOf('pages/api/webhook.js'), UI_INDIRECT)
  assert.equal(classOf('app/blog/[slug]/route.ts'), UI_INDIRECT)
  assert.equal(classOf('app/blog/route.js'), UI_INDIRECT)
  assert.equal(classOf('src/routes/login/+server.js'), UI_INDIRECT)
  // The neighbouring page in the same directory stays UI-TESTABLE.
  assert.equal(classOf('app/blog/[slug]/page.tsx'), UI_TESTABLE)
})

test('server actions under UI dirs are UI-INDIRECT and count for devops', () => {
  // manual-test-plan names server actions explicitly as UI-INDIRECT, and
  // review-code counts them toward the devops review alongside API routes.
  // They must therefore escape the app/ and pages/ UI-TESTABLE rules.
  assert.equal(classOf('app/dashboard/actions.ts'), UI_INDIRECT)
  assert.equal(classOf('app/(marketing)/signup/actions.js'), UI_INDIRECT)
  assert.equal(classOf('app/actions/createUser.ts'), UI_INDIRECT)
  assert.equal(classOf('src/server-actions/deletePost.ts'), UI_INDIRECT)
  assert.equal(classOf('app/lib/session.server.ts'), UI_INDIRECT)
  // The neighbouring page is untouched by the carve-out.
  assert.equal(classOf('app/dashboard/page.tsx'), UI_TESTABLE)
  // A server action alone is enough to require the devops reviewer.
  assert.equal(classifySurface(['app/dashboard/actions.ts']).needsDevopsReview, true)
})

test('every file gets a terse, non-empty reason naming the matched rule', () => {
  assert.equal(one('src/components/Button.tsx').reason, '.tsx component')
  assert.equal(one('app/dashboard/settings.ts').reason, 'under app/')
  assert.equal(one('app/api/users/route.ts').reason, 'API route path')
  assert.equal(one('src/lib/format.test.ts').reason, 'test file')
  assert.equal(one('src/lib/format.ts').reason, 'under lib/')
  assert.equal(one('go.mod').reason, 'no UI surface match')
  for (const f of classifySurface(['a.tsx', 'README.md', 'src/lib/x.ts']).files) {
    assert.equal(typeof f.reason, 'string')
    assert.ok(f.reason.length > 0 && f.reason.length <= 40, `reason too long: ${f.reason}`)
  }
})

test('rollup counters and hasUI/needsManualTestPlan on a mixed change', () => {
  const result = classifySurface([
    'src/components/Button.tsx',      // UI
    'app/dashboard/page.tsx',         // UI
    'app/globals.css',                // UI
    'app/api/users/route.ts',         // INDIRECT
    'src/lib/format.ts',              // INDIRECT
    'src/hooks/useUser.ts',           // INDIRECT
    'README.md',                      // NOT
    'src/components/Button.test.tsx', // NOT
    'package.json'                    // NOT
  ])

  assert.equal(result.files.length, 9)
  assert.equal(result.uiCount, 3)
  assert.equal(result.indirectCount, 3)
  assert.equal(result.backendCount, 3)
  assert.equal(result.hasUI, true)
  assert.equal(result.needsManualTestPlan, true)
})

test('hasUI is false for a backend/docs-only change', () => {
  const result = classifySurface(['README.md', 'docs/methodology.md', 'go.mod'])
  assert.equal(result.uiCount, 0)
  assert.equal(result.indirectCount, 0)
  assert.equal(result.backendCount, 3)
  assert.equal(result.hasUI, false)
  assert.equal(result.needsManualTestPlan, false)
})

test('UI-INDIRECT alone still requires a manual test plan', () => {
  const result = classifySurface(['app/api/users/route.ts'])
  assert.equal(result.uiCount, 0)
  assert.equal(result.indirectCount, 1)
  assert.equal(result.hasUI, true)
  assert.equal(result.needsManualTestPlan, true)
})

test('needsDevopsReview is true when any file suggests infra impact', () => {
  const infraTriggers = [
    'package.json',
    'requirements.txt',
    'go.mod',
    'Cargo.toml',
    'yarn.lock',
    'Cargo.lock',
    '.env',
    '.env.production',
    '.github/workflows/ci.yml',
    '.gitlab-ci.yml',
    'Dockerfile',
    'docker-compose.yml',
    'app/api/users/route.ts',
    'src/routes/login/+server.ts'
  ]
  for (const path of infraTriggers) {
    assert.equal(
      classifySurface(['src/components/Button.tsx', path]).needsDevopsReview,
      true,
      `${path} should trigger a devops review`
    )
  }
})

test('needsDevopsReview is false for a purely UI/frontend change', () => {
  const result = classifySurface([
    'src/components/Button.tsx',
    'app/dashboard/page.tsx',
    'styles/main.css',
    'tailwind.config.js',
    'README.md',
    'src/components/Button.test.tsx'
  ])
  assert.equal(result.needsDevopsReview, false)
  assert.equal(result.hasUI, true)
})

test('needsDevopsReview is false for UI-INDIRECT files that are not API routes', () => {
  const result = classifySurface(['src/lib/format.ts', 'src/hooks/useUser.ts', 'src/db/client.ts'])
  assert.equal(result.indirectCount, 3)
  assert.equal(result.needsDevopsReview, false)
})

test('degenerate input: empty, non-array, and unusable entries', () => {
  for (const input of [[], null, undefined, 'nope', 42, {}]) {
    const result = classifySurface(input)
    assert.deepEqual(result.files, [])
    assert.equal(result.uiCount, 0)
    assert.equal(result.indirectCount, 0)
    assert.equal(result.backendCount, 0)
    assert.equal(result.hasUI, false)
    assert.equal(result.needsManualTestPlan, false)
    assert.equal(result.needsDevopsReview, false)
  }

  const skipped = classifySurface([null, undefined, '', '   ', 0, false, {}])
  assert.deepEqual(skipped.files, [])
})

test('degenerate input: unusable entries are dropped, real ones survive', () => {
  const result = classifySurface([null, 'src/components/Button.tsx', '', 'README.md', undefined])
  assert.equal(result.files.length, 2)
  assert.equal(result.uiCount, 1)
  assert.equal(result.backendCount, 1)
})

test('leading ./ and surrounding space are normalized away', () => {
  assert.equal(classOf('./src/components/Button.tsx'), UI_TESTABLE)
  assert.equal(classOf('././app/api/users/route.ts'), UI_INDIRECT)
  assert.equal(one('./src/components/Button.tsx').path, 'src/components/Button.tsx')
  assert.equal(one('  ./README.md  ').path, 'README.md')
  assert.equal(one('././app/page.tsx').path, 'app/page.tsx')
})
