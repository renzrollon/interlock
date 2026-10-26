## Context

Five subagent spawns sit on the paths `/interlock:spec` and `/interlock:settle` run, and none names a model or an effort: explore's investigators (`skills/explore/SKILL.md:89`, reached from spec §1b), review-code's dimension reviewers and skeptics (`skills/review-code/SKILL.md:50`, `:96`, reached from settle §5a and §5c), and settle's fixer and conformance worker (`skills/settle/SKILL.md:226`, `:357`). Spec spawns nothing itself (no Agent tool in its `allowed-tools`), and review-artifacts runs both of its reviewers inline. On this host the per-call defaults are: a `general-purpose` agent runs on the main conversation's model; the built-in `Explore` agent runs on the main conversation's model, except that a Fable session's Explore runs on `opus` over a subscription, Console or `ANTHROPIC_BASE_URL` gateway; an agent with no `effort` runs at the session's level.

Ship already solved this for its own spawns. `EFFORT.byTier`, `EFFORT.verify` and `EFFORT.skeptic` in `lib/limits.mjs:465-469` are published by `interlock limits`, read by `lib/run.mjs` when it emits a step, forwarded by the drivers, and bannered when `CLAUDE_CODE_EFFORT_LEVEL` or `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` makes them not in effect (`lib/run.mjs:2764-2784`, `workflows/ship.js:558-561`). `EFFORT.skeptic` is read only there (`lib/run.mjs:1980`, `:2018`, `:2055`): the same skeptic, spawned by the review-code skill under settle, runs at whatever the session has.

What a `settle --review` pass spends, from the records of the pass on PR #24 (head `8685077`, a seventy-one-file diff). Review r0 selected and ran six dimensions (`language`, `architecture`, `qa`, `technical-lead`, `domain`, `blast-radius`; `dimensions-r0.json`) and left twenty-one surviving findings: four blockers, seven warnings, ten suggestions, none dismissed, none dropped by the band (`review-r0.json`, `counts`). The eleven blockers and warnings each received two skeptics — twenty-two skeptic agents — and sat at seven `file:line` locations; the four blockers were one issue at `test/retired-names.test.mjs:153`, raised once each by `language`, `architecture`, `qa` and `technical-lead`, each paraphrase its own identity under `findingKey` and so its own skeptic pair. Across the three reviews on that change the skeptics refuted none of forty-nine findings (`.claude/metrics/review-rename-*.json`: raised 24, 21, 4; dismissed 0, 0, 0). Round 1 fixed four findings and declined seven, every one of them for sitting in the protected `test/retired-names.test.mjs` (`remediate-r1.json`); the re-review then ran all six dimensions again over the whole diff (`dimensions-r1.json`). A second round would have briefed the same seven findings to a fixer that cannot edit their file. Settle keeps no cost record of its own spawns, so the owner's figure is the session's; the agent counts are the record.

What the published work on automated review gates says, and what this design takes from it:

