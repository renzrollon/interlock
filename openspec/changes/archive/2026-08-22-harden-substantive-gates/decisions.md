# Decisions — harden-substantive-gates

| id | question | class | resolution | evidence |
|----|----------|-------|------------|----------|
| D1 | Which slice of the two reviews' ~40 findings does this change cover? | agent_resolved | The three verified silent defects plus the advertised-vs-actual integrity gaps. Architectural bets, token/doc cleanups and citation corrections are excluded and named. | design.md Goals / Non-Goals; proposal.md §Explicit non-goals |
| D2 | Close the docs-claim-more-than-code gaps by implementing the claim or deleting it? | agent_resolved | Implement. Every gap here is closable by a deterministic shape predicate, which is why implementing is cheap; the audited ledger is also the differentiator the competitive review found no equivalent for. | design.md D5; .docs/WORKFLOW-REVIEW-2026-08-21.md §3.2 |
| D3 | Where does the canonical predicted-path transform live, and how strong is it? | agent_resolved | Export and strengthen the transform that already exists privately at `lib/risk.mjs:128`; apply it once at plan validation in `lib/waves.mjs`. Lexical only — no filesystem resolution, since a predicted path may name a file that does not exist yet. | design.md D1; lib/risk.mjs:128-133 |
| D4 | Fix only the reported collision key, or every raw-form path reader? | agent_resolved | Every reader. The sweep found two further raw-form keys neither review reported — `uniquePaths`' `seen` dedup key and `isDocsOnlyWave` — and fixing one call site while siblings stay raw is how the original bug survives the fix. | design.md D1 invariant sweep table; shared/INVARIANT-SWEEP.md §The rule |
| D5 | How strong is the dismissal-evidence predicate? | agent_resolved | A `path:line` or `path:start-end` shape token whose path is present in the reviewed diff. Not line existence — a review runs against a diff and a valid citation to a deleted line would be falsely rejected. | design.md D2 |
| D6 | Do confirming verdicts also have to cite? | agent_resolved | No. That direction resolves toward a human reading the finding, which is the cheap error; requiring a citation there would drop real findings. | design.md D2 §Direction; specs/review/evidence-gate third requirement |
| D7 | Wire or remove the two caps `interlock limits` prints but nothing enforces? | agent_resolved | Wire `verifySpillBytes` (it governs a real threshold in `lib/spill.mjs`); remove `memoryEntriesPerRun` (no enforcement point exists, so wiring it would mean inventing one). | design.md D7 |
| D8 | Does a test asserting a cap equals a number count as that cap being enforced? | agent_resolved | No. `test/spine/limits.test.mjs:35` pins a value rather than exercising a behavior, and counting it as a reader is what let a dead cap look alive. The cap-authority check excludes value-pinning tests explicitly. | design.md D7; specs/ship/cap-authority third requirement, edge case |
| D9 | How is a ledger reference matched in `design.md` — as a heading or as a token? | agent_resolved | As a token anywhere in the design text. `shared/DECISION-LEDGER.md` does not constrain where a decision is recorded, so a stricter form would invalidate ledgers that comply with the documented contract. | design.md D5 §Reference form; shared/DECISION-LEDGER.md §Template |
| D10 | How long does `interlock ready --review` stay accepted after `--findings` lands? | needs_human | — | — |
| D11 | Does the review tolerance band need recalibrating once dismissals must be cited? | needs_human | — | — |

## Notes on the two `needs_human` rows

**D10** is a deprecation-policy call, not a repo fact: whether anything outside this checkout calls `interlock ready --review` is not knowable from here, and removing a CLI input on the wrong schedule breaks a caller this repo cannot see. This change keeps `--review` accepted with a warning for one release; when it is removed is the human's decision.

**D11** is unanswerable before the change ships. Requiring citations will raise surviving-blocker counts on the first `--strict` runs — that is the intended effect, not a regression. Whether the *quality band* then needs recalibrating can only be read off real runs, and relaxing a gate is a policy decision this loop deliberately does not make on its own.

Both rows are recorded rather than resolved because routing to `needs_human` when in doubt costs one question, while a wrong `agent_resolved` ships an unreviewed decision. Neither blocks the checkpoint path — they block `--continue`, which this change should not use in any case (design.md §Risks, last entry).
