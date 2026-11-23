# Design

## Context

See `proposal.md` for the motivation. This section holds only what shapes the approach.

**Four read-only spawns have no type today.**

| Site | Where | How it answers today |
|------|-------|----------------------|
| Dimension reviewer, first pass and proof re-run | `skills/review-code/SKILL.md:68-74, 164-170` | Returns findings in its reply; the session writes the files |
| Skeptic | `skills/review-code/SKILL.md:125-135` | Returns verdicts in its reply |
| Settle conformance worker | `skills/settle/SKILL.md:412-414` | Writes `.claude/ship/settle/handoff.json` itself (`lib/settle-cli.mjs:1080`) |
| Strict artifact reviewer | `skills/review-artifacts/SKILL.md:50-61` | Returns findings in its reply; the session writes the file |

Two skills say the limit in their own words: "A skill's `allowed-tools` do not reach an agent it spawns" (`skills/review-code/SKILL.md:74`, `skills/review-artifacts/SKILL.md:61`). The bound is the prompt's write-nothing line (`lib/prompts/review-dimension.mjs:114`, `lib/prompts/review-skeptics.mjs:56`). The conformance briefing carries no bound at all.

**The precedent.** `agents/settle-fixer.md` bounds the fix round by its `tools` list, is spelled in the skill (`skills/settle/SKILL.md:245`), is required by `interlock doctor` (`lib/doctor.mjs:545-552`) and is pinned by `test/spine/plugin-agents.test.mjs`.

**The host probe, run 2026-11-19.** A scratch plugin with two agents was loaded with `--plugin-dir` into a headless session through `scripts/host-probe.mjs`, with `Agent`, `Write`, `Edit`, `Read`, `Bash` and `Skill` all allowed at the session level, so the agent's own list was the only thing that could remove a tool.

| Probe | Host | Result |
|-------|------|--------|
| `reader`: `tools: Read, Grep, Glob, Bash`, `disallowedTools: Write, Edit, Skill, Agent, mcp__*` | 2.1.318 and 2.1.310 | The agent listed `Read, Bash` and the host's own hand-back tool. It answered `NO WRITE TOOL`, `NO AGENT TOOL`, `NO SKILL TOOL`, and the file it was asked to create does not exist |
| `writer` (control): `tools: Read, Write`, no `disallowedTools` | 2.1.318 | The agent listed `Read, Write`, created its file, and still had no `Agent` and no `Skill` tool |
| A call naming `probeplug:missing` | 2.1.318 | The tool result is an error: `Agent type 'probeplug:missing' not found. Available agents: …`. Nothing was spawned |

Three facts follow. The allowlist is enforced, and it alone removes `Agent` and `Skill`. A missing type fails loudly and does not fall back to the default type. These hosts have no `Grep` or `Glob` tool, so a name the host lacks is dropped without an error and `Bash` is the reviewer's only way to search.

**The fixer's typed spawn works in practice.** Five session transcripts hold six `interlock:settle-fixer` spawns made by the settle skill, and none was refused (counted 2026-11-19).

## Goals / Non-Goals

**Goals:**

- One plugin agent type for every read-only spawn of the review loop, with a tool list the host enforces.
- No reader holds a tool that edits a file, spawns an agent, invokes a skill or reaches an MCP server.
- Each site says aloud what it does when the type cannot be spawned, and never substitutes another type.

**Non-Goals:**

- Review consistency between rounds. The levers for that are the per-area `REVIEW.md`, an eval set built from real misses, and the open briefs `judge-overlapping-findings-once` and `put-a-failure-scenario-on-every-finding`.
- The ship workflow's review step (D4).
- Explore's and bootstrap's investigators, which already run as the host's read-only `Explore` type (D19).
- Stopping every write. `Bash` stays, and a shell can write a file (D2, D5).
- Moving reviewer answers into files, which the open brief `say-the-review-loop-scale-up-front` proposes (D9).
- A new routing role, a hook that keys on agent type, or a capability key in the host registry.

## Decisions

### The type

**D1. One shared type, not one per role.** `interlock:reviewer` serves all four sites. The CLI assembles each brief, so an agent file per dimension would be a second copy of the rubrics. The fixer and the worker already share one tool list.

