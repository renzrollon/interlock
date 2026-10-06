// Step records as the ship meter reads them off the ping's Bash result.
//
// An importable module rather than JSON because `claude plugin test` runs the
// mod's tests with no filesystem. The field set follows `relayStep` in
// lib/run.mjs (what the Workflow host's stdout carries) plus the wave-state
// positions a non-relayed step carries, so both shapes are exercised; the
// close record follows `runClose`'s return. The captured Workflow-host records
// from the task 1.2 probe are the JSON files beside this one.

const sha = c => c.repeat(64)

export const CHANGE = 'add-the-thing'
export const RUN_ID = 'wf_6b71ef8e-ba7'
export const BANNER = 'GRAPH UNAVAILABLE: never built — implementer and reviewer agents fall back to grep and will be slower'
export const SECOND_BANNER = 'CACHE ACCOUNTING PARTIAL: 1 of 2 agents reported no cache figures'
export const SHA_A = sha('a')
export const SHA_B = sha('b')

export const RUN_BATCH = {
  schema: 'interlock.run-step/1',
  action: 'run-batch',
  change: CHANGE,
  wave: 2,
  waveIndex: 1,
  batchIndex: 0,
  batchCount: 2,
  spawns: [
    { label: 'lane-a', kind: 'implement', model: 'sonnet', effort: 'low', promptPath: '.claude/ship/prompts/lane-a.md', promptSha256: SHA_A },
    { label: 'lane-b', kind: 'implement', model: 'opus', effort: 'high', promptPath: '.claude/ship/prompts/lane-b.md', promptSha256: SHA_B }
  ],
  banners: [BANNER],
  then: { argv: ['run', 'record-batch'] }
}

/** The relayed shape alone: no batch positions reach the Workflow host (design D6). */
export const RELAYED_TEST_WAVE = {
  schema: 'interlock.run-step/1',
  action: 'test-wave',
  change: CHANGE,
  wave: 2,
  spawns: [],
  banners: [BANNER],
  then: { argv: ['run', 'record-batch'] }
}

export const HALT = {
  schema: 'interlock.run-step/1',
  action: 'halt',
  reason: 'inter-wave verification failed twice',
  spawns: [],
  banners: [BANNER, SECOND_BANNER],
  then: { argv: ['run', 'close', '--halt', 'inter-wave verification failed twice'] }
}

export const CLOSE_SUMMARY = [
  `ship ${CHANGE}: halted — inter-wave verification failed twice`,
  '',
  '  degradations:',
  `    ${BANNER}`,
  `    ${SECOND_BANNER}`,
  '  resume card: .claude/handoff/ship-add-the-thing-wf_6b71ef8e-ba7.md'
].join('\n')

export const CLOSE = {
  schema: 'interlock.run-step/1',
  action: 'halt',
  then: null,
  spawns: [],
  exitCode: 1,
  banners: [BANNER, SECOND_BANNER],
  summary: CLOSE_SUMMARY
}

/** A `close` step (from `run next`) that carries its summary, as task 1.4 names it. */
export const CLOSE_STEP = {
  schema: 'interlock.run-step/1',
  action: 'close',
  spawns: [],
  banners: [],
  summary: `ship ${CHANGE}: complete`,
  then: { argv: ['run', 'close'] }
}

// --- the wave board (draw-the-wave-board-in-the-meter-pane design D11) ------
//
// The relayed steps of a run over the halted run's plan
// (test/fixtures/ship/halted-run-6e9d0b02/plan.json): the adoption step with
// its summary, the step record-batch returns with the ids it recorded, a
// skipped verification, and the step after a replan with a revised summary.
// The kit has no filesystem, so the summary is a literal;
// test/spine/plan-summary.test.mjs asserts it equals `summarizePlan` of that
// plan, so it cannot drift.

export const FIXTURE_PLAN_SUMMARY = {
  waves: [
    {
      index: 0,
      group: 1,
      kind: 'impl',
      batches: [
        [
          [{ id: '1.7', tier: 4, model: 'sonnet', description: 'Docs (design D2, D4, D5, D7' }],
          [{ id: '1.4', tier: 3, model: 'sonnet', description: 'In lib/receipt.mjs (design D4, D5, D7' }],
          [{ id: '1.2', tier: 2, model: 'sonnet', description: 'Create lib/project-slug.mjs exporting projectSlug(absPath) = every' }],
          [{ id: '1.3', tier: 2, model: 'sonnet', description: 'In lib/limits.mjs add notifyTimeoutMs: 5000 to' }],
          [{ id: '1.6', tier: 1, model: 'haiku', description: 'Verify — do not edit' }]
        ]
      ]
    },
    {
      index: 1,
      group: 1,
      kind: 'impl',
      batches: [
        [
          [{ id: '1.5', tier: 4, model: 'sonnet', description: 'In lib/doctor.mjs (design D5, D12): append' }],
          [{ id: '1.1', tier: 3, model: 'sonnet', description: 'Create lib/notify.mjs (design D1, D2, D4' }]
        ],
        [
          [{ id: '2.1', tier: 4, model: 'sonnet', description: 'In lib/run.mjs (design D1, D5, D7' }]
        ],
        [
          [{ id: '2.2', tier: 3, model: 'sonnet', description: 'In bin/interlock (design D1, D14): add' }]
        ],
        [
          [{ id: '2.3', tier: 2, model: 'sonnet', description: "In workflows/ship.js and bin/interlock-run, append '--notify'" }]
        ],
        [
          [{ id: '3.2', tier: 2, model: 'sonnet', description: 'In skills/spec/SKILL.md §6 (design D6' }]
        ]
      ]
    }
  ],
  testWave: {
    index: 2,
    batches: [
      [
        [{ id: '3.1', tier: 3, model: 'sonnet', description: 'In test/workflows.test.mjs (design D1, D5, D7' }],
        [{ id: '3.3', tier: 2, model: 'sonnet', description: "Run 'openspec validate harden-unattended-ship-runs --strict', 'interlock" }]
      ]
    ]
  },
  deferred: [
    { id: '1.1', group: 1, after: ['1.3'] },
    { id: '1.5', group: 1, after: ['1.6'] },
    { id: '2.2', group: 2, after: ['2.1'] },
    { id: '2.3', group: 2, after: ['2.2'] }
  ]
}

