# Design

## Context

See `proposal.md` for the motivation. Explore brief: `.claude/handoff/explore-say-what-must-hold-and-how-to-undo-it-20261119-164337.md`. This is change 1 of a six-brief epic; the other five briefs carry the same timestamp.

What exists, and what constrains the approach:

- The description template is prose in `skills/settle/SKILL.md:536-559`. The model composes every section except the CLI's `## Merge confidence` block (`:524-532`).
- The description is published twice in a pass: an interim body at create (`:108-135`) and a whole-description replace at §9a (`:583-601`). Every pass that publishes reaches §9a. A pass stopped before it, by a failed push (`:106`) for example, leaves the interim body, which nothing checks.
- The model types the description more than once: into `settle-summary.md` (§8, `:575-577`) and into the publish heredoc (`:587-598`). The two are separate acts and can differ.
- The publish argv is pinned (`test/skills.test.mjs:2154-2158`) and required by a living spec (`openspec/specs/review/merge-request-delivery/spec.md:163-189`).
- `interlock settle` is one family in `lib/settle-cli.mjs`: `SETTLE_SUBCOMMANDS` and `USAGE_LINES` (`:44-69`), `SETTLE_HELP` (`:71-84`), dispatch (`:1107-1138`). `cli/interlock:4005` hands it `cliIo`, which already carries `readStdin` and `livingListFor` (`cli/interlock:2415, 2667`).
- A subcommand a shipped skill spells must be known, have its flags in `lib/cli-flags.mjs:45-66`, and be run by the smoke (`test/spine/cli-inventory.test.mjs:1-18`). An unknown flag is refused at run time (`cli/interlock:3254`).
- `test/spine/settle-cli.test.mjs:41-51` holds its own copy of the subcommand list, deep-equals it to the export (`:135`), and runs two generic assertions per name (`:128, :151-160`): help names it, and a call with no flags exits 1 with a usage line and empty standard output.
- The living list is built by `io.livingListFor(root, flags, { change, changed })`, bounded, and reports `omitted`, `skipped`, `partial` and `source` (`lib/conformance.mjs:113-134`).
- `parseSpec` (`lib/spec-text.mjs:144`) gives each delta requirement its `section` and a normalised `key`, and gives renames as `from`/`to` pairs.
- `cli/interlock` is 242,369 bytes; shipped files have a 262,144-byte limit with a headroom check (`test/spine/package.test.mjs:403-439`).
- The settle meter keys a `settle` verb only when `SETTLE_VERBS` holds it (`lib/settle-meter.mjs:117-127, 300`) and reads `gh pr view` as the branch's own lookup only when no number follows (`:274, 322`).

## Goals / Non-Goals

**Goals:**

- Every published description names its change, says what must hold and how that was checked, and says how to undo the merge.
- The facts those sections rest on are printed by the CLI, from the artifacts and the living specs.
- A section that went missing is said out loud, from the text the platform actually holds.
- A reword of the skill cannot drop a section, a command line or a spoken line without a test failing.

**Non-Goals:**

- No change to `## Testing`, to the `## Merge confidence` block, or to any publish, create or label argv.
- No judgement of a section's quality. The check reads presence, emptiness, a bare `None` and the `Change:` line.
- No sign-off mechanism. The person who asked for the change reads and owns the description; nothing records that they did.
- No change to the settle meter, to the `--review` loop's ordered steps, or to `cli/interlock`.
- No new published limit and no new dependency.

## Decisions

Rows D1 to D7 are carried from the explore brief. D8 onward were made while writing this change.

**D1. Keep `## High Risk Changes`, `## Prerequisites to Production` and `## Testing` as named.** A living requirement names the first, and pull requests #36 to #43 carry all three. Alternative: Anthropic's "Risk" and "How to revert" wording for all; rejected because it renames a pinned heading for no gain.

**D2. The two new headings are `## Must Not Change` and `## How to Roll Back`.** They answer items (b) and (d) of the owner's 2026-11-19 request in the owner's own terms.

**D3. The description stays model-written.** The CLI prints facts and checks the result. Alternative: the CLI renders the whole description; rejected because the summary and the risk narrative are judgement, and `merge-request-delivery` already defines the risk section as narrative under the CLI's verdict.

**D4. With no change, the line reads `Change: none` and every section is still required.** The settle skill already runs without a change and says so (`skills/settle/SKILL.md:507`).

**D5. The check never stops the pass.** An incomplete description is republished a single time and checked again; a second failure is reported as `DESCRIPTION INCOMPLETE:` and the pass goes on to the labels. A check that could not run is reported as `DESCRIPTION NOT CHECKED:`. Alternative: stop before the labels; rejected because the verdict block and its labels must reach the pull request whatever the prose around them looks like.

**D6. A bare `None` is refused only in the two new sections.** There is always something a change must leave alone and always some way to undo it, or a statement that it cannot be undone. The risk and prerequisite sections keep `None` as a valid answer, as today (`skills/settle/SKILL.md:550, 553`).

