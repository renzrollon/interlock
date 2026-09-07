# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **An unattended ship run that stops can now reach you.** Four independent "quick win" gaps closed at the one seam both hosts already pass through — `interlock run close`:

  - **Push on halt or completion.** With `INTERLOCK_NTFY_TOPIC` set, `run close --notify` — which both `workflows/ship.js` and `bin/interlock-run` now pass on every close — posts one [ntfy](https://ntfy.sh) message per terminal outcome: `high` priority on `SHIP HALTED`, default otherwise. The message carries the summary's first line, the change and the run id, and nothing that identifies the machine — never the topic, the cwd or the project slug. `INTERLOCK_NTFY_URL` selects a self-hosted server (default `https://ntfy.sh`); leaving the topic unset makes the default path, and the test suite, open no connection at all. A failed push prints `push: failed — <reason>` and a `PUSH FAILED: <reason>` degradation banner and never moves the exit code. `interlock notify` and the `interlock notify checkpoint <change>` sugar (used by `/interlock:spec`'s checkpoint) are also callable standalone.
  - **The summary names the run and where it closed.** Every terminal summary now carries `run: <runId>` (or `run: none — the run halted before a plan was adopted`), `project: <slug>` and `cwd: <absolute path>` rows, so a reader who was not watching can find the trajectory file and the checkout afterwards. `<slug>` is a pure function of the closing directory (`lib/project-slug.mjs`), matching the directory name Claude Code uses under `~/.claude/projects`.
  - **A clean completion reminds you to archive.** When every task is ticked and the run did not halt, the summary prints `ARCHIVE PENDING — <change>: after merge, run openspec archive <change>` — plus `also unarchived: <n> completed change(s) — run interlock drift` when other changes are also sitting there — right before the closing "do not start another run" line. It is a reminder, never a gate: the exit code never moves, because the shipped change satisfies the unarchived check by construction at every clean close.
  - **`interlock doctor` stops reporting green for a run whose first ping prompts.** `REQUIRED_COMMANDS` gains `test`, `printenv` and `mkdir` — the commands the environment probe actually shells out to — each with a `why`, and a new `notify` row (`ok` naming the server, `skip` naming `INTERLOCK_NTFY_TOPIC`, never the value). A repo-fact test now checks this repository's own `.claude/settings.json` against the derived list, and a drift test extracts every instructed command out of `workflows/ship.js` and `lib/prompts/*.mjs` and fails, naming the file and the command, the moment one falls outside `REQUIRED_COMMANDS`, the runner commands, or the documented host read-only set (`HOST_READ_ONLY`).

  All four are additive: unset `INTERLOCK_NTFY_TOPIC` and a run behaves exactly as before, plus the three new identity rows and, on a clean ship, the archive line. See [when it stops](docs/04-when-it-stops.md) for `ARCHIVE PENDING` and `PUSH FAILED`, and the README's [push notifications](README.md#configuration-push-notifications) section for the two environment variables.

- **The CLIs install without Claude Code.** `package.json` was `private: true`, so the only way onto a PATH was a git checkout or the plugin install — even though the policy engine, the graph and the runner are stdlib Node with no dependencies and each is useful outside a Claude Code session. The package publishes as **`@renzrollon/interlock`** (`npm i -g @renzrollon/interlock`, or `npx -p @renzrollon/interlock interlock ...`), and the plugin install path is untouched.

  What ships is a **whitelist**, not an ignore list: `files` names `bin`, `lib`, `workflows`, `skills`, `hooks`, `agents`, `shared`, `.claude-plugin` and the three root documents, so a new directory cannot ship by accident. The failure that whitelist invites is the opposite one — a reachable `lib/` file left out packs cleanly, installs cleanly, and dies at the user's first command — so `test/spine/package.test.mjs` walks the transitive relative-import closure of **every declared `bin` entry** (including the bare side-effect `import` that is how `bin/interlock-graph` reaches the whole graph CLI) and fails naming any reached file no `files` entry covers. It also asserts each `bin` entry exists, is executable and carries the node shebang, and that `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` carry **one** `MAJOR.MINOR.PATCH` version — the `bump-release` skill keeps bumping them together, and a partial bump is now a red build rather than a habit that held.

  CI's `cli-smoke` job packs the tarball, installs it into a throwaway prefix, and runs every binary the `bin` map names plus `interlock limits` from that prefix — the map is read with `node -e`, so a renamed binary cannot fall out of the smoke silently. Releases publish from a `v[0-9]*` tag through `.github/workflows/release.yml`: `npm test` first, then `npm publish --provenance --access public` over the workflow's OIDC identity. **No registry token is stored in this repository.** Trusted publishing is a one-time console step on the registry for this repository and that file name; until it exists the publish step fails with the registry's own error and the workflow is reported failed, never skipped.

- **The ACP driver became a runner, and a host is now one file plus a declaration.** `bin/interlock-ship-acp` spoke one protocol to one kind of agent. Once the loop moved into the CLI, everything left in that file was a transport — and a transport welded to one vendor is the reason "Interlock runs on Claude Code and nothing else" was a portability claim nobody could act on. It is **`bin/interlock-run`** now, with `--host claude | acp | codex | qwen` (or `$INTERLOCK_RUN_HOST`), and an adapter under `lib/host/` is a transport plus a declaration of what that host **cannot** do: `schemaEnforced`, `modelSelect`, `worktree`, `hooks`, `usage`, `billing`. The run program reads those declarations; nothing branches on a host's name.

  `bin/interlock-ship-acp` still works: it prints `interlock-ship-acp is now interlock-run --host acp` on stderr — never on stdout, which carries the summary a caller may be parsing — and execs the runner with your arguments and its exit status. **It is removed in the next minor version (0.3.0).**

  Every vendor flag was verified against the installed CLI rather than taken from a doc, and one had drifted: `codex exec` (0.145.0) rejects `--ask-for-approval` outright, so the adapter does not send it — `exec` is the non-interactive mode and never prompts. `--dangerously-bypass-approvals-and-sandbox` is deliberately not used in its place; `--sandbox workspace-write` is the posture a ship lane wants. The three fixture CLIs under `test/fixtures/hosts/` **refuse** a wrong invocation rather than accepting one, so a drifted flag fails a test instead of producing a green run that enforced no schema.

- **Lane isolation is closed on the runner, which was the gap blocked on the host.** Under `--isolate-waves` the run program emits one worktree path per lane and the batch's merge base; `bin/interlock-run` runs `git worktree add --detach` per lane, spawns it with that directory as its cwd (for ACP, the session's cwd), and `interlock run record-batch` folds the clean lanes, removes their worktrees, and **halts naming the path and both lanes** when two of them wrote the same file despite a disjoint prediction. The path is derived by the CLI and read back by the fold rather than reported by the agent, so the checkout and the fold cannot disagree about where a lane ran. Who creates the worktree is the host's declared `worktree` capability — `runtime` on the Workflow host, which is unchanged — not a branch on its id. `docs/08-harness-landscape.md` said this gap was "the strongest argument for the host port"; it now says the port paid off.

