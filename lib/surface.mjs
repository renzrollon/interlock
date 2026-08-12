// Deterministic UI-surface classifier for a set of changed files.
//
// This question used to be answered twice, in English prose, by two skills that
// disagreed: the manual-test-plan skill asked the model to re-derive a tri-state
// UI-TESTABLE / UI-INDIRECT / NOT-UI-TESTABLE split on every run, while the
// devops review dimension made a looser, separate binary judgement about whether
// a change is "purely UI/frontend" and can be skipped. Same inputs, two
// hand-rolled answers, no reason for them to agree. This module replaces both
// prose implementations with one pure function so the tri-state and the devops
// skip decision are derived from the same rules, reproducibly, with no model
// call.
//
// Exposed to skills as `specflow surface --changed <files...>`.
//
// Path + extension logic only: no fs, no git, no agent, no I/O, no clock.
// Paths are repo-relative and POSIX-separated ('/').

export const UI_TESTABLE = 'UI-TESTABLE'
export const UI_INDIRECT = 'UI-INDIRECT'
export const NOT_UI_TESTABLE = 'NOT-UI-TESTABLE'

// --- rule tables ---------------------------------------------------------

const TEST_DIRS = new Set(['__tests__', 'e2e', 'tests', 'cypress', 'playwright'])
const DOC_EXTS = new Set(['md', 'mdx', 'txt'])
const DOC_DIRS = new Set(['docs', 'openspec'])
const CONFIG_EXTS = new Set(['json', 'yml', 'yaml', 'toml', 'ini', 'lock'])
const TOOLING_DIRS = new Set(['scripts', 'tools'])

const UI_EXTS = new Set(['tsx', 'jsx', 'vue', 'svelte'])
const UI_DIRS = new Set(['app', 'pages', 'components', 'views', 'screens'])
const STYLE_EXTS = new Set(['css', 'scss', 'sass', 'less', 'styl'])

const STATE_DIRS = new Set(['hooks', 'store', 'stores', 'context', 'providers', 'reducers', 'selectors'])
const DATA_DIRS = new Set(['lib', 'services', 'models', 'schemas', 'db', 'prisma', 'graphql', 'resolvers', 'controllers', 'middleware'])

// Dependency manifests that make a change infra-relevant regardless of class.
const DEP_MANIFESTS = new Set(['package.json', 'requirements.txt', 'go.mod', 'cargo.toml'])

// --- helpers -------------------------------------------------------------

// Tolerate junk entries: non-strings become '', surrounding space is trimmed,
// and any number of leading './' segments are stripped.
function normalize(entry) {
  if (typeof entry !== 'string') return ''
  let p = entry.trim()
  while (p.startsWith('./')) p = p.slice(2)
  return p
}

// Split a normalized path once into the pieces every rule needs. Directory
// segments and the basename are compared lowercased so that Components/ and
// components/, Dockerfile and dockerfile, behave the same.
function parts(path) {
  const segments = path.split('/').filter(Boolean)
  const base = segments.length ? segments[segments.length - 1] : ''
  const dirs = segments.slice(0, -1).map(s => s.toLowerCase())
  const lower = base.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot > 0 ? lower.slice(dot + 1) : ''
  return { dirs, lower, ext }
}

const notUI = (reason) => ({ class: NOT_UI_TESTABLE, reason, apiRoute: false })
const uiTestable = (reason) => ({ class: UI_TESTABLE, reason, apiRoute: false })
const uiIndirect = (reason, apiRoute = false) => ({ class: UI_INDIRECT, reason, apiRoute })

