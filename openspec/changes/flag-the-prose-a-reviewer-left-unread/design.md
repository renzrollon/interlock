# Design

## Context

See `proposal.md` for why. What shapes the approach:

- **An `unread` entry is free text.** `validateLedger` keeps `{ input, reason }` and drops every other key (`lib/review-proof.mjs:76-86`). Nothing in an entry is a path the CLI can class.
- **Any entry on a ran dimension fails the proof.** `computeProof` lists it and sets `proven` false (`lib/review-proof.mjs:179, 210`).
- **One fact, many readers.** `proof.proven` and `proof.unread` are read by `review.ran` (`lib/merge-confidence.mjs:329-354`), the proof answer (`lib/review-proof.mjs:292-313`), the gap lines and the not-proven banner (`:262-275`, `:426-437`), the settle comment (`lib/settle-cli.mjs:324-347`), the review's own `proof:` line (`lib/review-cli.mjs:246-248`) and the settle meter's review row (`lib/settle-meter.mjs:1060-1066`). A rule applied at one of them contradicts the others.
- **The classifier exists** (D7). `readingClassOf(path, sourcePaths)` in `lib/diff-reading.mjs:58-61` answers source, test or prose, and honours the counts-as-source list. It shipped in `234906b` and its change was archived on 2026-11-23.
- **Both places that compute a proof already hold the policy.** `interlock review` reads it at `lib/review-cli.mjs:192-193`, from the base when `--base` is given. A ship run's adjudication reads it at `lib/run.mjs:2040`, from the commit the run started on.
- **Two rubrics require the change's artifacts.** `skills/review-code/dimensions/technical-lead.md:3` ("Read the OpenSpec artifacts first") and `qa.md:7` ("Read them; do not assume"). Skipping them was the PR #28 failure the proof exists for.

## Goals / Non-Goals

**Goals:**

- One decision, made in the proof, so every reader of the proof agrees.
- The reviewer names files. The CLI, not the reviewer, decides what they are.
- An entry with no `paths`, and a record with no `proseUnread`, read exactly as they do today.
- Nothing a dimension brief hands a reviewer is ever listed apart.

**Non-Goals:**

- Kinds for the other skips a reviewer declares: a suite not run, a probe not available, another dimension's remit (D3).
- Any change to the re-run rule, the re-run cap, what `uncited` requires, the settle meter's rows or the ship close's `REVIEW NOT PROVEN` banner.
- A new published limit, command, command-line flag or exit status.

## Decisions

### Whether to do this at all (D1)

**D1: the owner answered on 2026-11-23, yes.** Decide it in the proof, and carry a flag on `review.ran`. The artifacts are written to that answer.

The measurement that goes with the question, taken on 2026-11-23 from the nine final settle review records that carry a proof (77 `unread` entries): had every entry named its files, the rule as written lists one entry apart and makes no proof hold. The one entry is PR #43 round 1, `technical-lead`, on two files under `docs/`. That review's other entry is on the change's delta specs, which D2 keeps amber. The explore brief said one review in six; it counted PR #43 without applying its own D2 recommendation. The entries were sorted by hand, as the brief's were.

Had the answer been no, the change would have been dropped whole. Nothing else depends on it.

Alternatives considered, from the brief:

- *A flag at the verdict alone.* Rejected. A pull request would carry `MERGE` under a comment ending `REVIEW NOT PROVEN:`.
- *A prompt line alone, telling a reviewer that such a file is not an `unread` input.* Rejected on its own. Nothing can assert a model followed it.
- *A reviewer-declared kind.* Rejected in `openspec/changes/archive/2026-11-13-stop-proof-re-runs-for-unread-inputs/design.md:48`: a model's label would decide the outcome.

### The entry names files (D4, D5, D11)

An `unread` entry may carry `paths`, a list of repository paths (D11 fixes the names: `paths`, `proseUnread`, the flag `prose-unread`, and the words `prose left unread` on every printed line).