- **Model routing is one published map, read by every host.** `INTERLOCK_MODEL_MAP` is a JSON object keyed by host id, each entry mapping the planner's tier slugs to that host's model ids; a malformed one fails the invocation at startup rather than three waves in. `claude` accepts `haiku`/`sonnet`/`opus` unmapped; `acp` negotiates as before; `codex` and `qwen` require a mapping and, without one, get **no model flag at all** and are named in `MODEL ROUTING UNAVAILABLE (<host>)` with the reason `no mapping for <slug>` — never quietly run on the operator's default and reported as the tier the planner asked for. `INTERLOCK_ACP_MODEL_MAP` keeps working as an alias of the `acp` entry.

- **The runner says which billing path it is on, and the receipt records it.** `ACP HOST (experimental)` is replaced by `RUNNER HOST: <id> (experimental)`, and three new banners state what a green summary would otherwise hide: `SUBSCRIPTION PATH: programmatic (<host>)` for a run over the Claude binary directly or through ACP, `CHATGPT PLAN PATH (codex)` when neither `CODEX_API_KEY` nor `OPENAI_API_KEY` is set, and `HOOKS NOT IN FORCE (<host>)` on a host with no equivalent of this repository's `PreToolUse` guards. The receipt carries `host: { id, billing, hooks, usage }`.

  **The default host does not change, and the reason is written down.** `/interlock:ship` launches the Workflow runtime, no skill ever starts the runner, and the runner refuses `--host workflow` from the other side. Inside an interactive session the Workflow runtime is the path Anthropic exempted from its paused programmatic-use billing change; `claude -p`, the Agent SDK and ACP are the flagged usage. `docs/04-when-it-stops.md` carries that paragraph, and the `SUBSCRIPTION PATH` banner points at it, so there is one place to update if the policy settles.

  A live probe settled the one condition the design left open: a plugin `PreToolUse` hook returning `permissionDecision: "deny"` **still blocks** under `claude -p --permission-mode bypassPermissions` (the call was refused and recorded in `permission_denials`). So `bypassPermissions` stays the unattended default and the `claude` host declares `hooks: true`; the fallback to `dontAsk` plus `--allowedTools` was not needed. The adapter passes `--plugin-dir` naming this checkout, which is what makes `--agent interlock:worker` resolvable and that declaration honest — and when the checkout is not the plugin it passes no `--agent` and declares `hooks: false` rather than assuming.

- **Token usage reaches the receipt when the host reports it, and is `unknown` when it does not.** Each adapter attaches `usage` beside a spawn's result from the vendor's own envelope, and `run close` sums it per wave and per run. One spawn without usage makes its wave — and the run total — `unknown`, never a smaller number: a partial sum looks like a measurement and is a lower bound. A host that reports nothing at all (`qwen`, `acp`) says so once, in the summary, instead of leaving empty figures to be read as zero.

