# Claude Code teams and orchestration briefs

Six change briefs and seven app ideas for keeping Interlock current with what Claude Code shipped up to 2026-10-03. Claude Code 2.1.288 is installed on the machine they were written on. They were produced in five passes. Three research angles collected claims: agent teams and background sessions; the Workflow runtime and hooks; and headless `-p` flags and cost. Every claim then went through three adversarial lenses: primary source, currency, and whether it holds in the contexts Interlock actually runs in. Two claims were killed and several were corrected. A gap-fill round covered what the angles missed. Three ideators read the verified claims against this repository: one on the ship loop, drivers and host adapters; one on new apps and surfaces; one on guards, evals, observability and cost. A judge ranked their ideas after checking the load-bearing code paths. On the question that started this, agent teams turned out not to be the lever. Teams are experimental and off by default (teams-1). They never spawn from `-p` or the Agent SDK (teams-3). `/resume` does not restore them (teams-7), and they give no worktree isolation (teams-8) (all https://code.claude.com/docs/en/agent-teams). The features that matter to Interlock are the ones around teams: subagent and permission hooks, the `-p` result envelope, worktree bases, background sessions, and the environment variables that rewrite a spawn's model. Each brief is the source for one OpenSpec change, in the order given. Create it with `openspec new change`; do not hand-scaffold `openspec/changes/`.

## Sources to re-read on the day a change is proposed

Each was read on 2026-10-03 against Claude Code 2.1.288 unless a version is given. A default, a flag, or a bug's status can move.

- https://code.claude.com/docs/en/agent-teams (2026-10-03)
- https://code.claude.com/docs/en/agent-view (2026-10-03; agent view is a research preview since 2.1.139)
- https://code.claude.com/docs/en/workflows (2026-10-03)
- https://code.claude.com/docs/en/hooks (2026-10-03, CC 2.1.288)
- https://code.claude.com/docs/en/sub-agents (2026-10-03)
- https://code.claude.com/docs/en/worktrees (2026-10-03)
- https://code.claude.com/docs/en/headless (2026-10-03)
- https://code.claude.com/docs/en/cli-reference (2026-10-03)
- https://code.claude.com/docs/en/env-vars (2026-10-03)
- https://code.claude.com/docs/en/model-config (2026-10-03)
- https://code.claude.com/docs/en/sessions (2026-10-03)
- https://code.claude.com/docs/en/prompt-caching (2026-10-03)
- https://code.claude.com/docs/en/monitoring-usage (2026-10-03; traces are beta)
- https://code.claude.com/docs/en/goal (2026-10-03)
- https://code.claude.com/docs/en/scheduled-tasks (2026-10-03)
- https://code.claude.com/docs/en/cloud-environments (2026-10-03)
- https://code.claude.com/docs/en/remote-control (2026-10-03)
- https://code.claude.com/docs/en/routines (2026-10-03; research preview)
- https://code.claude.com/docs/en/ultrareview (2026-10-03; research preview)
- https://code.claude.com/docs/en/plugins/manifest-reference (2026-10-03)
- https://code.claude.com/docs/en/plugins/components (2026-10-03)
- https://code.claude.com/docs/en/plugins/cli-reference (2026-10-03)
- https://code.claude.com/docs/en/plugins/mods/overview (2026-10-03; mods shipped in 2.1.287)
- https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration (2026-10-03; beta `managed-agents-2026-04-01`)
- https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md (raw: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md), read through 2.1.288 on 2026-10-03
- https://github.com/anthropics/claude-code/issues/82258 (open on 2026-10-03)
- Local, no URL: `claude --help` and `claude <subcommand> --help` on 2.1.288, and the bundled `workflow-authoring` skill shipped with 2.1.288. Re-run both on the day. `workflow()` and the `budget` global are documented only in that skill, not on the public workflows page.

## Facts these briefs rely on, as of 2026-10-03

Vendor numbers below are vendor facts, cited with source and version. None of them is an Interlock threshold. Interlock's own caps live in `lib/limits.mjs`.

| Id | Claim | Version or date | Confidence | Source |
|---|---|---|---|---|
| teams-1 | Agent teams are experimental and off by default. Only `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, in the environment or in settings `env`, enables them. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/agent-teams |
| teams-3 | In `-p` mode and Agent SDK sessions no teammate is ever spawned. A named subagent runs as an ordinary subagent even with teams enabled. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/agent-teams |
| teams-4 | TeamCreate and TeamDelete were removed. Each session with the flag has one implicit team, and teammates are spawned through the Agent tool's `name`. | 2.1.178 | high | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| teams-5 | Only in interactive sessions with the flag set does an Agent call that sets `name` launch a teammate without confirmation (unless it is a fork or passes `isolation`). In `-p` and the SDK it stays a subagent. Workflow `agent()` calls take `label` and are not covered. | fetched 2026-10-03 | medium (corrected) | https://code.claude.com/docs/en/agent-teams |
| teams-6 | Teams cannot nest. A session has exactly one team, it cannot be shared, and the lead is fixed for the session. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/agent-teams |
| teams-7 | `/resume` and `/rewind` do not restore in-process teammates, and in-process teammates cannot run background subagents. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/agent-teams |
| teams-8 | Teams give no worktree isolation. Two teammates editing one file overwrite each other, and the docs say to partition files by hand. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/agent-teams |
| teams-10 | A teammate's model is the first of: spawn prompt, definition `model`, `CLAUDE_CODE_SUBAGENT_MODEL`, lead's model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` skips the first two. Teammates inherit the lead's effort. | v2.1.257 | high | https://code.claude.com/docs/en/agent-teams |
| teams-12 | Plugin agents spawned by name as teammates now run with their own prompt, tools, disallowedTools and effort instead of defaults. | 2.1.288 | high | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| teams-13 | A teammate spawned while the lead is in plan mode has its plan approved automatically, without review. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/agent-teams |
| teams-15 | Task tools are offered by default only on Claude 3.x, Opus 4.0-4.7, Sonnet 4.0-4.6 and Haiku 4.5. On other models they need an opt-in, and teammates coordinate by message. | 2.1.268 | medium (corrected) | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| teams-17 | `claude --bg` cannot be combined with `-p`. A background session moves into its own worktree under `.claude/worktrees/` before editing unless `worktree.bgIsolation` is `none`. | agent view 2.1.139; bgIsolation 2.1.143 | high | https://code.claude.com/docs/en/agent-view |
| teams-18 | `claude agents --json` is the supported external interface for session state (`working`, `blocked`, `done`, `failed`, `stopped`). Files under `~/.claude/jobs/` are not stable. | 2.1.145; `--all`, id, state 2.1.169 | high | https://code.claude.com/docs/en/agent-view |
| teams-19 | While agent view is open, a background session that needs input or finishes fires Notification with `agent_needs_input` or `agent_completed`. With no agent view open, nothing fires. | 2.1.198 | medium (corrected) | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| orchestration-1 | Workflow scripts can call `agent()`, `pipeline()`, `parallel()`, `phase()`, `log()` and `workflow(nameOrRef, args?)`, which nests one level. Globals are `args` and `budget`. `Date.now()`, `Math.random()` and a no-argument `new Date()` throw. | 2.1.288 (bundled skill) | medium (corrected) | https://code.claude.com/docs/en/workflows |
| orchestration-2 | The Workflow runtime allows 16 concurrent agents by default, changed by `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` (1-256). A run is capped at 1,000 agents. | v2.1.269 | high | https://code.claude.com/docs/en/workflows |
| orchestration-3 | A workflow run accepts no mid-run user input. The script has no direct filesystem or shell access. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/workflows |
| orchestration-4 | On relaunch, a failed agent reruns along with every agent that started after it, even completed ones. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/workflows |
| orchestration-5 | Workflows run in `-p` and the SDK with no approval prompt. The Workflow call goes through normal permission evaluation: an allow rule, auto mode, bypass mode, a PreToolUse allow hook, or a host callback. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/workflows |
| orchestration-7 | A workflow pauses at a claude.ai usage limit only in an interactive subscription session. In `-p`, the SDK, background and teammate sessions the affected agent fails. | v2.1.271 | high | https://code.claude.com/docs/en/workflows |
| orchestration-8 | Plugin workflows are namespaced `/<plugin>:<meta.name>`. `meta` must be a plain object literal or the command drops out of autocomplete. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/workflows |
| orchestration-9 | An `agent()` call with a schema fails after five validation attempts by default. A stopped agent or an unrecoverable API error resolves to null. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/workflows |
| orchestration-10 | A workflow agent's prompt cache lasts 5 minutes by default, including on a subscription, unless `subagentPromptCacheTtl` is `1h`. Matching siblings are held briefly so they read the first agent's prefix. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/workflows |
| orchestration-11 | Hooks have five handler types: command, http, mcp_tool, prompt, agent. Agent hooks are experimental. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/hooks |
| orchestration-12 | Hook events include PermissionDenied, UserPromptExpansion, TaskCreated, TaskCompleted, TeammateIdle, WorktreeCreate, WorktreeRemove, PreModelSwitch, PostModelSwitch and StopFailure, alongside the classic events. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/hooks |
| orchestration-13 | A timed-out command, http or mcp_tool hook does not block the tool call. The exception is PreModelSwitch, where a timeout blocks the switch. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/hooks |
| orchestration-14 | A WorktreeCreate hook replaces default worktree creation for `--worktree`, `isolation: worktree` and background sessions. Any non-zero exit fails worktree creation. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/hooks |
| orchestration-15 | For plugin subagents, the `hooks`, `mcpServers`, `permissionMode` and `initialPrompt` frontmatter fields are ignored. `model`, `effort`, `maxTurns`, `memory`, `skills`, `background` and `isolation` apply. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/sub-agents |
| orchestration-18 | `isolation: worktree` on a subagent branches from the repository's default branch by default, not from the parent's HEAD. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/sub-agents |
| orchestration-19 | A plugin's `settings` key applies only `agent` and `subagentStatusLine` and drops the rest. | fetched 2026-10-03 | high | https://code.claude.com/docs/en/plugins/manifest-reference |
| orchestration-20 | `claude plugin eval` runs cases in an isolated session with only the target plugin, and by default also without it. It exits 0 on pass, 1 on a failing case, 2 on a partial run. | v2.1.269 | high | https://code.claude.com/docs/en/plugins/cli-reference |
| headless-1 | `--permission-prompts none` denies anything that would prompt while the permission mode keeps deciding. Earlier versions reject the flag. | 2.1.259 | high | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| headless-2 | With `--permission-prompts none`, tools that need a person are removed. Denials appear as `permission_denied` stream-json messages and in the result's `permission_denials`. | v2.1.259+ | high | https://code.claude.com/docs/en/headless |
| headless-3 | The headless docs recommend `--bare` for scripted calls and say it will become the `-p` default in a future release. | 2026-10-03 | high | https://code.claude.com/docs/en/headless |
| headless-5 | Under `--bare`, OAuth and the keychain are never read, so the API needs `ANTHROPIC_API_KEY` or an apiKeyHelper. A plugin loads only through `--plugin-dir` or `--plugin-url`. | 2026-10-03 | high | https://code.claude.com/docs/en/headless |
| headless-6 | `--restricted` removes command-running tools and WebFetch unless `--tools` names them, refuses bypassPermissions, and ignores user, project and local settings files. | 2.1.248 | high | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| headless-7 | `--agents` accepts the path to a JSON file with `-p`, as well as inline JSON. | 2.1.281 | high | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| headless-9 | Open bug: `claude -p --agent` with an agent whose frontmatter has a `tools:` allowlist returns subtype success, exit 0, and no `structured_output` when `--json-schema` is set. | filed 2026-07-29 against 2.1.220; open 2026-10-03 | high | https://github.com/anthropics/claude-code/issues/82258 |
| headless-10 | `--max-budget-usd` now stops background subagents. Once the cap is reached, new spawns are denied. | 2.1.217 | high | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| headless-11 | A per-session spawn cap added in 2.1.212 was removed in 2.1.224, and its env var is a no-op. The binding limits are concurrent Agent-tool subagents and nesting depth. | 2.1.212 / 2.1.224 | medium (corrected) | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| headless-13 | `promptCacheTtl` and `subagentPromptCacheTtl` accept only `5m` or `1h`. With an API key, usage credits or a cloud provider, both default to five minutes. | v2.1.242+ | high | https://code.claude.com/docs/en/prompt-caching |
| headless-14 | `-p --output-format json` reports cache writes under `usage.cache_creation`, split into `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`. | 2026-10-03 | high | https://code.claude.com/docs/en/prompt-caching |
| headless-15 | Agent frontmatter `experimental.cacheTtl` (`5m` or `1h`) sets a per-agent cache TTL when no subagent TTL setting is configured. A `1h` value is ignored while a subscription draws on usage credits. | 2.1.248 | high | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| headless-17 | A routine's API trigger is a POST with a bearer token and a beta header. It is for claude.ai users only. | research preview, 2026-10-03 | high | https://code.claude.com/docs/en/routines |
| headless-18 | Routines have hourly limits per account and per routine. None of them has overage. | research preview, 2026-10-03 | high | https://code.claude.com/docs/en/routines |
| headless-19 | `claude ultrareview` blocks until the cloud review finishes and prints findings (`--json` gives the raw bugs.json), exit 0, 1 or 130. `claude -p '/code-review ultra'` does not wait and returns no findings. | research preview | high | https://code.claude.com/docs/en/ultrareview |
| headless-20 | Ultrareview gives Pro and Max a one-time allotment of free runs. After that each review costs usage credits. It is unavailable on Bedrock, Google Cloud's Agent Platform and Microsoft Foundry. | research preview | high | https://code.claude.com/docs/en/ultrareview |
| gap1-1 | SubagentStart hooks get `agent_id` and `agent_type`, cannot block, and can inject `additionalContext`. The event fires on spawn, on resume, and each time an in-process teammate handles a message. | docs at CC 2.1.288 | high | https://code.claude.com/docs/en/hooks |
| gap1-2 | SubagentStop hooks get `agent_id`, `agent_type`, `agent_transcript_path` and `last_assistant_message`. `decision:block` or exit 2 keeps the subagent running. Internal agents also fire it, with the session's `--agent` name or an empty `agent_type`. | docs at CC 2.1.288 | high (corrected) | https://code.claude.com/docs/en/hooks |
| gap1-3 | `--fallback-model` takes a chain, switches only on overload, unavailability or non-retryable server errors, lasts for the current turn, and is not shown by `/status`. | fallbackModel setting 2.1.166 | high | https://code.claude.com/docs/en/model-config |
| gap1-4 | The fallback chain applies to subagents, which continue on the fallback model since v2.1.247. Interactive sessions do not report a teammate's fallback. | v2.1.247 | medium (corrected) | https://code.claude.com/docs/en/model-config |
| gap1-5 | `/bg` and detach preserve `--fallback-model`, so background workers drop to the fallback instead of failing. | 2.1.143 | high | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| gap1-6 | `-p --output-format json` includes `total_cost_usd` and a per-model cost breakdown. Both are client-side estimates. | 2026-10-03 | high | https://code.claude.com/docs/en/headless |
| gap1-7 | Cost and token OTel metrics carry model, query_source, agent.name and plugin.name. Agent names outside built-ins and official-marketplace plugins show as `custom` unless `OTEL_LOG_TOOL_DETAILS=1`. | real names 2.1.273 | high | https://code.claude.com/docs/en/monitoring-usage |
| gap1-9 | Subagent API requests carry `x-claude-code-agent-id` and `x-claude-code-parent-agent-id`. `claude_code.llm_request` spans carry `agent_id` and `parent_agent_id`. | 2.1.139 | high | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| gap1-10 | The Workflow `budget` global has `total` (from the user's `+500k`-style directive, or null), `spent()` (output tokens across the turn) and `remaining()`. Once spent reaches total, `agent()` throws. | 2.1.288, bundled skill only | high | local `workflow-authoring` skill |
| gap1-11 | `workflow(nameOrRef, args)` runs a saved workflow inline and returns its value. The child shares the parent's concurrency cap, agent counter, abort signal and budget. Nesting is one level. | 2.1.288, bundled skill only | high | local `workflow-authoring` skill |
| gap1-12 | `/goal` wraps a prompt-based Stop hook. A small model judges the condition from the conversation alone and runs no commands. | 2.1.139 | high | https://code.claude.com/docs/en/goal |
| gap1-13 | `--include-hook-events` adds hook lifecycle events to the stream and needs `--output-format stream-json`. SessionEnd, Notification, PreCompact and PostCompact never produce `hook_started`. | 2026-10-03 | high | https://code.claude.com/docs/en/cli-reference |
| gap2-2 | The Workflow runtime runs fewer concurrent agents on machines with fewer CPUs. Queued `agent()` calls wait for a slot. | v2.1.269 | high | https://code.claude.com/docs/en/env-vars |
| gap2-4 | `--no-session-persistence` (print mode) means the session is not saved and cannot be resumed. | 2.1.288 | high | local `claude --help` |
| gap2-5 | `-p` sessions are left out of the picker but resumable with `--resume <session-id>`. Transcripts live at `~/.claude/projects/<project>/<session-id>.jsonl`. Retention defaults to 30 days (`cleanupPeriodDays`). | 2026-10-03 | high | https://code.claude.com/docs/en/sessions |
| gap2-8 | Mod hooks run in every session that loads the plugin, including `-p`, the SDK and cloud sessions. Panes draw only in the terminal and the Desktop Code tab. | 2.1.287 | high | https://code.claude.com/docs/en/plugins/mods/overview |
| gap2-10 | CronCreate and `/loop` tasks are session-scoped. They fire only while Claude Code is running and idle, with no catch-up. | 2026-10-03 | high | https://code.claude.com/docs/en/scheduled-tasks |
| gap2-11 | Claude Code's prompt cache is effectively scoped to one machine and directory. Sessions in different directories miss each other's cache. | 2026-10-03 | high | https://code.claude.com/docs/en/prompt-caching |
| gap2-12 | `--exclude-dynamic-system-prompt-sections` moves per-machine sections (cwd, env, memory paths, git status) into the first user message for cross-user cache reuse. It applies only with the default system prompt. | print mode v2.1.98 | high (corrected) | local `claude --help` |
| gap2-14 | Managed Agents multiagent orchestration delegates one level deep, and all agents share one sandbox and filesystem. | beta `managed-agents-2026-04-01` | high | https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration |
| gap3-2 | By default the system prompt is rendered once per conversation and reused, including on resume, until compaction. | `off` added 2.1.267 | high | https://code.claude.com/docs/en/cli-reference |
| gap3-3 | A line containing only `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` in replacement system-prompt text splits it so the part above stays cached. | 2.1.275 | high | https://code.claude.com/docs/en/cli-reference |
| gap3-4 | `worktree.baseRef` is `fresh` (default, branch from `origin/<default>`) or `head` (local HEAD). It governs `--worktree`, EnterWorktree and agent-isolation worktrees, and cannot name a branch. Inside a linked worktree, `head` resolves to that worktree's HEAD. | 2.1.133; fix 2.1.154 | high | https://code.claude.com/docs/en/worktrees |
| gap3-6 | `claude_code.llm_request` spans carry `workflow.run_id` (`wf_…`), `workflow.name` and cache token counts. Tracing is off by default and needs three opt-in settings. | traces beta, 2026-10-03 | high | https://code.claude.com/docs/en/monitoring-usage |
| gap3-7 | `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` forces one model onto subagents, teammates and Workflow agents. The definition's `model` is ignored and no model can be passed at spawn. | 2.1.257 | high | https://code.claude.com/docs/en/env-vars |
| gap3-8 | `CLAUDE_CODE_SUBAGENT_MODEL` now sets only the default subagent model. A model passed at spawn and a definition's `model:` take precedence. | 2.1.251 | high | https://code.claude.com/docs/en/sub-agents |
| gap3-10 | A plugin's root `settings.json` or manifest `settings` applies only `agent` and `subagentStatusLine`. User settings override plugin defaults. | 2026-10-03 | high | https://code.claude.com/docs/en/plugins/components |
| gap3-14 | Cloud sessions start from a fresh clone. Repo hooks, agents and skills carry over, but plugins enabled under `enabledPlugins` are not installed. Cloud sessions share the account's rate limits. | 2026-10-03 | high | https://code.claude.com/docs/en/cloud-environments |
| gap3-15 | `claude remote-control` server mode accepts `--spawn worktree` (each session gets its own worktree) and `--capacity <N>`. | 2026-10-03 | medium (corrected) | https://code.claude.com/docs/en/remote-control |

### Unverified — confirm before relying on these

The verified set has no low-confidence claims. Two kinds of fact are unconfirmed. The first kind was checked in official docs by an ideator but never voted on by the verifiers:

- B-worktrees-1: `.worktreeinclude` copies gitignored files into new worktrees. Background and subagent worktrees are swept after `cleanupPeriodDays`. A background session moves into its worktree before its first edit. https://code.claude.com/docs/en/worktrees, https://code.claude.com/docs/en/agent-view Lead's note, 2026-10-03: the first two sentences are on the worktrees page as read directly; the background-session move is from the agent-view page and remains unverified.
- B-cloud-env-1: `CLAUDE_CODE_REMOTE` and `CLAUDE_CODE_REMOTE_SESSION_ID` are set in cloud sessions. https://code.claude.com/docs/en/cloud-environments
- B-artifacts-1, -2, -3: Artifacts need a claude.ai sign-in on Pro, Max, Team or Enterprise. They are unavailable to API-key, gateway and cloud-provider sessions, and off by default in the SDK, the GitHub Action and MCP-server contexts. Org comments need v2.1.221, and comments sent to Claude need v2.1.228. Pages can carry export-to-paste controls. https://code.claude.com/docs/en/artifacts
- B-desktop-tasks-1: Desktop local scheduled tasks have local file access and an optional worktree. https://code.claude.com/docs/en/desktop-scheduled-tasks
- B-routines-1: GitHub `pull_request` triggers can filter on merged, labels and head branch, and webhook events over the hourly caps are dropped. https://code.claude.com/docs/en/routines
- B-remote-control-1: Remote Control mirrors workflow progress to devices, keeps permission prompts open until answered, and can push them to the phone. https://code.claude.com/docs/en/remote-control
- B-env-1: `CLAUDE_CODE_BRIDGE_SESSION_ID` is set while Remote Control is connected (v2.1.199+). https://code.claude.com/docs/en/env-vars
- B-ultrareview-1: a commit id is a valid ultrareview base. https://code.claude.com/docs/en/ultrareview
- B-tag-1: Claude Tag is Team/Enterprise only, runs each thread in an ephemeral sandbox in auto mode, and sets plugins per scope. https://claude.com/docs/claude-tag

The second kind is design-day probes. These are assumptions a brief depends on that no claim establishes:

- Entering a worktree outside `.claude/worktrees/` with EnterWorktree asks for approval (read in https://code.claude.com/docs/en/worktrees by the critic, no claim id). Inside a Workflow run, which accepts no input (orchestration-3), that prompt would stall the lane.
- The Workflow tool's `tool_input` and `tool_response` shape. https://code.claude.com/docs/en/hooks does not document it.
- Whether UserPromptSubmit or UserPromptExpansion fires for a typed `/interlock:ship`. Whether either fires when a background workflow's completion wakes the session.
- Whether Workflow `agent()` spawns fire SubagentStart and SubagentStop with `agent_type` `interlock:worker`. Whether the transcript carries per-turn usage with the 5m/1h split.
- Whether PermissionDenied fires only in auto mode, and how `autoMode.classifyAllShell` treats narrow Bash allow rules. https://code.claude.com/docs/en/auto-mode-config
- SessionEnd reason values, the plugin SessionEnd time budget, and the StopFailure error types. https://code.claude.com/docs/en/hooks
- Whether a Workflow `agent({model})` counts as a "model passed at spawn" under the 2.1.251 precedence (gap3-8).
- What `claude -p --output-format json` writes to stdout, and with what exit code, on an error subtype.
- Whether an `--agents` file whose worker has no `tools:` key avoids #82258.
- Whether hooks from a `--plugin-dir` plugin run under `--bare`. The local 2.1.288 help says bare skips hooks "defined in settings and by installed plugins".
- The envelope subtype of a `--max-budget-usd` stop under `--json-schema`, and its behaviour on a subscription login.
- Whether frontmatter `experimental.cacheTtl` applies to Workflow `agent({type})` spawns, and whether `claude plugin validate --strict` accepts the key.
- Whether `worktree.baseRef` passed through `--settings` governs `claude --bg` worktrees. gap3-4 does not list background worktrees.
- `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS` (the critic read it as new in 2.1.288; it stops sending `output_config.format`) and `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`. https://code.claude.com/docs/en/env-vars. `--safe-mode` is in the local 2.1.288 help: "Start with all customizations (CLAUDE.md, skills, installed plugins, hooks, MCP servers, custom commands and agents, output styles, workflows, custom themes, keybindings, and more) disabled". Its env twin, `CLAUDE_CODE_SAFE_MODE`, is unverified.
- TRACEPARENT inheritance in `-p`, and Claude Code stripping `OTEL_*` variables from Bash subprocesses. https://code.claude.com/docs/en/monitoring-usage

## Repository constraints every brief inherits

- Thresholds live in `lib/limits.mjs` and are printed by `interlock limits`. Skills, prompts and briefs do not restate them. A brief that needs a number proposes a limits key, and `design.md` derives its value.
- Vendor numbers (concurrent slots, agents per run, TTLs, retention, routine fire limits, ultrareview prices) are cited as vendor facts with source and version. They never become Interlock policy in prose. Vendor version floors become named constants in the module that reads them, the way `PROMPT_CACHE_MIN_HOST_VERSION` already is.
- Guards fail open. A new deny allows on any missing `session_id`, unknown stage, malformed ledger, unrecognised tool input, or its own crash. Recorder hooks always exit 0 and return no decision.
- No hook goes on an event where a timeout or non-zero exit blocks. That rules out WorktreeCreate (orchestration-14) and PreModelSwitch (orchestration-13). No hook exits 2 or returns `block` on SubagentStop (gap1-2).
- Every plugin hook runs in every session in every repository where the plugin is installed. Each handler exits before any filesystem access when no live stage marker or launch ledger exists.
- Guards and recorders are plugin-level hooks in `.claude-plugin/plugin.json`. Plugin subagent frontmatter `hooks` are ignored (orchestration-15). Hook handlers are command hooks. A prompt or agent handler (orchestration-11) would make a model's verdict a gate.
- Corpus-loss semantics stay per corpus. The trajectory and spill are fatal. Outcomes, review metrics, the resume card and every new sidecar in these briefs are outcome-class: a failed write is a banner and never moves an exit code. Hooks never write the trajectory.
- Unknown stays unknown. A missing usage, cache or model figure is never stored as zero.
- Degradation is spoken. A capability a host lacks is declared in `lib/host/registry.mjs`, asserted by `test/spine/host-registry.test.mjs`, and bannered. Registry edits are serialized across changes because each touches `CAPABILITY_VALUES`.
- Drivers interpret. Policy lives in `lib/run.mjs`. The no-policy sweep in `test/workflows.test.mjs` applies to every driver edit.
- A new flag sent to `claude` sits behind the existing one-time `--help` probe (design D30), so an older CLI never receives an unknown option.
- Zero runtime dependencies. No Agent SDK and no OTel SDK.
- A new skill instruction is pinned by tokens in `test/skills.test.mjs`.
- `openspec/` is written through `openspec new change` and `openspec instructions`.
- Agent teams stay out of the run path. No brief depends on them.
- `dispatch-published-effort`, `price-the-claude-5-5-list` and `measure-cost-per-task` from `briefs/claude-5-5-improvement-briefs.md` have landed or are in the Unreleased section. These briefs may depend on them and do not re-propose them.
- `npm test` before any change is reported complete.

### Landing order and shared files

- Brief 1 and Brief 5 both edit `bin/interlock-run` (`createWorktrees`, `spawnOne`), `runRecordBatch` in `lib/run.mjs`, and the spawn result schema. Land Brief 1 first or design them together.
- Brief 2 lands before Brief 4. Brief 2 moves model-override policy into `run start` and refines the observed `modelSelect` when FORCE is set. Brief 4's model-substitution banner and observed `cacheAccounting` reuse that path.
- Briefs 2, 3 and 4 all add `plugin.json` hook registrations, `hooks/_shared.mjs` helpers, `docs/13-the-guards.md` rows and `test/hooks.test.mjs` cases. Land them in the order 2, 3, 4. Settle one recorder file for the non-deciding hooks (SessionEnd from Brief 2; SubagentStart, SubagentStop and the permission events from Brief 4). Keep the deciding guard (Brief 3) separate.
- Brief 6 must not treat Interlock's own lane worktrees as session worktrees. It touches `runStart` beside Briefs 2 and 4.

---

## Brief 1 — Fork isolated lanes from the tree the run is actually on

**Suggested change name:** `fork-isolated-lanes-from-snapshot-base`

**Depends on:** nothing. Lands before Brief 5, or is designed with it.

### Why

Under `--isolate-waves`, a lane works in its own worktree and its result is folded back into the shared tree. The fold measures the lane's writes against a merge base. That base is wrong.

- `decorate()` in `lib/run.mjs` (near lines 885-900) reads `mergeBase` from `ctx.deps.headCommit(root)`. `bin/interlock` wires that dep to `git rev-parse HEAD` (near line 2475).
- `bin/interlock-run` `createWorktrees` (near line 409) forks each lane with `git worktree add --detach --force <path> <base>`.
- `laneDiff` (`bin/interlock`, near line 1283) diffs the lane against that base. `applyLaneDiff` (near line 1334) copies whole files with `copyFileSync`.

The ship commit is the last step of a run. Earlier waves' writes and earlier batches' folds stay uncommitted, so HEAD never moves during a run. Every isolated batch therefore forks from the pre-run commit. Two things follow.

- A wave-2 lane cannot see the wave-1 code it depends on.
- A collision-deferred batch exists because it shares a path with an earlier batch. It edits the stale copy of that file. Its whole-file fold then overwrites the earlier batch's edit. No collision fires, because the collision check looks only within one batch.

Under `--isolate-waves` that is a near-certain silent revert. It is the worst class of failure Interlock has: the run reports success and the code is wrong. The `decorate()` comment that the next batch's merge base "is read off this tree" is false. `test/spine/merge-lanes-fold.test.mjs` only exercises a clean shared tree. This was found by reading the code. It has not been reproduced yet, so the reproduction is task 1.

The Workflow host has a second problem. `worktree: 'runtime'` passes `isolation: 'worktree'` to `agent()`. Under the default `worktree.baseRef` of `fresh`, the runtime branches from `origin/<default>`, not from HEAD (gap3-4, https://code.claude.com/docs/en/worktrees; orchestration-18, https://code.claude.com/docs/en/sub-agents). Every file that differs between `origin/main` and the change branch then lands in every lane's diff. A multi-lane batch halts on a collision no lane caused. A single-lane batch silently copies `origin/main`'s versions over the branch. A plugin cannot set `baseRef`: plugin settings apply only `agent` and `subagentStatusLine` (gap3-10, https://code.claude.com/docs/en/plugins/components). `baseRef` cannot name a branch either (gap3-4).

### What changes

This brief is Phase 1. It closes the silent revert on both hosts with stdlib git plumbing and no new threshold.

- **The base is a snapshot, not HEAD.** A new dep, `snapshotTree(root)`, in `bin/interlock` builds a commit object of the shared tree as it stands. It uses a temporary `GIT_INDEX_FILE`, `git add -A`, `git write-tree` and `git commit-tree -p HEAD`, all through `execFileSync`. It moves no ref, touches no index and changes no working-tree file. `decorate()` stores the snapshot as `manifest.mergeBase` in place of HEAD. `laneDiff`, the fold and `createWorktrees` read it unchanged.
- **A deferred batch now sees the earlier batch.** Because the snapshot includes earlier folds, a collision-deferred batch edits the current file. Its whole-file fold carries both edits. No cross-batch collision check is needed.
- **Wave 2 sees wave 1.** Files that wave-1 lanes created are in the snapshot, so they are in every wave-2 lane tree.
- **A snapshot that cannot be built halts.** It hits the existing halt, "could not capture the shared-tree base commit".
- **The lane base is checked on every host.** `run record-batch` reads each lane's base itself with `git -C <worktreePath> rev-parse HEAD`, rather than trusting an agent's report. A lane whose base is not the stored snapshot halts the run: `LANE BASE MISMATCH: <lane> forked from <sha>, expected <snapshot>`. Nothing from that batch is folded. A fold against the wrong base becomes a halt, never a revert.
- **One allowed refinement.** Accept a lane whose base is HEAD when the snapshot's tree equals HEAD's tree. That is the first isolated batch of a run that started on a clean tree.
- **The comment in `decorate()` is corrected** to say what the base now is.

The consequence must be stated in the design and the docs. Until the follow-up lands, `--isolate-waves` on the Workflow host will usually halt with `LANE BASE MISMATCH`, because the runtime cannot fork from a snapshot commit. That is the intended Phase 1 outcome: a named halt in place of a wrong fold.

### Capabilities

- **Registry.** No new key or value in Phase 1. `worktree` stays `'driver' | 'runtime'`. The follow-up adds a `'cli'` value when the CLI creates lane worktrees for every host.
- **Workflow host.** `isolation: 'worktree'` on `agent()` is governed by `worktree.baseRef` (gap3-4), which Interlock can neither read reliably nor set (gap3-10). When an isolated batch halts on mismatch, the halt reason names `worktree.baseRef` and says that `--isolate-waves` on the Workflow host needs the follow-up.
- **Rejected: a WorktreeCreate hook.** A non-zero exit fails worktree creation for every `--worktree`, isolation and background worktree on the machine, not just ship runs (orchestration-14, https://code.claude.com/docs/en/hooks). That fails closed.

### Impact

**Code**

- `bin/interlock` — new `snapshotTree` dep beside `headCommit`. `laneDiff` and `applyLaneDiff` unchanged.
- `lib/run.mjs` — `decorate()` stores the snapshot. `runRecordBatch` reads lane bases and halts on mismatch. Corrected comment.
- `bin/interlock-run` — `createWorktrees` unchanged apart from receiving the snapshot as its base.
- `workflows/ship.js` — unchanged.

**Tests**

- `test/spine/merge-lanes-fold.test.mjs` — the two reproduction fixtures, and a mismatch fixture.
- `test/spine/run.test.mjs` — `decorate()` stores a snapshot, not HEAD. A non-isolated batch still carries `mergeBase: null`.
- `test/spine/merge-lanes.test.mjs` — the same-tree refinement.

**Docs and specs**

- `openspec/specs/lanes/spec.md` and `openspec/specs/waves/spec.md` deltas, through `openspec new change`.
- `docs/06-why-it-works.md` and `docs/07-cli-and-configuration.md`. Say that `git add -A` respects `.gitignore`, so an ignored generated file stays absent from lane trees, as it is today. Say that `--isolate-waves` on the Workflow host halts with a named reason until the follow-up.
- `CHANGELOG.md`.

### Out of scope

- **CLI-created worktrees for every host, and EnterWorktree on the Workflow host.** This is the follow-up. EnterWorktree into a given path is not in the verified claim set. The worktrees page says that entering a path outside `.claude/worktrees/` asks for approval, and a Workflow run accepts no input (orchestration-3, https://code.claude.com/docs/en/workflows), so the follow-up must prove the switch works without a prompt.
- **Moving lane worktrees under `.claude/worktrees/`.** That belongs to the follow-up, and it needs `observedChangedPaths` to exclude the directory in repositories that do not ignore it.
- **Committing folds mid-run.** That would end the single feature-level commit. The snapshot gives the same base without it.
- **A WorktreeCreate hook.** Rejected above.

### Decisions the design has to settle

1. **Who reads the lane base.** The CLI from the reported `worktreePath` (recommended), or an agent-reported `laneBase` schema field. Prefer the CLI. Keep a schema field only as a fallback if a runtime worktree can be gone by the time `record-batch` runs.
2. **Keeping the snapshot alive.** A dangling commit is safe from default `git gc` for the length of a run, but not from a user's `git gc --prune=now`. Decide whether to pin it under a private ref namespace (for example `refs/interlock/<runId>`) and delete that ref at close. If so, the "moves no ref" rule becomes "moves no ref outside Interlock's namespace".
3. **Untracked files.** Today an isolated lane does not see untracked, non-ignored files in the shared tree. With the snapshot it does. That is the intended fix, and the spec must say it.
4. **Fail early or at the first mismatch.** On the Workflow host, `run start` could refuse `--isolate-waves` with a named reason instead of letting the first isolated batch halt. Pick one. Refusing early wastes no agents. Halting at the mismatch keeps the refinement useful for single-batch runs.

### Task outline

1. Reproduce. Add a two-batch isolated wave whose second batch edits the first batch's file, and a wave-2 lane that imports a wave-1 file. Watch the first lose an edit and the second miss the import.
2. Add `snapshotTree` and store it in `decorate()`. Both fixtures pass.
3. Add the lane-base read, the `LANE BASE MISMATCH` halt and the same-tree refinement, with a fixture whose lane forks from a different commit.
4. Correct the `decorate()` comment. Write the spec deltas through `openspec new change`. Update docs.
5. `CHANGELOG.md`. `npm test`.

### Acceptance

- In the two-batch fixture, after both folds the shared file contains both batches' edits.
- A wave-2 lane's worktree contains a file a wave-1 lane created.
- A lane whose worktree HEAD is not the stored snapshot halts the run with `LANE BASE MISMATCH`, naming the lane and both shas. Nothing from that batch is folded.
- `snapshotTree` leaves HEAD, the index, `git status --porcelain` and every ref outside any chosen Interlock namespace unchanged.
- A batch without `--isolate-waves` still carries `mergeBase: null` and runs exactly as before.
- Tests: `test/spine/merge-lanes-fold.test.mjs`, `test/spine/run.test.mjs`, `test/spine/merge-lanes.test.mjs`.

---

## Brief 2 — Name what rewrote, dropped or stopped a Workflow agent

**Suggested change name:** `name-workflow-spawn-overrides-and-stops`

**Depends on:** nothing. Lands before Brief 4, and first of the three hook changes (2, 3, 4).

### Why

The default host speaks wrongly in two places and says nothing in two others.

1. **A false banner.** The validate ping in `workflows/ship.js` (near line 414) runs `printenv CLAUDE_CODE_SUBAGENT_MODEL`. When it is set, the driver raises `MODEL ROUTING OVERRIDDEN` (near line 461) and withholds the haiku pin from every control-plane ping (the pin is set near line 466 only when no override is seen). `docs/04-when-it-stops.md`'s `MODEL ROUTING OVERRIDDEN` section says the same. Since 2.1.251 that variable sets only the default: a model passed at spawn and a definition's `model:` both take precedence (gap3-8, https://code.claude.com/docs/en/sub-agents). On a current host the banner is false, and the pings run on the override model, often opus, for the whole run.
2. **A missing banner.** `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` does override everything. It forces one model onto subagents, teammates and Workflow agents and ignores the definition's model (gap3-7, https://code.claude.com/docs/en/env-vars; teams-10, https://code.claude.com/docs/en/agent-teams). Nothing in `lib/`, `bin/` or `workflows/` probes it. A user with FORCE set gets per-lane routing silently replaced.
3. **A misattributed null.** `spawnOne` (`workflows/ship.js:285`) reports any result without the right briefing hash as `BRIEFING NOT ACKNOWLEDGED: <label> reported (nothing)` (near line 308). But `agent()` resolves to null for a stopped agent or an unrecoverable API error (orchestration-9, https://code.claude.com/docs/en/workflows). Outside an interactive subscription session, a usage limit fails the agent instead of pausing (orchestration-7). The banner sends the reader to the briefing when the host was the cause.
4. **A killed session leaves nothing.** A session that ends mid-run kills the background workflow. `run close` never runs. No resume card is written and the trajectory has no terminal record. The Unreleased resume card has a hole exactly where a reader most needs it. The runner has the same hole: `bin/interlock-run` has a `stop()` path (near line 535) that calls `run close --halt`, but nothing traps SIGINT or SIGTERM.

Two smaller facts belong with these. `RUNTIME.maxConcurrentAgents` in `lib/limits.mjs` holds the documented vendor default (orchestration-2). The runtime runs fewer agents on machines with fewer CPUs, and `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` changes the count (gap2-2, https://code.claude.com/docs/en/env-vars). A wave wider than the real slot count queues silently. And `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (teams-1) does not affect Workflow `agent()` calls (teams-5, corrected), but a user debugging an odd interactive session should see it named.

### What changes

- **The probe's policy half moves out of the driver.** `interlock run start --host workflow` reads `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` and the Bedrock variables from its own `process.env`. That is how `hostSessionId` (`lib/run.mjs`, near line 382) already reads `CLAUDE_CODE_SESSION_ID`. The CPU count comes from `node:os`. There is no `host-env.json` file and no `nproc`. The Workflow script has no filesystem access (orchestration-3), and `nproc` is absent on stock macOS, so adding it to `REQUIRED_COMMANDS` would fail doctor there.
- **The driver forwards, it does not decide.** `run start` emits the ping model (`haiku` or null) on its step. `workflows/ship.js` sets `pingExtra.model` from that field. The `printenv CLAUDE_CODE_SUBAGENT_MODEL` and Bedrock lines leave the validate ping. Graph and test-profile probes stay where they are.
- **Version-aware reading.** `run start` learns the host version by extending the existing `probeClaudeEffort` call (`bin/interlock`, near line 2561) with `claude --version`.
  - `CLAUDE_CODE_SUBAGENT_MODEL` set, host 2.1.251 or later: no override banner, and pings keep haiku. An advisory note says the variable sets only the default on this host. It stays advisory until the design-day probe confirms that `agent({model})` counts as a spawn-time model.
  - Same variable, older host or unknown version: today's banner and today's haiku withholding.
  - FORCE set (2.1.257 or later): `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 — every agent runs on one model`. The observed `modelSelect` is refined downward, the same pattern the effort probe already uses.
  - Both version floors are named constants in the module that reads them.
- **Slots are observed, not resized.** `run start` records the slot count it can observe: the env override, or "vendor default, possibly CPU-reduced" with the CPU count. When the plan's widest wave exceeds an observed override, it banners `WAVE WIDER THAN RUNTIME SLOTS: <n> lanes queue`. `interlock limits` prints the vendor default beside the observed value. The plan is not resized.
- **TEAMS is a doctor note only.** No run banner, because Workflow agents are unaffected (teams-5).
- **Null is split from a wrong hash.** In `spawnOne`, `result === null` banners `AGENT RETURNED NO RESULT: <label> — the runtime stopped it, the API failed, or a usage limit ended it; the step is recorded as failed`. A present result with the wrong hash keeps `BRIEFING NOT ACKNOWLEDGED`. This is a host-observed fact with no policy, so it may live in the driver. The no-policy sweep gains a case for it.
- **A killed session leaves a note.** A SessionEnd command hook, in the recorder file shared with Brief 4, acts only when a live stage marker exists and the hook's `session_id` equals the run-start session id the trajectory already records. It writes `.claude/ship/<change>/interrupted.json` with `{session_id, reason, stage, at}`. That is one synchronous write and no subprocess. It always exits 0. SessionEnd is a hook event (gap1-13, https://code.claude.com/docs/en/cli-reference). Its reason values and the plugin time budget are on the unverified list.
- **Three readers speak the note.**
  - `interlock run start` banners `PREVIOUS RUN INTERRUPTED: <change> run <id> ended at stage <stage> — no resume card was written; interlock run-log show <id>`, then clears the note.
  - `hooks/preflight.mjs` surfaces the same line at the next SessionStart.
  - `interlock report` splits runs with no terminal record into interrupted and unexplained, each with its denominator.
- **The runner traps signals.** `bin/interlock-run` traps SIGINT and SIGTERM and calls its existing `stop()` once, so a killed runner also leaves a receipt and a card.
- **Doctor gains a `claude-env` row** with the same version-aware reading. It reports ok or skip and never fails.

### Capabilities

- **Environment variables read:** `CLAUDE_CODE_SUBAGENT_MODEL` (gap3-8), `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` (gap3-7), `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` (gap2-2, orchestration-2), `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (teams-1).
- **Registry:** no new key. The Workflow host's observed `modelSelect` is refined downward when FORCE is set.
- **Hook events:** SessionEnd, new registration, recorder only.
- **Banners added or changed:** `MODEL ROUTING OVERRIDDEN` (FORCE, and pre-2.1.251 only for the plain variable), `WAVE WIDER THAN RUNTIME SLOTS`, `AGENT RETURNED NO RESULT`, `PREVIOUS RUN INTERRUPTED`. When the host version cannot be read, behaviour falls back to today's banner, and the note says the version was unknown.

### Impact

**Code**

- `workflows/ship.js` — validate ping loses the model and Bedrock probes. `pingExtra.model` comes from the step. `spawnOne` splits null from a wrong hash.
- `lib/run.mjs` — `runStart` reads the environment and decides the banners and the ping model.
- `lib/host/claude-cli.mjs` and `bin/interlock` — the version probe beside `probeClaudeEffort`.
- `lib/limits.mjs` — `formatLimits` prints the observed slot count beside the vendor default.
- `lib/doctor.mjs` — `claude-env` row. `REQUIRED_COMMANDS` unchanged.
- `hooks/` — the shared recorder file with its SessionEnd branch. `hooks/preflight.mjs` reads the note.
- `.claude-plugin/plugin.json` — SessionEnd registration.
- `lib/report.mjs` — interrupted versus unexplained.
- `bin/interlock-run` — signal trap.

**Tests**

- `test/workflows.test.mjs` — the no-policy sweep finds no `printenv CLAUDE_CODE_SUBAGENT_MODEL`. Null and wrong-hash results banner differently.
- `test/spine/run.test.mjs` — the version-aware matrix and the ping model field.
- `test/hooks.test.mjs` — SessionEnd cases.
- `test/spine/doctor.test.mjs`, `test/spine/limits.test.mjs`, `test/spine/report.test.mjs`.

**Docs**

- `docs/04-when-it-stops.md` — rewrite `MODEL ROUTING OVERRIDDEN`. Add `AGENT RETURNED NO RESULT` and `PREVIOUS RUN INTERRUPTED`.
- `docs/10-agentic-workflow-ship-and-spec.md` — step 1 and the kill switches.
- `docs/13-the-guards.md` — the SessionEnd recorder row, marked as a recorder that blocks nothing.
- `CHANGELOG.md`.

### Out of scope

- Resizing waves to the observed slot count.
- A subagentStatusLine row that shows resolved against routed models. It is a later polish.
- StopFailure attribution of a null result. StopFailure exists (orchestration-12), but whether it fires for a Workflow subagent's API error is undocumented. That waits on a probe.
- The ship-meter mod. Its FORCE probe is absorbed here, and the rest stays an idea.
- Writing a terminal record into the interrupted run's trajectory. See decision 4.

### Decisions the design has to settle

1. **Advisory or authoritative 2.1.251 reading.** Keep it advisory until one probe on 2.1.288 confirms that `agent({model: 'haiku'})` runs on haiku with `CLAUDE_CODE_SUBAGENT_MODEL` set. Record the probe in `design.md`.
2. **Version source.** Parse `claude --version`. Decide the exact fallback when parsing fails: today's behaviour plus a note.
3. **Recorder file.** One file for SessionEnd now and Brief 4's events later, or separate files. Settle it here so Brief 4 does not reorganise it.
4. **Terminal record for an interrupted run.** The next `run start` could append a terminal record to the interrupted run's trajectory. That is a CLI write in the fatal class, not a hook write. Recommended: not in this change. The note and the report split are enough.
5. **Unverified environment candidates.** The critic flagged `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS`, which may remove schema enforcement behind a gateway, and safe mode, where plugins, hooks and workflows are absent. Confirm both against https://code.claude.com/docs/en/env-vars before adding them to the doctor row. Do not add them on the critic's word.

### Task outline

1. Probe on 2.1.288 (by hand, in a scratch session): with `CLAUDE_CODE_SUBAGENT_MODEL` set, a Workflow `agent({model: 'haiku'})` runs on haiku. Record the result.
2. Failing tests first: null result banners `AGENT RETURNED NO RESULT`; FORCE banners; the plain variable on 2.1.251 or later does not banner.
3. Move the environment reading into `run start`. Forward the ping model. Delete the driver's model probe.
4. SessionEnd recorder, the three readers, and the runner signal trap.
5. Doctor row, limits print, docs.
6. `CHANGELOG.md`. `npm test`.

### Acceptance

- With `CLAUDE_CODE_SUBAGENT_MODEL=opus` on host 2.1.288, `run start` raises no `MODEL ROUTING OVERRIDDEN` banner, and the ping step names haiku unless a Bedrock variable is set.
- With the same variable on host 2.1.250, today's banner appears and pings carry no model.
- With `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, the banner names FORCE and the manifest's observed `modelSelect` is downgraded.
- `spawnOne` given null banners `AGENT RETURNED NO RESULT`. Given a wrong hash it banners `BRIEFING NOT ACKNOWLEDGED`.
- `workflows/ship.js` contains no `printenv CLAUDE_CODE_SUBAGENT_MODEL`.
- A SessionEnd payload with a matching `session_id` and a live marker writes `interrupted.json`. A mismatched or missing `session_id` writes nothing. A crash exits 0. With no marker the hook creates no file or directory.
- The next `run start` prints `PREVIOUS RUN INTERRUPTED` once and clears the note.
- SIGTERM to `bin/interlock-run` leaves a receipt and a resume card.
- The doctor `claude-env` row never reports fail.
- Tests: `test/workflows.test.mjs`, `test/spine/run.test.mjs`, `test/hooks.test.mjs`, `test/spine/doctor.test.mjs`, `test/spine/limits.test.mjs`, `test/spine/report.test.mjs`.

---

## Brief 3 — guard-ship-relaunch: a second launch without a new human prompt is denied

**Suggested change name:** `guard-ship-relaunch`

**Depends on:** Brief 2 for hook-registration order and shared helper conventions. Not a technical dependency. Task 1, the payload capture, gates the deny branch.

### Why

The single most expensive recorded mistake is enforced only by prose. `skills/ship/SKILL.md:53` says: "Do not call Workflow again in this conversation … Only a new user message that explicitly asks to ship leftover tasks (or `/interlock:ship` again) is a relaunch." `test/skills.test.mjs:655` pins that sentence. `evals/trampoline-launch` measures whether the model obeys it. Nothing stops a model that does not. The CHANGELOG records the incident: the parent chat relaunched ship over leftover checkboxes, which cost "another 20+ agents, including a full review cycle".

The host now offers enforcement. A Workflow call goes through normal permission evaluation, including PreToolUse hooks (orchestration-5, https://code.claude.com/docs/en/workflows). UserPromptExpansion is a hook event beside the classic UserPromptSubmit (orchestration-12, https://code.claude.com/docs/en/hooks). A timed-out command hook does not block (orchestration-13), which matches the fail-open rule. The handler is a command hook. A prompt or agent handler (orchestration-11) would have a model judge whether a relaunch is authorised, which is the re-arguable verdict `CLAUDE.md` forbids.

### What changes

- **`hooks/guard-relaunch.mjs`**, one script that dispatches on `hook_event_name`. It is registered three ways in `.claude-plugin/plugin.json`.
- **UserPromptSubmit and UserPromptExpansion** record the time of the last human prompt in `.claude/ship/launch-ledger/<session_id>.json`. They write only when a ledger for that session already exists, which means after a first launch in that session. Otherwise the hook exits before any filesystem access. Without this rule, every prompt in every unrelated repository with the plugin installed would create `.claude/ship/`.
- **PostToolUse with matcher `Workflow`** records a launch when `tool_input` names this plugin's ship workflow. It also records the Workflow run id from `tool_response` if one is present. Recording after the tool call means a launch the runtime refused never counts.
- **PreToolUse with matcher `Workflow`** denies a ship launch when the ledger holds a launch for this `session_id` that is newer than the last recorded human prompt. The deny goes through `deny()` in `hooks/_shared.mjs`. The reason quotes the skill rule and gives the remedy: send a new message asking to ship the leftovers.
- **Every unknown allows.** No `session_id`, an unreadable ledger, unrecognised `tool_input`, a host that never wrote a prompt record, or the hook's own crash.
- **A false deny is cheap.** If the guard ever denies a legitimate relaunch, the remedy is one more typed message. That is far cheaper than an unwanted 20-agent run, but it is still a denial, which is why task 1 gates the deny branch.
- **The prose stays.** The skill sentence, its pin and the eval are unchanged. The eval measures whether the model obeys. The hook bounds what happens when it does not.
- **`docs/13-the-guards.md`** gains a hook row and a fail-open table row.

### Capabilities

- **Hook events:** PreToolUse (`Workflow`), PostToolUse (`Workflow`), UserPromptSubmit, UserPromptExpansion (orchestration-12). Command handler only. Keyed on the common `session_id` field.
- **Registry:** no new capability. `bin/interlock-run` refuses the Workflow host id, so only the `/interlock:ship` trampoline can reach this guard. `docs/13` says so.
- **When absent:** with hooks disabled, enforcement falls back to the prose and the eval. `docs/13` says that in so many words. A failed ledger write leaves a note on stderr.

### Impact

**Code**

- `hooks/guard-relaunch.mjs` (new). `hooks/_shared.mjs` gains a ledger reader and writer.
- `.claude-plugin/plugin.json` — four registrations.

**Tests**

- `test/hooks.test.mjs`:
  - first launch: allowed
  - second launch in the same session with no prompt in between: denied, with the reason
  - second launch after a UserPromptSubmit: allowed
  - `/interlock:spec --continue` launching ship once inside one human prompt: allowed
  - a different `session_id`: allowed
  - a non-ship workflow: allowed
  - missing `session_id`, malformed ledger, crash: allowed, with a stderr note
  - a prompt in a session with no ledger: no file created
  - a test asserting the `plugin.json` registrations
- `test/fixtures/` — the captured real payloads from task 1.

**Docs**

- `docs/13-the-guards.md`. `CHANGELOG.md`.

### Out of scope

- The commit briefing's three nevers (`git push`, `--amend`, `git add -A`). That is the guard-commit idea, held as later. Fold it in only if this change has room, since both touch `docs/13`, `test/hooks.test.mjs` and the hooks layer.
- Launches across sessions. Each session is its own ledger.
- A queue of launches. A later queue idea would have to register as one launch.

### Decisions the design has to settle

1. **What identifies a ship launch.** Field names come from the captured payload: a `scriptPath` ending in `workflows/ship.js`, or a `name` of `interlock:ship`. A marketplace install may namespace differently. Match on something that survives that.
2. **Whether the completion wake looks like a prompt.** If a background workflow's completion notification fires UserPromptSubmit, the guard is useless, because the dangerous relaunch is exactly the one that follows that notification. This is the decisive probe.
3. **Both prompt events or one.** Record on UserPromptSubmit, UserPromptExpansion, or both, depending on which fires for a typed `/interlock:ship`.
4. **Ledger lifetime.** Who deletes stale ledgers: `run close`, Brief 2's SessionEnd recorder, or an age check on read.

### Task outline

1. Capture payloads with a logging hook in a scratch session. Get PreToolUse and PostToolUse for a Workflow call (the `tool_input` keys, and where `tool_response` carries the run id). Get UserPromptSubmit and UserPromptExpansion for a typed `/interlock:ship`. Record what fires, if anything, when a background workflow's completion wakes the session. Pin the payloads as fixtures. If a typed slash command fires neither prompt event, or the completion wake fires UserPromptSubmit, stop after the recorder half and ship no deny branch.
2. Write the failing hook tests.
3. Implement the recorder branches, then the deny.
4. Register in `plugin.json`, with a test that asserts the registration.
5. `docs/13`, `CHANGELOG.md`, `npm test`.

### Acceptance

- Every case in the test list above holds.
- The deny reason quotes the skill rule and names the remedy.
- No path through the hook exits non-zero except the documented deny.
- With no ledger for a session, a UserPromptSubmit creates no file or directory.
- The skill sentence at `skills/ship/SKILL.md:53` and its pin are unchanged.
- Tests: `test/hooks.test.mjs`.

---

## Brief 4 — Workflow-host recorder hooks: lane identity, cache accounting, observed model, permission events

**Suggested change name:** `record-workflow-agent-usage`

**Depends on:** Brief 2 (the observed-capability path and the FORCE observation) and Brief 3 (hook registration order). Task 1, a probe, decides how much of this change survives.

### Why

The default host measures the least. `ASSUMED_CAPABILITIES` in `lib/run.mjs` (near line 168) declares `cacheAccounting: false` for the Workflow host. The runtime exposes `budget.spent()`, which counts output tokens summed across the turn (gap1-10, local `workflow-authoring` skill, 2.1.288). So every `/interlock:ship` run prints `CACHE ACCOUNTING NOT REPORTED`. The Unreleased CHANGELOG names this as a known weakness, and the cost-per-task sweep has to measure outside the ship loop.

No receipt records the model that actually served a lane either.

- FORCE replaces every Workflow agent's model (gap3-7, https://code.claude.com/docs/en/env-vars).
- A fallback chain keeps subagents running on the fallback since v2.1.247 (gap1-4, https://code.claude.com/docs/en/model-config).
- Background sessions keep the fallback (gap1-5, CHANGELOG 2.1.143).

The trajectory's agent-spawn event records the routed model, and the corpus reads it as the model that ran.

Mid-run permission prompts and auto-mode denials go unnamed too. `docs/04` calls a mid-run permission prompt the one interruption the runtime cannot prevent. PermissionDenied is a hook event (orchestration-12, https://code.claude.com/docs/en/hooks).

Hooks can now see all of this. SubagentStop gives `agent_id`, `agent_type` and `agent_transcript_path` (gap1-2). SubagentStart gives `agent_id` and `agent_type` (gap1-1). The `agent_id` is the same id OTel spans and request headers carry (gap1-9), so a later telemetry join is possible.

### What changes

- **One recorder file for non-deciding hooks**, settled with Brief 2. It is registered on SubagentStart and SubagentStop with the anchored matcher `^interlock:(worker|ping)$`, and on PermissionDenied and PermissionRequest. It acts only while a fresh stage marker exists, using the index-and-pid staleness rule from `lib/ship-stage.mjs` that the guards already use. Otherwise it exits before any filesystem access.
- **SubagentStop records usage.** It reads `agent_transcript_path` and sums each assistant turn's usage: input, output, `cache_read_input_tokens`, and cache creation split by `ephemeral_5m` and `ephemeral_1h`. Those are the fields `CACHE_TIER_FIELDS` in `lib/host/claude-cli.mjs` already reads from the `-p` envelope (headless-14, https://code.claude.com/docs/en/prompt-caching). It collects the distinct models. It pulls the briefing sha256 out of the BOOTSTRAP prompt as the join key to a spawn label. It appends one line keyed by `agent_id` to an outcome-class sidecar under `.claude/ship/`.
- **It cannot block.** It always exits 0, never returns `decision: block`, and catches its own crash. Exit 2 on SubagentStop keeps the subagent running (gap1-2). Internal agents report the session's `--agent` name or an empty `agent_type` (gap1-2), and the anchored matcher skips them.
- **SubagentStart records spawn time**, deduplicated by `agent_id`, because the event also fires on resume and on each teammate message (gap1-1).
- **Permission events record** `{agent_id, tool, reason}` for denials and `{agent_id, tool}` for prompts.
- **`run close` joins.** `recordUsage` and `summarizeUsage` match lines to spawns by briefing sha. A wave where every spawn has a line gets recorded usage and cache figures, and the manifest's observed `cacheAccounting` becomes `'hook'`. One missing line makes the wave unknown under the existing unknown-not-zero rule, bannered `CACHE ACCOUNTING PARTIAL: <n> of <m> agents unrecorded`.
- **Observed model.** The receipt and the agent-spawn record gain `modelObserved` beside the routed model. A mismatch banners `MODEL SUBSTITUTED: <label> routed <slug>, ran <id>`. The comparison goes through `lib/host/model-map.mjs`, or every lane would raise a false banner on alias against full id. Brief 5 raises the same banner on the runner, with the same words.
- **Permission banners.** `PERMISSION PROMPTS DURING RUN: <n>` and `AUTO MODE DENIED <n> TOOL CALLS`.
- **The join reads the transcript.** It does not bind through a PreToolUse(Read) hook. That would run a node process on every Read in every session with the plugin installed.
- **A captured fixture pins the transcript line shape.** An unparseable transcript is unrecorded, never zero.

### Capabilities

- **Hook events:** SubagentStart (gap1-1; command hooks only), SubagentStop (gap1-2), PermissionDenied (orchestration-12), PermissionRequest (https://code.claude.com/docs/en/hooks).
- **Registry:** `cacheAccounting` widens from a boolean to include an observed `'hook'` value. This edit is serialized with every other registry change. The Workflow host's assumed value stays `false`. `run close` raises the observed value only when every lane recorded.
- **When absent:** with hooks disabled, or if the probe fails, today's `CACHE ACCOUNTING NOT REPORTED` stands unchanged. Partial coverage banners `CACHE ACCOUNTING PARTIAL`.
- **Corpus class:** the sidecar is outcome-class. A failed append is a banner and never moves an exit code. `docs/13` says so explicitly, so nobody "makes it consistent" with the fatal trajectory.

### Impact

**Code**

- The shared recorder file in `hooks/`. `hooks/_shared.mjs` helpers.
- `.claude-plugin/plugin.json` — four registrations.
- `lib/run.mjs` — `recordUsage`, `summarizeUsage`, `runClose`, `logSpawns`.
- `lib/run-log.mjs` — `modelObserved` on agent-spawn, receipt fields.
- `lib/receipt.mjs`.
- `lib/host/registry.mjs` — the `cacheAccounting` values.

**Tests**

- `test/hooks.test.mjs`, `test/spine/run.test.mjs`, `test/spine/run-log.test.mjs`, `test/spine/receipt.test.mjs`, `test/spine/host-registry.test.mjs`.
- `test/fixtures/` — captured SubagentStart and SubagentStop payloads and one real transcript.

**Docs**

- `docs/13-the-guards.md` — recorder rows and the corpus-class sentence.
- `docs/04-when-it-stops.md` — the new banners.
- `CHANGELOG.md`.

### Out of scope

- The worker cache-lifetime choice. It needs these figures first and is held as later.
- A doctor row on `autoMode.classifyAllShell`. It is on the unverified list, and is a cheap add-on once confirmed.
- OTel correlation. That is later, and only for operators who export telemetry.
- The ship-meter mod. It is the fallback if task 1 fails.

### Decisions the design has to settle

1. **Scope after the probe.** If Workflow `agent()` spawns do not fire SubagentStop with `agent_type` `interlock:worker` and a readable transcript, the change shrinks to the permission-event half, or stops.
2. **The join key.** The briefing sha in the BOOTSTRAP text. Confirm it appears verbatim in the first user turn of the transcript.
3. **The `cacheAccounting` value shape.** Old manifests read `true` and `false`. Choose an enum that keeps them readable.
4. **Sidecar location and lifetime.** Per change or per run, and who clears it.
5. **The cache split in transcripts.** The critic noted that no claim establishes the 5m/1h split in Workflow agent transcripts. If it is absent, record total cache creation only, and keep the tier split unknown.

### Task outline

1. Probe with a logging plugin. Spawn a Workflow `agent()` with type `interlock:worker`. Capture the SubagentStart and SubagentStop payloads and one transcript. Check whether PermissionDenied and PermissionRequest inside a workflow agent carry `agent_id`. Pin all of it as fixtures. Decide scope (decision 1).
2. Failing tests for the join: complete, partial, unparseable.
3. Recorder hook and registrations.
4. The close join, the banners, the receipt fields and the registry value.
5. Docs, `CHANGELOG.md`, `npm test`.

### Acceptance

- A SubagentStop fixture for `interlock:worker` appends one line with summed usage, models and briefing sha.
- The hook exits 0 for valid input, malformed input and a forced crash, and never prints a decision.
- An empty `agent_type` writes nothing. With no live marker the hook creates no file or directory.
- A close where every lane has a line records wave cache figures, sets observed `cacheAccounting` to `'hook'`, and raises no `NOT REPORTED` banner.
- A close with one missing line marks the wave unknown and banners `CACHE ACCOUNTING PARTIAL` with both counts.
- A transcript model that differs from the routed model after the model map banners `MODEL SUBSTITUTED`. An alias and its full id raise nothing.
- A failed sidecar append banners and leaves the exit code unchanged.
- Tests: `test/hooks.test.mjs`, `test/spine/run.test.mjs`, `test/spine/run-log.test.mjs`, `test/spine/receipt.test.mjs`, `test/spine/host-registry.test.mjs`.

---

## Brief 5 — The claude runner reads the whole result envelope

**Suggested change name:** `read-claude-runner-result-envelope`

**Depends on:** Brief 1 first, or a joint design, because both edit `bin/interlock-run`, `runRecordBatch` and the spawn result schema. It uses Brief 4's `MODEL SUBSTITUTED` wording if that lands first, and defines it otherwise.

### Why

The runner is the opt-in path. It ranks below the default-host briefs for that reason only. It is also the prerequisite for spend caps and resumable lanes, both held as later.

`readClaudeEnvelope` (`lib/host/claude-cli.mjs:178`) keeps two fields: `structured_output` and `usage`. It already returns `result: null` when `structured_output` is missing, and that becomes a failed spawn. So the problem is not a silent success. It is an anonymous failure. Three failures look the same today.

1. **The adapter sends the configuration of an open bug.** `claude -p --agent` with a `tools:` allowlist and `--json-schema` can return subtype success, exit 0 and no `structured_output` (headless-9, https://github.com/anthropics/claude-code/issues/82258, open on 2026-10-03). `agents/worker.md` carries `tools: Read, Write, Edit, Grep, Glob, Bash`. The adapter passes `--json-schema` and `--agent` (`lib/host/claude-cli.mjs`, near lines 97-103). The registry declares `schemaEnforced: true`. The lane fails with no named cause.
2. **Denials are unread.** The adapter's own header comment (near lines 18-21) records that a PreToolUse deny lands in `permission_denials`. Nothing reads it. With `--permission-prompts none` (headless-1, CHANGELOG 2.1.259), denials appear there too (headless-2, https://code.claude.com/docs/en/headless). A lane a guard blocked looks like a lane that did nothing.
3. **A non-zero exit returns null before stdout is read** (`lib/host/claude-cli.mjs:338`). The `spawn-failed` event reaches stderr only under `--verbose`. A lane stopped by max turns, a rate limit or an auth failure looks identical to every other failure.

Two more facts are dropped.

- **Which model served the lane.** A fallback chain switches for one turn and `/status` does not show it (gap1-3, https://code.claude.com/docs/en/model-config). The per-model breakdown in the envelope is the only sign (gap1-6, https://code.claude.com/docs/en/headless).
- **The lane's session id.** `-p` sessions are resumable with `--resume <session-id>`, and transcripts are kept for a vendor default retention period (gap2-5, https://code.claude.com/docs/en/sessions). The runner records none. `--no-session-persistence` would remove the transcript altogether (gap2-4, local `claude --help` 2.1.288), so the adapter must never pass it.

And one fact is coming. The headless docs say `--bare` will become the `-p` default (headless-3). Under bare, OAuth and the keychain are never read, and plugins load only through `--plugin-dir` or `--plugin-url` (headless-5, https://code.claude.com/docs/en/headless). Subscription users would hit an auth failure with no warning.

### What changes

Phase 1 keeps `--output-format json`.

- **Parse stdout whatever the exit code.** The reader returns a `host` record beside `result` and `usage`:
  - `subtype`, `is_error`, `terminal_reason` if present
  - `errors`, truncated and bounded
  - `permission_denials`: a count and the tool names
  - `session_id`, `num_turns`
  - `servedModels`: the keys of the per-model breakdown
  - `hostCostUsd`: `total_cost_usd`, labelled a client-side estimate
- **The adapter classifies. `lib/run.mjs` decides the banners at close.**
  - `LANE STOPPED BY HOST: <label> <subtype>`
  - `SCHEMA RESULT MISSING (claude): <label> — success without structured_output (anthropics/claude-code#82258)`
  - `TOOLS DENIED IN LANE: <label> <n> (<tools>)`
  - `MODEL SUBSTITUTED: <label> routed <slug>, ran <ids>`, compared through `lib/host/model-map.mjs`
- **A new trajectory event, `agent-result`,** joins `RUN_LOG_TYPES` in `lib/run-log.mjs`. The CLI writes it on the existing `record-batch` path, so it inherits fatal-on-write. `hostCostUsd` is stored apart from `MODEL_PRICES` dollars and is never summed with them.
- **The resume card lists each halted or failed lane's session id** with `claude --resume <id> --fork-session`, and says the transcript expires after the host's retention period.
- **Never wait on a prompt.** Pass `--permission-prompts none` when `INTERLOCK_CLAUDE_PERMISSION_MODE` is not `bypassPermissions` and the `--help` probe lists the flag.
- **A pinned test** asserts the adapter never passes `--no-session-persistence`.
- **Bare-proofing.**
  - A pinned test asserts `claudeArgs` always carries `--plugin-dir` when the checkout is the plugin, and that the adapter never relies on implicit plugin, hook or `CLAUDE.md` loading.
  - A doctor row reports skip, never fail, when `--bare` or `CLAUDE_CODE_SIMPLE` is in effect without `ANTHROPIC_API_KEY` or an apiKeyHelper.
- **A hypothesis to probe, not a default.** Generate a per-run agents file from `agents/worker.md` with no `tools:` key, pass it with `--agents <file>` (headless-7, CHANGELOG 2.1.281), and restrict tools with the `--allowedTools` the adapter already sends. Adopt it only if the probe returns `structured_output`. Otherwise the named failure stays the mitigation.

Phase 2 is optional and a separate decision. Switch to `--output-format stream-json --verbose --include-hook-events` (gap1-13, https://code.claude.com/docs/en/cli-reference). Take the final `result` line as the envelope. Count guard `hook_response` events that carry `interlockGuard.guard`, and record `guardDenials` per lane. `interlock report` then gains a guard-firing indicator over the lanes that could produce one.

### Capabilities

- **CLI flags:** `--output-format json` (existing), `--permission-prompts none` (headless-1), `--resume` and `--fork-session` (gap2-5), `--plugin-dir` (headless-5), `--agents <file>` (headless-7, hypothesis), `--no-session-persistence` (asserted never passed, gap2-4), `--include-hook-events` (Phase 2, gap1-13).
- **Registry:** `schemaEnforced` stays declared `true` for `claude`. Receipts gain an observed refinement when a schema-missing envelope appears, so the corpus can be partitioned. No new key.
- **When absent:** if the `--help` probe does not list `--permission-prompts` and the permission mode is not bypass, the run banners once that prompts are not suppressed on this CLI. An unparseable envelope stays null and unknown, never zero.
- **Rejected: `--restricted` for reviewer lanes.** It ignores project settings, so the plugin's hooks would not apply, and it removes the Bash a reviewer needs for `git diff` (headless-6, CHANGELOG 2.1.248).

### Impact

**Code**

- `lib/host/claude-cli.mjs` — `claudeArgs`, `readClaudeEnvelope`, the non-zero exit path, the probe.
- `bin/interlock-run` — `spawnOne` forwards the host record.
- `lib/run.mjs` — banner decisions at close, the `agent-result` write.
- `lib/run-log.mjs` — the new event type and field mapper.
- `lib/receipt.mjs`, `lib/resume-card.mjs`, `lib/doctor.mjs`.
- `agents/worker.md` — unchanged unless the agents-file probe succeeds. Then a parity test pins the generated file to it.

**Tests**

- `test/fixtures/hosts/fake-claude.mjs` gains modes: an error subtype with a non-zero exit, success without `structured_output`, a per-model breakdown with an extra model, `permission_denials`, and (Phase 2) a stream with a denying `hook_response`. It keeps refusing unknown flags.
- `test/spine/host-adapters.test.mjs`, `test/spine/run-log.test.mjs`, `test/spine/run.test.mjs`, `test/spine/resume-card.test.mjs`, `test/spine/doctor.test.mjs`, `test/spine/plugin-agents.test.mjs` (agents-file parity, if adopted).

**Docs**

- `docs/04-when-it-stops.md` — the four banners. `CHANGELOG.md`.

### Out of scope

- Per-lane spend caps. Held as later. They need this change's subtype classification.
- Resuming a lane to send it its own fixes. Held as later. This change only records the id and prints the command.
- `--restricted` reviewer lanes. Rejected above.
- An Agent SDK host. It would add a runtime dependency.
- Making stream-json the default without the Phase 2 decision.

### Decisions the design has to settle

1. **The error envelope.** What stdout carries, and with what exit code, on an error subtype. Probe on 2.1.288 before writing the parser.
2. **Agents file or named failure.** Adopt the generated file only on a passing probe.
3. **Bounds.** The `errors` list and the banner lists reuse `LIMITS.resumeCardListRows`, or a new limits key printed by `interlock limits`.
4. **Schema version.** Whether `agent-result` needs a trajectory schema bump. Readers must tolerate the old version either way.
5. **Phase 2 or not.** It changes the parser and enlarges stdout.
6. **The model comparison.** A fallback can serve one turn of a lane. Decide whether any extra model raises the banner or only a majority.

### Task outline

1. Probes on 2.1.288: the error-subtype envelope and its exit code; whether an agents file without `tools:` returns `structured_output`. Capture both as fixtures.
2. Extend `fake-claude.mjs` with the new modes.
3. Failing tests for each banner.
4. Envelope reader, host record, `agent-result`, banners, resume-card line.
5. `--permission-prompts none` behind the probe. The never-`--no-session-persistence` test. The `--plugin-dir` pin. The doctor row.
6. Docs, `CHANGELOG.md`, `npm test`.

### Acceptance

- A success envelope without `structured_output` fails the spawn, and the summary shows `SCHEMA RESULT MISSING` naming #82258 without `--verbose`.
- A non-zero exit whose envelope has an error subtype banners `LANE STOPPED BY HOST` with that subtype.
- Two permission denials banner `TOOLS DENIED IN LANE` with the count and the tool names.
- A routed `sonnet` whose breakdown key is its full id raises nothing. An extra model key raises `MODEL SUBSTITUTED`.
- `agent-result` is written by the CLI, and a failed append exits 1.
- A halted run's resume card lists each failed lane's session id and the resume command.
- `claudeArgs` never contains `--no-session-persistence`. `--permission-prompts none` appears only when the probe lists it and the mode is not bypass.
- `hostCostUsd` is never added to `MODEL_PRICES` dollars.
- Tests: `test/spine/host-adapters.test.mjs`, `test/spine/run-log.test.mjs`, `test/spine/run.test.mjs`, `test/spine/resume-card.test.mjs`, `test/spine/doctor.test.mjs`.

---

## Brief 6 — State home: keep corpora intact in a worktree Interlock did not create

**Suggested change name:** `resolve-corpus-state-home`

**Depends on:** Brief 1, because Interlock's own lane worktrees are linked worktrees and the resolver must ignore them. It touches `runStart` beside Briefs 2 and 4. Land those first or serialize.

### Why

Worktree sessions are becoming the normal shape of parallel work.

- `claude --bg` moves into its own worktree under `.claude/worktrees/` before editing, unless `worktree.bgIsolation` is `none` (teams-17, https://code.claude.com/docs/en/agent-view).
- `claude agents --json` is the supported state interface for those sessions (teams-18, same page).
- `--worktree` and agent-isolation worktrees follow `worktree.baseRef` (gap3-4, https://code.claude.com/docs/en/worktrees).
- Remote Control can spawn each session in its own worktree (gap3-15, https://code.claude.com/docs/en/remote-control, medium).
- Cloud sessions start from a fresh clone (gap3-14, https://code.claude.com/docs/en/cloud-environments).

Interlock resolves every corpus against `--root`, which defaults to cwd: `.claude/ship/runs` (`RUN_LOG_DIR`, `lib/run-log.mjs`), `.claude/learning/outcomes.jsonl`, `.claude/metrics` (`METRICS_DIR`) and `.claude/handoff` (`HANDOFF_DIR`). This repository's `.gitignore` excludes all of them, plus `.claude/testing/` and `.claude/graph/`.

Claude Code already does a read-through of its own. When a worktree checkout has no `.claude/skills`, `.claude/agents` or `.claude/commands` at its root, the session loads the main checkout's copies (skills from v2.1.277), and project-scope plugins installed from the main checkout load in its worktrees (v2.1.200). Nothing does the same for Interlock's test profile, graph or corpora. https://code.claude.com/docs/en/worktrees

In a linked worktree, a run therefore starts without its test profile and graph, and prints `NO TEST PROFILE` and `GRAPH UNAVAILABLE`. Then it writes its fatal trajectory, its outcome record, its review metrics and its resume card into a directory that goes away with the worktree. `interlock report` in the main checkout never sees those runs, and never says it is missing them. The report exists to read exactly these corpora, and it degrades silently. That breaks "degradation is spoken".

### What changes

- **`lib/state-home.mjs` (new).** When cwd is a linked worktree, it resolves the main worktree as the parent of `git rev-parse --path-format=absolute --git-common-dir`, through `execFileSync`, following `lib/drift.mjs` and `lib/run-paths.mjs`. Any git failure falls back to cwd with `STATE HOME UNRESOLVED: <reason>`. An explicit `--root` wins, so a user who wants per-worktree corpora keeps them.
- **The resolver ignores Interlock's own lane worktrees.** A cwd under `LANE_WORKTREES_DIR` is not treated as a session worktree.
- **Split by kind.**
  - Append-only corpora keyed by run id go to the state home: `runs/<runId>.jsonl`, `outcomes.jsonl`, the metrics files, and resume cards. Readers read them from there.
  - Per-run working state stays in cwd: `.claude/ship/run.json`, `state.json`, briefings, spill, and `.claude/ship/<change>/stage.json`. Two concurrent ships in two worktrees never share a cursor. The guards keep reading a stage marker relative to cwd and still fail open.
- **Inputs read through, with a banner.** When `.claude/testing/profile.json` or `.claude/graph/` is missing in a linked worktree, read the state home's copy. Banner `TEST PROFILE FROM MAIN CHECKOUT` or `GRAPH FROM MAIN CHECKOUT`. The graph banner says the graph may be stale for this worktree, and the grep fallback remains.
- **`run start` records `surface` and `stateHome`** on run-start and on the receipt. Surface is `main` or `linked-worktree`. A `cloud` value waits on decision 4.
- **`interlock report` partitions runs by surface**, and says how many runs in its window came from linked worktrees.
- **Loss semantics are kept exactly.** A failed trajectory append in the state home still exits 1. Outcome and metrics write failures still only report.

### Capabilities

- **Not a host capability.** Surface is a fact about the session, not about the transport. It goes on the receipt and is bannered. The registry stays transport-only.
- **Claude Code features involved:** background-session worktrees (teams-17), `--worktree` and isolation worktrees (gap3-4), Remote Control spawned worktrees (gap3-15), cloud fresh clones (gap3-14).
- **Banners:** `STATE HOME UNRESOLVED`, `TEST PROFILE FROM MAIN CHECKOUT`, `GRAPH FROM MAIN CHECKOUT`. `CORPUS EPHEMERAL` only if cloud detection is verified.

### Impact

**Code**

- `lib/state-home.mjs` (new).
- `lib/run-log.mjs`, `lib/outcomes.mjs`, `lib/metrics.mjs`, `lib/resume-card.mjs` — resolve corpus paths through the state home.
- `lib/run.mjs` — `runStart`, the surface fields. `newManifest` and `readManifest` stay cwd-relative.
- `lib/ship-stage.mjs` — unchanged. `stagePath` stays cwd-relative.
- `lib/report.mjs` — surface partition.
- `lib/doctor.mjs` — a row naming the resolved state home.
- `lib/graph/` and the test-profile loader — read-through.

**Tests**

- New `test/spine/state-home.test.mjs` — linked-worktree fixture, lane-worktree exclusion, git failure, explicit `--root`.
- `test/spine/root-isolation.test.mjs` — guards the state home too. Otherwise a test run inside a worktree writes into the developer's main checkout.
- `test/spine/run-log.test.mjs`, `test/spine/outcomes.test.mjs`, `test/spine/metrics.test.mjs`, `test/spine/resume-card.test.mjs`, `test/spine/report.test.mjs`, `test/spine/doctor.test.mjs`.

**Docs**

- `docs/11-the-indicators.md` — where corpora live and how the report partitions them.
- `docs/07-cli-and-configuration.md` — `--root` and the state home.
- `CHANGELOG.md`.

### Out of scope

- The background ship launcher, `interlock board`, the Remote Control recipe and the cloud-routine idea. All wait on this change.
- Writing a `.worktreeinclude`. `.worktreeinclude` is unverified (B-worktrees-1). Doctor may suggest one for `.claude/testing/` and `.claude/graph/` once it is confirmed. It never suggests the corpora, which must not fork.
- Migrating corpora already stranded in old worktrees. See decision 5.

### Decisions the design has to settle

1. **The exact path list** that moves to the state home, and the list that stays in cwd.
2. **Lane exclusion.** A path prefix check on `LANE_WORKTREES_DIR`, or a marker file Interlock writes into each lane.
3. **The background-session move.** A background session may start in the main checkout and move before its first edit (B-worktrees-1, unverified). Then `run start` and a later `run` call could run from two cwds. They must either agree on one manifest or halt naming both paths. A two-cwd fixture pins the choice.
4. **Cloud detection.** `CLAUDE_CODE_REMOTE` is unverified (B-cloud-env-1). Confirm it before a `cloud` surface or `CORPUS EPHEMERAL` ships.
5. **Stranded runs.** The report could scan `git worktree list` and banner `<n> runs recorded in linked worktrees not read`. That speaks the degradation for runs made before this change.
6. **Concurrent appends.** Several worktrees appending to one `outcomes.jsonl` rely on single-line `O_APPEND` writes and the existing torn-line tolerance. A test exercises it.

### Task outline

1. Probe on 2.1.288: where a `claude --bg "/interlock:ship <change>"` session's Bash writes land before and after its move into a worktree.
2. Failing tests: in a linked-worktree fixture, the trajectory lands in the main checkout. Root isolation guards the state home.
3. `lib/state-home.mjs`, and the corpus writers and readers wired through it.
4. Input read-through and its banners. The doctor row.
5. Surface on run-start and the receipt. The report partition.
6. Docs, `CHANGELOG.md`, `npm test`.

### Acceptance

- In a linked-worktree fixture, a run's trajectory, outcome record, metrics and resume card land under the main checkout's `.claude/`. `run.json` and `stage.json` stay in the worktree.
- `interlock report` run in the main checkout counts that run and names its surface.
- A cwd under Interlock's lane worktree directory is not treated as a session worktree.
- A git failure falls back to cwd and banners `STATE HOME UNRESOLVED`.
- An explicit `--root` disables resolution.
- A failed trajectory append in the state home exits 1. A failed outcome write only banners.
- Tests: `test/spine/state-home.test.mjs`, `test/spine/root-isolation.test.mjs`, `test/spine/run-log.test.mjs`, `test/spine/outcomes.test.mjs`, `test/spine/metrics.test.mjs`, `test/spine/report.test.mjs`.

---

## New app ideas (not briefs yet)

None of the six briefs is an app. These are the judge's "later" app ideas. Each needs its prerequisite before it is worth a change.

**Ship a queue of ready changes in one run.** The user is a developer whose `/interlock:spec --continue` left several changes that pass `interlock ready`. The moment is the end of a spec session, just before stepping away. A new plugin workflow, `/interlock:ship-queue`, would call `workflow('interlock:ship', …)` once per change. `workflow()` runs a plugin workflow inline and shares the parent's concurrency cap, agent counter, abort signal and budget, nesting one level (gap1-11, local `workflow-authoring` skill 2.1.288). A literal `meta` keeps the command in autocomplete (orchestration-8, https://code.claude.com/docs/en/workflows). A pure `lib/queue.mjs` would order changes, admit only ready ones, stop at the first halt, and defer a change whose projected agents exceed what remains of the runtime's per-run cap (orchestration-2), less a reserve key in `lib/limits.mjs` printed by `interlock limits`. Prerequisites: `workflow()` reaching the public workflows docs, which today omit it (orchestration-1). Brief 3 recognising the queue as one launch. An idempotent `queue record` keyed by run id, because a relaunch replays later children (orchestration-4). A shared budget throws inside the next child's `agent()` (gap1-10), and that has to surface as a queue halt. It also stacks several unattended commits, which raises the cost of a wrong idea.

**`interlock board`: every ship in flight on one screen.** The user is a developer with several ships running across worktrees and background sessions. The moment is "which one is stuck?". `interlock board` would join `git worktree list --porcelain`, each worktree's newest trajectory tail and stage marker, and `claude agents --json --all --cwd <worktree>`. That command is the supported state interface, with `working`, `blocked`, `done`, `failed` and `stopped` (teams-18, https://code.claude.com/docs/en/agent-view), and the local 2.1.288 help lists `--all` and `--cwd`. A `blocked` ship shows as waiting on you. It is a pure reader that never exits non-zero, with a refresh interval in `REPORT_CAPS` printed by `interlock limits`. It never parses `~/.claude/jobs`. The Notification hook is no substitute, because it fires only while agent view is open (teams-19). Prerequisites: Brief 6, and a background launcher that makes several in-flight ships a real pattern. Today a single `/interlock:ship` occupies the session, so the need is mostly hypothetical.

**Checkpoint page.** The user is the spec author at Interlock's one required human stop, and on Team or Enterprise plans a teammate who should read it too. The moment is `/interlock:spec` stopping at the checkpoint after `interlock notify checkpoint` has pushed to the phone. A stdlib renderer, `lib/checkpoint-html.mjs`, built like `lib/report-html.mjs`, would assemble one page from CLI output only: `interlock validate`, `ledger --json`, `conformance --json`, `risk --json`, the adjudicated artifact-review findings and `drift --json`. The spec skill would publish it as a private Artifact and republish to the same URL after a re-spec (B-artifacts-1, -2, -3, unverified, https://code.claude.com/docs/en/artifacts). Answers return as a pasted block. The page has no approve control, and ledger edits still pass `interlock ledger`. An unpublished page banners `CHECKPOINT PAGE NOT PUBLISHED: <reason>`. Prerequisites: confirm the Artifact tool is offered inside a skill invocation and over Remote Control. Settle one guarded publish convention, shared with the halt page.

**Halt triage page.** The user is the operator who gets the `SHIP HALTED` push away from the desk, or the teammate who picks the run up. The moment is `run close --halt` writing the resume card to a gitignored local file the phone cannot reach. A pure `renderResumeCardHtml` beside `formatResumeCard` would add a leftover-task sorter. Each leftover id shows the run's recorded evidence, starts as unknown, and exports `interlock tasks tick <change> --ids <only those marked done>`. It exports nothing while every id is unknown, which makes the card's "never tick everything" rule interactive. The ship trampoline would publish it as an Artifact (B-artifacts-1, -3, unverified) or banner `RESUME CARD NOT PUBLISHED`. The card, not a runtime relaunch, stays the human path, because a relaunch replays completed siblings (orchestration-4, https://code.claude.com/docs/en/workflows). Prerequisites: the same Artifact checks and publish convention as the checkpoint page. The ArtifactData shared database is described only by this session's tool, not in public docs, and stays out of scope.

**Away-from-desk ship over Remote Control.** The user is a solo developer with an always-on workstation. The moment is reading the checkpoint on a phone and wanting the run started now. The recipe is `claude remote-control --spawn worktree` on the workstation (gap3-15, https://code.claude.com/docs/en/remote-control, medium), then `/interlock:ship <change>` from the Claude app. Remote Control mirrors workflow progress and can push open permission prompts to the phone (B-remote-control-1, unverified). `interlock doctor` would gain a row that reports ok when `CLAUDE_CODE_BRIDGE_SESSION_ID` is set (B-env-1, unverified) and skip otherwise, never fail. When that row skips, no ntfy topic is set and the permissions row is not ok, doctor says a mid-run prompt will wait for someone at this terminal. Prerequisites: Brief 6, because spawned sessions are linked worktrees. Confirm that `/interlock:ship` is accepted from the mobile client and that `worktree.baseRef` governs `--spawn worktree`. gap3-4 does not list it.

**ship-meter, a mod that shows the run live.** The user is an operator watching a run. The moment is mid-run, when every banner is still held back until close. Mods (2.1.287) run in every session that loads the plugin, and draw panes only in the terminal and the Desktop Code tab (gap2-8, https://code.claude.com/docs/en/plugins/mods/overview). A mod could observe each model request's usage and the model that answered per agent, and show wave progress, routed against served models, and banners so far. Its FORCE probe is already absorbed into Brief 2. Prerequisites: Brief 4's probe must fail first, because the meter is the fallback route to the same measurements. The mods API is days old. An older host that rejects the `modules` key could stop the plugin loading for every user, which would be a fail-closed install. It would also bring a `.test.ts` file into an `.mjs`-only repository.

**Checkpoint = merge: a cloud Routine ships a change when its spec PR merges.** The user is a team that reviews specs as pull requests. The moment is a reviewer merging a labelled spec PR. A merged, approved PR is a stronger and auditable checkpoint than a private read. A routine with a GitHub trigger (B-routines-1, unverified, https://code.claude.com/docs/en/routines) would run `/interlock:ship <change>` once and open a PR whose body is a new `interlock run receipt --markdown`. Routines have hourly limits with no overage (headless-18), and API fires are for claude.ai users only (headless-17). Cloud sessions start from a fresh clone (gap3-14, https://code.claude.com/docs/en/cloud-environments), and usage limits fail agents rather than pause them there (orchestration-7). Prerequisite, load-bearing and low-evidence: prove with a real routine that the Interlock plugin loads in a routine's cloud session. cloud-environments says repository `enabledPlugins` are not installed (gap3-14). It also waits on Brief 6.

## Later and dropped, and why

**Later**

- guard-commit enforces the commit briefing's three nevers: no technical blocker. It waits only on the six-brief cap. Fold it into Brief 3 if there is room, otherwise land it right after.
- The run picks the worker prompt-cache lifetime: waits on Brief 4 for default-host cache figures. It also needs a probe that frontmatter `experimental.cacheTtl` (headless-15) applies to Workflow agents, and the measure-before-retuning rule.
- CLI-owned spend ceilings (per-lane `--max-budget-usd`, headless-10): waits on Brief 5's subtype classification and a probe of the budget-stop envelope. The Workflow host stays unsupported, because the user sets `budget.total` (gap1-10).
- Every skill gets a routing case, and the always-on context cost is recorded: real but indirect. It needs a captured `claude plugin details` fixture and a decision on metered-suite budget (orchestration-20).
- A lane as a resumable session: waits on Brief 5 for lane session ids. It also needs a probe that `-p --resume --fork-session` with a new `--json-schema` returns structured output, and a sweep arm that shows it pays.
- Ship in the background on its own worktree branch: waits on Brief 6, or every background run loses its corpora. It needs a probe that `baseRef` passed via `--settings` governs `--bg` worktrees. Usage limits fail rather than pause in background sessions (orchestration-7).
- OpenTelemetry correlation keys (`workflow.run_id`, `agent_id`; gap3-6, gap1-9): waits on Brief 3's Workflow payload capture for the run id. Spans are beta, and the audience is narrow.
- Ultrareview as an external witness for Interlock's own review (headless-19, headless-20): waits on a captured real `bugs.json` fixture, because the schema is undocumented.
- The seven app ideas above, each waiting on its stated prerequisite.

**Dropped**

- Review room, agent-team reviewers the author can question: invites the author to talk a reviewer out of a correct blocker. It rests on an experimental API with no resume (teams-7).
- An experimental team host with persistent lane-slot teammates: reintroduces a model following skill prose as the loop interpreter, which `workflows/ship.js` replaced. It has no worktree isolation (teams-8), no resume (teams-7), and a lead context that compacts mid-run.
- Morning ship-health as a Desktop scheduled task: low marginal value. Doctor already runs at every SessionStart. Desktop tasks are unverified, and CronCreate and `/loop` are session-scoped (gap2-10).
- Ship from a Slack thread with Claude Tag: low evidence on every load-bearing point, Team/Enterprise only, and stacked on the unproven cloud-routine idea.

**Rejected mechanisms, so nobody re-proposes them**

- A WorktreeCreate hook: a non-zero exit fails worktree creation machine-wide (orchestration-14).
- A PreModelSwitch guard: a timeout blocks the switch (orchestration-13).
- SubagentStop or TaskCompleted exit-2 "gates": exit 2 keeps the agent running (gap1-2).
- `/goal` as a verify gate: a small model judges from the transcript alone (gap1-12, https://code.claude.com/docs/en/goal).
- Prompt or agent hook handlers for any gate (orchestration-11).
- `--restricted` reviewer lanes: plugin hooks would not apply (headless-6).
- `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` (gap3-3): it needs a replacement system prompt, which drops the default prompt and `--exclude-dynamic-system-prompt-sections` with it.
- An Agent SDK host: a runtime dependency. A Managed Agents host: one shared filesystem and no per-lane isolation (gap2-14).
- Agent tool `isolation: "remote"`: not found in sub-agents, tools-reference or the CHANGELOG.
- Managed Agents Outcomes (killed claim gap2-15), and per-lane joins on `api_request` events (killed claim gap1-8: `agent_id` is only on beta spans).

## What the critic flagged

**Contradictions**

- orchestration-1 originally said the docs mention no `workflow()` nesting call. Its own correction and gap1-11 say "`workflow(nameOrRef, args)` exists, nests one level, and adds a `budget` global". The public `workflows.md` still omits `workflow()` and `budget`. That part is local-skill-only.
- headless-11's 200-spawn per-session cap "conflicts with gap2-3 and its own correction: v2.1.224 removed that cap and the env var is a no-op". Its note ("could hit 200") is stale.
- gap2-12 originally said "cross-session" cache reuse. The local 2.1.288 help says "Improves cross-user prompt-cache reuse". The cache ideas' claim that lanes in different worktrees share a prefix "extrapolates beyond both". The later cache-lifetime idea must treat it as a hypothesis to measure.
- gap3-2 says bare mode leaves system-prompt recording off unless `--system-prompt-snapshot on` is passed. The local help says "on (the default)" and adds "No effect where system-prompt recording is not yet enabled". Re-check bare-mode behaviour.
- headless-3's note and the runner idea assume `--plugin-dir` under `--bare` keeps the plugin's hooks. The local help says `--bare` skips "hooks (those defined in settings and by installed plugins …)". This is not established, which is why Brief 5 pins `--plugin-dir` and does not claim hooks survive bare.
- orchestration-2 states a default slot count. gap2-2 adds "fewer on machines with fewer CPUs". A constant in `lib/limits.mjs` "would overstate the slots on small machines unless the observed value is printed beside it". Brief 2 prints it beside.
- headless-19 says `claude ultrareview` blocks until the review finishes. The local subcommand help adds `--timeout <minutes>`. A witness must treat a timeout as unparseable, not as "no findings".
- The background-ship idea assumes `worktree.baseRef` applies to `claude --bg` worktrees. gap3-4 lists only `--worktree`, EnterWorktree and agent isolation.
- "Existing code disagrees with how the ideas frame the problem." `readClaudeEnvelope` already returns `result: null` when `structured_output` is missing, and records a failed spawn. "The remaining gap is naming the cause (#82258) and surfacing denials, not a silent success." Brief 5 is written that way.
- Duplicate ideas disagreed on design and vocabulary: spend caps (`budgetCap` versus `spendCap`), cache lifetime (`worker-1h` versus `worker-long`), runner banners, recorder file names, and null-result wording. These briefs pick one each: `SCHEMA RESULT MISSING`, `TOOLS DENIED IN LANE`, `MODEL SUBSTITUTED`, `AGENT RETURNED NO RESULT`.
- Ideas referred to each other by batch-local numbers that did not match. These briefs use titles instead. The `error_max_budget_usd` subtype has no claim.
- teams-5's note that "workflows/ship.js named implementer spawns could silently become teammates" contradicts its own correction, "because ship.js passes `label`, not `name`".

**Weak claims the ideas leaned on**

- Every idea citing a B-* id (state home, checkpoint page, halt page, morning ship-health, Remote Control, checkpoint-merge routine, Claude Tag, board) rests partly on facts the verifiers never voted on. Brief 6 keeps nothing load-bearing on them, and marks cloud detection and `.worktreeinclude` unverified.
- The EnterWorktree statement that a pinned agent "only accepts targets under `.claude/worktrees/`" "has no claim id and is slightly wrong". Outside that directory it asks for approval, which inside a Workflow run "stalls or fails the lane". Brief 1 defers EnterWorktree for this reason.
- The recorder idea "rests on `agent_transcript_path` content carrying per-turn usage with ephemeral_5m/1h splits for Workflow agents, and no claim establishes that". It is Brief 4's first probe.
- The relaunch guard's Workflow `tool_input` field names, the run id in `tool_response`, and UserPromptExpansion semantics are unverified. orchestration-12 confirms only that the event names exist. It is Brief 3's first task.
- The "1.5s plugin SessionEnd budget" and the StopFailure error-type list have no claim. Brief 2 does not depend on either.
- PermissionDenied being auto-mode only, and the `autoMode.classifyAllShell` rule, are not in the verified claims.
- The ship-meter idea's mods API details are "summarized only loosely in gap2-8's interlock_note, which is not the claim itself".
- The routing-case idea's `tool_used: Skill` grader and the `claude plugin details` output fields have no claim. orchestration-20 covers only `plugin eval` exit codes.
- The Workflow `budget` global and `workflow()` rest on the bundled skill only (gap1-10, gap1-11).

**Features no claim or idea covered (leads, unverified)**

- `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS` and `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`: behind a gateway, a user setting either "may quietly lose the schemaEnforced capability that both drivers rely on". Brief 2's decision 5 holds this.
- `--safe-mode` / `CLAUDE_CODE_SAFE_MODE` (critic: 2.1.169): plugins, hooks, skills and workflows are absent. `/interlock:ship` does not exist and every guard is gone. The flag itself is in the local 2.1.288 help. A lane or session that inherits the env var would run with no guards.
- `--setting-sources`: "the only documented lever for bin/interlock-run lanes to shut out user-settings env such as CLAUDE_CODE_SUBAGENT_MODEL_FORCE or worktree.baseRef".
- Plugin `userConfig` (critic: 2.1.83, `claude plugin configure`): a supported channel for plugin options such as an ntfy topic or opt-ins, which the "plugin settings ship only two keys" claims do not cover.
- Channels (research preview): an MCP server that pushes CI results into a running session, the documented alternative to polling.
- The PushNotification tool as a fallback when `INTERLOCK_NTFY_TOPIC` is unset.
- Agent persistent `memory` frontmatter (orchestration-15 says it applies to plugin subagents). `agents/worker.md` should take an explicit position, because worker memory would make lanes and evals non-reproducible.
- PreCompact and PostCompact hooks, `--autocompact`, and the 2.1.286 fallback notice for a 1M-to-200K context drop. Long ship drivers and long lanes are where compaction bites.
- The ConfigChange hook, to record a settings change during a run.
- Self-hosted environments (`--environment ccpool_…`): a runner image could preinstall the plugin and the CLI, which answers gap3-14.
- Background session lifecycle (`claude respawn`, `claude rm`, `claude stop`, `attach`) and `claude purge`, which deletes the transcripts a resume line would point at.
- Workflow resume by run id, `/workflows`, FleetView and `meta.phases`. Nothing says whether a halted ship should be relaunched by run id or started cold.
- `claude auto-mode config`, which prints the effective auto-mode config as JSON, instead of hand-parsing settings files.
- `claude plugin tag`, which checks that `plugin.json` and the marketplace entry agree, given recent hand-made version bump commits.
- `claude gateway`, where the per-agent request headers (gap1-9) could be read.

**The critic's advice these briefs followed**

- Merge the duplicates and pick one vocabulary.
- Rank by evidence and dependency cost, with teams and mods last.
- Present agent teams only as an experimental, interactive-only research preview.
- Keep vendor numbers out of policy prose.
- Name the fail-open rejections.
- Keep the previous brief's three changes out.
- Frame cache TTL, `omitClaudeMd` and `--exclude-dynamic-system-prompt-sections` as future arms of the existing cost-per-task sweep, with cross-worktree cache sharing stated as a hypothesis.

## Provenance

Produced on 2026-10-03 by a 21-agent Workflow run with a hard cap of three agents in flight per round, all on Opus: three search-and-extract chains, three verifier lenses over every claim, three gap-fill agents and a second verifier round, three ideators, a judge and a completeness critic in parallel, and one writer. 105 claims were extracted, 95 kept, 2 killed, 8 folded as duplicates. 30 ideas were proposed and 6 selected. The lead spot-checked the result against the repository (`lib/run.mjs` merge-base capture and fold, `workflows/ship.js` model probe, `lib/host/claude-cli.mjs` envelope reader, the ship skill pin, `.gitignore`) and against direct reads of the agent-teams and worktrees pages.
