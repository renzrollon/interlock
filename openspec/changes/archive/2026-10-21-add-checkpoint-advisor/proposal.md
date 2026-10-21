## Why

The spec flow ends at a human checkpoint, and the checkpoint is the cheapest place to catch a wrong idea. Today the human arrives with three artifacts, a decision ledger and an artifact review, but nothing has read the whole change *as the person about to review it would*: what product question is still open that no file names, which task is the kind of task docs/02 warns about, and what a previous ship on these same files taught. The archived ledgers show the cost: six archived changes still carry an open `needs_human` row, and several more carry a row flipped by a `human decision` the agent could have asked for at the checkpoint instead of during the ship.

Three smaller gaps surround that one. The spec meter's pane cannot show what the human is waiting on, because nothing prints it as a CLI line it may key on. Nothing measures whether a checkpoint consult would be useful, so a consult added on taste would stay on taste; `docs/notes/2026-10-14-claude-code-opportunities.md` names ten labelled archived changes as the test and sets a kill criterion. And the surprises a review finds about a repository's own invariants (a sibling reader missed, a convention the spec never stated) die with the findings file; the next spec on the same files starts from zero. One shared value already diverges around that corpus: judged grader types are spelled three ways in `lib/evals-triage.mjs`, `lib/evals-calibrate.mjs` and `test/evals.test.mjs`, and triage never joins a case's grader types onto its trials, so the suite's first `llm` grader would be classed as a deterministic regression.

## What Changes

- **A checkpoint advisor.** After a clean artifact review and after `decisions.md` exists, `skills/spec/SKILL.md` runs one stronger-model, read-only consult through the Agent tool on a new plugin agent, `interlock:advisor`, bracketed by two model-free CLI steps. `interlock advisor <change> --brief` assembles a bounded brief from the change folder, the review's findings and matched compound notes; `interlock advisor <change> --check <draft>` validates the model's JSON draft against caps and a closed enum, cites every question to a heading that exists, and renders `openspec/changes/<change>/advisor.md`. The advisor never writes `decisions.md`; `interlock ready`, `interlock ledger` and `interlock validate` do not read `advisor.md`; a consult that fails is written down as one that did not run, and the spec continues to the checkpoint.
- **A measured kill criterion.** `interlock advisor --verdict --labels <evals dir>` tallies the human calibration labels of the Spec Range cases against caps in `lib/limits.mjs` and prints `KEEP`, `KILL` or `INSUFFICIENT LABELS`, always exiting 0.
- **Spec Range: ten eval cases.** One case per archived change whose ledger carried a question a human had to answer. Each case seeds a frozen copy of that change folder without its ledger, runs the consult, and grades whether the advisor's questions include the one the human actually raised and whether they merely restate what the artifacts already answer. Deterministic graders pin that the consult ran; the two judged graders carry deferrals until the labels exist.
- **The Spec Pane shows what the human is waiting on.** The spec meter learns one more keyed CLI line, `interlock advisor … --json`, and draws the advisor's state, its draft questions by id, and a `waiting on you` line composed from fields the CLI printed. Still observe-only: no file read, no verdict, no new engine call.
- **Compound notes.** A per-repository table at `docs/notes/compound.md`, under a contract in `shared/COMPOUND-NOTES.md`, holding one row per surprise a review found about this repository and the rule it implies. Rows are derived from surviving findings that carry a new optional `specGap: true` field, written by `/interlock:review-code` and by the ship loop's review adjudication (non-fatal, spoken as a banner), retrieved by file path for the advisor brief, and never edited by a machine.
- **One judged-type set.** The judged grader types become a single export swept into triage, calibrate and the eval structural test, and triage joins case-level grader types onto trials by name before classifying a dip.

Out of scope, deliberately: the note's ship-side bets (wave notes, lane repair, CI posture), the apps bet, and any gating on the advisor's output. The Wave Note and the Change Desk stay unbuilt.

## Capabilities

### New Capabilities

- `spec/checkpoint-advisor` — the consult: brief assembly, the agent spawn, draft validation and rendering, the did-not-run path, the verdict tally, and what no gate reads.
- `spec/compound-notes` — the per-repository note table: contract, derivation from `specGap` findings, the two writers, retrieval by path, and the `specGap` finding field.
- `evals/spec-range` — the ten fixture-seeded cases, their graders, their labels and deferrals, and the kill-criterion data they produce.

### Modified Capabilities

- `hooks/spec-meter` — the keyed-lines requirement gains `interlock advisor … --json` and its fields; the pane requirement gains the advisor lines and the `waiting on you` line.
- `spec/machine-readable-gate-lines` — the pinned-lines requirement gains the advisor lines in their place in the order, and their field tokens.
- `evals/triage` — the judged-only-dip requirement states that a trial grader's type is joined from the case's grader list by name, and that an unknown type is treated as deterministic and said so.

## Impact

- **CLI** (`bin/interlock`): two new subcommands, `advisor` and `note`; one new flag, `evals triage --eval-dir`; new rows in `interlock limits`. The file is near the directory's 256 KiB cap, so dispatch stays thin and logic lives in `lib/`.
- **Pure modules** (`lib/`): new `advisor.mjs`, `notes.mjs`, `md-table.mjs` (table helpers lifted from `ledger.mjs`), `evals-types.mjs`, `prompts/advisor.mjs` (registered in `prompts/index.mjs`); edits to `limits.mjs`, `findings.mjs` (optional `specGap`), `review-core.mjs` (one non-blocking anomaly), `prompts/review.mjs` and `prompts/commit.mjs` (the reply shape names `specGap`; the commit brief names the note table when touched), `spec-meter.mjs`, `evals-triage.mjs`, `evals-calibrate.mjs`, `ledger.mjs`, `run.mjs` (one seam in review adjudication, one banner, one manifest field).
- **Skills and agents**: `skills/spec/SKILL.md` gains §5a and the Agent tool in `allowed-tools`; `skills/review-code/SKILL.md` §2 (the reply shape lists `specGap`), §4 (the note-derive line) and the domain and technical-lead dimension briefs (when to set `specGap`) gain their instructions; new `agents/advisor.md`.
- **Evals**: ten new cases under `evals/spec-range-*/` with fixture folders, a scaffold script each, graders and deferral rows; `.github/workflows/evals.yml` full job passes `--scaffold`.
- **Committed state**: `docs/notes/compound.md` is the first plugin-written committed file outside a change folder (ledger D18, pending).
- **Docs**: sections in docs/02 (the advisor at the checkpoint), docs/04 (`COMPOUND NOTES NOT WRITTEN`), docs/07 (the two subcommands, the pane lines), docs/14 (Spec Range).
- **Tests**: new `test/advisor.test.mjs`, `test/advisor-brief.test.mjs`, `test/notes.test.mjs`; additions to the CLI, skills, spec-meter, plugin-agents, evals, triage, calibrate, findings, review-core, artifacts, workflows and prompts suites. No dependency is added.