- **The ACP host routes models per session, and the banner it used to print unconditionally became conditional and specific.** `bin/interlock-ship-acp` printed `MODEL ROUTING UNAVAILABLE (ACP host)` on every run, because when the adapter was written ACP v1 had no per-prompt model selector: the planner's slug travelled only as an `_meta['interlock/model']` hint an agent was free to ignore. So the tier ladder — haiku pings, sonnet implementers, opus only at tier 5, which is most of the cost story — was not in effect on the second host at all. ACP has since standardised session configuration, and the gap closes inside the adapter with no change to the host contract or to the loop.

  After `session/new`, `lib/host/acp.mjs` reads the `configOptions` the agent advertised; when one is a model selector (id `model` or category `model`) it picks a value for the planner's slug and applies it with `session/set_config_option` before `session/prompt`, falling back once to the legacy `session/set_model` on any JSON-RPC error. An agent that advertises nothing still gets one `session/set_model` with the raw slug, since agents predating config options accept it. The `_meta` hint keeps travelling for agents that honour it.

  **A value is chosen by rule, never guessed.** `pickModelValue(slug, option, map)` takes an operator's map first, then an exact `value`, then the first advertised option whose `value` or display `name` contains the slug case-insensitively — and otherwise nothing, because a wrong model that ran is invisible in a summary and a banner is not. `INTERLOCK_ACP_MODEL_MAP` is a JSON object of slug → value for agents whose model ids share no text with `haiku`/`sonnet`/`opus`; a mapped value the agent does not advertise is refused rather than sent, and a malformed map fails `createAcpHost` at startup rather than three waves in.

  **The banner is now derived, not declared.** The adapter emits one `{ type: 'model-routing', label, requested, applied, via, value, reason }` event per spawn that carried a model, and `host.modelRoutingSupported: false` — whose meaning was "never" — is replaced by `host.modelRouting: 'negotiated'`. The driver aggregates the events and computes nothing itself: it prints `MODEL ROUTING UNAVAILABLE (ACP host)` (verbatim, unchanged) with one `— <label>: <reason>` line per unrouted spawn only when at least one spawn that asked for a model did not get it, and otherwise the note `model routing: applied on N/N spawns via ACP session config`. The three reasons a spawn can carry — `no model option advertised`, `slug not among advertised values`, `mapped value not advertised` — are documented in [`docs/04-when-it-stops.md`](docs/04-when-it-stops.md). The permission `mode` option is deliberately left alone: trading `hooks/guard-tests.mjs` for an unverified `bypassPermissions` shortcut is a follow-on with its own test.

  Every path is proven against `test/fixtures/acp/agent.mjs` without a live agent: it grew `--config-options`, `--set-model` and `--config-error` modes and echoes back what it actually received as `appliedModel` / `appliedVia`, so a test asserts what the agent saw rather than what the adapter said about itself. For a user: an ACP agent that advertises its models behaves as it did before, banner included, only now the banner tells you which spawns and why — and one env var fixes the two cases where it can.

- **The strict tail is emitted by the CLI, and the second host runs it.** Adversarial review, bounded remediation, the verdict and the handoff artifacts were the last loop text either driver held: they ran inline in `workflows/ship.js` behind a `host-tail` step, and `bin/interlock-ship-acp` exited `2` on `--strict`, `--review`, `--handoff` and `--conformance` rather than quietly shipping something smaller. So the guarantees that make a strict run worth paying for — evidence-gated dismissal, a round budget the model cannot argue with, rubric delivery on re-review — were Claude-Code-only. `lib/run.mjs` now emits the tail as steps like any other, both drivers interpret them like any other, and the no-policy sweep in `test/workflows.test.mjs` has **no allowance left**: the seam marker, the skip it bought, and the exit-2 refusal are all gone, and the tail's own tokens (`isReal`, `qualityScore`, `reReviewDimensions`, `roundCap`, `byFile`, `needsManualTestPlan`, `autonomy`, `xhigh`) are in the swept list so the deletion cannot be undone by accident.

  **Every judgement with a correct answer moved into the CLI.** `run reviewed` reads the `findings.json` and `verdicts.json` the review agent wrote and adjudicates them with `lib/review-core.mjs` — the same survival, evidence and band rules `interlock review` applies — against the run's **observed** changed paths rather than a list the agent reported about the diff it was reviewing, then writes `review.json` and the review metrics and asks `lib/remediate.mjs` for round one. `run remediated --round <n>` re-adjudicates the rewritten files, records fixed and deferred, and obtains the next round, the verdict or the halt. No agent runs `interlock review` or `interlock remediate` any more, and no driver copies `roundCap`: raising `LIMITS.remediationRounds` by one buys exactly one more fixing round and moves the verdict round with it, with nothing outside `lib/` edited.

  **Criteria and policy are inlined rather than fetched.** The review and remediation briefings carry each selected dimension's written criteria and the repository's `REVIEW.md` prose, read by the CLI before the briefing is assembled — so the rubric-delivery requirement holds on re-review by construction instead of by an instruction the agent had to follow. A dimension whose criteria cannot be read is named in the briefing ("works from the dimension name alone") and bannered `REVIEW RUBRIC UNAVAILABLE: <dimension>` on the step, rather than dispatched silently. The policy prose stays framed as quoted data, subordinate to the rubric and the evidence gate.

  **Dimension selection is a recorded rule.** `language`, `architecture`, `qa` and `technical-lead` always; `devops` when the observed changed paths include deploy, CI, configuration or infrastructure files; `security` when they include auth, input-handling or data-exposure files — by the same path classification the run already uses for risk, with a reason recorded per optional dimension. It was a judgement call in the prompt, which made the dimension set unreportable. The reviewer may still add a dimension with a one-line reason, and the addition is recorded on the manifest.

  **Two provenance leaks closed.** The handoff briefing no longer asks the agent to run `interlock surface` and `interlock conformance` with `--changed <files changed by this run>` — the CLI runs both in-process over its own observed paths and inlines whether a manual test plan is needed (with the reason when it is not) and the scenario checklist to answer. And the autonomy-ladder record is written by `run close` from the CLI's last adjudication, for a strict run that actually reviewed; it used to ride on a prompt, which handed an observed count to the party the record assesses.

  For a user: `interlock-ship-acp <change> --strict` now runs the whole thing, and exit `2` no longer means "flag refused" — it means the invocation could not be started at all. A strict run on either host produces the same steps, the same halts, the same banners and the same receipt fields, because there is one program.

