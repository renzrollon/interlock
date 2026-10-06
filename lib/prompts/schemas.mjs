// The result schemas every spawn declares.
//
// These were literals in `workflows/ship.js` (inside the `LANE_DISPATCH` block
// and inline at the agent calls) and again in `bin/interlock-ship-acp`. A step
// carries its spawn's schema now, so both hosts declare what the CLI states and
// neither states one of its own.
//
// A host may ADD to a schema — the Workflow host adds a required `briefing`
// field, because it delivers briefings by reference and needs the hash back
// (design D2) — but it never authors one.

const HANDOFF_SCHEMA_SHAPE = {
  type: 'object',
  required: ['taskId', 'status', 'summary', 'next'],
  properties: {
    schema: { type: 'string' },
    taskId: { type: 'string' },
    status: { type: 'string' },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    next: { type: 'string' },
    blocker: { type: ['string', 'null'] }
  }
}

// filesChanged is what the agent touched; evidence is where the next wave
// should look. Neither substitutes for the other.
export const SINGLE_TASK_SCHEMA = {
  type: 'object',
  required: ['id', 'ok', 'handoff'],
  properties: {
    id: { type: 'string' },
    ok: { type: 'boolean' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
    note: { type: 'string' },
    handoff: HANDOFF_SCHEMA_SHAPE,
    // Only meaningful under --isolate-waves: the lane's own worktree, self-
    // reported (`pwd`), never predicted by the orchestrator. Declared here
    // unconditionally so the schema does not have to fork on the flag.
    worktreePath: { type: 'string' }
  }
}

// One outcome per task, with `not-attempted` distinct from `failed`: the tick
// must not mark a task nobody ran, and the failure budget must not be spent on
// one.
export const LANE_SCHEMA = {
  type: 'object',
  required: ['tasks'],
  properties: {
    // Only meaningful under --isolate-waves: one worktree per lane (one agent,
    // one `pwd`), so it lives at the lane level, not per task.
    worktreePath: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'outcome'],
        properties: {
          id: { type: 'string' },
          outcome: { type: 'string' },
          filesChanged: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
          note: { type: 'string' },
          handoff: HANDOFF_SCHEMA_SHAPE
        }
      }
    }
  }
}

// The classifier reports only whether it wrote the file and how large the
// classification is — it runs no CLI, so it has nothing else to report
// (design D7).
export const PLANNER_SCHEMA = {
  type: 'object',
  required: ['ok'],
  properties: {
    ok: { type: 'boolean' },
    taskCount: { type: 'integer' },
    detail: { type: 'string' }
  }
}

export const VERIFY_RESULT_SCHEMA = {
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'exitCode'],
        properties: {
          kind: { type: 'string' },
          exitCode: { type: 'integer' },
          total: { type: 'integer' },
          passed: { type: 'integer' },
          failed: { type: 'integer' },
          failures: { type: 'array', items: { type: 'string' } },
          locator: { type: 'string' },
          preview: { type: 'string' }
        }
      }
    },
    detail: { type: 'string' }
  }
}

export const REPLAN_SCHEMA = {
  type: 'object',
  required: ['revised'],
  properties: { revised: { type: 'boolean' }, detail: { type: 'string' } }
}

export const COMMIT_SCHEMA = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' }, sha: { type: 'string' }, detail: { type: 'string' } }
}

// The strict tail's three result schemas (`emit-strict-tail-from-cli`). All
// three ask for counts only: the reasoning, the findings and the fix diffs
// live in the work files (`findings.json`, `verdicts.json`) and the diff
// itself, never in the result the CLI adjudicates from.

// The review worker's own report. `addedDimensions` is how the run learns a
// reviewer went beyond the CLI's selection (design D4) — the CLI has no way to
// know WHY a dimension was added, so the one-line reason travels back here.
export const REVIEW_RESULT_SCHEMA = {
  type: 'object',
  required: ['ok'],
  properties: {
    ok: { type: 'boolean' },
    addedDimensions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'reason'],
        properties: { name: { type: 'string' }, reason: { type: 'string' } }
      }
    },
    stageMarkerWarning: { type: 'string' },
    detail: { type: 'string' }
  }
}

// A fixing round's own report. Fixed/deferred counts are never trusted from
// here — `run remediated` re-adjudicates the rewritten findings/verdicts files
// itself (design D2) — this is bookkeeping only.
export const REMEDIATE_RESULT_SCHEMA = {
  type: 'object',
  required: ['ok'],
  properties: {
    ok: { type: 'boolean' },
    stageMarkerWarning: { type: 'string' },
    detail: { type: 'string' }
  }
}

// The verdict round fixes nothing and re-reviews nothing, so its report is
// smaller still — the CLI already knows whether a blocker survived from its
// own re-adjudication; this is not what `run remediated` reads to decide.
export const VERDICT_RESULT_SCHEMA = {
  type: 'object',
  required: ['ok'],
  properties: {
    ok: { type: 'boolean' },
    detail: { type: 'string' }
  }
}

// The handoff writer's report. Unlike the review counts, these are NOT
// re-derivable by the CLI: whether a manual test plan was written and how many
// scenarios came back unconfirmed are facts about artifacts the agent authored,
// so they are reported. `manualTestPlan` and `skipReason` are the agent's
// account of what it did with the decision the CLI already made and inlined —
// the decision itself is never asked for back (design D5).
export const HANDOFF_RESULT_SCHEMA = {
  type: 'object',
  required: ['ok'],
  properties: {
    ok: { type: 'boolean' },
    manualTestPlan: { type: 'boolean' },
    skipReason: { type: 'string' },
    learnings: { type: 'integer' },
    scenariosChecked: { type: 'integer' },
    scenariosUnconfirmed: { type: 'integer' },
    detail: { type: 'string' }
  }
}

/** Every schema a step may carry, by the name the run program refers to it by. */
export const SCHEMAS = Object.freeze({
  SINGLE_TASK_SCHEMA,
  LANE_SCHEMA,
  PLANNER_SCHEMA,
  VERIFY_RESULT_SCHEMA,
  REPLAN_SCHEMA,
  COMMIT_SCHEMA,
  REVIEW_RESULT_SCHEMA,
  REMEDIATE_RESULT_SCHEMA,
  VERDICT_RESULT_SCHEMA,
  HANDOFF_RESULT_SCHEMA
})
