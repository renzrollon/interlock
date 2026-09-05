## Why

After `emit-wave-steps-from-cli`, every step of a lean run is emitted by `interlock run` and both drivers are interpreters — except the strict tail. Adversarial review, bounded remediation, handoff artifacts and conformance still live inline in `workflows/ship.js` behind the `host-tail` seam (`workflows/ship.js:2058-2356`), and `bin/interlock-ship-acp` still exits `2` on `--strict`, `--review`, `--handoff` and `--conformance` (`bin/interlock-ship-acp:100-110`). So the guarantees that make a strict run worth paying for — evidence-gated dismissal, a remediation budget the model cannot argue with, rubric delivery on re-review, conformance questions rather than verdicts — are Claude-Code-only, and the README says so. The seam exists because the first change moved the loop and not the tail; this change finishes the move so the second host reaches `--strict` parity through the same mechanism (`.claude/handoff/explore-creating-or-reusing-harness-20260904-171500.md` §Recommended Direction 1–2).

## What Changes

- **The run program emits the tail.** When the manifest carries a tail flag, the waves' `done` becomes a `review` step, then `remediate` steps for each fixing round and the verdict, then final verification, then a `handoff` step, then commit and close. The `host-tail` seam is deleted from the Workflow script and the exit-2 refusal from the ACP driver.
- **Review adjudication and the remediation budget move into the CLI.** The review agent writes `findings.json` and `verdicts.json` and reports counts; `interlock run reviewed` adjudicates them with the same rules `interlock review` applies, records metrics, and plans round one. `interlock run remediated --round N` re-adjudicates and asks `lib/remediate.mjs` for the next round or the verdict. No agent runs `interlock review` or `interlock remediate`, and no driver copies `roundCap`.
- **Criteria and policy are inlined by the CLI.** The review and remediation briefings carry each selected dimension's rubric and the repository's review policy prose, read by the CLI; a missing rubric is named in the briefing and bannered as `REVIEW RUBRIC UNAVAILABLE`. Re-review inlines the same files again, so the rubric-delivery requirement holds by construction.
- **Dimension selection is a recorded rule.** The four always-on dimensions plus `devops` and `security` are chosen by the CLI from the run's observed changed paths and reported on the step; the review agent may add a dimension it finds warranted, and the addition is recorded.
- **The handoff briefing is pre-computed.** The CLI runs `surface` and `conformance` itself and inlines whether a manual test plan is needed and which scenarios to check; the agent writes the artifacts.
- **The autonomy record is written by the closing step**, from the blocker count the CLI adjudicated, never by the commit agent.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `ship/run-program` (introduced by `emit-wave-steps-from-cli`): gains requirements for the review, remediation and handoff steps, for CLI-side adjudication and budget, and for the closing step's autonomy record.
- `workflow-host`: gains a requirement that every host runs the strict tail from the same step records and that no host may refuse a tail flag.

## Impact

- **Code**: `lib/prompts/{review,remediate,handoff,dimensions}.mjs`; `lib/run.mjs` (`reviewed`, `remediated`, the handoff step, tail-aware `close`); `bin/interlock` (usage); `workflows/ship.js` (delete the `HOST_TAIL_SEAM` sections, `REMEDIATION_BUDGET`, `RUBRIC_INSTRUCTIONS`, `POLICY_INSTRUCTIONS`, `remediationBudget`, the skeptic/verify effort literals); `bin/interlock-ship-acp` (drop `REFUSED_FLAGS`, pass tail flags to `run start`, usage text).
- **Tests**: `test/spine/run.test.mjs` (strict path), `test/spine/prompts.test.mjs`, `test/spine/prompt-integrity.test.mjs` (coverage grows by three), `test/workflows.test.mjs` (no-policy sweep loses its seam allowance and gains tail tokens), `test/spine/acp-host.test.mjs` / driver test (`--strict` accepted), `test/skills.test.mjs` (the ship skill no longer says strict is Claude Code only), `test/spine/limits.test.mjs` (`remediationRounds` reader unchanged).
- **Docs and skills**: `skills/ship/SKILL.md` §3, `README.md` Experimental, `docs/04-when-it-stops.md`, `docs/06-why-it-works.md` §7, `docs/10-agentic-workflow-ship-and-spec.md`, `CHANGELOG.md`.
- **Dependencies**: none. No new library; nothing to pin.
- **Compatibility**: a strict run on the Workflow runtime keeps its halts, banners, metrics files and receipt fields. The ACP driver gains `--strict`; exit code `2` no longer has a caller.
