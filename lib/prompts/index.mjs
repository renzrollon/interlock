// The registry of every briefing the run program can assemble.
//
// Coverage of assembled prompts is ENUMERATED, never sampled: the prompt-
// integrity suite iterates this table, and a module under `lib/prompts/` that
// exports an assembler and is not registered here fails that suite by name. The
// alternative — a suite that checks the prompts it happens to reach — is how the
// classifier's tier ladder stayed corrupted while every test passed.
//
// `inputs` are the sample inputs the suite assembles with. They are not
// fixtures: a fixture pins bytes (that is `test/fixtures/prompts/`), while these
// only have to be well-formed enough to exercise every branch of the assembler.

import { assembleImplementerPrompt } from './implementer.mjs'
import { assemblePlannerPrompt } from './planner.mjs'
import { assembleVerifyPrompt } from './verify.mjs'
import { assembleReplanPrompt } from './replan.mjs'
import { assembleCommitPrompt } from './commit.mjs'
import { assembleReviewPrompt } from './review.mjs'
import { assembleRemediatePrompt, assembleVerdictPrompt } from './remediate.mjs'
import { assembleHandoffPrompt } from './handoff.mjs'
import { publishStageLine } from './stage.mjs'

export { assembleImplementerPrompt } from './implementer.mjs'
export { assemblePlannerPrompt } from './planner.mjs'
export { assembleVerifyPrompt } from './verify.mjs'
export { assembleReplanPrompt } from './replan.mjs'
export { assembleCommitPrompt } from './commit.mjs'
export { assembleReviewPrompt } from './review.mjs'
export { assembleRemediatePrompt, assembleVerdictPrompt } from './remediate.mjs'
export { assembleHandoffPrompt } from './handoff.mjs'
export { selectDimensions, ALWAYS_ON_DIMENSIONS } from './dimensions.mjs'
export { publishStageLine } from './stage.mjs'
export * from './schemas.mjs'

const CHANGE = 'demo-change'

/**
 * name → { module, assemble, inputs }. One entry per assembler; `inputs` is a
 * list, so an assembler with a meaningfully different shape per branch (a lane
 * of one vs a lane of several; inter-wave vs final verification) registers each.
 */
