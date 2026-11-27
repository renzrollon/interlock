# Settle summary — answer-the-design-critique

- Branch: `feat/answer-the-design-critique`
- Pull request: #48 (https://github.com/renzrollon/interlock/pull/48), base `main`
- Head assessed: `169bdf5bf48a5e9d519b69a23f38ee48307fb95e`
- Commit message: `feat(cli): name the next action at a halt, a typo and the install`
- PR title: `feat(cli): name the next action at a halt, a typo and the install`

## Description

## Summary
Change: `answer-the-design-critique` (openspec/changes/answer-the-design-critique/proposal.md)
- **Why:** the 2026-11-26 design critique scored the README, the Pages site and the terminal 24 to 25 out of 40. They share one failure: at the moments a person most needs the next action (after a halt, after a typo, during the install), the surface does not give it.
- **Terminal:** bare `interlock` prints a grouped index of about 25 lines instead of 1,125, and an unknown command names the closest one. `interlock changes` skips dot-directories such as a stray `openspec/changes/.claude/`.
- **After a halt:** a commit denied by a left-over stage marker, a halted summary and the unreachable-close fallback now each tell a person how to recover. They keep that apart from what they tell an agent inside a live run.
- **README and site:** the install steps follow the order a person runs them. The site's Run tab has no blank terminal lines, and the state machine follows the lit node. A tab click now brings its panel into view. The branch also carries the clarify pass for the README and site copy (`d55c405`: `DESIGN.md`, `PRODUCT.md`) and a note on the changes since 1.18.0 (`e7a50b9`).

## Merge confidence

**HUMAN** · score 61 (amber range 40–79; 9 of 17 gating signals clean)
_`MERGE` means every local signal is green. It does not say the platform’s branch rules would let this pull request merge: required checks, required approvals, code owners, a draft state, unresolved review threads and a merge queue are not read here._

Assessed commit `169bdf5bf48a5e9d519b69a23f38ee48307fb95e` against `origin/main` (merge base `ac7deed62177191c569f31e561bb4c5c23240b36`).

**Needs a fix**

- `spec.coverage` (amber): `1 added source file(s) no spec names: lib/help-cli.mjs`

**Needs a person**

- `diff.shape` (amber): `671 source line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400`

**Needs more evidence**

- `review.ran` (amber): `dimension(s) with unread inputs: language, technical-lead, regression, security, domain, blast-radius`
- `run.integrity` (unobserved): `no run record: this assessment was not made by a ship run, which writes one at close`

**Flags:** `review.ran` domain-partial, `verify.suite` no-typecheck, `verify.suite` no-lint, `verify.suite` no-build, `verify.e2e` no-e2e, `verify.coverage` no-coverage, `conformance.living` requirements-omitted

**Labels:** `interlock/human-review`, `interlock/score-61`

<details>
<summary>All 18 signals</summary>

