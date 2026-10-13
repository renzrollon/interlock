## Context

See `proposal.md` for why. This section holds only what shapes the approach.

**What exists.** Seven of the epic's eight briefs are on this branch: the pure assessment and the command (E1), the coverage figures, the base-ref policy, the `domain` dimension and the spec audit (E8, E4, E5, E7), and the close-time verdict with living conformance (E2, E6). The last of those, `complete-and-record-the-merge-verdict`, is committed, complete and not archived; its deltas modify two requirements of `review/merge-confidence` ("The change-shape signals…" and "The command SHALL run offline…") and remove one. This change modifies only requirements that change leaves alone, and adds the rest, so neither overwrites the other at archive.

**What was checked on 2026-10-12, and how.**

- The full suite on this branch: 3,463 tests, 0 failing, 10 skipped (six of them the relay tests that need a port the sandbox withholds).
- `interlock merge-confidence` reaches `MERGE` (score 93, exit 0) on a throwaway repository when given a review, a final verification verdict, handoff counts, a pipeline input for the head and a run's evidence file. Without the evidence file it reads `HUMAN` on `run.integrity` alone.
- The same command on this branch against `main` reads `HUMAN`, score 47: no review evidence, 40,518 changed lines, risk class `high`, and four source files the epic added that no spec names.
- The behaviours below were each reproduced by running the command, or read off the cited line.

| Finding | Where | Verified |
|---|---|---|
| A `checks` key that is missing, misspelt or misshapen reads "no checks", green | `lib/merge-confidence.mjs:437`, `:467` | ran |
| A run's evidence file is accepted whatever base is under assessment | `lib/merge-evidence.mjs:471-499`, `bin/interlock:3033` | read |
| An empty run record reads "no degradation"; a null count tallies as zero | `lib/merge-confidence.mjs:102`, `:711-725`; `lib/run.mjs:4727` | ran |
| An object with no findings list reads as zero findings, for the gate, the review, the remediation plan, the readiness check and a run's own adjudication | `lib/findings.mjs:134-147`; `bin/interlock:2857`, `:3280`, `:3309`; `lib/ready.mjs:256`; `lib/run.mjs:2041` | ran (gate, remediate), read (others) |
| The run's findings and verdicts work files are never removed, and `readJson` returns null for an absent or unparseable one | `lib/run.mjs:147-148`, `:2041-2042`, `:2312` | read |
| `- src/**` in an enforced list is a literal path that matches nothing | `lib/review-core.mjs:826-838` | ran |
| A living list cut to nothing returns before the omission flag the sibling change's spec requires | `lib/merge-confidence.mjs:538` | ran |
| Lines in a file the report never saw are not "changed lines", and nothing says so | `lib/coverage.mjs:243-269`; `lib/merge-confidence.mjs:406` | ran |
| A size cut of the domain text raises no banner; `docs/04-when-it-stops.md:705` says it does | `lib/run.mjs:1821-1825` | read |

**What a `run close` cannot break.** The assessment at close sits in a `try`, its evidence write in another, and the exit expression is unchanged; closes in a directory with no repository, an unborn repository, a detached head and a depth-one clone all exit 0 and say what they could not read. This change touches the run in two places only: the review step and its adjudication (D10, D24) and one banner (D20).

**Constraints.** No runtime dependency. Decision modules stay pure; `bin/interlock` does the I/O. No threshold in prose, and none is added. A gate fails closed; a guard fails open. A skill instruction exists only if a token pin asserts it. The `mr` skill may run `git`, `gh`, `glab`, `openspec`, `interlock` and nothing else (`skills/mr/SKILL.md:8`).

## Goals / Non-Goals

**Goals:**

- A person who runs the `mr` skill on a merge request gets a description block and two labels that are what the CLI computed, for the commit the platform holds.
- No input the verdict or the review gate reads can turn "could not be read" into a clean reading.
- With the sibling change archived, the epic's own pull request passes the spec-coverage rule the epic introduced.

**Non-Goals:**

- Changing what `risk.class` reads at merge. It is the signal that will hold most merge requests at `HUMAN`, and it is the owner's decision (D1, Open Questions).
- Carrying a hand review's output to the `mr` skill. Without a run there is no run record, so no merge request made by hand can read `MERGE` whatever its review says (D23).
- A review that runs in continuous integration. The CI job documented here re-reads evidence a ship run produced; it does not produce any.
- Sharing the domain text bound fairly between capabilities. The cut is global and alphabetical today, so a large first capability can leave later ones with nothing; this change makes the cut visible (D12, D20) and does not move it.
- The stray dot-directory `interlock changes` lists, the handoff's unframed requirement headings, and a size bound on living-spec reads. Noted by the audit, not gate-affecting, left for a later change.

