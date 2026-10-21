# Claude Code, October 2026, and Interlock

14 October 2026. A synthesis of four independent passes: the Interlock 1.6.1 loop in this repo, current Claude Code and Claude Platform docs, GitHub repos with star counts from the GitHub API that day, and a product brief constrained by the harness. This is a proposal. It is not a change to the loop.

The workspace folder is `specflow`. The product is Interlock (`renzrollon/interlock`, package 1.6.1). OpenSpec owns the artifacts. Interlock owns exploration, gates, parallel execution, review, verification, and commit. The line on the README still holds: you read one spec, and parallel agents ship it to a tested commit.

## Decision

**One advisor, once, at the spec checkpoint. Ship stays a workflow with hooks, a meter, and exit codes.**

The question was whether one advisor can sit on spec, on ship, or on every subagent. The platform and this harness answer it the same way.

| Shape | What to do |
|---|---|
| One advisor during spec | Build it. One plaintext model call after artifact review, writing `openspec/changes/<name>/advisor.md`. The human reads it with the checkpoint. `interlock ready` ignores the file. |
| One advisor for every ship subagent | Do not build it. On Managed Agents only the primary thread can consult the advisor; subagents cannot. Each lane that carried the tool would pay for its own advisor and still would not see the other lanes. Workers in this repo cannot call Skill, Agent, or MCP. |
| One shared policy during ship | This is already the design. Extend `hooks/mod.mjs` and the `PreToolUse` guards. They see every lane. A model does not. |
| A live critic mailbox workers ask mid-wave | Do not build it. `workflows/ship.js` does not branch on prose, and the runtime has no mid-run human channel. A watcher with authority has nowhere legal to act. A watcher without authority is a second log. |

