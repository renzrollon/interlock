## Why

Interlock ships two subagents it calls "advisors". Neither is Claude Code's advisor tool (the server tool `advisor_20260301`, which the user turns on with `/advisor`, the `advisorModel` setting or `--advisor`). The real tool does not fit the job those two do: they write a file a human reads at a checkpoint, while the tool's advice goes only to the model that asked for it. That advice is encrypted with an Opus 5.5 or Fable advisor, and the model decides when to call. So the subagents go (D1).

The real tool does fit Interlock's executors, the spec session and the ship lanes, and it already reaches them. Subagents inherit a configured advisor even with a `tools:` allowlist, and `claude -p` lanes load the user's settings. A user who runs `/advisor` today gets lanes that consult it, and nothing in Interlock says so. That is silent degradation, which this repository does not allow. So Interlock observes the tool and reports it (D2). It asks for no consult: the advice is redacted from every reviewer and its spend is not established, so asking for it is a later decision, made on the counts this change starts recording. It never turns the tool on (D4).

## What Changes

- **BREAKING** Remove the checkpoint advisor, released in 1.7.0:
  - the `interlock:advisor` agent
  - `interlock advisor --brief|--check|--verdict` and the advisor rows in `interlock limits`
  - spec skill §5a and its `Agent` grant
  - `openspec/changes/<name>/advisor.md`
  - the ten Spec Range eval cases and `scripts/advisor-e2e.mjs`
  - the spec meter's advisor, consult, draft and `waiting on you` lines (D7)
- Remove the review-code findings advisor, which was never released:
  - the `interlock:review-advisor` agent
  - `/interlock:review-code --advisor` and `interlock review --advisor-brief`
  - `interlock review-advisor`
  - `review-advisor.md`
  - the six Review Range eval cases
  - its unarchived change folder (D9)
- Keep compound notes working:
  - `interlock note add|derive|match` moves out of the advisor module unchanged.
  - The spec skill now runs `interlock note match` after `tasks.md` and reads the matched rules (D3).
  - `note match` names unreadable rows.
  - The cap is renamed `maxNoteMatchRows` (D6).
- Add a doctor `advisor` row. It names the settings scopes that set `advisorModel` and whether `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` is set. It never fails, and it says Interlock cannot turn the tool on.
- A ship run records the configuration at start (D5). When an advisor is configured, the run note says lanes may consult it, the advice is not recorded, and its spend is not established (D13). When the env var disables it, the run note says so.
- Count advisor consults:
  - **Per ship lane:** from each lane's transcript, summed in the close summary. Unknown is never zero.
  - **In the spec meter:** from the engine's per-request server tool uses.
- Ask for no consult (D2). Lane briefings are byte-identical whether or not an advisor is configured, so the counts measure unprompted use. The spec skill forbids running `/advisor` or editing `advisorModel`, and its hand-off reports whether the tool was available and the consults made.
- Update docs and CHANGELOG. The unreleased bullet goes; a Removed entry covers the 1.7.0 checkpoint advisor (D11).

## Capabilities

### New Capabilities
- `advisor-tool`: how Interlock observes, reports and counts consults of Claude Code's own advisor tool, why it asks for none yet, and why it never configures it.

### Modified Capabilities
- `spec/checkpoint-advisor`: every requirement removed. The consult, its CLI and `advisor.md` are gone.
- `evals/spec-range`: every requirement removed along with the cases.
- `hooks/spec-meter`: the keyed lines drop `interlock advisor` and add `interlock note match`. The pane drops the advisor, consult, draft and `waiting on you` lines and gains an advisor-consult count from server tool uses.
- `spec/machine-readable-gate-lines`: the observer-line pins drop the three advisor lines and the advisor spawn token, and pin the `note match` line between the status line and the ledger line.
- `spec/compound-notes`: retrieval is read through `interlock note match` by the spec skill instead of the advisor brief, and the cap is renamed.

## Impact

- **Removed code:**
  - `agents/advisor.md`, `agents/review-advisor.md`
  - `lib/advisor.mjs`, `lib/advisor-cli.mjs`, `lib/advisor-kit.mjs`
  - `lib/review-advisor.mjs`, `lib/review-advisor-cli.mjs`
  - `lib/prompts/{advisor,review-advisor,brief-kit}.mjs`
  - `scripts/advisor-e2e.mjs`
  - `evals/spec-range-*`, `evals/review-range-*`, and their tests and fixtures
- **Edited code:**
  - `bin/interlock`, `lib/cli-flags.mjs`, `lib/limits.mjs`, `lib/notes.mjs`, `lib/prompts/index.mjs`, `lib/review-core.mjs`
  - `lib/spec-meter.mjs`, `hooks/mod.mjs`
  - `lib/doctor.mjs`, `lib/host/claude-env.mjs`, `lib/run.mjs`, `lib/agent-usage.mjs`
  - `bin/interlock-run`
  - `scripts/postinstall-smoke.mjs`, `scripts/gen-flow-svg.mjs` (with the generated `docs/assets/flow-*.svg`)
  - `evals/CALIBRATION-DEFERRALS.md`
- **New code:** `lib/advisor-tool.mjs` (pure: configuration reading, note texts, the doctor texts).
- **Skills:** `skills/spec/SKILL.md`, `skills/review-code/SKILL.md`, `shared/COMPOUND-NOTES.md`.
- **Docs:** 02, 07, 10, 14, README, CHANGELOG.
- **Users:** a script calling `interlock advisor` stops working. A user who never ran `/advisor` sees only the new doctor row. A user who did gets the run note and consult counts; their lane briefings do not change.
- **No new dependency.** No setting is written and no flag is passed to any host.
