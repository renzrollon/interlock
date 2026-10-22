## Context

`/interlock:review-code` resolves findings with model-free code: `interlock review` turns the dimension findings and skeptic verdicts into `surviving`, `dismissed`, `droppedByQuality` and `droppedByPolicy` (`lib/review-core.mjs:223-402`), and `interlock gate` decides. The result is printed to stdout and never stored. Dismissed records keep only vote counts (`lib/review-core.mjs:335`); the skeptics' reasoning and evidence stay in the raw `--verdicts` input. The checkpoint advisor (`lib/advisor.mjs`, `lib/prompts/advisor.mjs`, `lib/advisor-cli.mjs`, `agents/advisor.md`) is the pattern this change copies, at a new seat.

Two constraints shape every decision:

- **Size.** `bin/interlock` is 237,645 bytes against a 245,760-byte headroom pin (`test/spine/package.test.mjs:432-442`).
- **The spec meter.** It counts `interlock:advisor` spawns and reads `interlock advisor` lines and `.claude/metrics/advisor-*.json` writes (`hooks/mod.mjs:704`, `lib/spec-meter.mjs:40-52, 434`).

The explore brief `.claude/handoff/explore-add-review-findings-advisor-20261022-235413.md` is the ground. Its rows are carried into `decisions.md` as D1–D16, unrenumbered.

## Goals / Non-Goals

**Goals**
- An opt-in consult after review-code's gate whose draft is validated by code against ids the CLI assigned, and rendered to `openspec/changes/<change>/review-advisor.md`. When the consult fails, the file says so (D7, D8, D11).
- Every cap in `lib/limits.mjs` and visible in `interlock limits`, with no threshold in skill prose (D14).
- Review Range cases whose human labels a CLI tallies into a verdict (D10, D12, D15, D16).
- The checkpoint advisor's behaviour is unchanged while its generic parts are shared (D5, D6).

**Non-Goals**
- Any gate, autonomy credit, compound note or merge signal reading the file (D8).
- `/interlock:mr`, ship `--strict` and `/interlock:review-artifacts`.
- Making `interlock review` store its resolved result on disk for other readers.

## Decisions

### The brief is written by the review (D1, D2, D9)

`interlock review --advisor-brief <change>` writes the brief right after the `--metrics` side-write in `bin/interlock`'s review case (3723-3730), in the same style: bookkeeping that warns (`advisor brief not written: <reason>`) and never changes the exit code. At that point the resolved buckets, the raw verdicts and the changed paths are all in hand.

The alternative was a separate `review-advisor --brief` that re-runs the resolution. It was rejected for two reasons:
- it would re-plumb the policy file and `--base` handling through a second command under an 8 KB byte budget
- the two resolutions could disagree

Making `interlock review` store its resolved JSON was also rejected. That adds a corpus file with one reader.

The bin side is one call into `lib/review-advisor-cli.mjs`. Paths follow `lib/advisor-cli.mjs:62`: `<root>/.claude/metrics/`, not `corpusHome`, because the brief is per-run evidence for the agent, not a corpus.

**The join (D2).** `lib/review-core.mjs` gains one export, `verdictsFor(finding, verdicts)`, built on the existing private `matchKeys`/`verdictKey` (73-84): title plus trimmed file first, title alone as the fallback. `resolveReview`'s output stays as it is, so no consumer of the review JSON sees a new field on dismissed records. The stale docstring at 196-199, which says verdicts carry no file, is corrected in the same edit.

**Ids.** `S<n>` and `D<n>` follow the positions in `surviving` and `dismissed`. The index file `review-advisor-brief-<change>-<stamp>.json` carries `{ change, stamp, survivors: [{id, file, title}], dismissed: [{id, file, title}], changed: [paths] }`.

**The cut order.** It follows the spec: policy drops first, then quality drops. Survivors, dismissals and instructions are never cut, and an overrun is spoken.

### A dedicated agent (D3)

`agents/review-advisor.md` is a copy of `agents/advisor.md`'s frontmatter with its own name and a description naming review-code's consult step. A separate type keeps the spec meter's consult counter honest during a session that still has a live spec run. The meter needs no edit for this:
- its draft regex does not match `.claude/metrics/review-advisor-…`
- `lineKind` compares whole words, so `interlock review-advisor` is not the `advisor` kind

A test pins both facts so a later meter edit cannot start counting review consults.

### The CLI persists the draft (D4)

`interlock review-advisor <change> --check -` reads the reply from standard input (the `io.readStdin` used at `lib/advisor-cli.mjs:104`) and writes it unchanged to `.claude/metrics/review-advisor-<change>-<stamp>.json` before parsing it. The skill therefore does no `Write`. This removes the failure the 21 October Spec Range run hit, where the session's `Write` of the reply was denied and the consult was recorded as did-not-run (`docs/notes/2026-10-21-advisor-mod-and-review-gates.md` §2 fix 1).

A persist failure does not stop the check. The rendered file still comes from the stdin text, and the JSON omits `draft`. The check reads the newest index for the change by stamp. A missing index makes the consult did-not-run, with the reason `no brief index for <change>`.

### Flags, targets and order (D7)

The kind enum is closed, with three values. Each kind's targets are resolved against the index:
- `dismissal-doubt`: one `D<n>`
- `shared-root-cause`: two or more distinct `S<n>`
- `uncovered`: one changed path, compared through `canonicalizePath` so `./lib/a.mjs` matches `lib/a.mjs`

Validation runs before the cap, so an invalid flag never pushes a valid one over the cap. This follows the checkpoint advisor's validate-then-cap rule. Ids are positional `F<n>`.

A fourth kind ("missing dimension") was considered and folded into `uncovered`. A dimension the review never ran is already named in the brief's per-dimension counts, and a path is a target the CLI can check where a dimension name the model invents is not.