| Signal | Band | Flags | Reason and evidence |
| --- | --- | --- | --- |
| `review.blockers` | green |  | `no surviving blocker among 5 surviving finding(s); its proof of coverage does not hold`<br>`5 surviving finding(s): no blocker, no unrecognised severity` |
| `review.warnings` | green |  | `0 surviving warning(s), at or under MERGE_BANDS.maxWarningsForMerge = 2; its proof of coverage does not hold`<br>`no surviving warning` |
| `review.ran` | amber | domain-partial | `dimension(s) with unread inputs: language, technical-lead, regression, security, domain, blast-radius`<br>`selected: language, technical-lead, regression, security, domain, blast-radius`<br>`ran: language, technical-lead, regression, security, domain, blast-radius`<br>`depth: lean`<br>`domain review ran on a degraded input: 249 requirement(s) were left out of the domain reviewer's text by the size bound (LIMITS.maxDomainSpecChars); 20 capabilities were left with no requirement in the text`<br>`unread: language: the full test suite (npm test) and the new test files (not run in this review, and the test file bodies were not read line by line; only the CLI was exercised by hand); the site and doc prose and the openspec change artif…`<br>`unread: technical-lead: The site/*.dc.html, site.css, DESIGN-PROMPT.md, DESIGN.md, PRODUCT.md and README.md edits, and the cli/arguments, change-resolution and close-summary delta specs in full (These are design and copy edits, and their o…`<br>`unread: regression: test/hooks.test.mjs 2536-2730, test/spine/cli.test.mjs, test/spine/run.test.mjs and test/mod/meter.test.ts. I did not run these. I also did not read the site/*.dc.html, DESIGN-PROMPT and DESIGN.md/PRODUCT.md prose line …`<br>`unread: security: spec, doc, site and test files (openspec/changes/answer-the-design-critique/*, site/*, docs, DESIGN.md, PRODUCT.md, test/*) (prose, design and test material with no attacker-reachable code path; the security review was sp…`<br>`unread: domain: Living requirements for the capabilities whose text was cut or shown by heading only (hooks/tool-guards, cli/arguments, ship/close-summary, hooks/stage-guard, hooks/launch-guard and others) (The brief quoted only the headin…`<br>`unread: blast-radius: Whether 'interlock --help --all' returns the full text through helpFor with an undefined subcommand (I did not run the CLI. This is correctness inside the changed hunks, which another dimension owns.); Site pages, doc…` |
| `review.adversarial` | green |  | `every surviving blocker and warning has at least MERGE_BANDS.minVerdictsPerFinding = 2, no refutation was refused, and the quality band removed no blocker`<br>`refused refutations: 0` |
| `risk.class` | green |  | `class medium is within MERGE_ALLOWED_CLASSES (low, medium)`<br>`class medium`<br>`unmatched-source-change: 16 non-docs path(s) with no matching risk rule: .impeccable/design.json; cli/interlock; cli/interlock-run (+13 more)` |
| `verify.suite` | green | no-typecheck, no-lint, no-build | `typecheck skipped: the profile names no type-check command (no-detectable-command); unit: unit suite is green; lint skipped: the profile names no lint command (no-detectable-command); build skipped: the profile names no build command (no-d…`<br>`typecheck skipped: the profile names no type-check command (no-detectable-command)`<br>`unit: unit suite is green`<br>`lint skipped: the profile names no lint command (no-detectable-command)`<br>`build skipped: the profile names no build command (no-detectable-command)` |
| `verify.e2e` | green | no-e2e | `no end-to-end suite is enabled or requested here (e2e-not-requested)`<br>`e2e skipped: e2e-not-requested` |
| `verify.coverage` | green | no-coverage | `coverage is not configured in this repository (the final verification verdict skipped it as coverage-not-configured)` |
| `ci.pipeline` | green |  | `12 check(s) passed or were skipped on the head commit`<br>`test (18): pass (required)`<br>`Smoke evals (pull request): pass`<br>`test (20): pass (required)`<br>`test (22): pass (required)`<br>`test (24): pass`<br>`Full eval suite (manual): skipped`<br>`test (release npm): pass`<br>`validate-plugin (latest): pass`<br>`validate-plugin (floor): pass`<br>`upgrade-install: pass`<br>`Outcome eval prepare (model-free): pass (required)`<br>`validate-plugin: pass (required)` |
| `conformance.delta` | green |  | `33 of 33 scenario(s) checked, none unconfirmed`<br>`33 of 33 scenario(s) checked (the command counted 33); 0 unconfirmed` |
| `conformance.living` | green | requirements-omitted | `2 of 2 living requirement(s) checked, none unconfirmed`<br>`2 of 2 living requirement(s) checked (the command counted 2); 0 unconfirmed`<br>`2 requirement(s) asked and 249 left out by the size bound`<br>`left out: hooks/ship-meter: The meter SHALL read the run from the CLI's own step records, never from prose`<br>`left out: hooks/ship-meter: Per-agent figures SHALL be display-only, labelled live, and never invented`<br>`left out: hooks/ship-meter: The pane SHALL draw on both surfaces and name the record it is not`<br>`left out: hooks/ship-meter: The hooks module SHALL observe only, and the guarantee SHALL be pinned statically`<br>`left out: hooks/ship-meter: The mod's tests SHALL run under 'claude plugin test' and SHALL never be collected by 'npm test'`<br>`left out: hooks/ship-meter: The meter SHALL say how long a live run has been quiet, from a published cap`<br>`left out: hooks/ship-meter: The meter SHALL say when a run agent's turn ends without an answer, in the host's own word`<br>`left out: hooks/ship-meter: The meter SHALL speak the guards' refusals in the guards' own words`<br>`left out: hooks/ship-meter: The module SHALL draw the session start's report from the preflight file, and decide nothing from it`<br>`left out: hooks/ship-meter: The module SHALL show a halt resume card on request, verbatim and bounded by a published cap`<br>`left out: hooks/ship-meter: The classic session-start hook SHALL return the forward call itself, and the shape SHALL be pinned statically`<br>`left out: hooks/ship-meter: A pane control SHALL draft a line the pane printed, and SHALL never submit it or replace a typed draft`<br>`left out: hooks/ship-meter: The meter pane SHALL draw the plan as a diagram above the board where the surface draws SVG, and SHALL keep the board on every surface`<br>`left out: hooks/ship-meter: The module SHALL tell a halt, a close, a quiet run and a checkpoint one time each, and SHALL toast the same words when no notification was sent`<br>`left out: hooks/ship-meter: The module SHALL suggest open change names and recent run ids for the plugin's own commands, and SHALL leave every other draft to the engine`<br>`left out: hooks/ship-meter: Below the mods floor a loaded module SHALL draw, tell and suggest nothing, SHALL say so one time, and SHALL keep the launch guard`<br>`left out: hooks/ship-meter: The hooks module SHALL use the capability object only in plain shapes, and the rule SHALL be pinned statically`<br>`left out: hooks/ship-meter: Every hooked event SHALL be documented, and one the directory has not accepted SHALL carry a recorded engine floor`<br>`left out: review/merge-confidence: The verdict SHALL be the worst band over every gating signal`<br>`left out: review/merge-confidence: A flag SHALL lower the score and SHALL NOT move a band`<br>`left out: review/merge-confidence: The score SHALL be bounded by the worst band and ordered by clean signals`<br>`left out: review/merge-confidence: A missing result SHALL be unobserved; a missing tool SHALL be a flag; a missing unit suite SHALL never be a flag`<br>`left out: review/merge-confidence: The risk signal SHALL be computed over the touched paths and SHALL never be red`<br>`226 more evidence line(s) left out of this row; --json carries them all` |
| `spec.coverage` | amber |  | `1 added source file(s) no spec names: lib/help-cli.mjs`<br>`added, named by no spec: lib/help-cli.mjs`<br>`49 of 189 tracked coverable source file(s) are named by a spec` |
| `diff.shape` | amber |  | `671 source line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400`<br>`source: 671 changed line(s) in 16 file(s), counted toward the caps`<br>`test: 577 changed line(s) in 10 file(s), not counted toward the caps`<br>`prose: 1982 changed line(s) in 19 file(s), not counted toward the caps`<br>`total: 3230 changed line(s) (added plus deleted), 45 changed file(s)` |
| `decisions.open` | green |  | `20 ledger row(s), none needing a person and none invalid`<br>`agent_resolved D1`<br>`agent_resolved D2`<br>`agent_resolved D3`<br>`agent_resolved D4`<br>`agent_resolved D5`<br>`agent_resolved D6`<br>`agent_resolved D7`<br>`agent_resolved D8`<br>`agent_resolved D9`<br>`agent_resolved D10`<br>`agent_resolved D11`<br>`agent_resolved D12`<br>`agent_resolved D13`<br>`agent_resolved D14`<br>`agent_resolved D15`<br>`agent_resolved D16`<br>`agent_resolved D17`<br>`agent_resolved D18`<br>`agent_resolved D19`<br>`agent_resolved D20` |
| `run.integrity` | unobserved |  | `no run record: this assessment was not made by a ship run, which writes one at close` |
| `drift.stale` | green |  | `no living spec cites a file this change removed, and no other unarchived change shares its capabilities`<br>`0 broken citation(s) repo-wide, none of a file this change touched`<br>`1 unarchived change(s), none on this change's capabilities` |
| `policy.humanPaths` | green |  | `no changed path falls under the 1 always-human-review path(s) listed at origin/main`<br>`always-human-review paths read from origin/main: .github/workflows`<br>`45 changed path(s), none under a listed path` |
| `plan.fidelity` | info |  | `no run record`<br>`no run record: plan fidelity is reported from a ship run, and this assessment has none` |

