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

**A maintainer, by hand, after a scheduled run.** Deliberately not CI: a workflow
that commits to the default branch needs `contents: write` and produces a
bot-authored commit on every run, which is a permissions and provenance decision
larger than the promotion rule needed (design D6). The scheduled job continues to
upload its results as an artifact; copying the summary here is a human action, so
the history is something someone chose to record rather than something that
accumulated.

The decision module and its CI reader work over whatever is committed, so nothing
breaks while this stays empty — `promote` simply keeps saying it cannot decide.
