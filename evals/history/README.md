# Eval run history

`interlock evals promote --history evals/history` reads this directory to decide
whether a case has earned promotion from advisory to blocking. One `*.json` file
per recorded run, read in filename order — timestamped names sort chronologically,
which is what makes "the last N consecutive qualifying runs" a well-defined window.

Empty right now, and that is the correct state: no full-suite run has completed.
With nothing here `promote` reports **insufficient history** and exits 2, which
the eval workflow reads as the advisory posture. The current behaviour, reached by
decision rather than by default.

## Record shape

```json
{
  "run_id": "2026-09-15T07-17-41Z",
  "triage": "pass",
  "cases": [
    { "id": "handoff-status-enum", "trials": 3, "passed": 3 },
    { "id": "skill-routing", "trials": 3, "passed": 2, "judged_graders": ["implements-not-replans"] }
  ]
}
```

| Field | Meaning |
|---|---|
| `run_id` | the run this record summarises |
| `triage` | the verdict `interlock evals triage` gave that run. `no_signal` and `configuration` mark the run non-qualifying: it is excluded and named, and it does **not** break the consecutive chain |
| `cases[].trials` | how many trials of the case the run carried |
| `cases[].passed` | how many of them passed. Promotion is pass^k — `passed` must equal `trials`, on every run in the window |
| `cases[].judged_graders` | the case's judged graders, if any. A case naming one is refused unless `interlock evals calibrate` has measured that grader at or above the published agreement floor |

**Counts and a verdict only — never transcripts.** This directory is committed and
grows without bound; a transcript here would make it unreadable within a year and
would put trace content into version control on a schedule.

## Who appends, and when

**A maintainer, by hand, after a run they started.** Deliberately not CI: a workflow
that commits to the default branch needs `contents: write` and produces a
bot-authored commit on every run, which is a permissions and provenance decision
larger than the promotion rule needed (design D6). The `ship-outcome-eval` workflow
has no schedule: it runs only when a maintainer dispatches it (`workflow_dispatch`),
and uploads its results as an artifact. Copying the summary here is a human action, so
the history is something someone chose to record rather than something that
accumulated.

The decision module and its CI reader work over whatever is committed, so nothing
breaks while this stays empty — `promote` simply keeps saying it cannot decide.

## Local interactive-session rows

Next to the per-run `*.json` records, `ship-outcomes.jsonl` is the outcome eval's
row log. Most rows come from `node evals/ship/run.mjs`, which spawns an agent
against a committed fixture. A second kind is graded in place after a maintainer
ran `/interlock:ship` by hand (the per-release local run), with:

```
node evals/ship/run.mjs --grade-root <dir> --change <name> --baseline-commit <sha> \
  --fixture-id <id> [--run-id <id>] [--baseline-counts <file>] [--history-root <dir>]
```

That form runs the loop arm's graders over the root as it stands. It spawns no
agent and needs no credential. Without `--run-id` it grades the change's newest run by
recorded start time (equal start times fall to the later run id, and the output says so).
Its row has the same schema as every other, and is
told apart by what it records about itself:

| Field | Value |
|---|---|
| `evalAgent` | `interactive-session` — a person drove the run, not the eval's agent |
| `version` | the plugin version the run recorded, else the CLI version it recorded. A run that recorded neither is **refused**, nothing is appended, and the output says so |
| `host` | the host the run recorded (`workflow` for `/interlock:ship`) |
| `model` | the model the run recorded, or `unknown` — never a default |
| `fixture` | `--fixture-id`, e.g. `kettle@demo-ship` |
| `arm` | `loop` |

Without `--baseline-counts` (a JSON file of the suite's counts before the run) the
`unit-suite-not-weakened` criterion is recorded `unobserved` with its reason,
never met. Token and spend measures are absent with their reasons: an interactive
session is not metered by this eval.

**A maintainer commits the rows they keep.** The command appends to this
repository's `evals/history/` by default; use `--history-root` to write elsewhere
and `--no-history` to grade and print only. Nothing commits a row for you, and a
row that is not committed is not part of the record.