- **D4.** `paths` is optional. An entry without it is read as today, so the two living scenarios that pin today's rule stay true: both use an entry with no path (`openspec/specs/review/review-proof/spec.md:54-58`, `openspec/specs/review/merge-confidence/spec.md:1106-1110`).
- **D5.** A `paths` value that is not a non-empty list of non-empty strings is dropped, and the entry is read as one with no `paths`. That is the stricter reading. It is not a ledger fault: a shape fault on `checked` records a dimension unproven (`lib/review-proof.mjs:68-75`), and this key must not add a second way to do that.

`lib/findings.mjs:88-95` gains the key in the answer schema, not in `required`.

### What makes an entry prose-only (D6, D13, D14)

An entry is prose-only when it carries `paths` and every path passes all three tests:

1. **It is a changed file** (D13). The path, in canonical form, is in the list the proof already counts as changed (`lib/review-proof.mjs:182`). A file the diff does not change is an input of another kind, and a directory names no file. With no diff the proof holds on nothing, and nothing is prose-only either.
2. **It is classed prose** (D6) by `readingClassOf`, with the counts-as-source list. A file under a listed path is source.
3. **It is not required prose** (D2, D8, below).

**D14: an entry is never split.** One path that fails keeps the whole entry under `unread`, with all its paths. The entry is one statement by the reviewer, keyed by its `input` (`lib/review-proof.mjs:131-148`), and half of a statement is not something the reviewer said.

### Required prose (D2, D8)

**D2: the owner answered on 2026-11-23, no.** The change's own OpenSpec directory is not prose a reviewer may skip. The artifacts are written to that answer.

**D8** makes that answer computable from a path alone. The proof holds no change name: `interlock review` computes it from the answers and the diff (`lib/review-cli.mjs:186-224`), and a brief reads an archived change from the archive (`lib/review-cli.mjs:347-355`), so "the change's directory" has two homes. Required prose is therefore:

- any path under `openspec/`: a change's artifacts in either home, and the living specs they sync into;
- any path under `.claude/`: the review context every brief quotes (`lib/review-cli.mjs:55`), the project instructions and the test profile, all of which the documentation rule would otherwise class as prose (`lib/risk.mjs:109`);
- the review policy file, which every brief quotes.

Had D2 been answered yes, the `openspec/` line would leave this list and nothing else would move. That would edit one constant in `lib/review-proof.mjs`, the three scenarios in `specs/review/review-proof/spec.md` that name an `openspec/` path, their tests and one paragraph of `docs/15-merge-confidence.md`. PR #43 round 1 would then be the one recorded review whose proof holds.

Alternative considered: *a table of which dimension's rubric requires which input*, so `language` could skip delta specs and `technical-lead` could not. Rejected for this change. It is the kind-by-kind rule D3 defers, and the one recorded entry it would matter for is `technical-lead`'s own.

### The list and its second reader (D9, D12)

**D9: the owner answered on 2026-11-23, yes: the proof reads the list.** D6 makes the proof a reader of `## Counts as Source`. The living requirement says that list moves no merge signal other than `diff.shape` (`openspec/specs/review/policy-file/spec.md:257-259`), a requirement archived that same day. The artifacts are written to that answer.

The reason is the direction of the effect. The list can keep an entry under `unread`. It cannot move one out, because a listed path is source and only prose is listed apart. So a pull request gains nothing by editing the list, and the list is read from the base all the same. At assessment time nothing changes: `interlock merge-confidence` still reads the list for `diff.shape` alone, and `review.ran` reads the proof the review recorded. `test/spine/merge-confidence.test.mjs:3048-3060` keeps passing as written.

The delta replaces the requirement under a new name, because its old name says "read only by the size signal". Its four scenarios move with it.

Had D9 been answered no, the proof would class by the path rule with no list. That would drop `specs/review/policy-file/spec.md`, the requirement "The proof SHALL class paths with the counts-as-source list the review was adjudicated by" and the helper below. In this repository an `unread` entry on a file under `skills/` would then be listed apart, since those files are Markdown.

**D12: when the list cannot be established, nothing is listed apart.** The list is not established when the policy the review read reports a problem `sectionOfProblem` attributes to `source`, or to no section (`lib/review-core.mjs:899-906`). No section is how a copy that was not parsed reads. It is also how a stray front-matter key and a threshold-shaped line in the body read (`lib/review-core.mjs:879-882`), so those switch listing apart off too. That is accepted as the stricter reading: telling them from an unparsed copy would mean matching problem wording, and the fix is to correct the file. It is the condition under which the size signal counts everything (`lib/merge-evidence.mjs:214-219`). A problem in `## Do Not Report` or `## Always Human Review` changes nothing. The entry stays under `unread`, named as today, and the review prints the policy problem as today, so nothing degrades quietly.

