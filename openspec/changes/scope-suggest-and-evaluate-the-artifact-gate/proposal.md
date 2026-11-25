# Proposal

## Why

`brief-and-record-the-artifact-gate` gave the artifact gate a CLI-built brief and a record of who read the change at what depth. Five gaps from the 2026-11-25 revisit are still open (`.docs/REVIEW-ARTIFACTS-REVISIT-2026-11-25.md` §9.4, items 3–6). That report is local and gitignored, so the figures used here are restated in `design.md`.

- **G4.** A `--since` re-gate cannot scope an uncommitted change. Every change is uncommitted at gate time, so it reads everything.
- **No feedback path.** Nothing turns the gate's own evidence into `REVIEW.md` lines.
- **G5.** No eval measures whether the gate finds what it should.
- **No wording check.** No code checks requirement wording.
- **Uncheckable blockers.** A blocker may cite nothing a person can check.

The owner asked for all of these as one change, with their dependencies noted.

## What Changes

- **A re-gate scoped to a snapshot (R4).**
  - When the gate is given `--stage artifacts` and `--metrics <change>`, it writes a copy of the change's artifact files beside the findings file, in `.claude/metrics/snapshots/`.
  - `interlock review brief --artifacts <change> --since <findings file>` diffs the change against that snapshot. It prints the changed hunks with line numbers, and a rework share (changed lines over total). When the share is over a bound that `interlock limits` publishes, it says a full gate is the owner's call. It never runs one itself.
  - With no snapshot (an older findings file, or a failed write), the brief says so and the re-gate rules fall back to today's git scoping.
- **The record names its findings file.** The review-metrics record gains `findings`, the repository-relative path of the findings file the gate read. This gives an exact join between a record's reader and the findings' severities, which the suggestions below need.
- **`interlock review-policy suggest` (§9.2 "When").** A read-only command that lists candidate `REVIEW.md` lines, each with its evidence, from four triggers:
  - **T1 escapes:** compound-note rows for one file from several changes.
  - **T2 overturned passes:** a gate that passed, followed by a blocking gate from a different reader.
  - **T3 recurring blocker classes:** the same `check` tag on blockers in several changes.
  - **T4 owner rulings:** ledger rows in archived changes resolved by a human decision.

  It also lists `stale` Artifact Checks, which raised nothing over many gates. Evidence counts only since `REVIEW.md` last changed at HEAD; `--all` widens that. `--summary` prints the one line `REVIEW.md candidates: <n> — interlock review-policy suggest`, or nothing when there is nothing to suggest. The spec skill's hand-off and the settle skill's close both print it. The owner still writes `REVIEW.md`, and the command writes nothing.
- **Gate evals seeded from the corpus (R6).** Three model-in-the-loop cases, the first to cover `review-artifacts`:
  - a recall case on `add-merge-confidence-gate` as commit `4966355` holds it, the one corpus change whose pre-fix artifacts are in git;
  - a seeded-defect recall case for a harness hazard;
  - a clean-change case that must raise no blocker for an incomplete test-pin list.

  All three use deterministic graders. Their pass^k comes from the existing `evals promote`.
- **A requirement-wording lint (R8).**
  - `interlock validate --json` gains `wording`: each phrase from a word list in code (`properly`, `as appropriate`, `if possible`, `and/or`, `but not limited to`, `eventually`, `etc.`), found in a delta spec's requirement or scenario text outside code spans and quotations.
  - It never changes `ready`. The spec skill prints its lines before the gate.
  - The owner's precondition, running the word list over the corpus first, was met during exploration: one hit in 427 spec files, a quoted mention, which the code-span rule excludes.
- **A blocker cites its passage (R9).**
  - In an artifact findings file, a blocker with neither a positive `line` nor a non-empty `passage` is reported under `malformed`. It still holds the gate and still counts toward `autonomyOutcome.blockers`, and continuation readiness names the missing citation when it refuses.
  - The brief's emit shape and the skill's emit contract name the optional `passage`.
  - Code-review findings are unaffected. The open brief `put-a-failure-scenario-on-every-finding` owns those.

### Dependencies

| Part | Depends on | Kind |
|---|---|---|
| everything | `brief-and-record-the-artifact-gate` (committed `fe07cea`, not archived) | Archive it first. This change ADDS requirements to one capability that change extended, `review/metrics-emission`, and cites its brief, its `check` tag and its record fields |
| `review-policy suggest` T2, T3, stale | the record's `findings` field (this change) and its `reviewer`, `depth` and `check` (the change above) | Task order (`dependsOn`) |
| checkpoint and settle lines | `review-policy suggest --summary` | Task order |
| R6 recall cases | none for the three seeded now. Turning later blockers into cases needs R4's snapshots, which this change starts writing | Follow-up |
| R8 | the corpus run (done; `design.md` §5) | Precondition, met |
| R9 | none in code. It shares `lib/findings.mjs` with the open `put-a-failure-scenario-on-every-finding` brief, so whichever lands second rebases | Sequencing |

## Capabilities

### New Capabilities

- `spec/artifact-re-gate`: the snapshot the gate writes of the artifacts it judged, and the `--since` scope, rework share and fallback the brief derives from it.
- `review/policy-suggestions`: `interlock review-policy suggest`, its four triggers, the stale list, the evidence window, and the one-line summary the spec and settle skills print.
- `spec/requirement-wording`: the wording lint on `interlock validate`, and the spec skill printing its lines.

### Modified Capabilities

- `review/metrics-emission`: adds that the record names the findings file the gate read.
- `review/evidence-gate`: adds that an artifact blocker cites a line or a passage, or is rejected as malformed.
- `evals/case-suite`: adds the artifact-gate cases.

## Impact

- **Code:**
  - new: `lib/line-diff.mjs`, `lib/artifact-snapshot.mjs`, `lib/review-policy-suggest.mjs` (pure), `lib/review-policy-cli.mjs` (I/O), `lib/requirement-wording.mjs`;
  - changed: `lib/findings.mjs`, `lib/metrics.mjs`, `lib/review-cli.mjs`, `lib/prompts/artifact-review.mjs`, `lib/artifacts.mjs`, `lib/limits.mjs`, `lib/cli-flags.mjs`, `lib/ready.mjs`, `lib/prompts/index.mjs`;
  - `cli/interlock` gets dispatch and usage lines only, because it has about 2.4 KB of headroom.
- **Tests:** the new test files of tasks §1, and the pin updates its table names: `test/spine/metrics.test.mjs`, `cli.test.mjs`, `cli-inventory.test.mjs`, `spec-meter.test.mjs`, `test/evals.test.mjs` and `test/skills.test.mjs`.
- **Skills and prose:** `skills/review-artifacts/SKILL.md` and `re-gate.md`, `skills/spec/SKILL.md` (§4 and §6), `skills/settle/SKILL.md` (§11).
- **Evals:** three new case directories under `evals/`.
- **Docs:** `docs/07`, `10`, `12`, `14`, `16` and `CHANGELOG.md`.
- **Cost:** the three cases add metered trials to a full eval job whose cost ceiling is already tight. They run only when started by hand with a credential, and no ceiling changes here.
- **Not in this change:** a command that captures a case from a snapshot and its findings; checking that a cited `passage` really appears in its file; code-review findings (R9 for code); and any lens or rubric text.