## Decisions

### D2. The platform's output becomes the pipeline input in code, not in the skill

The brief has the `mr` skill write the pipeline file. A skill is prose a model follows, so the mapping from `SUCCESS`, `NEUTRAL`, `TIMED_OUT` and the rest to four states would be re-derived on every run, and the one input that decides `MERGE` on the platform side would be a file a model typed. A new command, `interlock pipeline`, backed by a pure `lib/pipeline.mjs`, does the mapping; the skill pipes the platform's JSON into it.

*Alternative considered:* `gh pr checks --json name,bucket --jq …` in the skill. It moves the table into a jq expression nobody tests, has no equivalent on GitLab, and still needs a join with the required list.

`lib/pipeline.mjs` exports, and nothing else decides these:

| Export | Contract |
|---|---|
| `PIPELINE_STATES` | frozen `['pass', 'fail', 'pending', 'skipped']`; `readPipeline` in `lib/merge-confidence.mjs` imports it |
| `GITHUB_STATE_TABLE`, `GITLAB_STATE_TABLE` | the frozen tables of D3 and D4 |
| `pipelineFromGithub(doc, { required, exclude })` | returns `{ ok: true, input, notes }` or `{ ok: false, reason }`; never throws |
| `pendingFromGitlabMr(doc)` | returns `{ ok: true, input }` (no head pipeline), `{ ok: true, pending: { sha, headPipeline } }`, or `{ ok: false, reason }` |
| `pipelineFromGitlab(doc, pending, { exclude })` | returns `{ ok: true, input, notes }` or `{ ok: false, reason }` |
| `validatePipelineInput(value)` | returns `{ ok: true }` or `{ ok: false, reason }`; the one rule for a well-formed input (D7) |

`input` is `{ sha, checks: [{ name, state, required }], excluded: [names] }`, `excluded` always present. `notes` are strings for standard error (an unmatched exclusion, a required set that was not given).

Command shape:

```
interlock pipeline --github <file|-> [--required <name>]... [--exclude <name>]... [--out <file>] [--json]
interlock pipeline --gitlab-mr <file|-> --out <file> [--json]
interlock pipeline --gitlab <file|-> --mr <file> [--exclude <name>]... [--out <file>] [--json]
```

- `--required` and `--exclude` accumulate. `parseArgs` in `bin/interlock` is last-wins for every flag except `--changed` and `--mode`; the two new flags join `--mode`'s accumulate branch, where a single use is a scalar and a repeated one a list, and the command turns either into a list before calling the module.
- Standard output: with `--json`, the input object, or for `--gitlab-mr` with a head pipeline the pending record; without it, one line: `pipeline <sha>: <n> check(s) (<p> pass, <f> fail, <q> pending, <s> skipped); required: <names or "not given">; excluded: <names or "none">`, or for a pending record `pending <sha>: head pipeline <id>`.
- Exit 0 when it produced an input or a pending record; 1 on a document it cannot read or does not recognise, a missing `--mr` or `--out` where required, a pipeline that is not the record's, or a branch pipeline for another commit. On exit 1 standard output is empty.
- When `--out` names an existing file and no input is produced, the file is removed and standard error says so. A fixed output path that kept its last good file would hand the next command an earlier moment's checks, with a commit that may still match.

The name follows the flag it feeds (`--pipeline`) and the signal (`ci.pipeline`).

### D3. GitHub: one document for the commit and the checks, required names as flags

`gh pr view <n> --json headRefOid,statusCheckRollup` returns the head commit and its checks in one response, and returns an explicit empty list when there are none (captured from pull request 17 of this repository on 2026-10-12, `gh` 2.93.0). `gh pr checks --json` carries no commit, and with no checks it prints nothing and exits 1, which is indistinguishable from a failed call. So the first is the source. A document with no `statusCheckRollup` key is refused; an empty list is "no checks".

