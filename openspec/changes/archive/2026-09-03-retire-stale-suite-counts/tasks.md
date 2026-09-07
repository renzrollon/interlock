## 1. Retire the counts

- [x] 1.1 In `README.md`, rewrite the `npm test` comment in the Development block (line 285) so it carries no count and keeps the `no dependencies` claim.
- [x] 1.2 In `docs/06-why-it-works.md` §3 "The judgement/mechanism split" (line 58), remove `760 tests` from the sentence beginning "Two properties fall out"; keep "no network, no API key, most running in under a millisecond".
- [x] 1.3 In `docs/06-why-it-works.md` §14 "What this costs, honestly" (line 396), remove `760 tests` from the "No published benchmark" paragraph; keep the concession that the tests prove the policy engine and not the product. (This site is the fourth one, not named by R19 — see design.md D4.)
- [x] 1.4 In `docs/10-agentic-workflow-ship-and-spec.md` §2, remove `590+` from the "Evals" bullet in "Roles, in this repo's vocabulary" (line 90). The bullet's rewrite is task 3.1; this task only removes the number.

## 2. Assert what replaced the counts

- [x] 2.1 In `test/workflows.test.mjs`, beside the existing doc-claim assertions (near line 393), add a test asserting `package.json` declares no runtime `dependencies` key, with a message naming the documented `no dependencies` claim in `README.md` that it backs.
- [x] 2.2 In the same file, add a test that reads `README.md`, `docs/06-why-it-works.md` and `docs/10-agentic-workflow-ship-and-spec.md` and fails when any of them states a count of the test suite. Match the drift shape (a number, optional `+`, then `tests` / `unit tests` / `test suite` / `cases` within a short window), not the stale values; the failure message must name the file and the matched text. Add the comment explaining why the absence is pinned, following the precedent at line 393.
- [x] 2.3 Run `npm test` and confirm 2.2 does not fire on unrelated numbers in those three files (section numbers, years, arXiv ids, the runtime ceilings in `docs/06` §2). Narrow the pattern if it does; do not exempt a file.

## 3. Describe the eval suite in docs/10

- [x] 3.1 Rewrite the §2 "Evals" bullet so it names `evals/` as the model-in-the-loop suite, keeps the existing point that the unit suite tests the policy engine rather than product quality, and states that the two are different things. No case count, no threshold value.
- [x] 3.2 Rewrite the §8 "Evals" subsection so it names `evals/`, names the surfaces its cases exercise (implementer briefing, control-plane action, trampoline halt, skill routing, evidence locators, tier read scope, cited cap resolution), and states the boundary: no cases exercise the spec path — `skills/spec`, `review-artifacts`, `review-code`, `explore`, `bootstrap` — and the job is advisory and gates nothing. Keep the closing point that the checkpoint read is the eval that matters.
- [x] 3.3 In the same subsection, where a cost ceiling is relevant, state that one exists and name `interlock limits` as where to read it. Print no number.
- [x] 3.4 Confirm by reading `evals/` and `.github/workflows/evals.yml` that every coverage claim written in 3.1–3.3 is true on the day it is written, and that no claim asserts scores or a baseline exist. (`baseline.md` lives in the archived change, not in `evals/` — do not link it as if it were a live file.)

## 4. Pin the eval-suite description

- [x] 4.1 In `test/workflows.test.mjs`, add a test asserting `docs/10-agentic-workflow-ship-and-spec.md` names `evals/` in both §2 and §8, and names the spec-path coverage gap. Assert tokens, not sentences.
- [x] 4.2 Extend 4.1 with a negative assertion that the §8 subsection states no numeric cap or threshold value, and add a comment recording why the run status ("not yet run against a model") is deliberately left unpinned — design.md D3.

## 5. Verify

- [x] 5.1 Run `npm test` and paste the output. Every test passes, including the new assertions in tasks 2 and 4.
- [x] 5.2 Grep `README.md` and `docs/` for a count describing the test suite and confirm nothing survives, which is R19's acceptance criterion.