- **The ship loop moved into the CLI; both drivers are now interpreters.** Interlock has run two drivers of one loop since the ACP host landed — `workflows/ship.js` on the Workflow runtime and `bin/interlock-ship-acp` over ACP — and each held its own copy of the branching and of every agent's briefing, sharing policy only by evaluating marked blocks of one driver's source through `new Function`. `lib/run.mjs` now emits the whole program as a versioned step (`interlock.run-step/1`): the agents to spawn — label, model, tools, result schema, briefing — and the exact `interlock` argv to call once they return. A driver's loop is *spawn everything in `spawns`, write the results, call `then.argv`, repeat until `then` is null*, and it branches on nothing — not a flag, a mode, a count, or a verdict; every one of those (apply-only, no-commit, skip-e2e, isolate-waves, replan, verify-skip, done) is taken inside `lib/run.mjs` from a run manifest (`.claude/ship/run.json`) and the wave state.

  A briefing is delivered by reference, not pasted through a ping: `run` writes it to `.claude/ship/briefings/<label>.md` with its own sha256 on line one, and the step carries the path, the hash, and the text. The ACP driver is ordinary Node and reads the text off the step; the Workflow script cannot hold several kilobytes of prompt without a ping copying it — which would either breach the result-field cap or invite a silent under-instructed run on a relay miss — so it hands the worker the path and requires the hash back as `briefing` in its result. An absent or wrong hash fails the task closed with a named reason, exactly as a missing handoff packet does today.

  `interlock run classified --classified <file>` folds the mechanical work after the classifier — coverage, `waves`, `wave-state create`, the run-start event, and the first step — into one call, so the classifying agent no longer runs four CLI commands whose output it is also the one reporting on. `interlock run record-batch` folds the lane merge (under `--isolate-waves`), `wave-state record-batch --write-state`, and `tasks tick` into one call. `interlock run close` builds the receipt and the summary text every driver prints verbatim, and takes host-only banners through `--host-banners` so "no degradation banners" stays true across two hosts. `LIMITS.maxRunSteps` (200) replaces the literal `MAX_LOOP_STEPS` both drivers used to hardcode; each driver keeps its own `RUNAWAY_BACKSTOP` (1000) as a runtime ceiling, named in a comment as not a policy cap. The one loop text left in a driver after that change was the `host-tail` seam — the strict tail, inline in `workflows/ship.js` behind a single step name, refused by the ACP driver with exit `2`. `emit-strict-tail-from-cli` (below) removed it.

  Prompt assembly moved with it, into `lib/prompts/` (`implementer.mjs`, `planner.mjs`, `replan.mjs`, `commit.mjs`, `verify.mjs`, `stage.mjs`, `schemas.mjs`) — the ten pinned implementer fixtures under `test/fixtures/prompts/` are byte-identical, and the "publish the ship stage" fragment now renders from `lib/ship-stage.mjs`'s own constants instead of a literal duplicated in `workflows/ship.js` and drift-tested against it. The planner prompt is the same on both hosts now: the ACP form (write `classified.json` and stop) rather than the Workflow form that used to ask the same agent to run four commands afterward.

- **Cohesion lanes, a per-tier lane cap, and solo mode — fewer, fatter implementers on minor work.** A lane could only form from a path collision, so sixteen path-disjoint tier-2 test tasks were sixteen agents, each paying a spawn prefix and re-reading the same design to change one line. Inside a dependency layer, `interlock waves` now packs disjoint components whose hardest tier is at or below `LANE_CAPS.cohesionMaxTier` (3) into shared lanes — next-fit over hardest-first components, tasks in id order, never across a layer, a section, or the implementation/test boundary. Tier 4 and 5 are excluded on purpose: cross-file and novel work is where a fresh context per task still earns its cost. Every fold is a named warning and a `kind` on the lane, so a plan says what it packed rather than leaving it inferred from a smaller agent count.

  The lane cap is now the table `LANE_CAPS.byTier` (`1:8 2:8 3:6 4:4 5:8`) rather than one scalar, because a bound that is right for eight trivial edits is wrong for four cross-file refactors. `LIMITS.maxTasksPerAgent` is **removed rather than aliased** — a deprecated alias would have let a reader keep the old scalar silently, while removal fails the stale reader at import. The `maxTasksPerAgent` override survives as a uniform ceiling, so an override of 1 still reproduces one agent per task exactly.

  **Solo mode** ships a small change as one opus agent holding all of it: one wave, one batch, one lane, every implementation task in section-then-layer-then-id order followed by the test tasks, inside the same verify-and-commit loop and the same failure budget. `--solo` and `--waves` force it either way (both at once halts at parse); absent a flag, the classifier emits a `recommendedMode` and the planner honours solo only inside the published envelope `SOLO.maxTasks` (20), refusing it above that with a warning naming the count and the bound. The prompt asking for that recommendation never states the number — the envelope is a cap in `lib/limits.mjs`, printed by `interlock limits` as its own `laneCaps` and `solo` groups and read by the planner, so it cannot be re-argued in prose. A solo lane is promoted to opus after the classifier clamp (each promotion reported like a clamp) and briefed at the full-read ladder without rewriting any task's tier.

  The plan preview opens by naming the mode and its source, and the plan format is bumped to `interlock.ship-plan/3`: every stored `/2` plan is rebuilt once, because a `/2` plan has no cohesion lanes and no mode, and reusing one would silently keep the old shape. The mode override is part of the fingerprint, so a plan built under a different override is re-planned rather than adopted.