Neither document says which checks are required. `gh pr checks <n> --required --json name` does, and with none required it prints nothing on standard output and exits non-zero. The skill passes each name it prints as `--required <name>`. This is the one transcription left to the model. A missed name reads a reported failed check amber where it should be red; an invented name adds a pending required entry; neither turns a reported check green. A required check that has not reported at all is in neither document, so it is visible only when it is named, which is why an unmatched required name becomes a pending entry and why the claim stops at "reported".

State table (the conclusions and states are GitHub's own enumerations):

| Entry | Value | State |
|---|---|---|
| check run | status not `COMPLETED` | `pending` |
| check run | `SUCCESS` | `pass` |
| check run | `NEUTRAL`, `SKIPPED` | `skipped` |
| check run | `FAILURE`, `TIMED_OUT`, `ACTION_REQUIRED`, `STARTUP_FAILURE` | `fail` |
| check run | `CANCELLED`, `STALE`, anything else | `pending` |
| commit status | `SUCCESS` | `pass` |
| commit status | `FAILURE`, `ERROR` | `fail` |
| commit status | `PENDING`, `EXPECTED`, anything else | `pending` |

A check run's name is its `name`; a commit status's is its `context`. Two check runs with the same name and `workflowName` are a re-run, and the one with the later `startedAt` is read.

### D4. GitLab: the merge request states the head, and a file carries it to the second step

`glab ci get --merge-request <iid> --output json` prints the merge request's head pipeline with a `jobs` list, always fetched (read in `glab`'s `ci/get` source on 2026-10-12: the output is the pipeline with `jobs` and `variables` added). Each job carries `name`, `status` and `allow_failure` (GitLab jobs API). A merged-result pipeline runs on a commit GitLab made, so its `sha` is never the head; the head is the merge request's own `sha`, which `glab mr view <iid> --output json` prints, beside `head_pipeline`.

So GitLab is two commands, and the commit is never typed. `--gitlab-mr` reads the merge request document and writes to `--out`: a complete input with no checks when `head_pipeline` is null, or a pending record `{ sha, headPipeline }` when it names one. The pending record has no `checks`, so D7 refuses it if the second step never runs. `--gitlab` reads the pipeline document and the record named by `--mr` (which may be the same path as `--out`), refuses a pipeline whose `id` is not `headPipeline`, and writes the input with the record's `sha`.

*Alternative considered and dropped after review:* a `--head <sha>` flag the skill copies from the merge request. A model that typed the local head while the platform's was older would bind a merged-result pipeline's jobs to a commit they never ran on.

A merge request document without a `sha`, or without a `head_pipeline` key at all, is refused: an absent key is not the platform saying there is no pipeline.

| Job status | State |
|---|---|
| `success` | `pass` |
| `failed` | `fail` |
| `skipped` | `skipped` |
| `manual`, allowed to fail | `skipped` |
| `manual`, not allowed to fail | `pending` |
| `created`, `pending`, `preparing`, `running`, `scheduled`, `waiting_for_resource`, `waiting_for_callback`, `canceled`, `canceling`, anything else | `pending` |

A reference ending in `/merge` or `/train` under `refs/merge-requests/` marks a merged-result or merge-train pipeline; for any other reference the pipeline's own `sha` must equal the record's.

**This reader is written from GitLab's and `glab`'s documentation and source, with fixtures built to match them. Nobody ran it against a live project.** `docs/15` says so, and the command refuses a document it does not recognise instead of guessing.

### D5. A result the platform did not give is `pending`

Cancelled, stale and unknown values read `pending`, which the verdict reads as unobserved. *Alternatives:* `fail` would report a defect nobody found and, on a required check, a `BLOCK`; `skipped` would grant green on a check that never finished.

### D6. The gate's own check is excluded by exact name, by the person, and shown

A required job that fails until a merge request is labelled, or a job that itself runs `merge-confidence --require-merge`, is in the pipeline the verdict reads. Counted, it is a failed or pending required check, and the verdict it waits for can never arrive. `--exclude <name>` on the command and `--gate-check <name>` on the skill leave it out; the name is recorded in the input, named in the signal's evidence and printed in the block. An exclusion also removes a required name that matched no reported check, so a gate job that has not reported yet does not come back as a pending required entry.

No name is excluded by default and no pattern is accepted. *Alternative considered:* a reserved job name excluded automatically. It would save a flag and hide the exclusion from the one place a reviewer reads.

### D7. A malformed pipeline file is an input error; inside the module it is unobserved

