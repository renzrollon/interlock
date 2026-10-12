## Why

The merge-confidence epic computes a verdict, and nothing delivers it: no command turns a platform's checks into the pipeline input, the `mr` skill still asks a model to write a confidence level, and `docs/15` says the labels and recipes "are not here yet". This is brief E3, the last one. An audit of the four epic commits (two of them never code-reviewed) also found places where the verdict, or the review gate under it, reads clean on evidence that is malformed, missing, or about a different diff. A label is only worth applying if the verdict behind it fails closed, so the delivery and the hardening land together and close the epic.

## What Changes

**Deliver the verdict (brief E3)**

- New `interlock pipeline` (`lib/pipeline.mjs`, pure): turns the platform's own output (`gh pr view --json`, `glab mr view` and `glab ci get --output json`) into the pipeline file `merge-confidence --pipeline` reads. The state tables are code, so no model transcribes a check's state, and on GitLab no one types the head commit: it travels between the two steps in a file. A state the table does not know reads `pending`. A check the caller excludes by name is recorded in the file and named in the verdict. A refused document removes any earlier file at the output path.
- `interlock merge-confidence` names the commit and the base it assessed, prints the two labels for its verdict and score, and with `--markdown` prints the description block, with every name it quotes rendered as inert text.
- `skills/mr/SKILL.md` fetches the head's checks, runs the command (with the run's evidence file when one exists), pastes the block as `## Merge confidence`, and applies one verdict label and one score label after removing their predecessors, and only when the platform's head is still the commit that was assessed. New flags `--confidence-comment` and `--gate-check <name>`. The sentence asking the model for an honest confidence level is removed; `## High Risk Changes` becomes narrative under the CLI's verdict.
- `docs/15-merge-confidence.md` gains the signal and flag tables (pinned to the registry by a test), the labels, the pipeline file, three platform recipes and the CI job, each recipe saying who merges, which step clears the labels on new commits, and whether it was exercised or written from the platform's documentation.

**Harden what the verdict and the review gate read (audit findings, each reproduced)**

- A pipeline file with a misspelt or misshapen `checks` reads "the platform reports no checks", green, and a failed required check behind it reads `MERGE`. It becomes an input error (exit 1), and `unobserved` inside the module.
- A run's evidence file is accepted for any diff that ends at the commit the run made, so a review of the last commit can read green for a five-commit pull request. Given a base, it is accepted only when that base is the one the run reviewed from.
- An empty run record, or one whose prompt and denial counts were never observed, reads "no degradation". An observation the record does not carry is `unobserved`.
- **BREAKING** A findings input with no findings list in it reads as zero findings, for five readers. `interlock gate` handed the object `interlock review --json` prints passes over surviving blockers; `interlock remediate` says there is nothing to fix; `interlock ready`, which may skip the human checkpoint, counts zero blockers; a ship run whose review step left no findings file adjudicates a clean review, from an earlier run's file if one is lying there; and a remediation round that leaves no list clears the blockers it was asked to fix. The gate now reads the record's surviving findings; `gate`, `review` and `remediate` exit 1; `ready` reads the review as not run; a run removes the work files before its review, records a review with no list as not completed, and in a remediation round keeps the last surviving findings, halting if it cannot read those either.
- A glob-shaped item in `## Always Human Review` (`- src/**`) is read as a literal path that matches nothing, so the listed paths read green. It is a reported problem, which the signal already reads amber.
- A living-requirement list the size bound cut to nothing reads green with no flag, against the earlier change's own requirement. It carries `requirements-omitted`.
- A changed source file the coverage report never saw passes unremarked. The coverage input names such files, and the signal carries a new flag, `unmeasured-source`, which lowers the score and moves no band.
- A size cut of the domain reviewer's text raises no run banner, though `docs/04` says it does. It raises `DOMAIN REVIEW PARTIAL`.

**Close the epic**

- The living specs name the four source files the epic added that no spec names today (`lib/coverage.mjs`, `lib/merge-confidence.mjs`, `lib/spec-audit.mjs`, `lib/spec-text.mjs`), so that, with the earlier change archived, the epic passes the spec-coverage rule it introduced.
- Statements the epic made false are corrected: "up to six" dimensions (`README.md`, `shared/SESSION-SHAPES.md`), the `--run` example that reads `HUMAN` without `--base`, the spec-audit output `docs/15` describes, the missing `docs/14` row, a shipped file linking to a doc the package does not ship. `CHANGELOG.md` gains a "Changed" section for what a user who never runs `merge-confidence` sees differently. The brief's status line is updated.