- **`interlock report` — the reader the corpora never had.** Interlock wrote three corpora and read none of them: `lib/outcomes.mjs` says in its own header that per §4.15(a) it "records and nothing else", `lib/run-log.mjs` accumulates a trajectory per run, `lib/metrics.mjs` writes a review's counts. That was the right call for *gating* and the wrong one for *reading* — the §4.16 ladder waits on evidence that was accumulating unread. `report` computes indicators over all three: coverage, first-pass ship, rework, plan fidelity, review findings, and which deterministic gate actually blocks. Add `--since` for a window, `--change` for one change, `--json` for the payload.

  Three properties are load-bearing. **A denominator travels with every value** — a zero denominator yields `null` and a reason, never `0`, because a rate over an unstated denominator commits both the error `lib/doctor.mjs` names ("an unknown is not a pass") and the one `lib/outcomes.mjs` names ("a biased control group is worse than none, because it looks like evidence"). **Provenance survives the arithmetic** — the observed/reported partition is carried through, so the review series from receipts and the one from metrics files are reported separately and never summed. And **one indicator is declared uncomputable**: "does the merged diff match the plan" is the sharpest question here and nothing records the comparison, so rather than approximate it from `planStatus` (stored-plan reuse over planning inputs) or the replan rate (the plan changing mid-run) — both about the plan, neither about the diff — it reports `computable: false` with what would close it.

  It **gates nothing, and that is policy rather than convenience**: always exit 0, no value compared against anything, no verdict word in the output, nothing in the loop reading it, and no file written — not even a cache. Every value here is one `if` away from a threshold and §4.15(a) forbids exactly that `if`; wiring one is decision §4.16 / slice F6.6, which has not been made. Metrics files are classified by their `schema` key and never by filename, because `skills/review-artifacts` writes `review-artifacts-*.json` into the same directory — matching the glob `review-*.json` while carrying finding bodies instead of counts — and a filename reader would mix a skill's prose into a counts indicator with nothing to notice. Ships with `/interlock:report`, which explains a census and is forbidden from recommending a cap or gate change on the strength of a figure, and [docs/11](docs/11-the-indicators.md).

  Its first run against this repository found three things nobody knew: the `run-receipt` event type had never once been written across 740 trajectories, 738 of those trajectories were attributed to no change at all, and every file in `.claude/metrics/` had been written by a skill in a shape the counts reader does not accept. A corpus nobody can read is a corpus nobody notices is empty.

- **`interlock doctor` — the preflight.** Every other gate in this repository judges the work; this one judges the machine the work runs on, because those are the expensive failures. A run that stops on wave four because `openspec` is not installed, or parks on an approval prompt for `npm test` with nobody watching, has spent four waves of agents to learn something a filesystem read knew at second zero — and since the reconstructability gate landed, an unwritable `.claude/ship/` no longer degrades a run, it ends it. `doctor` checks the Node version against both floors that apply (the plugin's, and the OpenSpec CLI's higher 20.19.0), the **installed** plugin's workflow / agent types / binaries (resolved from the plugin, never from the checkout you happen to be standing in — conflating them produces a report that checked the wrong copy), `interlock` / `interlock-graph` / `openspec` / `git` on PATH, whether the project is an OpenSpec project and a git work tree, `.claude/testing/profile.json`, the permission allowlist, and the writability of every run-state directory. It exits 1 when a check would stop an unattended run, and never repairs anything: each failure carries the fix as text, including a paste-ready `permissions.allow` snippet.

  Two properties make the allowlist half worth trusting. The required-command set is **derived, not hardcoded** — the four the flow always shells out to, plus whatever `.claude/testing/profile.json` says this project runs, truncated at the first `<placeholder>` — so a repo whose suite is `pnpm vitest run` is checked for `pnpm vitest run`. And a rule that exists but is *narrower* than the command it would have to permit (`Bash(interlock waves:*)` against a loop that calls ~30 subcommands) is reported as narrower **by name**, never counted as coverage; counting it would produce the one thing a preflight must never produce, a green report followed by the halt it promised to prevent. A `deny` overlapping a required command fails, an `ask` warns, and `defaultMode: "bypassPermissions"` warns and checks nothing, because nothing will prompt. The matcher reads both the current `Bash(git status:*)` spelling and the older `Bash(git *)` glob form.

### Fixed

- **A fresh ship run could die with `TypeError: lanes.some is not a function` instead of running its first wave.** A step never reaches `workflows/ship.js` from the CLI — the script has no shell, so every step arrives transcribed by an agent into a JSON schema. Two schemas carry a step, and only one of them was widened when batches became lanes: the `plan-waves` classifier still declared the pre-lane flat `tasks` and never declared `remainingBatches` at all. An undeclared property passes validation holding anything, so an agent told to copy `wave-state next` stdout with no slot to copy into wrote a list of task ids, and the wave loop called `.some` on a string. The throw happened outside `halt`, so the run lost its outcome record, its trajectory close event, and its banners along with the wave. The step shape is now stated once (`STEP_FIELDS`) and read by every schema that carries a step; `stepFromAgent` accepts a step only if the loop can actually dispatch it, so a bad transcription takes the existing single `next-retry-` re-read of state rather than the loop; and a step that stays misshapen halts by name. Test fixtures no longer always attach `cliStdout`, which is why the transcription fallback was reachable in production and unreachable in tests.

### Removed