const summaryTask = id =>
  [...FIXTURE_PLAN_SUMMARY.waves, FIXTURE_PLAN_SUMMARY.testWave]
    .flatMap(w => w.batches.flat(2))
    .find(t => t.id === id)

/** A lane spawn as `relayStep` hands it on: labelled by the lane rule, its title the label and the gist. */
const laneSpawn = (id, effort, c) => ({
  label: id,
  title: `${id} · ${summaryTask(id).description}`,
  kind: 'implementer',
  model: summaryTask(id).model,
  effort,
  type: 'interlock:worker',
  promptPath: `.claude/ship/briefings/${id}.md`,
  promptSha256: sha(c)
})

/** The first step of the adopted plan, relayed: wave position 0, its one batch, and the summary. */
export const ADOPTION_BATCH = {
  schema: 'interlock.run-step/1',
  action: 'run-batch',
  change: CHANGE,
  wave: 1,
  waveIndex: 0,
  batchIndex: 0,
  batchCount: 1,
  spawns: [laneSpawn('1.7', null, 'c'), laneSpawn('1.4', null, 'd'), laneSpawn('1.2', 'low', 'e'), laneSpawn('1.3', 'low', 'f'), laneSpawn('1.6', 'low', '1')],
  banners: [],
  then: { argv: ['run', 'record-batch'] },
  pingModel: 'haiku',
  plan: FIXTURE_PLAN_SUMMARY
}

export const VERIFY_LABEL = 'inter-wave-verify-3'

/** What record-batch returns after that batch: the inter-wave verify at position 0, and the ids it recorded. */
export const RECORD_BATCH = {
  schema: 'interlock.run-step/1',
  action: 'verify',
  change: CHANGE,
  wave: 1,
  waveIndex: 0,
  skipped: false,
  spawns: [
    {
      label: VERIFY_LABEL,
      title: VERIFY_LABEL,
      kind: 'verify',
      model: 'sonnet',
      effort: 'xhigh',
      type: 'interlock:worker',
      promptPath: `.claude/ship/briefings/${VERIFY_LABEL}.md`,
      promptSha256: sha('2')
    }
  ],
  banners: [],
  then: { argv: ['run', 'judge', '--context', 'inter-wave'] },
  recorded: { ok: ['1.7', '1.4', '1.2', '1.3'], failed: ['1.6'], notAttempted: [] }
}

export const SKIP_REASON = 'no-detectable-command'

/** An inter-wave verification at position 0 that planned no command. */
export const VERIFY_SKIPPED = {
  schema: 'interlock.run-step/1',
  action: 'verify',
  change: CHANGE,
  wave: 1,
  waveIndex: 0,
  skipped: true,
  reason: SKIP_REASON,
  spawns: [],
  banners: [`VERIFICATION SKIPPED: reason=${SKIP_REASON}`],
  then: { argv: ['run', 'judge', '--context', 'inter-wave'] }
}

/** The summary after a replan folded group 2 into one lane: position 1 now holds two batches. */
export const REVISED_PLAN_SUMMARY = {
  waves: [
    FIXTURE_PLAN_SUMMARY.waves[0],
    {
      index: 1,
      group: 1,
      kind: 'impl',
      batches: [
        [[summaryTask('1.5')], [summaryTask('1.1')]],
        [[summaryTask('2.1'), summaryTask('2.2'), summaryTask('2.3')], [summaryTask('3.2')]]
      ]
    }
  ],
  testWave: FIXTURE_PLAN_SUMMARY.testWave,
  deferred: [
    { id: '1.1', group: 1, after: ['1.3'] },
    { id: '1.5', group: 1, after: ['1.6'] }
  ]
}

/** The first step after that replan: position 1, batch 0 of 2, with the revised summary. */
export const REPLAN_BATCH = {
  schema: 'interlock.run-step/1',
  action: 'run-batch',
  change: CHANGE,
  wave: 1,
  waveIndex: 1,
  batchIndex: 0,
  batchCount: 2,
  spawns: [laneSpawn('1.5', null, '3'), laneSpawn('1.1', null, '4')],
  banners: [],
  then: { argv: ['run', 'record-batch'] },
  plan: REVISED_PLAN_SUMMARY
}

/** The bootstrap line `lib/agent-usage.mjs` joins on, as a spawn prompt carries it. */
export const bootstrapPrompt = s => `You are lane worker.\nRead the briefing.\nExpected sha256: ${s}\n`

export const stdout = record => JSON.stringify(record, null, 2)
