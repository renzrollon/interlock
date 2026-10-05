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
  '  resume card: .claude/ship/resume/add-the-thing.md'
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

/** The bootstrap line `lib/agent-usage.mjs` joins on, as a spawn prompt carries it. */
export const bootstrapPrompt = s => `You are lane worker.\nRead the briefing.\nExpected sha256: ${s}\n`

export const stdout = record => JSON.stringify(record, null, 2)