`validatePipelineInput` in `lib/pipeline.mjs` is the one statement of the shape, as `validateBaseline` is for the coverage baseline. The `merge-confidence` command calls it on the `--pipeline` file before assessing and exits 1 on any fault, as it already does for a file that is not JSON. `readPipeline` keeps a second line of defence for callers that build the input themselves: a `checks` that is not a list, or holds a non-object, is unobserved. An entry with a state outside `PIPELINE_STATES` keeps its existing amber reading there.

The living requirement says "An input with no checks SHALL be green with a flag". This change modifies that requirement to say "present and empty", because an added requirement beside it would leave both in force.

No schema identifier is added to the file. Shape validation already refuses the documents likely to be handed over by mistake (both raw `gh` outputs, a GitLab pending record), and a new required field would break every pipeline file written since E1.

### D8. A run's evidence covers one diff, and the command checks it

The evidence file already records the run's base (`manifest.startSha`). `readRunEvidence(file, { change, headSha, base })` gains one condition, applied after the existing four and only when the caller gives a base. `base` is `undefined` when no `--base` was given, `{ sha }` holding the merge base of `--base` and the head when git gave one, and `{ unreadable: true }` when it did not (a shallow clone), in which case the JSON output's `base` is `{ ref, sha: null }`. The file is refused whole, with a reason naming the two diffs, when `base.sha` differs from the file's `base`, when the file's `base` is null, or when the merge base was unreadable, in which case the reason names fetch depth.

With no `--base` nothing changes: the file is used under its four existing conditions, the signals that need a base stay unobserved, and the verdict cannot be `MERGE`. The usage text and `docs/04` currently show the two-flag form as the route to `MERGE`; they are corrected to show `--base`.

*Dropped after review:* taking the base from the file when none is given. The file would then choose the diff it is judged on, and a five-commit branch whose last commit a run made would read `MERGE` again, with the review policy read from a commit on the author's own branch.

*Alternative considered:* comparing against the tip of the base branch. A target branch that gained commits after the run started would then refuse every evidence file until a rebase, which punishes a branch for someone else's merge. A test holds this case, because an implementation that compared tips would otherwise pass every other one.

### D9. An observation the run record lacks is unobserved; a recorded degradation still wins

`readRunIntegrity` checks degradations first, so a halt beside missing counts is still amber and needs a person. With none, any of the seven observations absent or null reads unobserved and names them by their record keys (`halted`, `trajectoryComplete`, `stageMarkerGaps`, `rejectedReports`, `permissionPrompts`, `autoModeDenials`, `leftoverTasks`), so two tests written apart assert the same string. The close already writes all seven; the two it writes as null are the prompt and denial counts when neither the runner nor the hook sidecar observed anything (`lib/run.mjs:4708`), which is a run on a host with no recorder, and the test harness. Those runs now read `HUMAN` naming the missing counts. They could not read `MERGE` at close before either, and should not have been able to off-run.

### D10. One shape reader, five commands and a run, one rule

The shape sniffing lives in `flatten` (`lib/findings.mjs`). `gate` reaches it through `evaluateGate`; `review` through `resolveReview`; `remediate` through `planRemediation`; `ready` through `evaluateGate`; a run's `adjudicateReview` through `resolveReview`. The fix is one exported predicate, `carriesFindingsList(input)`, plus `surviving` as a fourth accepted shape. `flatten` itself stays total. Each consumer states its own consequence, because they differ on purpose:

| Consumer | On an input with no findings list |
|---|---|
| `interlock gate` (`bin/interlock:2848`) | exit 1, reason on stderr, nothing on stdout |
| `interlock review` (`bin/interlock:3288`) | the same |
| `interlock remediate` (`bin/interlock:3280`) | the same |
| `interlock ready` (`lib/ready.mjs` `readFindings`) | the artifact review has not run |
| `run reviewed` (`lib/run.mjs` `adjudicateReview`) | review recorded as not completed with the reason; adjudicated as empty; the run continues |
| `run remediated` (the same function, `lib/run.mjs:2182`) | the round is adjudicated from the surviving findings of the last adjudication, unchanged; a note containing `not re-reviewed` is recorded; the next round or the verdict is planned from them. When that record cannot be read back either, the run halts naming both files |