**D7. GitLab gets the same template and the same check, marked not exercised.** The existing rule for every GitLab line (`test/skills.test.mjs:1933-1943`).

**D8. Two subcommands, `description-brief` and `description-check`.** The family already names a briefing `-brief` and a verdict `-check` (`conformance-brief`, `tree-check`), and each has one exit-code contract. Alternative: one `describe` with a `--check` mode, as the brief sketched; rejected because one leaf would then have two contracts.

**D9. The brief names where each source sits; it quotes nothing.** For each of four sections it prints the artifact, the heading and the line, or `not found`. The skill already reads the artifacts (`skills/settle/SKILL.md:85`), so a quote would repeat them, and a quote needs a new published cap with its reader pin (`test/spine/limits.test.mjs:196-242`). The measured sections run to 2,402 characters at the 90th percentile over 90 archived designs. Alternative: quote under a new limit, as the brief sketched; rejected as cost without a new fact.

**D10. The check reads the platform's copy, after the publish.** `gh pr view <id> --json body` or `glab mr view <id> --output json` is piped in, and `--from-json <key>` picks the string. Alternatives: check `settle-summary.md`, or check the heredoc before it is sent. Both check a copy the model typed separately from the one it published, so a pass there says nothing about what a reviewer reads. They also need a file that a changeless pass does not have. `--from-json` is used in place of `gh pr view --jq .body` for two reasons: when `gh` itself fails, a bare body pipe is empty and would read as a description with seven missing sections, where JSON that does not parse reads as a check that could not run; and `glab` has no such flag.

**D11. No publish line changes.** The check is added after §9a. Publishing from a file would remove the double typing, but it moves pinned argv on both platforms and belongs in its own change.

**D12. The settle meter is not taught the new lines.** An unknown `settle` verb is unkeyed, and a `gh pr view` that carries a number is not the branch lookup, so the meter draws nothing new and ends nothing early. A guard test pins both facts. The check line must therefore always carry the pull request's number, which the delta spec requires.

**D13. A living requirement is "held" unless the change modifies, removes or renames it.** Matching is by capability and `requirementKey`. An added requirement subtracts nothing.

**D14. One living list.** The brief calls `io.livingListFor`, so its selection and bound are the ones `interlock conformance --living` and the merge verdict use. When a caller supplies no `livingListFor`, the list reads as not built with that reason, as `conformance-brief` does (`lib/settle-cli.mjs:1026-1037`).

**D15. No default change.** With no name the brief resolves none, even when one change is open. A skill that forgot the name gets `Change: none`, which the check then refuses when it is run with `--change`.

**D16. The check does not read order or labels.** A person may reshape a section by hand, and §9a keeps hand-written text on confirmation (`skills/settle/SKILL.md:601`). The labelled lines are pinned in the template, where the instruction lives.

**D17. The new sections are written as labelled lines.** `Undo:`, `Not undone by a revert:` and `Order:` under `## How to Roll Back`; `Before merging:` and `Before deploying:` under `## Prerequisites to Production`. Labels give the suite tokens to pin instead of sentences, and give a reader the same three answers in the same place on every pull request.

**D18. The rules live in a new pure module, `lib/settle-description.mjs`.** It imports no `node:` module. File and standard-input reads stay in `lib/settle-cli.mjs`. `cli/interlock` is not edited.

**D19. No sign-off line.** The closing report gains nothing about the person confirming the two sections. Nothing could assert it, and an instruction nobody asserts stops running.

**D20. Existing pins that move, and where.** Three, each updated in the red wave: the subcommand list at `test/spine/settle-cli.test.mjs:41-51` gains two names; the GitLab not-exercised list at `test/skills.test.mjs:1934-1939` gains the `glab mr view … | interlock settle description-check` line; `settleSkillProblems` (`test/skills.test.mjs:1568`) gains the description pins. Any other assertion that pins a meaning this change alters is updated in the task that alters it, never in a fix round, and the update names the assertion and the requirement it now pins.

**D21. The incomplete verdict is written the way `STOP:` is.** The check calls the CLI's `die` with `INCOMPLETE_PREFIX` and the problems joined by `; `, so standard error reads `interlock: DESCRIPTION INCOMPLETE: <problems>` and standard output is empty. A broken input dies with its own reason and never those two words. With `--json` the object is printed first and the exit code set afterwards, as `tree-check` does on a dirty tree. Alternative: a bare prefix and a problem list on standard output; rejected because every sibling's reason carries `interlock: ` and prints nothing on a refusal. Added after the artifact gate, from its first warning.

**D22. The `Change:` line names `<dir>/proposal.md` whether or not the file exists.** A change with no proposal is not ready to ship (`interlock validate` lists it as missing), so the case is an edge; the source row for the proposal says `not found` and the line stays one fixed shape. Added after the artifact gate.

### Shapes the tests and the implementation share