</details>

## Changes
- **cli/arguments**: bare `interlock` and `interlock help` print an index. `help <cmd>` prints what `<cmd> --help` prints, and `--help --all` prints the full usage. An unknown command keeps its first line and exit 1, then suggests the closest name.
  - `cli/interlock`, `lib/help-cli.mjs` (new), `lib/cli-flags.mjs`, `docs/07-cli-and-configuration.md`, `test/spine/cli.test.mjs`, `test/spine/suggest-command.test.mjs` (new)
- **cli/change-resolution**: no directory whose name starts with a dot is listed or picked as a change.
  - `lib/artifacts.mjs`, `test/spine/artifacts.test.mjs`, `docs/07-cli-and-configuration.md`
- **hooks/tool-guards**: the `guard-commit` denial names the marker's real path and the validated change. It names the run id only when `run.json` is usable and matches. It tells an in-run agent not to commit or close, then tells a person how to recover: `interlock run close --halt` or removing the marker by hand.
  - `hooks/guard-commit.mjs`, `lib/ship-stage.mjs`, `test/hooks.test.mjs`, `test/spine/ship-stage.test.mjs`, `test/mod/meter.test.ts`, `docs/13-the-guards.md`
- **ship/close-summary**: a halted summary from a usable manifest says when no commit is on record and lists the pick-up steps (`--ids` stays a placeholder). Both drivers print one fallback sentence when the close cannot be reached, and `interlock-run` adds a `cwd:` row.
  - `lib/receipt.mjs`, `workflows/ship.js`, `cli/interlock-run`, `test/spine/receipt.test.mjs`, `test/spine/run.test.mjs`, `test/spine/close-fallback.test.mjs` (new), `docs/04-when-it-stops.md`