The two run sites differ because "adjudicate as empty" means opposite things at each. At the first adjudication there is nothing earlier to keep, and the living `workflow-host` spec already says a review step that returns no findings file is recorded as not completed while the run continues. In a remediation round the same reading would clear the blockers the round was asked to fix, and at the verdict round `plan.halt` is computed from the surviving set (`lib/run.mjs:2189-2203`), so the run would commit. The last adjudication's survivors are in `review.json`, which every adjudication of this run writes (`lib/run.mjs:2051`) and `run reviewed` always wrote first. It is read before anything rewrites it and is left as it is when its findings are kept. If it is absent, unparseable or without its `surviving` list, there is nothing to stand on and nothing to adjudicate: the run halts with the reason, which is the one outcome that cannot clear a blocker. The living `ship/run-program` requirement that `run remediated` re-adjudicates is kept: the round is adjudicated, from the only findings the run can vouch for.

A review recorded as not completed still writes its review-metrics record and, at close, its autonomy record, both with the counts the adjudication produced, as they do today for a review step that reported failure. Both are storage only, `ship/run-program` requires the autonomy record, and that capability is one the sibling change modifies, so this change leaves them alone.

`remediate` handed a review record now reads its `surviving` list too, which is the list it was always meant to plan from.

*Alternative considered:* making `flatten` throw. `ready` would inherit the right behaviour through its existing `attempt`, and a run would crash mid-adjudication, which the trajectory rules treat as a halt.

**BREAKING** for a caller that hands `gate`, `review` or `remediate` an object such as `{}` to mean "nothing found". An empty list says that, and still passes.

### D11. A pattern is `*` or `?`, nothing else

Square brackets and braces occur in real paths (`app/[id]/page.tsx`), so only `*` and `?` mark an item as a pattern. The item becomes a parse problem whose text carries the section's label, in the form the existing threshold-shaped problem uses (`"<section label>" item "<item>" …`). `reviewPolicyAtBase` keeps do-not-report problems out of the human-paths signal by matching on that label (`lib/merge-evidence.mjs:188-190`), and `readHumanPaths` turns every remaining problem into amber needing a person (`lib/merge-confidence.mjs:634`), so no signal code changes.

### D12. A list cut to nothing: the sibling's spec already says flag, the code returns early

The unarchived sibling's requirement states that a list from which the bound left requirements out adds `requirements-omitted`, whatever the band. `readLivingConformance` returns for a zero count before reaching the flag. This is a defect against a requirement already written, so it is fixed with a test and no new requirement.

### D13. Unmeasured changed source is a flag, with the input naming the files

`lib/coverage.mjs` documents on purpose that a line in a file the report never saw is not a changed line. That stays true for the figure. The input gains the coverable source files with added lines and no record, and the count of those lines; `readCoverage` adds the new flag `unmeasured-source` to a green reading and names the files in the evidence of any reading.

*Changed after review:* the first draft read amber at the size floor. That contradicted the living rule that a change under the small-change floor is green whatever the figures, and it gave an amber nothing could lift to files a project leaves out of coverage on purpose (generated code, a second language), which an lcov report cannot tell from files no test loaded. A flag lowers the score and says what was not measured; it does not close the gap for a team that wants untested new code held, and that is a threshold the owner may want later.

`FLAGS` gains one entry. Its `docs/15` row and its fixture come with it, as the registry rule requires.

### D14. Label names have one definition; the skill removes, then adds, and only for the head it assessed

`lib/merge-confidence.mjs` exports a frozen `MERGE_LABELS`:

```
{ verdicts: { MERGE: { name: 'interlock/merge', color, description },
              HUMAN: { name: 'interlock/human-review', color, description },
              BLOCK: { name: 'interlock/blocked', color, description } },
  scorePrefix: 'interlock/score-',
  score: { color, description } }
```

`color` is six hexadecimal digits with no `#`, the form `gh label create --color` takes. The assessment carries `labels: { verdict: { name, color, description }, score: { name, color, description }, verdictNames: [three names], scorePrefix }`. The score is written unpadded (`interlock/score-7`), as the brief writes it. The skill carries no label name of its own: it reads the two to add from `labels.verdict` and `labels.score`, and identifies predecessors by `labels.verdictNames` and `labels.scorePrefix`. The brief's token pins for the label names therefore sit on `docs/15`, where the recipes need them, and the skill suite asserts the skill carries none.

The skill removes every verdict and score label the merge request carries and then adds the two printed, in two calls, so an unchanged verdict still produces a new label event for a platform policy to react to.

Before labelling the skill reads the platform's head again and compares it with `head.sha` from the JSON. A push that lands between the assessment and the label would otherwise put `interlock/merge` on a commit nobody assessed, and no later event would clear it.

