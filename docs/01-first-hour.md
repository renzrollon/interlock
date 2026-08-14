# Your first hour with Interlock

This page takes you from install to one committed change. Onboard the repo once, then spec, read, and ship.

## Before you start

| Requirement | Why |
|---|---|
| [Claude Code](https://claude.com/claude-code) **v2.1.154+** | Interlock is a Claude Code plugin. Cursor and Copilot are not supported in 0.x. |
| Dynamic workflows **enabled** | `/interlock:ship` is a skill trampoline that launches a [dynamic workflow](https://code.claude.com/docs/en/workflows). Turned off via `disableWorkflows`, org policy, or `CLAUDE_CODE_DISABLE_WORKFLOWS` — and on a Pro plan until you enable it in `/config` — the command exists but the run cannot start. |
| The [`openspec`](https://github.com/Fission-AI/OpenSpec) CLI | Interlock drives it; it owns the artifact formats. |
| Node.js ≥ 18 | Runs the bundled `interlock` and `interlock-graph` CLIs. |
| A git repo with code in it | `bootstrap` documents what already exists. |

## Install

```bash
/plugin marketplace add renzrollon/interlock
/plugin install interlock@interlock
```

## Allowlist the commands first

Worth two minutes before your first `ship`. Workflow agents inherit your own permission settings, so a command that is not allowlisted stops the run on an approval prompt — in the middle of a run that is supposed to need nothing from you, possibly while you are away from the keyboard.

Allowlist `interlock`, `interlock-graph`, `openspec`, `git`, and your test runner. `/permissions` is the quickest route.

## Step 1 — Onboard the repo (once)

```bash
/interlock:bootstrap
```

This reads your codebase and writes down what it already is. It initializes OpenSpec if the repo has never been initialized, explores in parallel, then writes:

- `openspec/initial-architecture.md` — stack, layout, data model, patterns, inferred design decisions
- `openspec/specs/<feature>/spec.md` — one spec per discovered feature, describing behavior that exists today

It will ask you to confirm the feature list before generating specs, and it never overwrites an existing spec file. On a small repo, `--quick` runs it sequentially in one context:

```bash
/interlock:bootstrap --quick
/interlock:bootstrap --scope packages/api    # restrict to a subdirectory
```

Bootstrap never modifies source code. When it finishes it may suggest `/interlock:docs-digest` — skip that for now.

## Step 2 — Spec one small change

Pick something genuinely small for the first loop: one endpoint, one flag, one bug with a known repro.

```bash
/interlock:spec add a --json flag to the report command
```

It explores first (unless you pass `--no-explore`), then drives the `openspec` CLI to produce the artifacts, then runs an artifact review over them. It writes:

```
openspec/changes/<change-name>/
├── proposal.md      what and why
├── design.md        how, and the decisions taken
├── tasks.md         ordered checkbox tasks
└── specs/**         delta specs — the behavior change, in Given/When/Then
```

Then it stops. It has written specs and no code. If you asked for a bug fix, it will refuse to create anything until you give it real error output and a reproduction — that gate is deliberate.

## Step 3 — Read the spec

This is the checkpoint, and it is the whole point of the tool. A wrong idea costs a paragraph here and a day after shipping.

Budget ten minutes. [**02 — The checkpoint**](./02-the-checkpoint.md) tells you what to look for in each file and what to do when something looks wrong.

Do not skip it. There is an advanced flag that skips it for you, and it is listed below with the other things that are not part of hour one — the read is what tells you whether to trust the rest of the loop, and you cannot decide to skip it before you have done it once.

## Step 4 — Ship it

When the spec looks right:

```bash
/interlock:ship
```

This runs start-to-commit without asking you anything. It is a workflow rather than a skill, and the workflow runtime accepts no mid-run user input at all — the zero-touch contract is a property of the runtime, not a promise in a prompt, so it cannot stall waiting for you. It implements `tasks.md` in dependency-ordered waves with parallel subagents, reviews the diff, remediates findings, runs the unit suite, writes handoff artifacts, and makes one commit.

Useful flags for a first run:

```bash
/interlock:ship --apply-only     # stop after the waves, before review
/interlock:ship --no-commit      # run everything, leave the commit to you
/interlock:ship --skip-e2e       # don't run e2e even if it's configured
```

If it halts, it tells you what completed and what it needs from you. [**04 — When it stops**](./04-when-it-stops.md) decodes each case.

## Step 5 — Open the MR (optional)

```bash
/interlock:mr --create
```

Detects GitLab or GitHub from the remote, writes a summary from the change artifacts and the diff, and creates or updates the merge request.

## Step 6 — Archive the change once it merges

Closing the loop is stock OpenSpec. Interlock does not wrap it:

```bash
openspec archive <change-name>
```

This moves the completed change out of `openspec/changes/` and folds its delta specs into the living specs under `openspec/specs/`, so the next `/interlock:spec` plans against what is now true. Add `-y` to skip the confirmation prompt, or `--skip-specs` for a tooling- or docs-only change that has no behavior deltas to fold in.

## Do not run these yet

Everything below is real and supported, but none of it is part of hour one. Each one adds concepts you do not need to complete a loop, and several are only meant to be called by the commands above.

| Skill | Why it can wait |
|---|---|
| `/interlock:dispatch` | Routing help for when you have enough skills to be unsure. You have a loop, not a menu. |
| `/interlock:graph` | Code knowledge graph. `bootstrap` already builds it for you. |
| `/interlock:docs-digest` | Agent-only prose primer. Pure optimization. |
| `/interlock:explore` | Standalone reconnaissance. `spec` runs it when it needs it. |
| `/interlock:review-artifacts` | The gate `spec` already runs at the end of its own flow. |
| `/interlock:review-code` | The gate `ship` already runs on the diff. |
| `/interlock:fix-tests` | For a red suite. Come back when you have one. |
| `/interlock:manual-test-plan` | `ship` emits this when the diff touches UI. |
| `/interlock:explain-code` | `ship` writes the commit teach-in itself. |
| `/interlock:commit` | `ship` calls it. Calling it directly is for recovery. |
| `/interlock:spec --continue` | The opt-out from Step 3. Skipping the read before you have done it once is skipping the part of the loop that earns the rest. [**05 — Continuity**](./05-continuity.md) when you are ready. |

Autonomy levels, the wave planner and the graph query surface are all deeper machinery. You can ship for weeks without touching them.

## Next

[**02 — The checkpoint**](./02-the-checkpoint.md) — how to review a spec in ten minutes.