- Anthropic's account of its own code-review service ([Solving code review at Anthropic](https://claude.dev/blog/solving-code-review-at-anthropic)) runs three depths per repository, quick to deep, has parallel reviewers whose findings are then voted on by verifiers, drops style and cleanup findings, re-reviews only the diff once a first pass has run, and reports that one remediation round moved the pass rate from 65% to 78% and the mean reviews per pull request from 2.08 to 1.32, with the reviewer asking the author to step back after three rounds. Taken: two published depths, a diff-scoped re-review, a round cap that is a published number.
- *Refute-or-Promote* ([arXiv 2604.19049](https://arxiv.org/abs/2604.19049)) finds that adversarial framing alone does not remove false positives and that a mandatory empirical check — run the thing the finding claims — is what does, killing a defect ten reviewers had endorsed. Taken: the strict skeptic runs the check a finding claims before voting; the evidence rule stays at both depths.
- Studies of LLM reviewers over-flagging ([arXiv 2603.00539](https://arxiv.org/abs/2603.00539), [arXiv 2508.12358](https://arxiv.org/abs/2508.12358)) find that more detailed prompting raises the false-fault rate. Taken: the lean depth runs fewer personas rather than longer ones, and the overlap on PR #24 is the local evidence that four personas on one diff converge on the same defects.
- Tiered and tunable review ([Tiered & Tunable Review, agentpatterns.ai](https://learn.agentpatterns.ai/code-review/tiered-and-tunable-review/)) measures a default tier at roughly 0.7 bugs per run against roughly 0.95 for a high tier at the same resolution rate, and escalates by policy: path criticality, size, author trust, defect history. Taken: the depth is a table and a flag; escalation by risk class is a named follow-up, not a guess in this change.
- Incremental re-review that carries prior findings forward is how CodeRabbit and comparable tools keep a pull request's state across pushes ([hamedghaderi/review#52](https://github.com/hamedghaderi/review/issues/52)). Taken: `interlock review --carry`.
- GitHub reports a cost reduction of about a fifth on Copilot code review from changing how the reviewer reads files, at the same review quality, and a medium analysis tier that routes complex pull requests to a dearer model ([Copilot code review: analysis depth and efficiency updates](https://github.blog/changelog/2026-06-25-copilot-code-review-analysis-depth-and-efficiency-updates/)). Taken: reading is where the cost is, so the re-review reads only the dimensions whose findings moved, and the depth is a published tier.

Constraints this design works under:

- Thresholds live in the CLI, not in prose (`.claude/CLAUDE.md`, `docs/06-why-it-works.md:80`). A model slug or an effort level in a skill is a threshold.
- Zero runtime dependencies; stdlib Node only.
- `bin/interlock` is 242,818 bytes, and `test/spine/package.test.mjs` fails any shipped file above the plugin directory's 256 KiB limit less a 16 KiB headroom, 245,760 bytes — about 2.9 KB of room. New logic goes in `lib/`; the binary gains argument parsing and calls.
- Guards fail open, and degradation is spoken: a spawn site that cannot learn its routing says so and spawns anyway.
- The Agent tool's own rule sets `effort` only when a skill or CLAUDE.md explicitly asks; a skill instruction is that ask. A per-call `effort` is applied by Claude Code 2.1.292 and later (installed: 2.1.310). `CLAUDE_CODE_EFFORT_LEVEL` outranks it; `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` makes the host ignore a per-call `model`.
- A prose instruction nobody asserts silently stops running: every new instruction is pinned by token in `test/skills.test.mjs`.

## Goals / Non-Goals

**Goals:**
- Every prose spawn site spec and settle reach passes a `model` and an `effort` read from one published table, and never a literal.
- The skeptic runs at one published effort whichever path spawns it.
- An environment override that makes the routing not in effect is said at the spawn site, in the words ship already uses.
- A site that cannot learn its routing says `ROUTING UNAVAILABLE` and spawns at the session defaults rather than stopping.
- The host's per-call effort floor is reported where the other subagent-routing host facts are: `interlock doctor`.
- A `settle --review` pass spends, by default, the fewest agents that still produce a record the merge verdict can read as complete: fewer dimension reviewers, two skeptic agents per review, a re-review scoped to the dimensions whose findings were fixed, and no fixer round on findings the loop can see will not be fixed.
- A strict depth exists, is one flag away on settle and on review-code, and is the review the skills ran before this change plus the empirical check.
- The depth a review ran at is on its record and in the verdict's evidence.

**Non-Goals:**
- Ship's run program, `lib/waves.mjs`, `lib/lane.mjs`, the classifier and the plan's tier routing. The owner judged plan-waves fine (D4).
- `review-artifacts`, which spawns nothing.
- The spec meter's investigator line in `hooks/mod.mjs` (D10).
- Routing for hosts other than Claude Code: these skills run only where the Agent tool exists.
- Tuning the values after this change lands: each is one line in `lib/limits.mjs`.
- Ship's strict tail: it already re-reviews only `plan.reReviewDimensions` (`lib/run.mjs`, `remediateStep`) and its fixer runs under the test guard hook; neither the carry nor the deferrals are needed there.
- `LIMITS.remediationRounds`: one cap for both loops, unchanged.
- The conformance worker: it runs at both depths, because the delta-conformance and living-conformance signals read its answers and nothing else; dropping it would turn two gating signals unobserved to save one Sonnet spawn.
- Choosing the depth from the risk class or the diff size (D14). The two depths should run on real pull requests first.
- Merging paraphrases of one finding into one identity. `findingKey` is file plus title by design (`review/settle-loop`, the replies requirement); the lean skeptic is told to judge overlapping findings once instead.

## Decisions

### D1 — The initial table values are the owner's call; the code ships with these (needs_human)

| role | spawned by | model | effort |
|---|---|---|---|
| `explore-investigator` | explore §Investigator rules, reached from spec §1b | `sonnet` | `medium` |
| `review-dimension` | review-code §2 | `sonnet` | `medium` |
| `review-dimension`, `strict` override | review-code §2 under `--strict` | `null` (inherit) | `null` (inherit) |
| `review-skeptic` | review-code §3 | `null` (inherit) | `EFFORT.skeptic` |
| `settle-fixer` | settle §5c | `null` (inherit) | `EFFORT.skeptic` |
| `settle-conformance` | settle §5e | `sonnet` | `null` (inherit) |

Why these: an investigator locates and cites and returns JSON, and the synthesis stays in the session, so it is tier-2 work in ship's own terms; a dimension reviewer reads a diff against a written rubric and every blocker and warning it raises is then checked by two skeptics; the skeptic and the fixer mirror ship's `review` and `remediate` steps (`lib/run.mjs:1975-1980`, `:2015-2018`: model inherited, effort `EFFORT.skeptic`); the conformance worker is ship's handoff spawn (`lib/run.mjs:4095-4099`) with a cheaper model, since it writes prose answers from a diff. The one thing the repo cannot decide is whether a Sonnet dimension reviewer is an acceptable trade for the session-model one it replaces: the skeptics verify what is raised, not what is missed. That is the question in the ledger. The `strict` override is the answer for the reader who wants the session model back: under `--strict` the dimension reviewers inherit the session's model and effort, as they did before this change.

### D2 — A table in code, published by `interlock limits`, read through `interlock routing <role>`

Alternatives: (A) write `model: sonnet, effort: low` into each skill — rejected, it restates a threshold in prose, drifts across five files and cannot banner an override; (C) set `model`/`effort` in agent-definition frontmatter and spawn those types — rejected, explore needs the built-in `Explore` tool set, a per-call parameter outranks frontmatter anyway, and a definition cannot speak `CLAUDE_CODE_EFFORT_LEVEL`; (D) rely on `CLAUDE_CODE_SUBAGENT_MODEL` — rejected, it is the operator's environment, it does not touch the built-in Explore and Plan agents, and it says nothing about effort.

`SPAWN_ROUTING` is its own export in `lib/limits.mjs`, beside `EFFORT`, for the reason `EFFORT` is: the `LIMITS` invariant asserts positive integers and this is a table. `formatLimits` prints one `routing: <role>` row per role (`inherit` for a `null`, as the effort rows do), and `limits --json` emits the table under `routing`.

### D3 — The resolver is `lib/routing.mjs`; the `bin/interlock` case is a few lines

`resolveRouting(role, env, { depth })` returns `{ role, depth, model, effort, banners, overrides }` or throws a typed error naming the known roles or the known depths. `listRouting(env, { depth })` returns `{ depth, roles, review, banners, overrides }`, every role resolved under `roles` and the depth's `REVIEW_DEPTH` row under `review`. The binary parses `routing [role] [--depth <d>] [--json]`, calls one of the two, and emits. Nothing else, because of the file-size cap. The module imports only `lib/limits.mjs`, `lib/host/claude-env.mjs` and `lib/host/effort.mjs`.

### D4 — Ship's spawns are untouched

Human decision, 2026-10-26: "ship's plan waves are fine currently. only spec and settle." The living `effort-routing` spec names four run-program spawns as the inheriting set and the implementer, verify, review and remediation steps as the published-effort set; neither set changes.

### D5 — `null` means omit the parameter

The same meaning `EFFORT.byTier` gives it (`lib/limits.mjs:457-462`): the host's default applies, which for a model is the subagent model order Claude Code documents (per-call, then frontmatter, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main conversation's model) and for an effort is the session level. JSON prints `null`; text prints `inherit`. A skill told "a `null` means omit that parameter" has no second interpretation.

### D6 — `review-skeptic` and `settle-fixer` read `EFFORT.skeptic` by reference

Not a second constant with the same value: a later change to the skeptic effort must move both paths at once, or the inconsistency this change removes comes back. The table test asserts the identity.

### D7 — Override detection and the banner words are ship's

`effortLevelOverride(env)` (`lib/host/effort.mjs:50`) and `observeClaudeEnv(env)` (`lib/host/claude-env.mjs:130`) already read the two variables. `banners` carries `EFFORT ROUTING OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=<v> — every agent runs at that effort, so the effort this prints is not in effect` and `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=<v> — every agent runs on one model, so the model this prints is not in effect`. `CLAUDE_CODE_SUBAGENT_MODEL` alone raises no banner here: on 2.1.251 and later it is only a default below a per-call parameter, and whether this host is older is a version fact `interlock doctor` already reports (`lib/doctor.mjs:1203-1230`). `routing` runs no subprocess (D12) and so does not know the version.

### D8 — Fail open, spoken

An unknown role exits non-zero with `interlock: unknown routing role "<role>" — roles: <list>` on stderr and nothing on stdout, so a skill never reads a default as a decision. At the spawn site, any non-zero exit becomes one printed line, `ROUTING UNAVAILABLE: <first line of the command's output>`, and the spawn proceeds at the session defaults. Routing is guidance about cost, never a gate: a review that did not run because a cost hint failed would be the wrong trade.

### D9 — Explore's `allowed-tools` gains `Bash(interlock *)`

It pre-approves `interlock-graph` and `openspec` today (`skills/explore/SKILL.md:7`); without this line the routing call would stall an autonomous explore on an approval dialog under a restrictive user profile, which is the failure `test/skills.test.mjs:651` exists to prevent for the Agent tool.

### D10 — The spec meter stays as it is

`hooks/mod.mjs:699-702` already reads an investigator spawn's served model. Rendering it on the explore line is the natural follow-up and is left out so this change stays in the skills and the CLI.

### D11 — A new flat capability, `spawn-routing`

The `effort-routing` requirements are about the run program's steps and drivers (`openspec/specs/effort-routing/spec.md:191` lists the four inheriting spawns by name); none of its requirement text changes, so a MODIFIED block would carry nothing. A flat `specs/spawn-routing/spec.md` is also what the installed `openspec validate` parses.

### D12 — The per-call effort floor is reported by `interlock doctor`, not by `routing`

`PER_CALL_EFFORT_MIN_VERSION = '2.1.292'` joins `SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION` and `SUBAGENT_MODEL_FORCE_MIN_VERSION` in `lib/host/claude-env.mjs:39-40`. The doctor already probes the version and prints the two subagent-model lines; it gains one more: applied on this host, or ignored below the floor, or cannot establish. `routing` is called once per role from inside a skill and must stay a pure lookup: no `claude --version` per call.

### The command

```text
interlock routing <role> [--depth lean|strict] [--json]     resolve one role at a depth
interlock routing [--depth lean|strict] [--json]            print the whole table at a depth
```

Without `--depth` the published default applies, and the answer says which depth it used. JSON for one role:

```json
{ "role": "review-dimension", "depth": "strict", "model": null, "effort": null,
  "banners": [],
  "overrides": { "effortLevel": null, "subagentModelForce": null } }
```

JSON with no role:

```json
{ "depth": "lean",
  "roles": { "explore-investigator": { "model": "sonnet", "effort": "medium" }, "...": {} },
  "review": { "dimensions": ["language", "technical-lead"], "skeptics": "per-review" },
  "banners": [],
  "overrides": { "effortLevel": null, "subagentModelForce": null } }
```

Text for one role: `routing review-dimension (strict): model inherit · effort inherit`, followed by each banner on its own line. Text with no role: a `depth: <d>` line, one `routing <role>: …` line per role, a `review dimensions: …` line and a `review skeptics: …` line, then the banners. Exit 0 whenever the role and depth resolved, banners or not. An unknown depth exits non-zero naming `lean` and `strict`, as an unknown role names the roles.

### What each spawn site says

The same five sentences at each site, in the skill's own voice, with the role filled in: run `interlock routing <role> --json` once, before the first spawn of that role — review-code instead runs `interlock routing --json` once, with `--depth strict` under `--strict`, and reads both of its roles, the dimension set and the skeptic shape from that one answer (D15); pass its `model` and `effort` on every Agent call of that role, and a `null` means omit that parameter; print every line of `banners` verbatim; when the command exits non-zero, print `ROUTING UNAVAILABLE: <first line>` and spawn at the session defaults; never name a model or a level in the skill. `test/skills.test.mjs` pins, per site, the role's `interlock routing` line, `ROUTING UNAVAILABLE`, `banners` and the `null`/omit sentence, and asserts that none of the five skill files spells a `model:` slug or an `effort:` level as a spawn parameter. The settle edits keep every token already pinned at `test/skills.test.mjs:1722-1736` and `:1786-1797`; the review-code edit keeps `Spawn one agent per dimension` and the dimension table.

### D13 — The depth table values are the owner's call; the code ships with these (needs_human)

| depth | always-on dimensions | skeptics | dimension reviewer routing |
|---|---|---|---|
| `lean` (default) | `language`, `technical-lead` | `per-review`: two skeptic agents, each judging every blocker and warning | the `review-dimension` row |
| `strict` | `language`, `architecture`, `qa`, `technical-lead` | `per-finding`: two skeptic agents per blocker and warning, each running the check the finding claims | the row's `strict` override |

The conditional dimensions keep their triggers at both depths: `devops` on `needsDevopsReview`, `security` on an auth, input or data surface, `domain` when `interlock domain-context` selects, `blast-radius` when the graph exists. Why these two always-on sets: `language` reads the diff for correctness and `technical-lead` reads it against the change's artifacts, which are the two questions a merge verdict cannot do without; `architecture` and `qa` on PR #24 raised nothing the other two had not (their four blockers were the one defect at `test/retired-names.test.mjs:153`), and the over-flagging studies in the Context say more personas on one diff add false faults faster than true ones. What the repo cannot decide is whether a pull request that never ran `qa` and `architecture` is acceptable as the default; that is the question in the ledger, beside D1.

On PR #24 the lean shape would have spawned, per review, four dimension reviewers (`language`, `technical-lead`, `domain`, `blast-radius`) and two skeptics instead of six and twenty-two, and the round-1 re-review would have run the dimensions that raised the four fixed findings with the rest carried.

### D14 — The depth is a table and a flag; it is not chosen from the diff

`REVIEW_DEPTH` is published by `interlock limits`, read through `interlock routing`, and selected by `--strict` on settle and on review-code, exactly as ship's `--strict` selects its tail: the default is the CLI's, and the skill is told not to invent `--strict` because the diff looks large (`skills/ship/SKILL.md:40` has the sentence). Escalation by policy — risk class, diff size, path criticality — is what the tiered-review pattern recommends and is the natural next change: `interlock risk` and the merge bands already classify both. It is left out here because the two depths have not yet run on a real pull request, and a default whose cost depends on a classifier the owner has not watched is a default nobody can budget.

### D15 — Review-code reads one `interlock routing --json` answer, not one per role

Review-code needs four things before it fans out: the `review-dimension` routing, the `review-skeptic` routing, the depth's always-on set and its skeptic shape. The no-role answer carries all four (`depth`, `roles`, `review`), so the skill runs one command, with `--depth strict` under `--strict`, and reads from it. The other sites keep the one-role call: explore and settle have no depth and one role each at their site. The spawn-routing requirement says so in those words.

### D16 — Lean skeptics are per-review, and the verdict floor still holds

The merge verdict's adversarial signal reads `MERGE_BANDS.minVerdictsPerFinding` votes on every surviving blocker and warning (`lib/merge-confidence.mjs`, `readReviewAdversarial`); a review that gave a finding one vote can never reach `MERGE`. So lean does not cut the votes: it cuts the agents. Two skeptic agents each receive every blocker and warning, grouped by file by the skill (the same `groupByFile` partition `planRemediation` uses), and each emits one verdict per finding id, so every finding still carries two votes from two agents. Each is told that findings naming one file and overlapping lines are one issue: judge it once, answer under each id. That is how four personas' paraphrases of one defect cost one reading instead of eight. The evidence rule does not change — a dismissal cites a `file:line` span in the diff, an uncited refutation dismisses nothing — and so `review.adversarial` reads a lean record exactly as it reads a strict one. The skeptic prompts stay where they are; the lean paragraph says how the two agents are given their findings.

### D17 — Strict skeptics run the check the finding claims

*Refute-or-Promote*'s result is that an adversarial framing changes little and an empirical gate changes a lot. The strict skeptic is told: when a finding claims something you can observe — a test that fails, an export that is missing, a branch that is unreachable, a command that errors — run it or read it before you vote, and put what you saw in `evidence`. That is the one sentence that makes strict stricter and not only dearer. Lean skeptics keep reading the span: the check costs tool calls, and the lean depth is the one that must stay cheap. The sentence is pinned by token.

### D18 — A round re-reviews `reReviewDimensions` and carries the rest

`planRemediation` already returns `reReviewDimensions`, the dimensions whose findings the round fixes, and ship's `remediateStep` re-reviews only those (`lib/run.mjs`; the policy comment in `lib/remediate.mjs`, point 3: "re-running a dimension that was already clean is pure token cost"). Settle ignored it and re-ran the full selection. Now `remediate-brief --json` exposes `reReviewDimensions`, the skill passes them as `--dimensions` on the round's review-code pass, and `--carry <previous record>` keeps the record whole: `interlock review --carry <file>` copies from that file's `surviving` every finding whose `dimension` is not in this review's `ran`, marks each `carried: true` with `carriedFrom: <that file's head>`, and appends it to `surviving`. It needs `--dimensions` to know what ran and exits 1 without it, and it refuses a carry file with no `surviving` list, as every reader of a review record does. `counts.surviving` keeps counting the list as emitted, so a reader that checks the length still finds it; `counts.carried` says how many of those were carried, and the partition reads `raised = droppedByPolicy + dismissed + droppedByQuality + surviving − carried`. The metrics record counts only what this review raised; a carried finding was counted by the review that raised it. The formatter prints a `carried=<n>` line. `interlock settle replies` keeps its identity rule — a carried finding's key is unchanged, so it reads `open` — and suffixes it `(carried)`, so the reply table says which open findings were not looked at again. On a pass whose first review used `--dimensions` by the caller's hand, the carry still works: it reads `ran`, not the selection. A round whose plan fixes nothing never reaches a re-review, as before.

### D19 — Two deferrals in `remediate-brief`, before the planner runs

Both are decisions the command can make from what it already holds. (1) Protected paths: the command computes, from the test profile, the paths the fixer must not edit, to print them in the briefing. A finding whose `file` is one of them cannot be fixed by that fixer, so it is deferred before planning with `protected test path <file> — the test guard keeps the fixer out of it; a person fixes it`. On PR #24 that is seven of eleven findings, and the first round would have briefed four. (2) Declined findings: with `--previous <remediate-r<r-1>.json>`, a finding that result listed under `notFixed` is deferred with the fixer's reason quoted, so a round never re-briefs what the last fixer declined. The skill passes `--previous` from round 2 on. Both deferrals are listed in the briefing under a `Deferred this round` heading with their reasons, and both leave the finding exactly where it was: it is still `open` in the reply table, still a blocker or a warning in the record, still red or amber in the verdict. When the deferrals leave nothing fixable, the command exits 1 with `STOP: nothing fixable remains — <p> finding(s) in protected test paths, <d> declined by the round <r-1> fixer`, and the loop ends as on any other `STOP:`. The deferrals live in `lib/settle-cli.mjs` (`briefedRound`), not in `planRemediation`: ship's fixer runs under the `guard-tests` hook and has no profile copy, and a planner shared by both loops must not learn a settle-only input.

### D20 — The record and the verdict say which depth ran

The dimension record gains `depth` (`lean` or `strict`); `readDimensionRecord` accepts it as an optional string and refuses any other value; `interlock review` records it under `dimensions.depth`. `merge-confidence`'s ran-signal evidence names it (`depth: lean`) when present and says nothing when absent, so a record written before this change reads as it did. No flag and no band: lean is the published default, not a degradation, and a score that dropped on every default pull request would be a threshold stated in a flag. The depth being in the evidence is what lets the person reading a `MERGE` ask for `--strict`.

### D21 — `review/settle-loop` is held by an open change; this change archives after it

The settle loop's capability is ADDED by `close-the-merge-request-loop`, which is not archived (its task 8.5 waits on the owner's real remote run), and `rename-the-review-loop-to-settle` edited that delta in place and archives after it. This change MODIFIES four of its requirements (the loop order, the review record, `remediate-brief`, `replies`) and quotes their titles verbatim from that delta. The living specs do not hold them yet, so this change archives after `close-the-merge-request-loop` and after `rename-the-review-loop-to-settle`, never before either (task 6.6). In `review/merge-confidence` it ADDS one requirement and touches none the open change MODIFIES, so there is no second ordering constraint there. `review/review-depth` is a new nested capability beside the other `review/` capabilities; `spawn-routing` stays flat as D11 says.

## Risks / Trade-offs

- [A Sonnet dimension reviewer misses what a frontier reviewer would catch] → the values are the human decision in D1, and each is one line in `lib/limits.mjs`; the two skeptics stay at the published `xhigh`.
- [The host is older than 2.1.292 and ignores the per-call `effort`] → `interlock doctor` says so (D12); the model half of the routing still applies.
- [`CLAUDE_CODE_EFFORT_LEVEL` or `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set] → the banner is the mitigation, as in ship; the variables are the operator's and are never unset.
- [A skill is reworded and the routing sentence is lost] → pinned by token per site; the test names the skill.
- [`bin/interlock` grows past the plugin's 256 KiB file limit] → the case is a few lines; the logic is in `lib/routing.mjs` (D3); the size is checked in the change's verification.
- [Review-code is also run standalone and in ship's `--strict` tail] → the skill change routes the standalone and settle paths; ship's `review` step keeps its own routing, and both read `EFFORT.skeptic` (D6).
- [The lean depth misses what `architecture` or `qa` would have raised] → the set is the owner's decision (D13), `--strict` is one flag away on both skills, the record and the verdict say the review was lean (D20), and the conditional dimensions still fire on their surfaces.
- [A carried finding is stale: the fix round changed the code under it] → it is marked `carried` with the head it came from, the reply table says `(carried)`, and the next full review — a strict pass, or the first review of the next pass — re-examines it; a carried blocker still blocks.
- [A deferral hides a finding] → never: it is printed in the briefing, stays in `surviving`, reads `open` in the reply table and keeps its band in the verdict; the only thing it skips is a fixer that cannot act on it.
- [The lean skeptic agent, given every finding at once, votes carelessly on the long tail] → each vote still needs cited evidence to dismiss, and the quality band scores each verdict as before; a skeptic that dismissed without evidence changes nothing.
- [A routing failure at review-code falls back to the strict shape and the pass costs what it did before] → that is the fail-open direction `ROUTING UNAVAILABLE` names; a lean fallback would be a cost hint deciding what a review covers.