### D15. The description block is printed by the command, and every sourced string is a code span

`--markdown` prints the block; `formatMergeConfidenceMarkdown(assessment, { head, base, excluded })` renders it, `head` being `{ sha }` or null, `base` `{ ref, sha }` or null, `excluded` a list of names. `--markdown` joins `BOOLEAN_FLAGS` so it never swallows a following change name. The signal table sits in a `<details>` element, which both platforms render.

Reasons and evidence quote names this repository does not control: a check is named by the workflow that defines it, a finding by the reviewer, a ledger question by its author. Each reason, each evidence line and each excluded name is therefore rendered inside an inline code span: backticks replaced with `'`, line breaks folded to a space, `|` escaped in table cells, and the text cut with an ellipsis at a module constant of 240 characters. That is a display bound the verdict never reads, not a limit; it is named here because an existing pin (`test/spine/merge-confidence.test.mjs:1514-1521`) fails on any literal in the module that equals a published band value, so the constant must not be one. A code span renders no mention, no link and no markup, so a check named with `</details>` stays text. The receipt leaves these lines out for the same reason; the description cannot, so it quotes them inertly.

`--confidence-comment` posts the same text as a comment, so each assessment leaves one entry in the timeline naming its commit.

*Alternative considered:* a `markdown` string inside the JSON. A model copying a JSON-escaped multi-line string is the transcription this change exists to remove.

### D16. What the skill passes

- The change, when one resolves. When none does the command says so and the affected signals read amber; the skill reports that and does not guess a change. A change archived before the merge request cannot be resolved, so the skill's closing note keeps saying to archive after the merge.
- `--base origin/<target branch>`, the branch name taken from the platform's merge request document, after fetching it.
- `--pipeline .claude/ship/pipeline.json`, written by `interlock pipeline --out`. When that command exits non-zero the skill stops the assessment: there is no file to pass, by D2.
- `--run .claude/ship/merge-confidence.json` when that file exists. The command applies every condition (D8) and prints its reason when it takes nothing.
- Nothing from the merge request's title, description or comments.

### D17. Three recipes, each resting on what was read, none exercised

`docs/15` documents, as sketches in the manner of the baseline job already on that page, each under a `### Recipe:` heading that opens with three labelled lines (`**Merges:**`, `**Clears labels:**`, `**Exercised:**`) so the pins have something to hold:

1. **GitHub, native.** A ruleset requiring one approval with stale approvals dismissed, and a workflow triggered by `pull_request_target` for `labeled` and `synchronize`: on `interlock/merge` it approves as the Actions bot; on new commits it removes the verdict and score labels. `pull_request_target` runs the workflow as the base branch has it and the job never clones the head, so a pull request cannot rewrite its own gate. It needs the repository setting that lets Actions approve pull requests. GitHub's settings page does not say whether that approval counts toward a required-approval rule; the recipe says so.
2. **Mergify.** A queue rule on `label=interlock/merge` with `check-success` conditions, plus the same label-clearing workflow, because Mergify has no condition for a label older than the head.
3. **GitLab.** A merge request pipeline job that reads the merge request's current labels through the API and passes on `interlock/merge` or an approval, with "pipelines must succeed"; an earlier job that removes the labels when a pipeline starts for new commits. Both need a project token. The job is the gate's own check, so the skill is run with `--gate-check`, and because a label change starts no pipeline the job is retried after labelling.

And the CI job: `interlock merge-confidence --require-merge` reads `HUMAN` unless it assesses the pull request's head commit (GitHub's default is the merge commit), is handed the run's evidence file, and excludes itself.

Facts read on 2026-10-12: `pull_request` and `pull_request_target` activity types include `labeled` and `synchronize`; events raised with the repository token start no workflow; `CI_MERGE_REQUEST_LABELS` is set before the pipeline and only in merge request pipelines; Mergify's `label`, `#approved-reviews-by` and `check-success` attributes.

### D18. The page says how far a label can be trusted

A label is the claim of whoever ran the skill on their machine. Anyone who can label a merge request can make the same claim by hand, and the timeline shows who did. A team that needs a gate an author cannot assert for themselves has to produce the evidence on a machine the author does not control, which this epic does not provide. The brief already frames the label as advice to a policy the repository owns; the page states the consequence.

### D19. The four unnamed files are named where their behaviour is specified

