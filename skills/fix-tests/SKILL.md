---
name: fix-tests
description: Discover and persist how a project's tests run, then run the suite and repair failures by root cause — clustering failures by error signature, fixing the shared cause once, and asserting no test was weakened. Use when tests are failing, the suite is red, CI pasted a failure log, or someone asks to make the tests pass.
license: MIT
compatibility: Requires the project's own test tooling. Node.js >= 18 for the bundled interlock CLI.
argument-hint: "[--e2e] [--dry-run] [--baseline <ref>] [--from-log <path>] [--reconfigure]"
allowed-tools: Bash Read Write Edit Glob Grep
metadata:
  type: execution
  autonomy_level: L2
  outputs:
    - .claude/testing/profile.json
    - .claude/metrics/fix-tests-<timestamp>.json
---

Make the suite green **without making it weaker**.

The failure mode this skill exists to prevent is the one where a suite goes green by shrinking — a deleted assertion, a `.skip`, a narrowed glob, a loosened matcher. That is not a fix; it is the bug plus a lie. Every step below is built around detecting it.

| Flag | Effect |
|------|--------|
| `--e2e` | Also run the e2e suite (only when `e2e.command` is configured) |
| `--dry-run` | Diagnose and propose; edit nothing |
| `--baseline <ref>` | Treat failures already present at `<ref>` as pre-existing |
| `--from-log <path>` | Parse a pasted CI log instead of running the suite first |
| `--reconfigure` | Re-run test discovery from scratch |

---

## 1. Resolve the test profile

Read `.claude/testing/profile.json`. If it is missing or `--reconfigure` was passed, run the discovery ladder in `${CLAUDE_PLUGIN_ROOT}/shared/TEST-PROFILE.md`: manifests, then runner configs, then CI workflows, then **at most four questions** for gaps that genuinely block a correct run.

This is the only skill permitted to interview the user about tests. Every later run is zero-question.

Persist the profile and mirror it into the `## Testing` block in `CLAUDE.md` (or `AGENTS.md`), between the managed markers, idempotently.

---

## 2. Run and baseline

Run the unit command. Record `total`, `passed`, `failed`, `skipped` — this is the baseline that step 6 asserts against.

Split failures into:

- **Newly broken** — not failing at `--baseline <ref>` (or all failures when no baseline was given)
- **Pre-existing** — already failing at the baseline. **Report only.** Do not absorb them into this fix unless the user explicitly widens scope.

---

## 3. Flake check

Re-run **only** the failing files or test names, once, using `single_file` / `filter_syntax`.

- Still failing → a real failure; continue.
- Passed on re-run → record it in `profile.known_flaky` and **do not "fix" it**. Mention it in the report. A test that passes on retry is a flaky test, and "fixing" it usually means deleting the thing that caught a race.

---

## 4. Cluster by error signature

| Signature | Example | Likely shared root cause |
|---|---|---|
| Same missing import | `Cannot find module './utils'` | Missing export or wrong path |
| Same type error | `Type 'X' not assignable to 'Y'` | Interface shape mismatch |
| Same fixture or setup | `ReferenceError: db is not defined` | Missing shared setup |
| Same env or config | `ECONNREFUSED`, `env.X is undefined` | Missing env or config |
| Same assertion pattern | Many `expected X received Y` | Logic bug in shared code |

With `--from-log`, parse the log into the same clusters without an initial run — but still record a live baseline before applying any fix.

---

## 5. Fix by root cause

```
iterations = 0, MAX = 5

WHILE failures remain AND iterations < MAX AND NOT --dry-run:
  1. Pick the cluster covering the MOST failures
  2. Choose ONE fix — source first
  3. Apply it
  4. Re-run ONLY the affected tests
  5. Drop resolved failures; iterations++
```

**Source first.** When a test and the code disagree, the default assumption is that the code is wrong. Change the test only when you can state why the test's expectation was incorrect — and say that out loud in the report.

**Never**: delete a test, add `.skip`/`.only`, loosen an assertion to match observed output, narrow a glob, raise a timeout to hide a race, or catch-and-ignore an error to make a run pass.

`--dry-run` stops after clustering: print the diagnoses and proposed fixes, edit nothing.

After 5 iterations, stop and report the unresolved clusters and what was tried. Do not thrash.

---

## 6. Full re-run and no-regression assert

Run the full suite again, then assert against the baseline:

- `total >= baseline.total`
- `skipped <= baseline.skipped`

**If either assert fails, revert the weakening change** — something deleted tests or added skips. A green suite that runs fewer tests than it did before is a regression wearing a green badge.

---

## 7. Persist

- Refresh `.claude/testing/profile.json` (`updated`, `known_flaky`, `notes`) with anything learned about running tests. Preserve every key you did not resolve yourself.
- Confirm the `## Testing` block is still a single idempotent pair of markers.
- Write at most **3** `.claude/memory/failure-modes/<slug>.md` entries for genuinely recurring gotchas, with index lines in `.claude/memory/MEMORY.md`. One-off typos do not belong in memory.
- Write `.claude/metrics/fix-tests-<YYYYMMDD-HHMMSS>.json` with the baseline, final counts, clusters, fixes applied, and anything unresolved.

---

## 8. Report

Baseline → final counts. Root causes fixed, one line each. Failures reverted as pre-existing. Flaky tests recorded. Anything still red, and what was tried. If you changed a test rather than source, say which and why.