A small pure helper beside `sectionOfProblem` answers the list or null. Both callers use it, so neither matches problem wording itself.

### Where the decision is made (D10, D17, D18)

**D10: in `computeProof`, by splitting the list.** `proof.unread` keeps the entries that fail the proof. `proof.proseUnread` holds the prose-only ones, in the same `{ dimension, entries }` shape. `proven` ignores the second list.

Splitting, not marking, is what lets every existing reader stay right with no edit: each of them counts or prints `proof.unread`, and after the split that list still means "what keeps this proof from holding".

- **D17.** A prose-only entry names no re-run and is not counted by `PROOF LEFT UNREAD`. Both read `proof.unread` (`lib/review-proof.mjs:252-259, 308-311`).
- **D18.** Carrying and merging do not change. The proof reads `unread` entries of ran dimensions only (`lib/review-proof.mjs:173-180`); a carried ledger contributes its `checked` entries (`:195-200`). A re-run merge keeps the first entry per `input` (`:131-148`), so `paths` travels with whichever entry was kept. A first entry with no `paths` therefore stays amber after a re-run that adds them, which is the same rule that stops a clean re-run erasing a declared gap.

`runProofRecord` passes the list through, so a ship run's record follows the same rule.

### Who says it (D15)

A reading that got looser has to be visible. Five places say it, all from the one list:

| Surface | What it says |
|---|---|
| the record | `proof.proseUnread`, and `paths` on the entry under `coverage` |
| `interlock review` | the dimensions, at the end of its `proof:` line |
| `interlock review proof` | one line per dimension after the first line and any gap lines |
| `review.ran` | the `prose-unread` flag, an evidence line per dimension, and the dimensions in a green reason |
| the settle comment | the dimensions and files on its last line, each file in an inline code span |

The flag is raised whatever the band, as `domain-skipped` is (`openspec/specs/review/merge-confidence/spec.md:1078-1083`).

The lines of `interlock review proof` serve a person who runs the command. Inside `/interlock:review-code` the skill prints the proof line only for `PROOF CAP REACHED` and `PROOF LEFT UNREAD` (`skills/review-code/SKILL.md:184`), so after `proven` nobody reads them. A review pass is covered by the record, the verdict and the comment, and the skill is not edited.

Two surfaces are left alone. The settle meter's review row reads `proof.proven` and three counts (`lib/settle-meter.mjs:1060-1066`) and the first line of the proof answer (`:865-867`); all stay true. The ship close's banner is for a proof that does not hold (`lib/review-proof.mjs:426-437`); a close assesses the verdict from the same record (`lib/run.mjs:4510`), so the flag reaches it there.

### What a reviewer is asked (D16)

The prompt asks for the changed files an `unread` entry is about, under `paths`, and says the CLI classes them. It does not say which class changes the proof. A reviewer told that prose is free would have a label to aim for, which is the objection the earlier design raised against a declared kind. The lines come from `renderProofRules` (`lib/prompts/review-dimension.mjs:103-156`), which the run's fix-round briefing also prints (`lib/prompts/remediate.mjs:143`), so all three briefings change together.

### What is left for later (D3)

**D3: the owner answered on 2026-11-23, not in this change.** Sorted by hand, 36 of the 77 recorded entries are about tests, a suite that was not run, a host probe or another dimension's remit. They name no changed prose file, so no path rule reaches them, and answering them needs a classing rule of its own. Of the rest, 16 are about a change's own artifacts or other files under `openspec/`, 15 are about source files a reviewer did not open, 9 name several kinds at once, and 1 is about prose alone.

### Prose that changes, and test pins that move (D19, D20)