`lib/merge-confidence.mjs` and `lib/coverage.mjs` are named by requirements this change adds or modifies for them. `lib/spec-audit.mjs` and `lib/spec-text.mjs` get one added requirement each that states behaviour they already have and that `docs/15` currently misdescribes: which of the audit's two outputs carries the per-capability measures, and that a root-level file with an extension is named by its `./` form (the mention rule needs a directory and an extension, `lib/spec-text.mjs:34`). Each comes with a pin test, so neither is a requirement written only to carry a path.

Three other files the epic added (`lib/merge-evidence.mjs`, `lib/prompts/domain-context.mjs`, `lib/spec-coverage.mjs`) are named only by the sibling change's deltas. They become named in the living specs when that change is archived, which is why the archive is a precondition of this goal and not of this change's code.

### D20. The banner follows the page, as one line

`docs/04-when-it-stops.md:705` says `DOMAIN REVIEW PARTIAL` covers a size cut. The code raises it only for a missing graph. The page is right by this repository's own rule that a degradation is spoken, so the code changes. `raiseOnce` keeps one banner per label (`lib/run.mjs:1599-1603`), so the cut and the missing graph cannot be two banners: when both hold, one line states both. The limit is cited by its key, `maxDomainSpecChars`, as the merge verdict cites its limits, so nothing in `lib/limits.mjs` moves.

On this repository's specs the banner will be common: 22 of 66 specs exceed the bound alone. That is the bound's problem, now visible.

### D21. The skill needs no shell redirect and no new tool

`interlock pipeline` reads its document from standard input and writes with `--out`, creating directories, so every step is a pipe between two commands the skill is already allowed. GitHub's second document is three or four names passed as flags (D3); GitLab's commit travels in the file the first step writes (D4).

### D22. Output shapes that widen, and the pins that move with them

These existing assertions change, each in the red wave, and nothing else about their tests changes:

| Pin | Today | After |
|---|---|---|
| `test/spine/coverage.test.mjs:24` | the shared `SEVEN_FIELDS` list, which the assertions at `:168`, `:196`, `:210` and `:227` all read | the nine fields |
| `test/spine/cli.test.mjs:3630`, `:3733` | `verify coverage` prints exactly seven fields | nine |
| `test/spine/merge-confidence.test.mjs:276-279` | `FLAGS` deep-equals eleven names | twelve, with `unmeasured-source` |
| `test/spine/merge-confidence.test.mjs:1193-1199` | a run record without `leftoverTasks` reads `run.integrity` green | unobserved, naming `leftoverTasks`; the first half (a zero count is green) stays |
| `test/spine/run.test.mjs:7034` | a strict close in the harness reads `run.integrity` green | unobserved, naming the permission-prompt and auto-mode-denial counts the harness never observes; a second close in the same test file, given a host record, reads green |
| `test/spine/merge-confidence.test.mjs:535-539` | the one coverage fixture allowed under the small-change floor is `coverage-tiny-diff` | `coverage-unreported` is allowed too, and both are asserted to sit under the floor. Found during the red wave, not at design time: that fixture has zero measured changed lines by construction (D13) |

`test/fixtures/merge-confidence/all-observable-green.json` gains the two unreported fields, as an empty list and a zero, so that the green input is what a current producer prints and `coverage-unreported-fields-absent` is that input with one thing changed.

`merge-confidence --json` gains `head`, `base` and `labels`; `test/spine/cli.test.mjs:2986` checks for keys by name and is unaffected, and the receipt whitelists its block by name (`test/spine/receipt.test.mjs:518`) and does not carry labels. `test/spine/merge-evidence.test.mjs:277` hands a one-field run record to the gatherer, which does not assess it. Run records in `test/fixtures/merge-confidence/` all carry the seven observations.

A task that finds a pin outside this table moved stops and says which.

### D23. A hand review's evidence stays out

`interlock review --json` redirected to a file is accepted by `--review` today. Wiring the `review-code` skill to save it for the `mr` skill would need a rule for which commit that review covered, which is what the run's evidence file exists to answer, and it would still read `HUMAN`: `run.integrity` has no producer off-run. The block shows each run-supplied signal as the command reads it with no file, with the command's reasons.

### D24. A run adjudicates only what this review wrote