`lib/settle-description.mjs` exports:

| Export | Value or return |
|---|---|
| `DESCRIPTION_SECTIONS` | frozen: `Summary`, `Changes`, `Must Not Change`, `High Risk Changes`, `Prerequisites to Production`, `How to Roll Back`, `Testing` |
| `REASONED_SECTIONS` | frozen: `Must Not Change`, `How to Roll Back` |
| `SECTION_SOURCES` | frozen rows `{ section, artifact, heading }`: `Must Not Change` ← `design.md` `Goals / Non-Goals`; `High Risk Changes` ← `design.md` `Risks / Trade-offs`; `Prerequisites to Production` ← `proposal.md` `Impact`; `How to Roll Back` ← `design.md` `Migration Plan` |
| `INCOMPLETE_PREFIX` | `'DESCRIPTION INCOMPLETE: '` |
| `NO_CHANGE_LINE` | `'Change: none'` |
| `changeLineFor({ change, dir })` | ``Change: `<change>` (<dir>/proposal.md)``, or `NO_CHANGE_LINE` when `change` is empty |
| `headingLines(markdown)` | `[{ heading, line }]`: level-2 headings outside fences, 1-based |
| `checkDescription(text, { change })` | `{ ok, problems, sections: [{ heading, present, empty, bareNone }], changeLine: { found, none, change } }` |
| `deltaRequirements(specFiles)` | from `[{ capability, text }]`: `[{ capability, section, heading, to? }]`; a rename is `section: 'RENAMED'` with `heading` the old name and `to` the new |
| `splitLiving(requirements, delta)` | `{ held, modifiedByChange }` |
| `locateSources({ proposal, design })` | texts or `null`: `[{ section, artifact, heading, line }]`, `line` `null` when not found |
| `assembleDescriptionBrief(facts)` | `{ text, json }` |

Problem strings, in the order they are reported: for each section in template order, one of `missing section: ## <name>`, `empty section: ## <name>`, `bare None in ## <name>`; then, when `## Summary` is present, at most one of `no Change: line under ## Summary`, `Change: line names no change`, `Change: line names <other>, not <name>`, `Change: line says none, not <name>`.

Brief, text: the first line is `description facts for "<change>" (<dir>): <n> changed path(s), base <ref>`, or `description facts with no change named: <n> changed path(s), base <ref>`. Then the `Change:` line, the delta requirement rows (`<SECTION> <capability>: <heading>`, a rename as `<from> -> <to>`), the held living requirements with `<artifact>:<line>` and the two counts, and the four source rows.

Brief, `--json`: `{ change, dir, archived, changeLine, changedPaths, base, requirements, living: { held, modifiedByChange, omitted, skipped, partial, source }, sources }`.

Check, exit 0: `description complete: <the Change: line it found>`. Check, exit 1 and incomplete: standard error `interlock: DESCRIPTION INCOMPLETE: <problem>; <problem>`, standard output empty unless `--json` (D21). The header comment of `lib/settle-cli.mjs` that calls `tree-check` the one exit 1 that prints is updated to name this second case.

`lib/settle-cli.mjs`: `SETTLE_SUBCOMMANDS` gains `description-brief` then `description-check` after `archived-change`. Usage lines: `interlock settle description-brief [<change>] --changed <files|-> --base <ref> [--json]` and `interlock settle description-check --file <file|-> [--from-json <key>] [--change <name>] [--json]`. `lib/cli-flags.mjs`: `'settle description-brief': ['changed', 'base']`, `'settle description-check': ['file', 'from-json']`.

## Risks / Trade-offs

- [A thin sentence satisfies the check] → Accepted. The check guards against a section vanishing. Quality is the owner's read, and D3 keeps it there.
- [The held list is long on a wide diff] → It is the bounded living list, and the brief says how many were left out. The skill writes two to five bullets from it, not the list.
- [No graph means a partial living list] → The list already says `partial` and why; the brief repeats it.
- [The GitLab check line has never run] → Marked not exercised, like every GitLab line, and pinned to stay marked.
- [A second publish costs one more platform call when the first description is incomplete] → Bounded at one by D5.
- [`--from-json` is a general key picker on one subcommand] → It takes one top-level key and refuses anything that is not a string there.
- [Design prose trips the risk classifier] → This file's `## Migration Plan` heading reads as `high` by keyword. Reported at the checkpoint with its cause.

## Migration Plan

Ships with the plugin; nothing is stored, so there is nothing to convert. A pull request settled before this change keeps its description until the next pass rewrites it.

To undo: revert the commit. The two subcommands and the skill lines leave together, because the skill is the only caller. Descriptions already published with the new sections stay as they are and need no cleanup.

Order: the CLI half lands before the skill half within the change, so the shipped skill never names a command the CLI lacks.

## Open Questions

- Should `--test-plan` and `--explain` comments point at the new sections? Not needed for this change.
- Should a later change publish the description from one file, so it is typed once? D11 leaves it out.