### Shared helpers (D5, D6)

The generic parts move into two pure modules, with no clock and no `node:` imports, matching the checks at `test/spine/advisor-brief.test.mjs:195-197` and `test/spine/advisor.test.mjs:379-385`:
- `lib/prompts/brief-kit.mjs`, listed in `NON_ASSEMBLER_MODULES` (`lib/prompts/index.mjs:398-404`): `oneLine`, `quote`, the `## Omitted` block, and the cut-and-overrun loop, with `render(cut, overrun)` passed in
- `lib/advisor-kit.mjs`: `table`, the did-not-run stanza with title and closing text as parameters, and positional ids with validate-then-cap

`lib/advisor.mjs` and `lib/prompts/advisor.mjs` import them. Their existing assertions are the proof that output is unchanged:
- `advisor-brief.test.mjs:88-271`
- `advisor.test.mjs:315-410`
- `prompts.test.mjs:836-856`

`verdictFromLabels(evalsDir, limits, { prefix, graders, minLabels, keepMin, repeatMax })` defaults every option to today's values, so `interlock advisor --verdict` prints what it printed before. The review tally passes `review-range-`, `['matches-label', 'repeats-survivor']` and its own caps.

### Raise-only, and pinned (D8)

`review-advisor.md` sits in the change folder so it travels with the change. `inspectChange` reads only the required artifacts and `specs/**` (`lib/artifacts.mjs:227, 295-303`), and `ready` reads only its artifact list (`lib/ready.mjs:101`). The guard is therefore a test, not code: modelled on `test/spine/artifacts.test.mjs:386-418`, it runs gate, autonomy, note derive, ready, validate, ledger and merge-confidence with and without the file and requires the same bytes.

### The skill step (D11, D13)

`skills/review-code/SKILL.md` gains `--advisor` in its flag table and a `## 4a.` section after `interlock note derive`. The step names the agent type and the CLI lines and states no cap and no model (`test/skills.test.mjs:882-885`).

The `## 4. ` and `## 5. ` slice keys the suite uses (`test/skills.test.mjs:840-861`) stay intact. A `## 4a.` heading sits inside the `## 4.` slice, so the §4 assertions still see the gate and note lines.

Without a resolved change, the step says the consult did not run because there is no change folder (D13). It does not invent a folder.

### Review Range (D10, D12, D15, D16)

Each case plants the real bug from a `fix(...)` commit as a dismissed finding with a weak citation. A weak citation is a `path:line` that passes the evidence gate but points at code that does not decide the defect. The fixture also holds a correct dismissal and a survivor, so a flag that picks every dismissal is not rewarded by `matches-label`, and `repeats-survivor` measures noise.

The structural block runs `interlock review` over each fixture to prove the labelled finding is dismissed. That keeps a fixture edit from silently turning the planted bug into a survivor.

The initial six cases (D15, owner to confirm):

| slug | fix | bug at |
|------|-----|--------|
| `briefing-label-path` | `be8a234` | `lib/run.mjs:1156` at `be8a234^`: a planner label joined into a briefing path with no shape check |
| `doctor-openspec-probe` | `cb6313a` | `lib/doctor.mjs:581` at `fea376c`: an empty `--version` probe read as installed |
| `preflight-closer` | `cb6313a` | `hooks/preflight.mjs:148` at `fea376c`: the closer warns users off spec and bootstrap when only ship is blocked |
| `advisor-check-exits` | `133aa8a` | `bin/interlock:2405` at `590ebae`: `advisor --check` exits non-zero instead of recording did-not-run |
| `notes-path-skipped` | `133aa8a` | `lib/run.mjs:2218` at `590ebae`: the notes path is named only when rows were appended |
| `halt-card-band` | `29ede89` | `lib/preflight-file.mjs:126` at `4c66f1e`: any listed halt card holds the session-start band |

The fixture carries only the touched file at the pre-fix ref, plus a short `proposal.md` written from the introducing commit's message. That is enough for the CLI to resolve the change.

### Cap values (D14)

The four caps are new `LIMITS` entries, each read as a literal `LIMITS.<cap>` in `lib/` and printed by `formatLimits`. The values are proposed here and confirmed by the owner at the checkpoint:
- `maxReviewAdvisorFlags: 10`
- `maxReviewAdvisorBriefChars: 160_000`, matching the checkpoint brief's bound
- `reviewAdvisorVerdictMinLabels: 6`, one per case
- `reviewAdvisorKeepMinMatches: 2`

### Opt-in and in-change evals (D11, D12)

Both are the owner's 2026-10-22 decisions. The opt-in flag carries the known risk that an unused flag leaves an empty corpus. §5 reporting is what makes the flag visible when it is used.

## Risks / Trade-offs

- [No labels exist for either advisor] → The verdict prints `INSUFFICIENT LABELS` until someone labels the transcripts (D16). The cases still run and produce the transcripts to label.
- [Seeded dismissals are authored, not observed] → The cases measure whether the advisor catches a planted weak dismissal, not the real dismissal error rate. The provenance in `label.md` makes the planting visible.
- [Opt-in may go unused] → §5 names the flag. A later change can make it default once the verdict is KEEP.
- [Byte budget in `bin/interlock`] → Dispatch is one line per branch and the usage text is short. If the pin trips, the usage text moves into the CLI module.
- [`interlock report` lists the persisted drafts as unrecognized `.json`] → Accepted; spec-advisor drafts already appear there (`lib/report.mjs:347-349`).
- [The helper lift could shift checkpoint advisor bytes] → The existing advisor assertions run unchanged and are the proof. The lift lands in the same wave as the review-advisor modules that need it, with no edit to those assertions.