- **README and site** (no spec capability): the README install order changes. On the Run tab, the stepper loses its blank lines, the state machine scrolls to the lit node, and optional states use tokens instead of 30% opacity. A tab click or tab hash reveals its panel. Every page-only fix is listed under `site/README.md` "Local patches" and pinned by a test.
  - `README.md`, `site/*`, `DESIGN.md`, `PRODUCT.md`, `.impeccable/design.json`, `test/site-patches.test.mjs` (new)
- **Docs**: `CHANGELOG.md` `[Unreleased]`, `docs/notes/2026-11-26-whats-new-since-1.18.0.md`

## Must Not Change
- Exit codes and the `Unknown command: <x>` first line, which `doctor` and the spec skill key on. Checked by `test/spine/cli.test.mjs` (stderr starts `Unknown command: `) and `test/spine/doctor.test.mjs:2119`.
- `interlock --help` and `-h` still print the full usage that about 30 assertions, the postinstall smoke check and CI read. Checked by `test/spine/cli.test.mjs:201` and the `--all` test beside it.
- The closing line `Do not start another ship run unless the user asks.` stays last and verbatim, and the resume card is unchanged. Checked by `test/spine/receipt.test.mjs` (`CLOSING`, the closing-line index check).
- `guard-commit`'s decision rests on the stage marker alone. A manifest it cannot read changes only the text. Checked by `test/hooks.test.mjs` (unparseable and foreign-schema `run.json` cases still deny).
- The ship meter's hooks module and the settings hooks are unchanged: `hooks/mod.mjs` is not in the diff. Only the mirrored deny sentence in `test/mod/meter.test.ts` moves (living requirement `hooks/ship-meter`, read of the diff).

## High Risk Changes
- **`guard-commit` imports `lib/run.mjs` lazily on the deny path.** A throw there must not turn a deny into an allow. Mitigation: the import sits in its own try/catch, which reads a throw as "no usable manifest" and still denies with the hand-removal text.
- **The site has no browser test, so a JS slip in `site/index.html` shows only in a browser, and `pages.yml` publishes `site/**` on the push to `main`.** Mitigation: `test/site-patches.test.mjs` pins that each patch is present, and a person runs the manual site checks below before merging.
- **A script that read bare `interlock` output as the full usage now gets the index.** Mitigation: `--help` is unchanged. Only the one test that pinned bare = `--help` was split.
- **Edit-distance suggestions can be wrong.** Mitigation: the suggestion only adds a line after the unchanged refusal, which still exits 1.

## Prerequisites to Production
Before merging: serve `site/` (`python3 -m http.server -d site`) and run the checks in `tasks.md` "Workflow follow-up": 1440 and 390 px in light and dark, Step to 14/14 with and without `--strict`, a halt-row click, a cold `#limits`, the `#install` link, back to the hashless URL, reduced motion.
Before deploying: none. The merge to `main` deploys `site/` to Pages through `pages.yml`, and the plugin ships with the next version bump.

## How to Roll Back
Undo: revert the merge commit. `pages.yml` then republishes the previous `site/`.
Not undone by a revert: nothing persistent. No data, migration or on-disk format changes. Stage markers, run manifests and receipts keep their schema.
Order: no order.

## Testing
- Ran: unit `npm test` exit 0, 5858 tests: 5853 passed, 0 failed, 5 skipped
- Not run: typecheck, lint, build, coverage, e2e
- Proof: the latest `Validation — 169bdf5bf48a5e9d519b69a23f38ee48307fb95e` comment on this pull request