**D2. `Bash` stays.** A strict skeptic runs a claim before voting, and every dimension prompt allows read-only commands. The probe adds a harder reason: on current hosts there is no `Grep` or `Glob` tool, so without `Bash` a reviewer could only open files it already knows the path of.

**D7. The list is `Read, Grep, Glob, Bash`.** It is the worker's list with `Write` and `Edit` taken out, and the pin test derives it that way so the two stay in step. `Grep` and `Glob` are kept for hosts that have them; the probe showed a name the host lacks is dropped silently. `disallowedTools` repeats `Write` and `Edit` beside `Skill`, `Agent` and `mcp__*`, so a later edit that adds one to `tools` has a second line to get past.

**D3. No model, no effort.** `SPAWN_ROUTING` owns both, and an `effort` on an agent definition would outrank the level a spawn is given.

**D12. The description reserves the type, and says when a spawn is sanctioned.** Without the never-invoke line the session's model could pick a type described as a code reviewer for any review task. With it alone, a model may decline the skill's own spawn; the fixer gained its sanctioned-use sentence for that reason (commit `fef94d9`), and its spawns have not been refused since.

The file, in full:

```markdown
---
name: reviewer
description: Read-only reader for the Interlock review loop — a dimension reviewer, a skeptic, the settle confirmation or the strict artifact reviewer. Reads the code, runs read-only commands and replies in the shape its prompt gives. Never invoke from a user conversation — only /interlock:review-code, /interlock:settle and /interlock:review-artifacts spawn this type. When one of those skills names this type, that skill is the spawner and the spawn is the sanctioned use.
tools: Read, Grep, Glob, Bash
disallowedTools: Write, Edit, Skill, Agent, mcp__*
---

You are an Interlock reviewer. Follow the user prompt. Use only the tools you were given. Read, search and run read-only commands. Create, change or delete no file yourself, through the shell either. Do not invoke skills. Do not spawn other agents. Reply in the shape the prompt gives, and then stop.
```

The description is one line and holds no colon followed by a space. A colon-space inside an unquoted YAML value ends the value early, and the repository's own frontmatter reader would not notice.

### The spawn sites

**D11. The type's name is spelled in the skills, not published by the CLI.** This follows the fixer. Each spawn paragraph is pinned by token. One new suite test resolves every backticked `interlock:<name>` a skill spells against `agents/<name>.md` or `skills/<name>/SKILL.md`, so a renamed file or a misspelt type fails the suite instead of failing a review. Both kinds of name are accepted because skills spell both in backticks: `skills/dispatch/SKILL.md:46` names the skill `interlock:ship`.

Each site gains the same three statements, in its own paragraph:

1. The agent is spawned as `interlock:reviewer`.
2. The plugin's definition of that type bounds its tools: it holds no tool that edits a file, spawns an agent or invokes a skill.
3. Routing chooses the model and the effort, never the type. After `ROUTING UNAVAILABLE` the call still names the type.

`skills/review-code/SKILL.md` names the type in three places: the dimension spawn (`:74`), the skeptic spawn (`:131`) and the re-run paragraph (`:170`). The sentence "A skill's `allowed-tools` do not reach an agent it spawns" stays, because it is still true and `test/skills.test.mjs:2912` reads it; what follows it changes from "the printed prompt's write-nothing line is the bound" to say that the shell can still write, so that line stays as the second bound.

`skills/review-artifacts/SKILL.md:61` stops saying the call names no `subagent_type`. It says the call names `interlock:reviewer` as its `subagent_type`, and that the prompt's writes-no-file line is the second bound.

**D5. The write-nothing prompt lines do not change.** `lib/prompts/review-dimension.mjs` and `lib/prompts/review-skeptics.mjs` are also read on the ship path, where the reviewer is a worker that does hold the edit tools. On the skill path the line covers the one thing the type cannot: a write through the shell.

**D17. The living reason for that line is corrected.** `openspec/specs/review/review-briefs/spec.md:61` says the prompt is the bound. The delta rewrites that clause and leaves the prompt text alone.

### The conformance worker

**D8. The worker replies; the session writes the handoff.** Explore's brief did not notice that this worker writes its own answer file. A type with no `Write` tool cannot do that. Three ways out were weighed:

| Option | Verdict |
|--------|---------|
| The worker replies with the JSON object and the session writes `handoff.json` as returned | Chosen. It is what the strict artifact reviewer already does (`skills/review-artifacts/SKILL.md:61`), the reply is small (four counts, one short paragraph, a sha), and all four readers then work the same way: a prompt in, a reply out, the session records |
| Give the type `Write` | Rejected. `Write` can replace any file in the tree, so "cannot edit" would be false for every reviewer and skeptic to serve one spawn |
| Let the worker write the file through the shell | Rejected. It makes a type described as read-only write by design, and a shell redirect is the kind of command a session is asked to approve where a tool write is not |

The briefing's last paragraph changes. Today (`lib/settle-cli.mjs:1080`): `When you are done, write JSON to <resultPath> in exactly this shape and then stop:`. After: `You write no file. When you are done, reply with one JSON object in exactly this shape, and nothing else:`. The shape line and the `head` line under it stay as they are. The first line of the briefing does not change, so the settle meter still files the spawn under `conformance` (`lib/settle-meter.mjs:1176, 1204`).

**D15. `--result` stays.** It now names the file the caller writes the reply to. `--json` still reports it as `resultPath`; the briefing text no longer holds it. No flag is removed and `lib/cli-flags.mjs:59` does not change.

The skill writes the object with the Write tool, which `skills/settle/SKILL.md` already grants. It repairs no value. A reply with no such object prints `CONFORMANCE UNREAD: <first line of the reply>` and writes no handoff; the skill already passes `--handoff` only when the file was written (`skills/settle/SKILL.md:503`), and the verdict reads a missing handoff as unobserved (`openspec/specs/review/merge-confidence/spec.md:332`). A reply naming another head is written as it came: `boundToHead` in the verdict command is what refuses it (`cli/interlock:3562-3565`).

**D9. This change does not decide whether reviewer answers move into files.** The open brief `say-the-review-loop-scale-up-front` recommends that dimension and skeptic answers travel as files, to keep some fifty 5–15 KB replies out of the session. That would need a write path this type does not have. That change decides it with the owner: add `Write` to this list knowingly, or keep replies and extract them another way. Its nested-spawn remedy, a "spawn no agent" line in three prompts, is replaced by this type for all four readers.

### When the type cannot be spawned

**D10. Never another type; each site has its own line.** The Agent tool answers `Agent type '…' not found` when a session's plugin has no such type. That can only happen when a session reads a newer skill than the plugin it loaded, or on a partial install. A spawn can also be refused or declined.

| Site | Line | What happens next |
|------|------|-------------------|
| review-code, dimension or skeptic | `REVIEW FAILED: reviewer type unavailable — <the tool's message, or the refusal>` | The review stops. It runs no draft, proof or promote line, so nothing is recorded. It names both remedies (D18) |
| settle, any `review-code` pass | (prints the line above) | The loop stops early, by the existing rule of `skills/settle/SKILL.md:149`: nothing more is committed or pushed, and the assessment gets only the records this pass wrote |
| settle, conformance | `CONFORMANCE SKIPPED: reviewer type unavailable — <the tool's message, or the refusal>` | No handoff. The loop goes on to the head verification. The briefing itself says the confirmation never halts anything (`lib/settle-cli.mjs:1078`) |
| review-artifacts, strict | `STRICT REVIEWER UNAVAILABLE: <the tool's message, or the refusal>` | The inline read runs in the session, as it does after `STRICT REVIEW UNREAD` (`skills/review-artifacts/SKILL.md:59`), so the gate still runs a single time |

The review fails, where the confirmation and the artifact gate degrade, because a review has no bounded fallback: the only other way to run it is the unbounded spawn this change removes, and a review that quietly ran that way would look the same in the record as a bounded one. The fixer made the same choice (`openspec/specs/review/settle-loop/spec.md:703-708`).

**D18. The review's failure line names two remedies, not the doctor alone.** A compound note on `lib/doctor.mjs` (N1, 2026-10-23) records that a doctor run by name can check a plugin against itself. That bites here: when a session is older than the skill it reads, the `interlock` on its PATH is the older plugin's, and that doctor does not know the file is required, so it reports nothing. The line therefore says that a session started before the plugin was updated does not have the type and a new session does, and that `interlock doctor` names an install whose `agents/` lacks the file. The first covers skew, the second a partial install.

