## Context

See proposal.md — Why. Two facts from the repository that shape the approach, both established by grep on 2026-09-03:

1. **The collected count cannot be derived statically.** `find test -name '*.test.mjs'` feeds `node --test`. A grep for test declarations across those files returns **1189**; `npm test` collected **1330** on the same tree (`.docs/EVALS-REVIEW-2026-09-03.md` §2). The 141-test gap is tests generated inside loops over fixture tables. Any "count the `test(` calls" assertion would therefore assert a number that is not the number the documentation is claiming.
2. **A doc-claim assertion precedent already exists.** `test/workflows.test.mjs:393` reads `README.md` and `docs/04-when-it-stops.md` and pins tokens — `interlock-ship-acp`, `Code Mode is out of scope` — with a negative regex guarding the claim that must never reappear. It also carries a comment explaining why the claim is pinned rather than trusted. That is the shape to follow.

A third fact constrains the second half: `.docs/EVALS-REVIEW-2026-09-03.md` §2 records that layer 3 (the `evals/` suite) has **never run**, and §3.2 G9 records that it has **no cases on the spec path**. Whatever `docs/10` says about eval coverage has to be true on the day it is written.

## Goals / Non-Goals

**Goals:**

- No count describing the unit suite survives a grep of `README.md` and `docs/`.
- The claim that survives at each site is the one a reader acts on, and it is asserted where asserting it is cheap and exact.
- Reintroducing a count is caught by `npm test`, not by the next review.
- `docs/10` describes `evals/` truthfully, including its gap.

**Non-Goals:**

- No test-count reporting tool, no coverage report, no `interlock` subcommand. R10 of the same review owns eval coverage reporting and is a different slice.
- No rewrite of `docs/06` or `docs/10` beyond the named sentences. This is the smallest slice of the review; it does not become a docs pass.
- No change to the eval suite itself, its cases, its CI job, or its caps.

## Decisions

### D1 — Derive or delete, decided per site

R19 permits either: a count replaced by a number-free phrase, or a count asserted by a test that reads the real number. Four sites, decided one at a time.

**The general cost of deriving.** The only honest reader of the real count is the runner itself. A test that derives it must spawn `node --test` over the same `find`-piped file list as a subprocess and parse the TAP plan. That test lives *inside* the suite it runs, so it re-enters itself: without an environment guard it recurses, and with one it still doubles the wall-clock cost of `npm test` for every contributor and every CI run, to maintain a sentence whose number carries no argument. The cheap alternative — counting `test(` declarations — asserts 1189 against a documented 1330 and would be a *wrong* number that a green suite certifies, which is worse than a stale one. Deriving is therefore expensive everywhere in this repo, and that cost is the same at all four sites.

**The per-site question is what the number was doing.** At each site, ask what the sentence loses if the number goes.

- **`README.md` line 285 — `npm test  # 760 tests, no dependencies`.** The number is orientation in a quickstart block; the load-bearing half is `no dependencies`, which is what tells a reader the command will work on a fresh clone. **Decision: delete the count, and derive the half that matters.** `no dependencies` becomes an assertion that reads `package.json` and fails if a `dependencies` key appears. This is the one site where deriving is exact, free, and about a claim that changes behaviour rather than a claim about scale. It also closes a real hole: `CLAUDE.md` states zero runtime dependencies as a convention and no test enforces it (grep of `test/**` for `dependencies` returns only wave-ordering matches).
- **`docs/06-why-it-works.md` §3, line 58 — "The policy is testable without a model — 760 tests, no network, no API key".** The argument is the judgement/mechanism split: policy is testable *without a model*. The count is decoration; "no network, no API key, most running in under a millisecond" already carries the point. **Decision: delete the count.** Deriving here would import the subprocess cost into a sentence whose argument does not use the number.
- **`docs/06-why-it-works.md` §14, line 396 — "760 tests prove the policy engine behaves as specified."** Not named by R19 (see D4). The sentence's whole purpose is to concede a limit — the tests prove the policy, not the product. The count contributes nothing to a concession and, being large, faintly undercuts it. **Decision: delete the count.**
- **`docs/10-agentic-workflow-ship-and-spec.md` §2, line 90 — "590+ unit tests of the policy engine".** The `+` makes this a floor, so at 1330 it is not false — it is merely off by more than half, which is the worse failure for a page whose job is to orient a prompt-only engineer. This is also the site that half 2 rewrites anyway, since the same bullet mislabels the unit suite as "Evals". **Decision: delete the count**, and rewrite the bullet under D3.

Net: all four sites lose their number, but not for one blanket reason — three because the number was decoration in an argument that does not use it, one because the derivable claim at that site was a different claim entirely. The `README.md` site is where deriving won.

**Alternative considered and rejected: derive at every site from a committed count file** regenerated by a script. It moves the staleness one hop — the file goes stale the moment someone forgets the script — and it adds a generated artifact to a repo that has none.

### D2 — Assert the absence, not just fix the text