The GitHub ecosystem keeps rebuilding the mailbox anyway: [OpenRig](https://github.com/mvschwarz/openrig) gives the advisor its own tab, [security-guidance](https://github.com/anthropics/claude-code/blob/main/plugins/security-guidance/README.md) pushes findings back before the human sees the turn, [GSD Core](https://github.com/open-gsd/gsd-core) freezes decisions before executors start. Those are the right *pressures*. In this harness they become files and CLI steps, which the sections below name. They do not become a second orchestrator.

Use an ordinary model call for the spec advisor. Leave the server Advisor tool (`advisor_20260301`) alone. On Claude Opus 5.5, Sonnet 5.5, Fable 5.1, and Mythos the advice comes back as `advisor_redacted_result`, which the client cannot store. A judgement that cannot be written into the change folder is silent degradation. The executor also chooses when to call, the tool input is empty, and the server injects the whole transcript. That invocation model fights the harness. The role split is the part worth stealing: a stronger model, no tools, guidance only, and if the consult errors the caller continues.

## What shipped that matters

Two products stay easy to mix up. **Claude Code** is the CLI, Desktop, IDE, and Agent SDK (`https://code.claude.com/docs`). **Claude Platform** is the Messages API and Managed Agents (`https://platform.claude.com/docs`). A feature on one is absent on the other unless the page says otherwise.

### Mods

Mods are real. Changelog date 1 October 2026. On by default in the CLI at v2.1.287+ and in the Desktop Code tab at v2.1.286+. A mod is JavaScript or TypeScript that runs inside Claude Code’s process, shipped inside a plugin. It can observe, rewrite, or replace tool calls, prompts, turns, and UI. It is unsandboxed: it can read files, start processes, see every prompt, and approve tool calls. `disableAllHooks`, `--bare`, and `--safe-mode` stop installed mods. They do not stop the built-in `sec-default` mod, which loads first so a user mod cannot override a managed deny.

Mods, permission modes, and plugins are three different things. A plugin is the package (skills, hooks, subagents, MCP, output styles, and mods). A permission mode is whether Claude asks before acting. A mod is the in-process handler.

Interlock already ships one. `hooks/mod.mjs` is the spec meter and the ship meter, plus the launch guard. `test/spine/mod-pins.test.mjs` fails if that module makes an engine call outside an allow-list, writes a file, or denies for any reason other than the launch rule. The meter observes. The CLI decides. New judgement does not belong in the mod.

As of the 14 October 2026 changelog (v2.1.299), `turn.start` also hears subagent turns. `e.agentId` is absent on the main loop, so a mod can tell a lane from the parent. That is the shared seat. It records and draws. It does not call a model on every tool.

Docs: [mods overview](https://code.claude.com/docs/en/plugins/mods/overview), [events](https://code.claude.com/docs/en/plugins/mods/events), [announcement](https://claude.com/resources/articles/claude-code-mods).

The version pairing is slightly soft. The mods overview states the v2.1.287 floor. The fetched changelog dated “Added Claude Mods” to 1 October 2026 and did not print a `2.1.287` heading on that date. Treat the floor as the docs’ requirement and the date as the changelog’s.

### Advisor tool

Beta. Header `advisor-tool-2026-03-01`. Tool type `advisor_20260301`, name `advisor`. A faster executor calls a stronger model mid-generation. The advisor has no tools and no memory. Its system prompt is Anthropic’s. You steer it only by what the executor’s transcript already contains. Caching breaks even at about three calls in one conversation. Advisor tokens are billed on the advisor model and are omitted from the executor’s top-level `usage`.

On Managed Agents (`managed-agents-2026-04-01`) the limit is explicit: only the session’s primary thread can consult it. `send_to_agent` cannot reach it. The name `anthropic.advisor` is reserved.

Docs: [advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool), [multiagent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration).

### Hooks, skills, workflows

Settings hooks already run inside subagents. Tool events carry `agent_id` and `agent_type`. `PreToolUse` can deny. This repo’s guards (`guard-commit`, `guard-tasks`, `guard-tests`) are that mechanism, fail-open when `.claude/ship/<change>/stage.json` is missing.

Skills remain procedures. `context: fork` runs one in a fresh subagent and does not inherit the parent transcript. `disable-model-invocation` is how commit and MR stay human-invoked. A skill is not a gate.

Dynamic workflows are a JavaScript script the runtime executes. Intermediate results stay in the script, not in the parent’s context. Interlock’s `workflows/ship.js` is already this shape, checked in, with the rules in the CLI. A model-written workflow (`/effort ultracode`) is the thing this repo left on purpose.

Agent teams are experimental, off by default (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), and require an interactive session. In `claude -p` and the Agent SDK a named subagent stays an ordinary subagent. Teams do not put teammates in worktrees. They are the wrong primitive for headless ship.

## Where the loop can take a new piece

Happy path, from `skills/dispatch/SKILL.md`:

```
graph → docs-digest → bootstrap
/interlock:spec      explore → artifacts → review     stops. Human reads.
/interlock:ship      waves → verify → commit          workflow. --strict adds review.
/interlock:mr        summary → merge request          never merges.
```

Subagents that already exist:

- Explore: 2–5 read-only investigators. Bootstrap: explorers, then a human confirms the feature list, then spec writers.
- Spec and review-artifacts run in the parent session. Review-artifacts is one model playing two headings. It has no skeptic and no cited-dismissal rule.
- Ship spawns `interlock:worker` and `interlock:ping` only. Both disallow Skill, Agent, and MCP. One worker per lane, briefed from `.claude/ship/briefings/`, prior wave memory limited to schema-validated handoff packets.
- `--strict` review is one worker whose prompt says “fan out one reviewer per dimension” and “two skeptics per finding.” That worker cannot call Agent. The skeptics reason inside one context, which is the failure mode lane isolation exists to prevent.
- `/interlock:review-code` is the path that actually spawns: one agent per dimension, two skeptics per blocker and warning, and a dismissal needs `file:line` in the diff or it dismisses nothing.

The gaps that are written down, and that a new feature can attach to:

1. **No machine asks whether the idea is right.** `docs/05-continuity.md`: continuity cannot catch a wrong idea. `interlock ready` checks implementability. The ten-minute read in `docs/02-the-checkpoint.md` is the only required human judgement.
2. **Strict-ship review cannot spawn.** The fix is spawn kinds in `lib/run.mjs`, copying `skills/review-code`, adjudicated by an exit code. The worker prompt already says “fan out,” and that worker cannot call Agent.
3. **Path disjointness is a prediction.** `docs/06-why-it-works.md`: a task that edits a file it never named is unguarded. `--isolate-waves` is opt-in and, on the Workflow host, halts after the first fold.
4. **Reports do not gate, and nothing in the loop reads them.** `interlock report` exits 0. Outcomes accumulate. `lib/outcomes.mjs` says wiring a gate to that file is a decision that has not been made.
5. **The installed Cursor plugin is an older snapshot** (`d2586f3`, manifest 0.1.0, no ship skill). Cursor is an unsupported host. A Cursor session that loads that plugin is not running 1.6.1.

## Bets

Eight. The first three are the spec advisor and the proof it is worth keeping. The next three steal what the popular repos actually do, in the form this harness can hold. The last two are apps, and they wait until the file exists and someone is looking at it.

### 1. Checkpoint Advisor — skill step, spec

After `/interlock:review-artifacts` and after `decisions.md` exists, before the checkpoint stop, one stronger-model call with no tools reads `proposal.md`, `design.md`, `tasks.md`, the delta specs, the ledger, and the artifact-review findings. It may see the graph path list for files the tasks already name, under the same size bound the domain reviewer uses. It writes `advisor.md`: at most ten draft questions, each with an id, why it matters, and a citation to a heading in the change. Per task id it may add a risk note of a kind the checkpoint page already names (vague wording, the same production file in consecutive tasks, a scenario no task covers, scope past the proposal).

The human may paste a row into `decisions.md` as `needs_human`. The advisor does not write the ledger, does not rewrite tasks, does not append `agent_resolved`, does not enter worker briefings, and does not change `interlock ready`. If the call errors, spec finishes and the skill says the consult did not run. A wrong consult is a draft the human ignores. The cost of a missed question is the checkpoint read you already do.

This matches [GSD’s Discuss](https://github.com/open-gsd/gsd-core) (freeze decisions before executors exist) and [feature-dev](https://github.com/anthropics/claude-code/blob/main/plugins/feature-dev/README.md) (explorers report, the parent decides). It refuses [OpenRig](https://github.com/mvschwarz/openrig)’s live seat. Headless SDK sessions will not spawn experimental teammates, and a seat that shares a writable workspace with the lanes puts the orchestrator context back.

Kill it if, on ten specs you label yourself, fewer than three drafted rows are questions you would have asked, or more than half repeat the artifact review.

### 2. Spec Range — cases in `interlock evals`, spec

Ten cases. The input is a frozen change folder whose right question you already know. The grade is whether a drafted row matches that label. The case does not ship. No model-in-the-loop case today covers `skills/spec`, review-artifacts, explore, or bootstrap.

This is the host’s own shape, which [plugin evals](https://code.claude.com/docs/en/plugin-evals) and [promptfoo](https://github.com/promptfoo/promptfoo) both use: a prompt, a file that must exist, a baseline arm with the skill disabled, and a grade on the trajectory when you care that the spec skill actually called the graph. Promptfoo is the wrap when a case needs the Agent SDK or a copied workdir. `claude plugin eval` is the default for deterministic checks.

Kill the advisor if you cannot honestly label ten historical misses. A score with no labels is a demo.

### 3. Spec Pane — the existing mod, display only

`hooks/mod.mjs` already draws `/interlock-spec`. Extend it to list the draft rows and a count, the way the ship meter reads `preflight.json`. No button writes the ledger. No new deny. No model call inside the mod.

The public mod catalogs are large and mostly irrelevant ([awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods) reported 3,836 mods on a 13 October 2026 scan). The ones that rhyme are small status bands: [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods) (`where-am-i`, `mission-control`, `review-watch`) and the blast-radius hold on `rm -r` and force-push. Interlock’s meter is already that band, bound to wave files those mods have never heard of. Steal the “what is waiting on the human” line. Do not install a second map.

Cursor has no mods. This bet is the Claude Code host only.

### 4. Blast-radius lanes — `interlock-graph`, before spawn

[code-review-graph](https://github.com/tirth8205/code-review-graph) (32,131 stars, pushed 6 October 2026) cuts review context from a Tree-sitter graph: a short packet, plus the blast radius of the files you are about to touch. Interlock already has `interlock-graph` and tells every later skill to query it before reading. The dispatcher still packs lanes from paths the tasks predicted.

Before the plan preview, ask the graph who calls the files each task names. Two tasks that share a caller, a helper, or a route handler are one lane even when the task text looks disjoint. Each briefing gets that short packet. A second indexer is a second product. If `interlock-graph` cannot answer the query, wrap the MCP for the duration of the run rather than forking Tree-sitter.

This is the ship-time “shared brain” that is deterministic. It needs no advisor.

### 5. Strict review that can actually spawn — `lib/run.mjs`, ship `--strict`

The pattern that won in public review tools is finders in parallel, then an independent attempt to kill each finding. [claude-code-gauntlet](https://github.com/liatrio-labs/claude-code-gauntlet) is 13 stars and was pushed 14 October 2026. Its README is a design with a number: on a 15-PR slice, golden recall 0.695 and noise 0.180, against Claude CLI review at 0.339 recall. The challenger does not see the finder’s reasoning. Security findings the challenger doubts are downgraded, not deleted. Git blame splits new from pre-existing. GitHub and GitLab both work, which matters because `/interlock:mr` already speaks `gh` and `glab`.

`/interlock:review-code` is already most of this: per-dimension agents, two skeptics, citation required to dismiss. `--strict` ship is the path that collapsed it into one worker. Add spawn kinds beside `review` in `lib/run.mjs`. The CLI adjudicates. The script still does not branch on prose. Cap remediation at two iterations, and revert a fix that fails the re-review. Those two rules are the durable part of [adversarial-review](https://github.com/ng/adversarial-review) and [adamsreview](https://github.com/adamjgmiller/adamsreview).

[security-guidance](https://github.com/anthropics/claude-code/blob/main/plugins/security-guidance/README.md) reviews on edit, on Stop, and on commit, and feeds findings back before the human sees the turn. Ship has no human at those moments. The equivalent that fits is a finding written into the wave receipt, visible to the next briefing only when the CLI put it there. A live “ask the critic” tool on the worker is the mailbox this decision refused. [Wave Note](#what-to-leave-unbuilt) is the weaker, flag-off version of the same impulse. Build the spawn fix first.

Do not vendor gauntlet or the official code-review plugin. The code-review README still describes a git-blame agent and an 80-point cutoff that the command file does not implement ([issue #79145](https://github.com/anthropics/claude-code/issues/79145)). Trust the command, and reimplement the stages against `skills/review-code/dimensions/`.

### 6. Compound note — a file the next spec advisor must open

[compound-engineering](https://github.com/EveryInc/compound-engineering-plugin) (`/ce-compound`, 25,516 stars) appends a short lesson to `docs/solutions/` after review. Living specs record requirements. They do not record the surprise. When a review finds something the spec did not say, append a note: the surprise, the file, the rule that should have existed. Checkpoint Advisor retrieves notes that match the files under discussion before it accepts its own draft as complete.

This is a file, in the same family as `decisions.md`. It is not [claude-mem](https://github.com/thedotmack/claude-mem) (100,574 stars, no published retrieval benchmark in the June 2026 maintainer thread) and it is not [funes](https://github.com/huggingface/funes). Both are optional importers later. A second store that can contradict the ledger will.

[Spec Kit](https://github.com/github/spec-kit) (141,199 stars) has two neighboring ideas worth a file and not a migration: a short constitution of non-negotiables the advisor quotes, and a converge loop that can say “not done” without opening a new change. OpenSpec stays the store. Interlock already has the second idea as verify, remediation, and `fix-tests`. Do not add Spec Kit’s phase machine beside it.

### 7. Receipt Check — CI job, merge request

A job runs `interlock drift`, `interlock merge-confidence`, and `interlock validate`. The change name comes from the branch. Stdout is uploaded. No model. Same advisory posture evals already use until a person promotes a check.

[claude-code-action](https://github.com/anthropics/claude-code-action) (9,502 stars) is the unattended GitHub reviewer. It does not speak GitLab. Interlock’s MR path already pastes a CLI block and applies CLI label names. The job should print what the skill already pastes, on both hosts. A green job is not a substitute for `--strict`.

The heavier version, an MR gauntlet bot, shares the finding schema from bet 5 and runs in CI. Gauntlet’s own numbers put a full review around a million tokens and 16–22 minutes. Default to the light pair (bugs and security) under a small diff, and ask before a full run. That bot is an app. The receipt job is a workflow file. Build the job first.

### 8. Outcome Bench — local app, after ship close

One command emits a static page from the outcome corpus and the trajectories. Columns: change, advisor rows the human dismissed, terminal outcome (halt, verify failure, review finding). No daemon, no account, no network. The reader sits outside the session that wrote the rows, which is why a paragraph in the spec skill cannot do this. `skills/report` already narrates denominators and gates nothing. The bench is that report aimed at one question: which checkpoint notes did I ignore, and which of those changes came back.

Build it only after `advisor.md` is actually kept. A month of empty dismissed-row column means the log is not worth querying.

**Change Desk** is the other app, and it is conditional. A read-only MCP server for a Cursor session: the four artifacts, `decisions.md`, `advisor.md` when it exists, and the JSON from `interlock ready` and `interlock ledger`. No write, no spawn, no ship. Cursor in this checkout otherwise gets stock OpenSpec, which looks like spec and ship and is not. Drop the server the day it grows a write tool, and skip it entirely if you are not speccing in Cursor.

## What to leave unbuilt

- **The Advisor tool on workers, one advisor across spec and ship, one watcher over the fan-out.** Platform limit plus the prefix cut plus the zero-touch runtime.
- **Wave Note.** One recorded model call after `record-batch`, flag off, including on lean ship, exit code unchanged. Revisit only if Spec Range shows misses that unit verify did not catch. A per-wave stronger-model call spends what the tier ladder saved.
- **A control room.** The ship meter already draws the run. [agentsview](https://github.com/kenn-io/agentsview) and OpenRig proved people like a local archive and a separate advisor tab. Another map will not catch a file collision the planner missed. If agentsview is installed, point at it. Do not build a second session indexer.
- **Agent teams, `/effort ultracode`, and `/goal` as the definition of done.** Teams are interactive-only and isolate nothing. Ultrathink-style effort on every ship skill makes the run non-repeatable. `/goal` judges the transcript with a small model and does not run the tests.
- **Auto mode as ship policy.** Fine as the human’s interactive default (v2.1.283+). Ship wants deny rules, the existing guards, and `dontAsk` in CI. A user mod can approve a call a hook blocked unless `sec-default` is in front. The mod pin test exists so Interlock’s own module does not become that mod.
- **claude-mem, funes, dreams, or API memory as the spec.** Model-written, easy to contradict, and (for auto memory) invisible to subagents and other machines. The ledger, the trajectory, and the outcome corpus are the memory.
- **A skill marketplace or an orchestrator plugin.** [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode), [ruflo](https://github.com/ruvnet/ruflo), and [superpowers](https://github.com/obra/superpowers) are other schedulers. Superpowers’ durable rule — the plan is written for someone with no context — already matches the task-shape contract in `skills/spec/SKILL.md`. Installing the plugin stacks a second orchestrator on `interlock run`.
- **Ultrareview on every wave.** Cloud fleet, about 15–25 minutes, GitHub.com PR mode, research preview. Local review stays `/interlock:review-code`.
- **Managed Agents as the spine.** Beta, not ZDR, advisor stays on the primary thread, session state leaves the machine.
- **Computer use, channels as task input, and “You should know.”** A GUI lock, a pushed prompt into a session that can edit the repo, and an opaque side agent. None of them is a gate.

Right-sizing (BMAD’s “small change, skip the ceremony”) is a real reason people route around spec-driven tools. Interlock already has `--solo` and a bug-fix evidence gate. A new skip path around the checkpoint is a product decision, and `docs/05` says continuity cannot catch a wrong idea. Leave it as a question, not a bet.

## Repos, by what they change here

Star counts are the GitHub API snapshot on 14 October 2026. Ranked by relevance to this loop, not by stars.

| Repo | Stars | Steal | Bet |
|---|---:|---|---|
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | 150,730 | Critic on edit, stop, and commit. Explorers report; the parent decides. | 1, 5 |
| [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core) | 10,497 | Discuss freezes decisions before plan. Each executor gets a fresh context. Verify writes a fix plan. | 1 |
| [liatrio-labs/claude-code-gauntlet](https://github.com/liatrio-labs/claude-code-gauntlet) | 13 | Blind challenge, new-versus-old, a published recall and noise number. GitLab. | 5, 7 |
| [obra/superpowers](https://github.com/obra/superpowers) | 298,854 | The plan is for someone with no context. Review lands before the next task. | already the task contract |
| [tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph) | 32,131 | Blast radius decides which lanes are actually disjoint. | 4 |
| [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) | 25,516 | After review, a short lesson the next spec must read. | 6 |
| [mvschwarz/openrig](https://github.com/mvschwarz/openrig) | 7,427 | The advisor is a seat, not a paragraph copied into every subagent. | 1, as a file |
| [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) | 100,574 | Progressive, cited, privacy-tagged recall. Optional input. | leave unbuilt as a store |
| [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | 25,991 | Grade tool order and files. Keep a no-skill baseline. | 2 |
| [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods) | 235 | A live band: which wave, which files, what is waiting on the human. | 3 |

Honorable, already the substrate: [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) (71,890 stars, pushed 13 October 2026). Keep it.

Ignore as design sources until someone reads past the installer: [affaan-m/ECC](https://github.com/affaan-m/ECC) (278,842 stars). Ignore role catalogs ([VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)). Ignore archived GSD ([gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done), last push 31 May 2026) and the stale security-review Action (last push 11 February 2026). The live in-session critic is the `security-guidance` plugin.

## Sequence

1. Checkpoint Advisor. One plaintext call, one file, the human reads it, `interlock ready` ignores it.
2. Spec Range. Ten labeled cases. Promote nothing. If the kill criterion hits, delete the advisor before a pane or a CI job wraps it.
3. Spec Pane. A read of that file inside `hooks/mod.mjs`.
4. Blast-radius lane cut on the graph you have. No model.
5. Spawn kinds for `--strict` review, with the blind challenge and the two-iteration cap.
6. Compound note, retrieved by the advisor.
7. Receipt Check. Still no model.

Outcome Bench, the MR gauntlet bot, and Change Desk wait until `advisor.md` exists and you are looking at it. When you pick up from that list, the receipt job is first among them only if bet 7 has not already landed.

## Open questions

1. The advisor never writes `decisions.md`. A draft blocks `--continue` only when you paste it as `needs_human`. Confirm that stays the rule.
2. Does the consult run on every spec, or only when the risk class is `high` or `critical`, the changes continuity already refuses to skip?
3. If Spec Range looks good, does lean ship stay closed to extra model calls, so Wave Note stays off?
4. Are you speccing in Cursor this month? The installed plugin there is not 1.6.1. Change Desk waits on a yes.
5. Who labels the ten Spec Range cases? If that person is not you, the grades drift toward whatever the model found easy to say.

## Sources

Primary docs and READMEs, fetched 14 October 2026:

- https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool
- https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration
- https://code.claude.com/docs/en/plugins/mods/overview
- https://code.claude.com/docs/en/hooks-guide
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/agent-teams
- https://code.claude.com/docs/en/workflows
- https://code.claude.com/docs/en/plugin-evals
- https://code.claude.com/docs/en/changelog
- https://github.com/anthropics/claude-code
- https://github.com/open-gsd/gsd-core
- https://github.com/liatrio-labs/claude-code-gauntlet
- https://github.com/obra/superpowers
- https://github.com/tirth8205/code-review-graph
- https://github.com/EveryInc/compound-engineering-plugin
- https://github.com/mvschwarz/openrig
- https://github.com/thedotmack/claude-mem
- https://github.com/promptfoo/promptfoo
- https://github.com/hamzafer/claude-code-mods
- https://github.com/Fission-AI/OpenSpec
- https://github.com/github/spec-kit

Repo facts are from Interlock 1.6.1 in this checkout (`docs/02`, `docs/05`, `docs/06`, `docs/09`, `docs/13`, `skills/spec`, `skills/review-code`, `skills/dispatch`, `lib/run.mjs`, `agents/worker.md`, `hooks/mod.mjs`). The passes did not execute the Advisor tool or a mod.
