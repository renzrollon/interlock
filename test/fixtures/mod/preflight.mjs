// The session start's report file and a halt resume card, as the hooks module
// reads them under the kit (test/mod/session-start.test.ts).
//
// An importable module rather than JSON files, because the kit has no
// filesystem: the test's own `fs.read` stub answers these texts by path. The
// shapes are the ones `buildPreflightReport` writes (lib/preflight-file.mjs,
// design D1) and `formatResumeCard` writes, spelled out here so a change to
// either writer is a change a test has to agree with.

import { LIMITS } from '../../../lib/limits.mjs'

export const PREFLIGHT_PATH = '/repo/.claude/ship/preflight.json'
export const WRITTEN_AT = '2026-10-07T08:00:00.000Z'

export const BANNER =
  'PREVIOUS RUN INTERRUPTED: add-foo run r-1 ended at stage verify — no resume card was written; interlock run-log show r-1'

const FAIL_MESSAGE = [
  'interlock preflight found issues that can stall an unattended ship run:',
  '  [FAIL] permissions: Bash(interlock:*) is not allowlisted',
  '     fix: add "Bash(interlock:*)" to permissions.allow',
  '          in .claude/settings.json',
  'The session still starts — apply the fixes above before /interlock:ship.'
].join('\n')

const base = over => ({
  schema: 'interlock.preflight/1',
  writtenAt: WRITTEN_AT,
  source: 'startup',
  root: '/repo',
  stateHome: '/repo',
  surface: 'main',
  message: 'interlock preflight OK.',
  doctor: {
    ran: true,
    parsed: true,
    ok: true,
    counts: { ok: 2, warn: 0, fail: 0, skip: 1 },
    checks: [
      { id: 'node', status: 'ok', detail: 'node 22.11.0', fix: null },
      { id: 'graph', status: 'skip', detail: 'no graph built', fix: null }
    ]
  },
  notes: { spoken: [], unreadable: [] },
  cards: { listed: [], archived: 0, unreadable: [], lookedIn: ['/repo/.claude/handoff'] },
  // The lists the prompt's suggestions read (lib/preflight-file.mjs `listedNames`):
  // `{ names, omitted }`, newest first, or `null` for a directory that could not be listed.
  openChanges: { names: ['add-foo', 'add-bar', 'fix-baz'], omitted: 0 },
  recentRuns: { names: ['r-3', 'r-2', 'r-1'], omitted: 0 },
  ...over
})

export const PERMISSIONS_DETAIL = 'Bash(interlock:*) is not allowlisted'
export const OPENSPEC_DETAIL = 'openspec 0.9.0 is older than the tested 1.0.0'

export const REPORT_FAIL_WARN_NOTE = base({
  message: FAIL_MESSAGE,
  doctor: {
    ran: true,
    parsed: true,
    ok: false,
    counts: { ok: 1, warn: 1, fail: 1, skip: 0 },
    checks: [
      { id: 'node', status: 'ok', detail: 'node 22.11.0', fix: null },
      {
        id: 'permissions',
        status: 'fail',
        detail: PERMISSIONS_DETAIL,
        fix: 'add "Bash(interlock:*)" to permissions.allow\nin .claude/settings.json'
      },
      { id: 'openspec', status: 'warn', detail: OPENSPEC_DETAIL, fix: 'npm i -g @fission-ai/openspec' }
    ]
  },
  notes: {
    spoken: [
      {
        runId: 'r-1',
        change: 'add-foo',
        stage: 'verify',
        banner: BANNER,
        marked: true,
        marks: [{ root: '/repo', marked: true, reason: null }]
      }
    ],
    unreadable: []
  }
})

export const REPORT_ALL_OK = base({})

/** A report whose two lists could not be listed (`null`, never empty): the suggestions stay off. */
export const REPORT_NULL_LISTS = base({ openChanges: null, recentRuns: null })

/** A report written before the two fields existed: they read as `null` under the same stamp. */
export const REPORT_WITHOUT_LISTS = (() => {
  const { openChanges, recentRuns, ...older } = base({})
  return older
})()

export const REPORT_WARN_ONLY = base({
  writtenAt: '2026-10-07T09:00:00.000Z',
  message: 'interlock preflight OK (1 warning).',
  doctor: {
    ran: true,
    parsed: true,
    ok: true,
    counts: { ok: 1, warn: 1, fail: 0, skip: 0 },
    checks: [
      { id: 'node', status: 'ok', detail: 'node 22.11.0', fix: null },
      { id: 'openspec', status: 'warn', detail: OPENSPEC_DETAIL, fix: null }
    ]
  }
})