// Classify one path. Order is load-bearing: exclusions, then route/API
// handlers, then UI-TESTABLE, then UI-INDIRECT, then default.
function classifyOne(p) {
  const { dirs, lower, ext } = p
  const inDir = (set) => dirs.find(d => set.has(d))

  // 1. NOT-UI-TESTABLE exclusions run first so that tests/, docs/ and tooling
  //    beat the UI rules — tests/components/Foo.tsx is a test, not a component.
  if (/\.(test|spec)\./.test(lower)) return notUI('test file')
  const testDir = inDir(TEST_DIRS)
  if (testDir) return notUI(`test dir ${testDir}/`)
  if (DOC_EXTS.has(ext)) return notUI('docs file')
  const docDir = inDir(DOC_DIRS)
  if (docDir) return notUI(`docs dir ${docDir}/`)
  if (lower === 'license' || lower.startsWith('changelog')) return notUI('docs file')

  // tailwind.config.* is the one config file with a user-visible effect, so it
  // is carved out ahead of every config/tooling exclusion below.
  const isTailwind = lower.startsWith('tailwind.config.')
  if (!isTailwind) {
    if (lower.startsWith('.') || dirs.some(d => d.startsWith('.'))) return notUI('dotfile or dot dir')
    if (CONFIG_EXTS.has(ext)) return notUI('config file')
    const toolDir = inDir(TOOLING_DIRS)
    if (toolDir) return notUI(`tooling dir ${toolDir}/`)
    if (lower.startsWith('dockerfile')) return notUI('container config')
    if (lower === 'makefile') return notUI('build tooling')
    if (/\.config\.[^.]+$/.test(lower)) return notUI('config file')
  }

  if (lower === 'types.ts' || lower.endsWith('.d.ts')) return notUI('type-only file')
  if (dirs.includes('types')) return notUI('type-only dir types/')

  // 2. Request handlers, checked ahead of the UI rules: a file under app/ or
  //    pages/ that serves a request is reachable only via UI side-effects.
  //    Server actions belong here too — manual-test-plan names them explicitly
  //    as UI-INDIRECT, and review-code counts them toward the devops review
  //    alongside API routes ("no new API routes or Server Actions").
  if (dirs.includes('api')) return uiIndirect('API route path', true)
  if (lower === 'route.ts' || lower === 'route.js') return uiIndirect('route handler', true)
  if (lower.startsWith('+server.')) return uiIndirect('server endpoint', true)
  if (dirs.includes('actions') || dirs.includes('server-actions')) return uiIndirect('server actions', true)
  if (lower === 'actions.ts' || lower === 'actions.js') return uiIndirect('server actions', true)
  if (lower.endsWith('.server.ts')) return uiIndirect('server module', true)

  // 3. UI-TESTABLE — directly user-visible surface.
  if (UI_EXTS.has(ext)) return uiTestable(`.${ext} component`)
  const uiDir = inDir(UI_DIRS)
  if (uiDir) return uiTestable(`under ${uiDir}/`)
  if (STYLE_EXTS.has(ext)) return uiTestable('style file')
  if (isTailwind) return uiTestable('tailwind config')

  // 4. UI-INDIRECT — reachable only through UI side-effects. Server actions and
  //    server modules are handled in rule 2 so they escape the UI directories;
  //    what remains here is state and data-layer code outside app/ and pages/.
  const stateDir = inDir(STATE_DIRS)
  if (stateDir) return uiIndirect(`under ${stateDir}/`)
  const dataDir = inDir(DATA_DIRS)
  if (dataDir) return uiIndirect(`under ${dataDir}/`)

  // 5. Nothing matched — assume no user-visible effect.
  return notUI('no UI surface match')
}

// review-devops' "purely UI/frontend, skip" rule, inverted: does this one file
// suggest infra impact? Independent of the tri-state class except that any
// API-route file counts.
function suggestsInfraImpact(p, record) {
  const { dirs, lower, ext } = p
  if (record.apiRoute) return true
  if (DEP_MANIFESTS.has(lower)) return true
  if (ext === 'lock') return true
  if (lower.startsWith('.env')) return true
  if (lower === '.gitlab-ci.yml') return true
  if (lower.startsWith('dockerfile') || lower.startsWith('docker-compose')) return true
  const gh = dirs.indexOf('.github')
  if (gh !== -1 && dirs[gh + 1] === 'workflows') return true
  return false
}

// --- public API ----------------------------------------------------------

// Classify an array of repo-relative path strings into the manual-test-plan
// tri-state, plus the rollups both callers need.
//
// Returns {
//   files: [{ path, class, reason }],   // normalized path, one entry per usable input
//   hasUI,                              // any UI_TESTABLE or UI_INDIRECT
//   uiCount, indirectCount, backendCount,
//   needsManualTestPlan,                // === hasUI
//   needsDevopsReview                   // inverse of review-devops' skip rule
// }
export function classifySurface(changedFiles) {
  const list = Array.isArray(changedFiles) ? changedFiles : []
  const files = []
  let uiCount = 0
  let indirectCount = 0
  let backendCount = 0
  let needsDevopsReview = false

  for (const entry of list) {
    const path = normalize(entry)
    if (!path) continue
    const p = parts(path)
    const record = classifyOne(p)
    files.push({ path, class: record.class, reason: record.reason })
    if (record.class === UI_TESTABLE) uiCount += 1
    else if (record.class === UI_INDIRECT) indirectCount += 1
    else backendCount += 1
    if (!needsDevopsReview && suggestsInfraImpact(p, record)) needsDevopsReview = true
  }

  const hasUI = uiCount > 0 || indirectCount > 0
  return {
    files,
    hasUI,
    uiCount,
    indirectCount,
    backendCount,
    needsManualTestPlan: hasUI,
    needsDevopsReview
  }
}
