## Why

Four sentences in the shipped docs state how large this project's test suite is, and every one of them is wrong. `README.md` and `docs/06-why-it-works.md` (twice) say "760 tests"; `docs/10-agentic-workflow-ship-and-spec.md` §2 says "590+ unit tests of the policy engine". The 2026-09-03 evals review (`.docs/EVALS-REVIEW-2026-09-03.md`, gap G12, requirement R19) records **1330** tests actually collected by `npm test` — 1329 passing, 1 skipped. The numbers are stale because nothing asserts them: the repo's own rule is that a prose claim nobody asserts silently stops being true, and these are the demonstration.

The same review records a second, worse drift in the same files. `docs/10` §2 calls the unit suite "Evals" and §8 says there is "no SWE-bench-style eval" and "a large, dependency-free test suite of the CLI" — neither mentions that a real model-in-the-loop eval suite exists at `evals/`, what it exercises, or what it does not. A reader of `docs/10` today would not learn that the suite exists, and would learn a number that is off by more than half.

## What Changes

- Every count that describes the unit suite is removed from prose. `README.md` line 285, `docs/06` §3, `docs/06` §14, and `docs/10` §2 keep their argument and lose their number.
- The one load-bearing claim that survives at the `README.md` site — **no dependencies** — stops being prose and becomes an assertion that reads `package.json`. It is exactly derivable, costs nothing, and is the claim a reader actually acts on.
- A doc-claim test pins the *absence* of a unit-suite count across the three files, so a future edit cannot silently reintroduce a number that will be stale within a month.
- `docs/10` §2 and §8 are rewritten to name the `evals/` suite, state what it covers (Interlock's model-facing surface as exercised by `ship`), and state what it does not cover — no cases on the spec path (`skills/spec`, `review-artifacts`, `review-code`, `explore`, `bootstrap`), advisory only, gates nothing. The description carries no case count and no numeric threshold; where a cost ceiling is relevant it names `interlock limits` as the place to read it.
- The `evals/` description is pinned by token assertions in `test/skills.test.mjs`'s doc-claim neighbourhood or `test/workflows.test.mjs`, following the existing precedent at `test/workflows.test.mjs:393`.

Not in scope: authoring eval cases, running the eval suite, producing a baseline, or any coverage report. Those are slices E1–E4 of the same review and stay there.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `evals/case-suite`: adds a requirement that the documentation describing the project's test and eval suites carries no unasserted count, and that the prose describing `evals/` states its coverage boundary. `evals/case-suite` is the only existing capability whose subject is a suite's contents and the honesty of what is claimed about it — it already owns "every case cites the reproduced failure it encodes" and "the seeded suite covers the observable-gap classes". `ship/cap-authority` was considered and rejected: its subject is caps the loop obeys, read from `lib/limits.mjs`, and a documentation count is not a cap.

## Impact

- `README.md` — one line, the Development block.
- `docs/06-why-it-works.md` — §3 and §14, one sentence each.
- `docs/10-agentic-workflow-ship-and-spec.md` — §2 "Evals" bullet and §8 "Evals" subsection.
- `test/workflows.test.mjs` — new doc-claim assertions, alongside the existing ones.
- No change to `lib/`, `bin/`, `workflows/`, `hooks/`, `skills/`, or `evals/`. No new dependency; `package.json` is read, not modified.
