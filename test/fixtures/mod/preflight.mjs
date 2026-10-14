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
