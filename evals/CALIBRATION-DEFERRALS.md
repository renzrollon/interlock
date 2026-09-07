# Judged graders awaiting calibration

Every grader whose verdict depends on a model judge must either carry a stored
set of human-labelled transcripts under `evals/<case>/calibration/<grader>/`, or
be named here with the reason its set does not yet exist. A judged grader that is
neither is a structural failure — `test/evals.test.mjs` fails it by name.

This file exists so an uncalibrated judge is **stated rather than silent**. It is
not an exemption list: `test/evals.test.mjs` also fails an entry that has outlived
what it describes — one naming a grader that no longer exists, or one that now
has a calibration set. Delete the row when the set lands.

Format, one row per grader, parsed by the structural gate:

```
- `<case>/<grader>` — <why the set does not yet exist>
```

## Deferred

- `skill-routing-explore/explores-not-indexes` — the case was authored in this change and has never run, so no transcript of it exists. It is the twin of `skill-routing/implements-not-replans` and expires with it.
- `skill-routing/implements-not-replans` — no transcript of this case has been produced. The eval harness is early-access and no full-suite run has completed, so there is nothing to label; labelling invented transcripts would be hypothetical calibration, which is worse than none.
- `trampoline-halt/halts-and-explains` — same: no run of this case exists yet. This grader additionally needs transcripts from a host with no Workflow tool, which the scheduled job's environment has not yet been confirmed to provide.

Both entries expire on the first completed run of the full suite that produces
readable transcripts for these cases. At that point label them under
`evals/<case>/calibration/<grader>/` — see `evals/CALIBRATION-LAYOUT.md` — and
remove the row here.