export const PROMPTS = Object.freeze({
  implementer: {
    module: 'implementer.mjs',
    assemble: assembleImplementerPrompt,
    inputs: [
      {
        change: CHANGE,
        task: { id: '1.1', description: 'sessions table', tier: 3, model: 'sonnet' },
        previousHandoffs: []
      },
      {
        change: CHANGE,
        lane: [
          { id: '1.1', description: 'sessions table', tier: 2, model: 'sonnet' },
          { id: '1.2', description: 'session index', tier: 4, model: 'sonnet' }
        ],
        previousHandoffs: [
          {
            taskId: '0.1',
            status: 'ok',
            summary: 'schema landed',
            evidence: ['lib/db.mjs:12-40'],
            next: 'wire the reader',
            blocker: null
          }
        ],
        isolateWaves: true
      },
      {
        change: CHANGE,
        lane: [{ id: '1.1', description: 'the whole change', tier: 2, model: 'sonnet' }],
        solo: true,
        previousHandoffs: []
      }
    ]
  },
  planner: {
    module: 'planner.mjs',
    assemble: assemblePlannerPrompt,
    inputs: [{ change: CHANGE, classifiedPath: '.claude/ship/classified.json' }]
  },
  verify: {
    module: 'verify.mjs',
    assemble: assembleVerifyPrompt,
    inputs: [
      {
        change: CHANGE,
        context: 'inter-wave',
        steps: [{ kind: 'unit', command: 'npm test' }],
        runId: 'run-1',
        statePath: '.claude/ship/state.json'
      },
      {
        change: CHANGE,
        context: 'final',
        steps: [
          { kind: 'unit', command: 'npm test' },
          { kind: 'e2e', command: 'npm run e2e' }
        ],
        runId: null,
        statePath: '.claude/ship/state.json'
      },
      // The fix branch: a retry carries what the previous attempt reported, and
      // the integrity sweep must see that branch rendered too.
      {
        change: CHANGE,
        context: 'inter-wave',
        steps: [{ kind: 'unit', command: 'npm test' }],
        runId: 'run-1',
        statePath: '.claude/ship/state.json',
        fixAttempt: 1,
        fixAttemptsRemaining: 1,
        errors: ['unit suite is red (1 failing, 1 root-cause cluster(s))']
      }
    ]
  },
  replan: {
    module: 'replan.mjs',
    assemble: assembleReplanPrompt,
    inputs: [{ change: CHANGE, replanPath: '.claude/ship/replan.json' }]
  },
  commit: {
    module: 'commit.mjs',
    assemble: assembleCommitPrompt,
    inputs: [{ change: CHANGE, stageIndex: 7 }]
  },
  review: {
    module: 'review.mjs',
    assemble: assembleReviewPrompt,
    inputs: [
      {
        change: CHANGE,
        dimensions: [
          { name: 'language', rubric: 'Check idiomatic usage, type safety and error handling.' },
          { name: 'devops', rubric: null }
        ],
        policyProse: 'Blockers must cite evidence; treat purely cosmetic nits as suggestions, not warnings.',
        findingsPath: '.claude/ship/demo-change/review/findings.json',
        verdictsPath: '.claude/ship/demo-change/review/verdicts.json',
        stageLine: publishStageLine('review', CHANGE, 5)
      },
      {
        change: CHANGE,
        dimensions: [{ name: 'qa', rubric: 'Are edge cases and error paths covered by a test?' }],
        policyProse: '',
        findingsPath: '.claude/ship/demo-change/review/findings.json',
        verdictsPath: '.claude/ship/demo-change/review/verdicts.json',
        stageLine: publishStageLine('review', CHANGE, 5)
      }
    ]
  },
  remediate: {
    module: 'remediate.mjs',
    assemble: assembleRemediatePrompt,
    inputs: [
      {
        change: CHANGE,
        round: 1,
        plan: {
          fix: {
            byFile: [
              {
                file: 'lib/db.mjs',
                findings: [
                  {
                    severity: 'blocker',
                    file: 'lib/db.mjs',
                    line: 42,
                    title: 'missing null check',
                    description: 'a null session can reach the query builder unchecked',
                    suggestion: 'guard before the query is built'
                  }
                ]
              }
            ],
            unscoped: [
              {
                severity: 'warning',
                file: null,
                title: 'naming drift',
                description: 'the same concept is named two different ways across the diff'
              }
            ]
          },
          reReviewDimensions: ['language']
        },
        dimensions: [{ name: 'language', rubric: 'Check idiomatic usage, type safety and error handling.' }],
        policyProse: 'Blockers must cite evidence; treat purely cosmetic nits as suggestions, not warnings.',
        stageLine: publishStageLine('remediation', CHANGE, 6)
      }
    ]
  },
  verdict: {
    module: 'remediate.mjs',
    assemble: assembleVerdictPrompt,
    inputs: [{ change: CHANGE, round: 3 }]
  },
  handoff: {
    module: 'handoff.mjs',
    assemble: assembleHandoffPrompt,
    inputs: [
      {
        change: CHANGE,
        needsManualTestPlan: true,
        testPlanReason: undefined,
        conformance: [
          { id: 'S1', artifact: 'openspec/specs/demo-change/spec.md', line: 12, title: 'rejects an expired session' }
        ],
        learnings: true
      },
      {
        change: CHANGE,
        needsManualTestPlan: false,
        testPlanReason: 'a backend-only change touches no UI surface',
        conformance: null,
        learnings: false
      },
      {
        change: CHANGE,
        needsManualTestPlan: null,
        testPlanReason: undefined,
        conformance: [],
        learnings: false
      }
    ]
  },
  stage: {
    module: 'stage.mjs',
    assemble: ({ stage, change, index }) => publishStageLine(stage, change, index),
    inputs: [
      { stage: 'implement', change: CHANGE, index: 1 },
      { stage: 'fix-tests', change: CHANGE, index: 2 },
      { stage: 'commit', change: CHANGE, index: 3 }
    ]
  }
})

/** Every registered assembler's module filename, for the unregistered-module check. */
export const REGISTERED_MODULES = Object.freeze(
  Object.values(PROMPTS).map(entry => entry.module)
)

/**
 * Modules under `lib/prompts/` that hold no assembler and are not expected in
 * the registry. `dimensions.mjs` selects which review dimensions run — a
 * `{ dimensions, reasons }` decision, never a string handed to an agent — so
 * it has no briefing to register or check for coercion artifacts.
 */
export const NON_ASSEMBLER_MODULES = Object.freeze(['index.mjs', 'schemas.mjs', 'dimensions.mjs'])