export const CARD_PATH = '/repo/.claude/handoff/ship-add-foo-r-1.md'
export const SECOND_CARD_PATH = '/repo/.claude/handoff/ship-add-bar-r-2.md'
export const CARD_WRITTEN_AT = '2026-10-06T21:14:03.000Z'

export const REPORT_WITH_CARD = base({
  cards: {
    listed: [
      { path: SECOND_CARD_PATH, change: 'add-bar', runId: 'r-2', writtenAt: '2026-10-05T10:00:00.000Z' },
      { path: CARD_PATH, change: 'add-foo', runId: 'r-1', writtenAt: CARD_WRITTEN_AT }
    ],
    archived: 1,
    unreadable: [],
    lookedIn: ['/repo/.claude/handoff']
  }
})

export const RECORD_SENTENCE = 'This file is a record, not a trigger'

export const CARD_TEXT = [
  '<!-- interlock.resume-card/1 change=add-foo run=r-1 -->',
  '# Ship halted — add-foo',
  '',
  'inter-wave verification failed twice',
  '',
  `${RECORD_SENTENCE}. Nothing reads it back: the next ship decides what to skip from the stored plan ` +
    'fingerprint, never from this card. **Do not start another ship run unless the user asks.**',
  '',
  '## Where this run stopped',
  '',
  '- change: `add-foo`',
  '- run: `r-1`',
  ''
].join('\n')

export const LONG_CARD = CARD_TEXT + '\n' + '- a leftover row that goes on\n'.repeat(Math.ceil(LIMITS.handoffPaneChars / 25))

export const stdout = report => JSON.stringify(report, null, 2) + '\n'

// --- the halt card's controls (make-the-run-surfaces-interactive design D22) ---
//
// Cards that print the commands a person runs next, the way `formatResumeCard`
// prints them: fenced lines and code spans. The pane offers a control for each
// line `offeredActions` (lib/run-actions.mjs) finds, in print order, one time each.

/** A card whose fenced block prints the receipt's two lines, printed again later, and whose last step prints the ship line. */
export const ACTIONS_CARD_TEXT = [
  '<!-- interlock.resume-card/1 change=add-foo run=r-1 -->',
  '# Ship halted — add-foo',
  '',
  'unit failures after 2 fix attempts',
  '',
  `${RECORD_SENTENCE}. Nothing reads it back. **Do not start another ship run unless the user asks.**`,
  '',
  '## Where this run stopped',
  '',
  '```',
  'interlock run-log show r-1',
  'interlock run-log query --run r-1 --halted',
  '```',
  '',
  '## Next',
  '',
  '1. Read the receipt again: `interlock run-log show r-1`.',
  '2. In a new session, when a person asks for it: `/interlock:ship add-foo`.',
  ''
].join('\n')

/** The controls `ACTIONS_CARD_TEXT` carries, in print order. */
export const ACTIONS_CARD_LABELS = [
  'Draft: interlock run-log show r-1',
  'Draft: interlock run-log query --run r-1 --halted',
  'Draft: /interlock:ship add-foo'
]

/** A card that prints a placeholder line in a fenced block and a lane's resume line in a code span. */
export const PLACEHOLDER_CARD_TEXT = [
  '<!-- interlock.resume-card/1 change=add-bar run=r-2 -->',
  '# Ship halted — add-bar',
  '',
  '```',
  'interlock tasks tick add-bar --ids <the ids above you verified are done>',
  '```',
  '',
  '- `1.2` (failed): `claude --resume s-9 --fork-session`',
  ''
].join('\n')

export const RESUME_LINE = 'claude --resume s-9 --fork-session'

/** A card over the pane's cap whose one command line is printed after the cut. */
export const LONG_ACTIONS_CARD =
  CARD_TEXT + '\n' + '- a leftover row that goes on\n'.repeat(Math.ceil(LIMITS.handoffPaneChars / 25)) + '\n```\ninterlock run-log show r-1\n```\n'

/** A report holding twenty open changes that begin `add-`, newest first, and no other. */
export const REPORT_MANY_CHANGES = base({
  openChanges: { names: Array.from({ length: 20 }, (_, n) => `add-${String(n + 1).padStart(2, '0')}`), omitted: 0 }
})