Fixing four sentences is a one-time edit that the next docs pass can undo. The repository's own stated rule is the reason not to stop there: *a prose claim nobody asserts silently stops being true*. So a doc-claim test pins the negative — a regex over `README.md`, `docs/06-why-it-works.md` and `docs/10-agentic-workflow-ship-and-spec.md` that fails when a sentence states a count of the test suite.

The regex must be tight enough not to fire on unrelated numbers (section numbers, years, arXiv ids, "16 concurrent agents", the `1,000 per run` runtime ceiling in `docs/06` §2). Scope it to the shape the drift actually takes: a number, optional `+`, then a word within a short window from a small vocabulary — `tests`, `unit tests`, `test suite`, `cases`. Assert on that shape, not on the specific stale values, or the pin dies the first time someone writes a *new* wrong number.

The test lives beside the existing doc-claim assertions in `test/workflows.test.mjs` rather than in a new file, because that is where the precedent and its explanatory comment already are, and a reader debugging a failure will find the sibling assertions in the same neighbourhood.

**Alternative considered and rejected: a lint rule or a pre-commit hook.** `CLAUDE.md` states there is no lint or build step; adding one for this would be a much larger decision than the change warrants.

### D3 — What `docs/10` may say about `evals/`

§2's "Evals" bullet currently calls the unit suite the evals. §8's "Evals" subsection says there is no SWE-bench-style eval and a large dependency-free test suite — it is already number-free, and it is already careful, but it never mentions that `evals/` exists.

Both sections say the same three things, phrased for their own altitude:

1. `evals/` exists and holds model-in-the-loop cases over Interlock's model-facing surface.
2. What it exercises: the surfaces `ship` drives — implementer briefing, control-plane action, the trampoline halt, skill routing, evidence locators, tier read scope, cited cap resolution.
3. What it does not: no cases exercise the spec path (`skills/spec`, `review-artifacts`, `review-code`, `explore`, `bootstrap`); it is advisory and gates nothing; the unit suite remains the regression net for policy.

Three constraints on the wording, each from a rule the repo already holds:

- **No count of cases.** A case count is the same failure this change exists to end, one directory over. The text names surfaces, not totals.
- **No threshold value.** `CLAUDE.md`: thresholds live in the CLI. Where a cost ceiling is relevant, the text says a ceiling exists and names `interlock limits` as the place to read it. It never prints one.
- **True on the day it is written.** The suite has not been run against a model as of 2026-09-03. The text may say so, hedged to the date, because a reader who assumes there are scores would misread everything else on the page.

**Which of these gets pinned, and which does not.** Pin the durable facts: that the text names `evals/`, and that it names the spec-path gap. Do *not* pin the transient status ("has not yet been run"), because that sentence is expected to change the first time slice E1 runs the suite, and a pin on it would turn a correct docs update into a test edit under a stage guard. Pinning scope and leaving status unpinned is the split that keeps the assertion honest without making it a tripwire on someone else's slice.

**Alternative considered and rejected: pinning the status too**, on the grounds that it forces the docs update when the fact changes. Rejected because `hooks/guard-tests.mjs` denies test edits during `remediation` and `fix-tests` stages, and a run that first executes the eval suite would hit exactly that.

### D4 — The fourth site the review does not name

R19 names three sites: `README.md`, `docs/10` §2, `docs/06` §3. A grep finds **four**: `docs/06-why-it-works.md` line 396 (§14, "What this costs, honestly") also says "760 tests". R19's acceptance criterion is *no stale count survives a grep*, which the three-site reading would fail. The fourth site is therefore in scope. It is one sentence and does not expand the change.

Two related numbers were checked and are **not** in scope: `.docs/EVALS-REVIEW-2026-09-03.md` is a dated review document, not published documentation, and `openspec/changes/archive/**/baseline.md` is an archived artifact. Neither is a live claim.

## Risks / Trade-offs

- **The negative regex fires on an innocent sentence** → scope it to the three files and to a narrow vocabulary window, and give it a message that names the file and the matched text so a false positive is diagnosed in seconds rather than worked around.
- **The regex is too narrow and misses a reintroduced count in a new phrasing** → accepted. A pin that catches the drift shape actually observed twice in this repo is worth more than one that tries to catch every phrasing and fires on prose. `CLAUDE.md`: assert tokens, not sentences.
- **`docs/10`'s eval coverage list goes stale when slice E1 or E2 authors a spec-path case** → that is the intended coupling and it is pinned, so the suite goes red and the docs get updated in the same change that closes the gap. This is the opposite of the failure being fixed.
- **The zero-dependency assertion blocks a future dependency** → it does not block it; it makes adding one require deleting the documented claim in the same commit. `CLAUDE.md` already says a dependency is a design decision belonging in a change's `design.md`, so a red test at that moment is correct.

## Open Questions

None. The one genuinely open number — whether `npm test` still collects 1330 — does not matter to any decision here, because every site loses its number regardless of what the current count is.