**Not in this change**: what `risk.class` reads at merge (decisions ledger, D1, owner's call); a hand review's evidence reaching the `mr` skill; a review run in CI; how the size bound is shared between capabilities; the stray dot-directory `interlock changes` lists.

## Capabilities

### New Capabilities

- `review/pipeline-evidence`: producing the pipeline input from a platform's own check output, by code: state tables for GitHub and GitLab, the commit the checks belong to, required checks, named exclusions, and what happens to an earlier file when a document is refused.
- `review/merge-request-delivery`: how the `mr` skill obtains the verdict, writes it into the description, labels the merge request and keeps a label from outliving the commit it was computed for; what the delivery documentation must say.

### Modified Capabilities

- `review/merge-confidence`: the pipeline-signal requirement is modified (a well-formed input, an explicit empty list, named exclusions). Added: the diff a run's evidence covers, unobserved run observations, the `unmeasured-source` flag, the commit, base and labels in the output, the description block, the documented signal and flag tables, and how a root-level file is named.
- `review/evidence-gate`: added: every command that reads a findings input refuses one that carries no findings list, and the gate reads a review record's surviving findings; a ship run adjudicates only findings this review wrote, and a missing list never clears a blocker.
- `review/policy-file`: added: a glob-shaped item in an enforced path list is a reported problem, never a path.
- `review/domain-review`: added: a size cut of the reviewer's text is spoken at run level.
- `verify`: the coverage-input requirement is modified to name changed source files the report does not list.
- `spec/spec-audit`: added: which of the audit's two outputs carries the per-capability measures, as built.

## Impact

- **New**: `lib/pipeline.mjs`, `test/spine/pipeline.test.mjs`, `test/spine/merge-delivery.test.mjs`, `test/fixtures/pipeline/`.
- **Changed code**: `bin/interlock` (`pipeline`; two accumulating flags in the argument parser; `merge-confidence --markdown`, the run-evidence base condition, pipeline input validation; `gate`, `review` and `remediate`; `verify coverage`), `lib/merge-confidence.mjs`, `lib/merge-evidence.mjs`, `lib/findings.mjs`, `lib/ready.mjs`, `lib/review-core.mjs`, `lib/coverage.mjs`, `lib/run.mjs` (the review step's work files, the adjudication at both of its call sites, one banner), `lib/prompts/review.mjs` and `lib/prompts/remediate.mjs` (one sentence each).
- **Changed prose**: `skills/mr/SKILL.md`, `docs/15`, `docs/07`, `docs/04`, `docs/12`, `docs/14`, `README.md`, `shared/SESSION-SHAPES.md`, `shared/TEST-PROFILE.md`, `CHANGELOG.md`, `briefs/merge-confidence-gate-epic.md`.
- **For existing users**:
  - `gate`, `review` and `remediate` exit 1 on an input with no findings list where they passed before.
  - A strict run whose review step writes no findings file reads that review as not completed, where it read clean; the review briefing now asks for an empty list. A remediation round that leaves no list no longer clears blockers, so such a run halts at its verdict where it committed.
  - Strict runs whose domain text is cut by the bound gain a `DOMAIN REVIEW PARTIAL` line in the close summary.
  - A `*` or `?` item in `REVIEW.md` is reported as a problem wherever policy problems are reported, and reads `policy.humanPaths` amber at the merge verdict when it sits in the always-human-review section.
  - `merge-confidence --run` under `--base` takes nothing from an evidence file whose run started somewhere other than the merge base. A run on a host with no recorder reads `run.integrity` unobserved where it read green. Neither could reach `MERGE` at a close before.
  - `verify coverage --json` gains two fields; `merge-confidence --json` gains `head`, `base` and `labels`; the published flag list gains `unmeasured-source`, which can lower a score.
  - A hand-written pipeline file that was tolerated is refused with the reason.
  - The `mr` skill now creates and applies labels on the platform, an outward action it did not take before; it remains invocable only by a person.
- **No new dependency.** No threshold is added or moved.
- **Order**: `complete-and-record-the-merge-verdict` is complete and unarchived. This change's code does not depend on it. Archive it first: the spec-coverage goal above holds only once its specs are living, and both changes add to `review/merge-confidence`.