### What does not change

**D4. The ship path keeps `interlock:worker`.** Its reviewers write one answer file each (`lib/run.mjs:1698, 1848`), and its spawn prefix is a separate, pinned contract.

**D13. No meter and no hook learns the type.** The settle meter reads an agent's role from its prompt's first line and keeps the type only as a label (`lib/settle-meter.mjs:1196-1204, 1266`). The spec meter counts `Explore` spawns only (`hooks/mod.mjs:1137`). The recorder writes for `workflow-subagent` only (`hooks/recorder.mjs:93`). One guard test pins that a spawn typed `interlock:reviewer` is filed by its prompt as before.

**D19. Explore's and bootstrap's investigators are out of scope.** They already name the host's read-only `Explore` type (`skills/explore/SKILL.md:91`, `skills/bootstrap/SKILL.md:82`).

**D6. The host enforces the list, so the type ships as a bound.** Explore left one question for a person: what to do if the probe showed the host does not enforce a plugin agent's tool list. The probe ran and the host does. The question was conditional and its condition did not occur, so nothing in this change branches on it.

### Pins and the inventory

**D14. The frozen directory inventory gains one path.** `test/spine/package.test.mjs:1118-1121` lists every agent and skill that grants a tool beyond `Read`, `Grep`, `Glob` and `LS`, and its comment says updating it is the owner's reading of the change. The reviewer holds `Bash`, so `agents/reviewer.md` joins the list. The directory already refuses the plugin for this code over the eighteen paths listed today, so the count moves and the outcome does not.

**D16. Known pins that move.** They are listed in `tasks.md` with the bounded rule. The list is the known ones, not a complete one:

- `test/skills.test.mjs:2905-2913`: the test that review-artifacts' strict call names no `subagent_type`.
- `test/spine/settle-cli.test.mjs:784, 795-800`: the briefing names the result file; `--result` names the file the worker answers into.
- `test/spine/doctor.test.mjs:231`: the required-files list.
- `test/spine/plugin-agents.test.mjs:58-96`: the three agent files.
- `test/spine/package.test.mjs:1118-1121`: the tool-grant inventory.

## Risks / Trade-offs

- **The shell can still write.** The type removes the edit tools and the ability to spawn, not every write. → The prompt's write-nothing line and the agent's own body both say so, and the proposal does not claim more.
- **A failed spawn now fails the review.** Before this change a review always ran. → It fails only when the type is missing from the session or a spawn is refused; the line names the cause and `interlock doctor` names a missing file. The skill and the agent file ship in one plugin version.
- **A session's model declines to spawn a reserved type.** → The description carries the sanctioned-use sentence; the fixer's record is six spawns, none refused. A refusal prints the site's line and is never worked around.
- **The session transcribes the conformance answer.** A session could alter a count while writing it. → The object is small, the skill says to write it as returned, and the verdict already counts its own denominators and refuses a handoff for another head. The same trust is already placed in the session for every findings and verdicts file.
- **The enforcement is host behaviour, not something `npm test` can see.** → The probe is recorded here with its date and versions. Re-run it when a host release changes how agents are defined; the recipe is the three prompts described under Context.
- **The open file-answers brief now has a constraint.** → Recorded as D9, and in that brief's own risk list ("a file answer weakens the reviewers' write-nothing bound to one path").
- **An older installed plugin.** Sessions on a plugin from before this change keep the old skills and the old behaviour; nothing here reaches them until a release.

## Migration Plan

1. Ship the agent file, the doctor row and the pins first; nothing spawns the type yet.
2. Change the conformance briefing's last paragraph in the CLI.
3. Change the three skills to name the type, with their failure lines.
4. Release. Installed sessions pick the type up at their next start.

**Rollback.** Revert the commit. The skills go back to untyped spawns, the briefing goes back to asking the worker to write its file, and the agent file is gone. No state on disk carries over: `.claude/ship/settle/` is cleared at the start of every pass.

**Not undone by a revert.** Nothing. The change writes no persistent record of its own.

## Open Questions

- Should a later change give the ship path's reviewers a narrower type than `interlock:worker`? It would need the answer-file write to stay, so it is a different list. Not needed for this change.