**D19.** `docs/07-cli-and-configuration.md:208-210` (the ledger shape, the proof's lists, the proof answer). `docs/15-merge-confidence.md` (the `review.ran` row at `:21`, the proof section at `:130-136`, a row in `## The flags`). `docs/12-repository-review-policy.md:25, 154` (the list's second reader). `skills/review-code/SKILL.md:100-115` (the answer shape). `skills/review-code/REVIEW.template.md:29-32, 76-78` and `REVIEW.md:46-48` (both say only the size signal reads the list). `CHANGELOG.md`. The comment at `lib/review-core.mjs:859` says the same and changes with them.

**D20.** One existing pin is known to move: the whole-list assertion on `FLAGS` at `test/spine/merge-confidence.test.mjs:286-304`. `tasks.md` carries the rule for any other.

## Shapes the tests and the implementation share

| Thing | Shape |
|---|---|
| ledger entry | `{ input, reason, paths? }`. `paths` is kept only as a non-empty list of non-empty strings, each trimmed; otherwise the key is absent |
| `computeProof` input | gains `sourcePaths`. An array is the established list and may be empty. Any other value means not established |
| `computeProof` result | gains `proseUnread: Array<{ dimension, entries }>`, in the order the dimensions ran, always present. `unread` holds the rest |
| `runProofRecord` input | gains `sourcePaths`, passed through |
| `proofSourcePaths(policy)`, in `lib/review-core.mjs` | `policy.sourcePaths`, or `null` when the list is not established (D12) |
| required prose | a canonical path equal to or under `openspec` or `.claude`, or equal to `REVIEW_POLICY_FILE` |
| `proseUnreadLines(proof)` | one string per dimension: `<dimension>: prose left unread <files> (<reason>)`, entries joined by `; `, files by `, ` |
| `proseUnreadClause(proof, span)` | `''`, or `prose left unread: <dimension> (<files>)` with dimensions joined by `, `. `span` wraps each file and is the identity by default |
| `coverageLine(proof, { span })` | today's line. With a clause it ends `cited; <clause>.` |
| the settle comment's not-proven line | today's line, then `; <clause>` |
| `interlock review` text | `proof: proven (… cited; prose left unread: <dimensions>)`, and the same tail in the not-proven form |
| the flag | `prose-unread`, in `FLAGS` after `blast-radius-partial` |
| `review.ran` evidence | `prose left unread: <dimension>: <files> (<reason>)`, one line per dimension |
| `review.ran` green reason | today's sentence, chosen by the skip flags as today, then `; prose left unread by <dimensions>` |
| test-name prefixes | `prose unread:` and `prose unread docs:` |

Readers of a record take `proseUnread` defensively, as `listsOf` does for the other lists (`lib/review-proof.mjs:403-412`): absent or not a list reads as empty.

## Risks / Trade-offs

- [This loosens the guard the proof was added for] → Only for changed prose outside `openspec/` and `.claude/`. The skip is named in the record, the verdict's evidence and the comment, and it lowers the score.
- [The documentation rule goes by extension and directory] → `requirements.txt`, `CMakeLists.txt` and any file under a `docs/` directory are prose by `lib/risk.mjs:109`. A repository that needs one read lists it under `## Counts as Source`, the answer the size signal already gives.
- [One list, two effects] → A repository cannot keep a skipped document amber without also counting it toward the size caps. Accepted under D9: both effects say "this prose is behaviour here".
- [A reviewer attaches a prose path to an entry about something else] → It gains nothing it could not gain by leaving the entry out. `unread` is self-declared.
- [The measured effect is nil] → The change can ship and move no verdict until reviewers stop declaring the other kinds. It is stated in the proposal and on D1.
- [Version skew] → An older CLI reading a newer record sees `proven` and raises no flag. An older CLI recording a newer reviewer's answer drops `paths` and reads amber, as today.
- [A carried dimension's `unread` entries reach neither list] → True before this change, and not changed by it (D18). The consequence here: a scoped fix round that does not re-review a dimension drops its prose-only entry from the proof, so `prose-unread` leaves the verdict although the skip stands, exactly as a failing entry leaves `unread` today.
- [To undo] → Revert the commit. A record written meanwhile keeps a key older readers ignore.

## Migration Plan

No stored record changes shape, and no `REVIEW.md` needs an edit. The change reaches installed sessions with the next release. Until a reviewer's answer carries `paths`, every entry reads as it does today.