The findings and verdicts work files sit in `.claude/ship/`, which is never cleared between runs, and nothing removes them. A review step that writes nothing therefore leaves an earlier run's findings to be adjudicated as this run's, and D10's "absent file" could never be observed. `reviewStep` removes both files when it first emits the review step. `run next` serves no stored step: it derives the step again through the same function, so "first" is decided by a marker on the manifest. `manifest.reviewDimensions`, which `reviewStep` already sets when it emits the step (`lib/run.mjs:1836`), is that marker: the files are removed only while it is unset, since afterwards the reviewer may already be writing. The review briefing (`lib/prompts/review.mjs:149`) and the remediation briefing (`lib/prompts/remediate.mjs:125`) each gain one sentence telling the agent to write `[]` to the findings file when nothing is found, pinned in the prompt suite, so that a clean result is a file with a list in it and not an absence. Without the second sentence a fix round whose re-review found nothing and wrote no list would keep the blockers it had just fixed.

The remediation rounds are left as they are: their files are this run's own previous round, and D10 covers a round that leaves no list.

*Added during implementation:* a removal that fails (a read-only work directory) is spoken as one banner, `REVIEW WORK FILE NOT CLEARED`, naming the path, because the run then continues with a file it could not vouch for. It has its section in `docs/04`, which the banner ratchet in `test/workflows.test.mjs` requires of every new banner.

## Risks / Trade-offs

- [The GitLab reader and all three recipes are unexercised] → Each recipe opens with an `**Exercised:**` line and lists the claims resting on documentation; the reader refuses unrecognised documents. The first real GitLab merge request is the test.
- [The skill's steps are prose; no test runs `gh`] → Token pins hold every command line and field key; one CLI test drives the whole chain from a captured `gh` document to a `MERGE` verdict, its labels and its block. Running the skill on this branch's own pull request is the remaining proof, and it is the owner's to run.
- [`gate`, `review` and `remediate` refusing `{}` breaks a caller] → The message names the accepted shapes. An empty list is the way to say "nothing found".
- [A review step that writes no file is now "not completed" where it was "clean"] → The briefing asks for the empty list (D24). A reviewer that ignores it produces an amber `review.ran`, which costs a look and grants nothing.
- [Runs on a host with no recorder now read `HUMAN` on `run.integrity`] → The reason names the two counts. Those runs had no basis for green.
- [The banner in D20 fires on most strict runs here] → It is one line, raised once per run, and it is true.
- [`unmeasured-source` does not stop a merge] → By design (D13). It is visible in the block and lowers the score.
- [This change is wide: ten modules and a skill] → Three sections, a leading failing-test wave, exports and output forms stated in D2, D8, D14 and D15, pins that move listed in D22.
- [Most merge requests will still read `HUMAN`] → See Open Questions. The verdict is correct; whether it is useful at that rate is D1.

## Migration Plan

1. Archive `complete-and-record-the-merge-verdict` first (`openspec archive complete-and-record-the-merge-verdict`). This change's code does not depend on it. Two things do: the spec-coverage goal (D19), and the order of the living `review/merge-confidence` spec, which both changes add to.
2. Ship this change with `--strict` from a session that loads this repository's plugin. The installed plugin is 1.4.2, whose loop has none of the epic's review code, and the strict tail the epic changed has never run in a real host.
3. Open the pull request for the branch and run the `mr` skill on it. Expect `HUMAN`: several commits, no single run's evidence covers the diff (D8).
4. Archive this change after the merge.

Rollback is a revert of the commit. The only state written is under `.claude/ship/`; labels already on a platform are removed by hand.

## Open Questions

**D1. Should `risk.class` keep reading the change's prose at merge?** Not answered here; the ledger carries it as needing a person.

The classifier matches keywords in the artifacts as well as paths, by design: before a ship there is no diff, and a false positive costs one human read. At merge the same rule decides whether a machine may say `MERGE`. Measured on this repository's 62 archived changes, each given one neutral source path: 4 read `medium`, 26 `high`, 32 `critical`. 54 of the 62 designs carry the OpenSpec template's own "Migration Plan" heading, which matches; removing that heading alone moves 5 changes to `medium`; ignoring code spans moves none. So on this repository 58 merge requests in 62 would be labelled `interlock/human-review` by `risk.class` whatever their evidence.

The options are to leave it (correct, and nearly uninformative here), to judge `risk.class` at merge on the touched paths alone while continuity keeps the prose, or to make the prose match narrower. The second loosens a gating signal and the third touches the classifier continuity relies on, so neither is taken without the owner. Whatever the answer, nothing in this change's specs or tasks moves.