- **`/interlock:session-retro`** moved to [renzrollon/shippable-skills](https://github.com/renzrollon/shippable-skills). It is no longer part of this plugin. Install it with `npx skills add renzrollon/shippable-skills` (or the Claude Code plugin on that repo). The live-session retro was never Interlock-specific; shipping it here blocked Cursor, Copilot, and Codex.

### Changed

**Breaking:** `/interlock:ship` is **lean by default**. Waves, unit verification, and a commit always run. Adversarial review, remediation, handoff artifacts (`manual-test-plan.md`, `code-explanation.md`, memory), and spec conformance are opt-in via `--review`, `--handoff`, `--conformance`, or `--strict` (the previous default). A `LEAN SHIP:` banner lists what was skipped so a lean run cannot look like a strict one. Continuity (`spec --continue`) also launches lean unless a tail flag is passed. Coverage checking and the first `wave-state next` are folded into the planner (no extra `plan-coverage` or `next-1` agents). `interlock autonomy record` runs only under `--strict`.

Two earlier passes landed together.

The first was **honesty and adoption**: several things the 0.1.0 README described
as enforced were prose, and one was not wired up at all. Those claims are now
either true or gone.

The second **made them true** — the ship loop moved out of prose and into a
dynamic-workflow script backed by a policy CLI, and the opt-in continuity path
gained the fail-closed readiness gate it needs.

> **Breaking:** `/interlock:ship` is now a [dynamic workflow](https://code.claude.com/docs/en/workflows)
> rather than a skill. Interlock requires **Claude Code v2.1.154+ with dynamic
> workflows enabled**. Where workflows are disabled — `disableWorkflows`, org
> policy, `CLAUDE_CODE_DISABLE_WORKFLOWS`, or a Pro plan that has not enabled
> them in `/config` — there is no ship path. The command name is unchanged.

### Added

- **Slim spawn prefix.** Every `/interlock:ship` `agent()` call names a plugin agent (`interlock:ping` / `interlock:worker`) and passes a tools allowlist that excludes Skill, Agent, and MCP, so workers stop inheriting the parent session's ~40k tool-and-skill catalog. ACP prepends `--agent <type>` when the command is the Claude Code CLI.
- **Wave-boundary cost.** Path collisions stay in the classified group as later batches instead of overflow waves. Inter-wave verification is capped (`LIMITS.interWaveVerifications`, default 3) and skipped for docs-only waves. `formatPlan` prints a projected agent count and warns on effectively serial plans. `verify plan` accepts `--context inter-wave` and `--changed`; docs-only `--changed` emits no steps. Ship fuses a following verify into the `record-batch` ping and records every remaining batch of a wave in one ping. Cheap pings use haiku when a one-time Bedrock probe says it is reachable. Wave-entry `wave-state next` logs one `agent-spawn` per task in `remainingBatches` so the ship-run trajectory matches the implementers the loop actually launches.
- **`/interlock:session-retro`** — a retro that runs while the transcript is still
  in context. Scores the live session against a new session-shapes taxonomy
  (`shared/SESSION-SHAPES.md`), flags where it wasted tokens against
  `shared/TOOL-ECONOMY.md` in relative magnitude (never fabricated counts), and
  writes wire-in notes under `.claude/handoff/` that fold repeatable steps back into
  the skills and workflows the session actually called. New-skill proposals use
  `shared/SKILL-CANDIDATE-BRIEF.md`. Standalone and current-session-only: it never
  reads the on-disk transcript. Later moved out of this plugin (see Unreleased).
- **`docs/` — four human-facing pages.** [The first hour](docs/01-first-hour.md)
  (install → `bootstrap` → one `spec` → read it → `ship` → archive, plus an
  explicit do-not-run-yet list), [the checkpoint](docs/02-the-checkpoint.md)
  (how to read four artifacts in ten minutes, and what "looks wrong" looks like
  in each), [OpenSpec vs Interlock](docs/03-openspec-vs-interlock.md) (who owns
  what, and why `spec` drives the CLI instead of forking the stock skills), and
  [when it stops](docs/04-when-it-stops.md) (every halt and banner, and the
  three-way split between harness-enforced, code-enforced, and model-followed).
- **The tolerance band is now applied.** `lib/findings.mjs` exported
  `TOLERANCE_BAND` since 0.1.0 and nothing called it. `applyToleranceBand()`
  now partitions findings into `{ reportable, dropped }`, and `evaluateGate()`
  applies it after the skeptics' dismissals and before counting blockers — so a
  finding scored below 3 of 5 for how well-grounded it is can no longer block a
  change. Unscored findings are kept: absence of a score is not evidence of low
  quality. When two skeptics disagree by more than `drift`, the disagreement is
  treated as signal and the finding survives. Gate results carry
  `droppedByQuality`, counted separately from `dismissedCount`.
- `interlock gate --min-quality <n>` and `--no-tolerance` to move or disable the
  band per run. It is on by default, in the CLI rather than in review prose,
  so it cannot be quietly re-argued on each run.
- **Loud failure banners** in `ship`'s final summary — `GRAPH UNAVAILABLE`,
  `NO TEST PROFILE`, `VERIFICATION SKIPPED`, `E2E FAILED (non-blocking by
  policy)` — printed whenever the condition holds, including on otherwise
  successful runs. A degraded run no longer reads like a clean one.
- Structural tests: a skill whose body instructs spawning subagents must list
  `Agent` in `allowed-tools`, and `shared/` + `lib/` are scanned for
  predecessor-project strings the way `skills/` already was.

**The ship loop became a program**

- **`workflows/ship.js`** — the eleven numbered headings of `skills/ship/SKILL.md`
  are now a script the runtime executes. The script holds the loop, the
  branching and the intermediate results; the `interlock` CLI holds the rules;
  the agents do the work. A cap is no longer a sentence a tired model can talk
  itself out of.
- **`lib/limits.mjs`** — every cap in one place: 8 parallel agents, 2 inter-wave
  fix attempts, 2 replans, 2 remediation rounds, 5 root-cause iterations, 2
  tolerated task failures. The CLI help text interpolates them, so the
  documentation cannot drift from the constant.
- **`lib/waves.mjs`** gained a pure execution state machine beside the planner:
  wave order, inter-wave verification, replan eligibility and the task-failure
  halt. Every transition returns a new deep-frozen state, because a resumed
  workflow replays transitions from cached results and a machine that mutated in
  place would answer differently on the replay than on the first pass.
- **`lib/remediate.mjs`** — blockers are fixed, suggestions are deferred,
  same-file findings never run in parallel. Rounds 1–2 fix; round 3 is a
  verdict-only round that is the sole round able to halt, so the last fix pass
  is never pre-empted by a halt it had not yet earned.
- **`lib/review-core.mjs`** — skeptic majority survival, severity refinement, and
  the quality band, with counts that distinguish *dismissed by a skeptic* from
  *dropped as too weak to report*. Ties keep the finding: a surviving false
  positive costs ten seconds of reading, and a wrong dismissal is invisible.
- **`lib/verify.mjs`** — plans verification from the test profile and judges the
  results, without ever running anything itself. Commands come from the profile
  verbatim; a red unit suite halts; coverage is advisory; e2e is reported and
  never repaired. Failures cluster by normalized error signature so a shared
  root cause is fixed once. Whether a typecheck halts now depends on where
  verification was called from — blocking between waves, reported but
  non-halting at the final gate, so the three documented hard halts stay three.
- **`lib/metrics.mjs`** — the review's dismissed and quality-dropped counts, and
  nothing else, under `.claude/metrics/`. This is the number the README points
  at as evidence a review is worth trusting; it is now real.
- **CLI**: `limits`, `remediate`, `review`, `verify plan|judge|unit|cluster|repair`,
  `wave-state create|next|record-batch|record-verify|replan`, `risk`, `ledger`,
  `ready`, `outcomes`. Every gating command exits non-zero when it blocks, and
  the workflow branches on exit status rather than on parsed prose.

**Opt-in continuity (`/interlock:spec --continue`)**

- **`lib/risk.mjs`** — classifies a change `low`/`medium`/`high`/`critical` from
  its paths and artifact text, and **fails closed**: no usable signal classifies
  as `high`, never `low`, and source paths matching no rule floor at `medium`
  because unrecognised is not safe. Every classification carries the signals and
  evidence that produced it.
- **`lib/ledger.mjs` + `shared/DECISION-LEDGER.md`** — a durable decision ledger
  at `openspec/changes/<name>/decisions.md`. An `agent_resolved` row without a
  written resolution *and* evidence is invalid, and an invalid row blocks exactly
  like an unanswered one.
- **`lib/ready.mjs`** — the gate. Fifteen named checks; `ready` is true only when
  every one affirmatively passed. A check that could not run is never a pass, an
  omitted artifact-review result is an unrun check rather than a clean one, and
  an exception while gathering evidence becomes a blocker.
- **`lib/outcomes.mjs`** — `.claude/learning/outcomes.jsonl`, appended for
  checkpoint and continuity runs alike. **Nothing gates on it yet** (§4.15a);
  it exists so that a later decision can be made on evidence instead of feel.

### Changed

- **Earned autonomy is demoted to experimental, and documented as storage
  only.** The ladder records outcomes, resets on blockers, and assigns blame
  transitively — but nothing reads the level to change what the workflow does,
  and the `spec` → `ship` checkpoint is not skippable at any level. The README
  previously said autonomy "changes whether the flow waits for you." It does
  not. Skills keep recording, so the evidence accumulates for a decision that
  has not been made yet.
- README leads with the three commands and links the docs. Nine of the thirteen
  remaining skills moved behind an "advanced surface" fold; `bootstrap`, `spec`,
  `ship` and `mr` are the product. No skill was hidden from the `/` menu — they
  are demoted in documentation, not disabled.
- README states plainly that this is a **Claude Code plugin**; Cursor and
  Copilot are not supported in 0.x.
- Corrected README claims that overstated what runs: `review-code` fans out *up
  to* six dimensions (devops and security are conditional on the diff), and
  only `ship` genuinely asks nothing — `bootstrap` and `spec` ask where the
  repo holds no correct answer.
- The README no longer implies the orchestration inside `ship` is code. Wave
  execution, remediation rounds and verification order are instructions the
  model follows; moving them into engines is planned, not shipped.
- `review-code` defers the quality threshold to `interlock gate` rather than
  restating a number in markdown.
- `bootstrap` no longer swallows a failed graph build with `2>/dev/null ||
  true`; it reports why the graph is unavailable and continues.

### Fixed

- **`ship` no longer relaunches itself after leftover checkboxes.** The parent chat treated remaining `- [ ]` as “ship isn’t done” and called `Workflow(ship.js)` again — another 20+ agents, including a full review cycle. The trampoline and dispatch now forbid a second call in the same conversation. `finish()` prints `SHIP COMPLETE WITH LEFTOVERS` plus failed ids instead of a silent complete. Succeeded boxes are ticked by `interlock tasks tick`, not by haiku editing markdown. `interlock tasks coverage` halts before implementers if the classifier dropped an unchecked task. Terminal summaries now include `GOAL MET: interlock ship returned a terminal summary.` so a user-set `/goal` can stop; leftover boxes still count as met. Spec prints `GOAL MET: interlock spec stopped at the checkpoint.` and must not use `/goal` to skip the human read. Safe `/goal` recipes and the inner-vs-outer retrigger table live in [docs/04](docs/04-when-it-stops.md).

- **`ship` no longer treats a hallucinated wave-state `action` as a halt worth cache-busting.** A haiku control-plane ping that invents `action: "report"` (the CLI never emits that) is retried once via `wave-state next` under a new `next-retry-*` label. Editing the prompt to resume was replaying every later implementer.

- Agent-facing strings naming the private predecessor project: the graph report
  header, a walker comment, and four `shared/` contracts that still referred to
  `propose`, `grill`, `review-ts`, `apply-change` and `openspec-create-pr`.
  Tests now prevent regression.
- **`/interlock:ship` was unknown in a consumer repo.** Moving the loop to
  `workflows/ship.js` unregistered it from the Skill tool, so Claude Desktop
  and `Skill(interlock:ship)` returned `Unknown skill` anywhere that was not
  the plugin source tree. `skills/ship/SKILL.md` is restored as a trampoline
  that only launches the script (`Workflow({ scriptPath })`) — the same
  pattern Anthropic's own workflow plugins use. The loop stays in the script.
  `plugin.json` now declares `"workflows": "./workflows"`. A raw string
  `args` payload is treated as the change name rather than dropped or
  stuffed into flags.
- `Agent` added to `allowed-tools` on the skills that spawn subagents
  (`bootstrap`, `explore`, `review-code`; `ship` too, before it became a
  workflow and stopped needing frontmatter at all). To be precise about what this
  fixes: `allowed-tools` is a per-turn **pre-approval**, not a restriction —
  Claude Code's documentation is explicit that it "does not restrict which tools
  are available" — so fan-out was never silently broken. What the omission cost
  was a possible approval prompt under a user's own restrictive permission
  rules, which in `ship` would interrupt a run that is contractually supposed to
  ask nothing.

### Changed

- **`wave-state --write-state`** on `record-batch`, `record-verify`, and `replan`: writes the new run state to a file and, with `--json`, emits the next step (same shape as `wave-state next`). Default stdout is still the new state.
- **`workflows/ship.js`** folds that next step into the record/replan agent, so a batch no longer pays a second control-plane turn. Mechanical CLI pings (`next`, `record-*`, `replan`, `record-outcome`) pin `haiku`. Implementers locate via the graph before grep, return schema only, and stop after green on tier 1–2. Review and remediate write JSON files and return counts only.
- Hot-path skill diet: `TOOL-ECONOMY.md` is rules-only; explore investigators return JSON; spec continuity lives in `skills/spec/continuity.md` and loads only on `--continue`; bootstrap explorers share one prompt skeleton plus a role table.

### Removed

- The prose ship loop that used to live in `skills/ship/SKILL.md`. Control
  flow is `workflows/ship.js`; the skill file is a trampoline only.

### Notes

The version number is not yet decided, but this is not a patch. `ship` changed
category, the plugin gained a hard requirement on the workflow runtime, and the
gate now drops findings it previously reported.

Two decisions were deliberately **not** taken. Continuity does not gate on the
learning corpus (§4.15a) — records accumulate, nothing reads them, and turning
that on should be a decision made against real data rather than an intuition.
And earned autonomy stays storage-only (§4.2 D) for the same reason: a feature
that gates a workflow should earn its own trust first.

## [0.1.0] — 2026-08-12

Initial release. Interlock is a Claude Code plugin that layers autonomous
spec-driven orchestration on top of the OpenSpec CLI.

### Added

**Distribution**
- Claude Code plugin with a single-plugin marketplace — installs in two commands.
- `bin/` executables (`interlock`, `interlock-graph`) join the Bash tool's `PATH`
  automatically when the plugin is enabled.

**The deterministic spine (`interlock`)**
- `waves` — plans execution waves from classified tasks: orders groups, clamps
  over-eager model assignments, defers test tasks, and **caps parallel fan-out**
  (default 8).
- `surface` — classifies changed files as UI-TESTABLE / UI-INDIRECT /
  NOT-UI-TESTABLE, and decides whether a manual test plan or devops review is
  warranted.
- `gate` — decides whether a review blocks, and partitions findings per file for
  parallel remediation. Exits non-zero when blocked.
- `validate` / `changes` — OpenSpec change readiness and discovery.
- `autonomy` — the L2→L3 earned-autonomy ladder with transitive blame.

**The code graph (`interlock-graph`)**
- Local, deterministic import/symbol graph with OpenSpec and memory overlays.
  Zero dependencies, no network, no vector store.
- Token-budgeted retrieval: `query`, `consumers`, `path`, `explain`, `context`,
  `docs`, `docs-index`.

**Skills**
- Onboarding: `graph`, `docs-digest`, `bootstrap`.
- Loop: `explore`, `spec`, `ship`, `mr`.
- Supporting: `review-code`, `review-artifacts`, `manual-test-plan`,
  `explain-code`, `commit`, `fix-tests`, `dispatch`.

**Guardrails enforced by the harness rather than by prose**
- `ship` sets `disallowed-tools: AskUserQuestion` — its zero-touch contract is
  structural, not aspirational.
- `ship`, `commit` and `mr` set `disable-model-invocation: true`, so Claude
  cannot decide on its own to commit or open a merge request.

**Testing**
- 171 tests, no dependencies. Covers the spine, the graph, and structural
  validation of every skill (frontmatter fields, description budget, and whether
  every bundled-file reference resolves).
- CI validates the plugin manifests with `claude plugin validate --strict` and
  smoke-tests the CLIs as executables.

### Notes

- Interlock **composes** OpenSpec rather than forking its skills. `/interlock:spec`
  drives the `openspec` CLI directly, so it does not drift when OpenSpec
  releases. Stock `openspec-*` skills remain available alongside it.
- Structural graph indexing covers JavaScript/TypeScript, Python and shell. Other
  languages get docs and spec indexing plus the full workflow, but no
  import/symbol edges — the skills state this rather than implying completeness.
- The autonomy ladder ships opt-in until it has accumulated real run data.

[0.1.0]: https://github.com/renzrollon/interlock/releases/tag/v0.1.0
