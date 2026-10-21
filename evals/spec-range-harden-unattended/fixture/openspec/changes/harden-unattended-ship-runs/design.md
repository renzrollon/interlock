## Context

See proposal.md — Why. The constraints that shape the how, all already in force:

- **Every terminal path converges on one CLI process.** `haltStep()` continues into `['run','close','--halt',reason]` (`lib/run.mjs:504-515`); `runClose()` (`lib/run.mjs:2172-2363`) writes the receipt, outcome and trajectory event and returns `{action, exitCode, banners, summary}`; both drivers print `closed.summary` verbatim (`workflows/ship.js:530-541`, `bin/interlock-run:438-445`) and already assemble host-observed close inputs in a `closeArgs()` function (`workflows/ship.js:503`, `bin/interlock-run:430`).
- **The Workflow driver has no I/O.** `workflows/ship.js:36-38` and `test/workflows.test.mjs:60-67`: no filesystem, no shell, no modules, no `process.cwd`. Anything that touches the network or the disk must run inside an `interlock` child process.
- **`lib/receipt.mjs` is pure and owns every printed line** (zero imports; header `:1-11`). `formatRunSummary({change, summary, flags, leftoverTaskIds, degradations})` is called with none of the new inputs by `test/workflows.test.mjs:2289-2293`, so every new input must default.
- **Banner strings are a verbatim contract** pinned at exactly one party (`test/workflows.test.mjs:111-133`; `docs/06:378`).
- **Zero runtime dependencies; `fetch` is global on Node ≥ 18** (`package.json` engines). The house pattern for outbound HTTP is `evals/ship/agent/model.mjs:3-15, 87-125`: raw fetch, `fetchImpl` injected so tests never touch the network.
- **Configuration is `INTERLOCK_<THING>` env vars** declared as named constants in the module that reads them (`lib/host/claude-cli.mjs:45-51`). `lib/limits.mjs` refuses per-repo tuning; every printed cap needs a non-test reader (`test/spine/limits.test.mjs:159`).
- **The close already knows the tick state** through `inspectChange` (`lib/run.mjs:2385-2392`), the same reader `detectUnarchived` uses (`lib/drift.mjs:84-96`), so the just-shipped change satisfies the unarchived predicate by construction at a clean close.
- **`runId` is minted at `adoptPlan`** (`lib/waves.mjs:1758`, copied at `lib/run.mjs:1528`) and is `null` on a manifest that never adopted a plan (`lib/run.mjs:259`).
- **`bin/interlock` is fully synchronous**: `main()` (`:1437`) is called inside a `try/catch` at `:2515-2521`; no `await` exists in the file. `runClose` has one caller (`bin/interlock:2376`); the spine tests drive the close through the CLI.
- **The host's read-only command set** (Claude Code permissions doc, read 2026-09-07) is `ls`, `cat`, `echo`, `pwd`, `head`, `tail`, `grep`, `find`, `wc`, `which`, `diff`, `stat`, `du`, `cd` and read-only `git`; compound commands are matched per subcommand. `test`, `printenv` and `mkdir` are not in it.

## Goals / Non-Goals

**Goals:**

- One notification implementation, in the CLI, requested identically by both drivers; zero extra agent turns on the Workflow host.
- Every new summary line pinned verbatim; every new input defaulted; no existing assertion broken.
- The default path — no topic — makes no network request, and the suite never does.
- The doctor stops reporting green for a run whose first ping prompts.

**Non-Goals:**

- A Stop hook, a reader app, or any inbound channel (`docs/08:769`: the webhook, not the gateway).
- Recording run identity or the push outcome in the receipt JSON or the outcome corpus (D10).
- Capturing the Claude Code session id (D10).
- A per-repo Interlock config file (D2).
- Rewriting the environment probe to avoid non-read-only commands (D12 alternative; follow-up).
- Archiving on the operator's behalf, or gating on drift (D7).

## Decisions

### D1 — The push rides inside `interlock run close`, requested by a `--notify` flag both drivers pass

`lib/notify.mjs` is a pure transport: `composeCloseMessage({headline, change, runId, halted})` → `{title, body, priority}` and `postNtfy({url, topic, title, body, priority}, {fetchImpl = globalThis.fetch, timeoutMs})` → `{sent: boolean, reason?: string}`. `readNotifyConfig(env)` → `{topic, url} | {topic: null}` or `{invalid: '<VAR>'}`. `bin/interlock` gains a `notify` case (`interlock notify --title <t> --body <b> [--priority high]` and the sugar `interlock notify checkpoint <change>`), and `run close` accepts `--notify`. Both drivers append `'--notify'` in `closeArgs()`.

*Alternatives rejected:* a plugin `Stop` hook (Claude Code only — `bin/interlock-run` would get nothing; the stage marker is cleared before it fires, `lib/ship-stage.mjs:198`; Stop-after-Workflow timing is undocumented); a POST in `lib/run.mjs` on every close (network in a decision module, every test close would post, breaks `README:149`); a `notify` *step* the drivers execute (`ship.js` cannot execute it; a new `ACTIONS` entry handled asymmetrically). `docs/04:134` rules out only a hook that *blocks*; `docs/08:769` asks for exactly this webhook.

### D2 — Topic and server come from `INTERLOCK_NTFY_TOPIC` and `INTERLOCK_NTFY_URL`; nothing is read from the tree

The ideas doc sketched a key in `.claude/settings.local.json`. Rejected: whether the host tolerates unknown keys is undocumented, and the doctor turns an unparseable settings file into a *permissions* error at every SessionStart (`lib/doctor.mjs:277-281`, `hooks/preflight.mjs:65-81`), so a typo would masquerade as an allowlist failure. Env is the repo's only configuration convention, a topic is per-user rather than per-repo, and it is a capability (the topic is the only auth on the public server) that must never enter the tree. The drivers already rely on env reaching the ping's shell: the probe `printenv`s `CLAUDE_CODE_SUBAGENT_MODEL` (`workflows/ship.js:372`). A gitignored `.claude/interlock.json` fallback is the follow-up if env proves not to reach `run close` on the Workflow host; the doctor row (D5) is how that would show.

### D3 — Push on every terminal close; `high` on a halt

The reader who walked away needs the outcome either way. ntfy priority `high` (4) for `SHIP HALTED`, default (3) otherwise. A flag to restrict to halts is not added: one more knob for a message a phone filters anyway.

### D4 — The message is the headline plus change and run id, and never the topic, cwd or slug

`title` = the summary's first line, produced by a new exported `summaryHeadline({change, halted, leftoverTaskIds})` in `lib/receipt.mjs` that `formatRunSummary` also uses, so the push and the print cannot disagree. `body` = `change: <name>` and `run: <runId>` or `run: none — the run halted before a plan was adopted`. Halt reasons are already user-facing text; nothing else is added because the relay is public by default.

### D5 — The outcome is a summary row, a degradation banner on failure, and a doctor row; the exit code never moves

Configured and attempted: `  push: sent (ntfy)` or `  push: failed — <reason>` as a receipt row (indented, after the `commit:` row and notes). Failure additionally pushes `PUSH FAILED: <reason>` onto `degradations` before `buildReceipt`, so the recorded list and the printed block are the same list (`ship-run` receipt requirement) and `No degradation banners —` is not printed. Unconfigured: no row, no banner — an optional feature left off is not a degraded run; `interlock doctor` gains a `notify` check (`ok` naming the server, `skip` naming `INTERLOCK_NTFY_TOPIC`, never `fail`, never the value). Invalid config (`{invalid}`) is a failed push naming the variable. The attempt is bounded by `LIMITS.notifyTimeoutMs = 5000`, read by `postNtfy` (its non-test reader) and printed by `formatLimits`. Reasons never echo the topic: every reason is sanitized before it leaves `postNtfy` — occurrences of the topic and of the server URL are stripped, newlines collapsed, and the string capped — because a `fetch` failure's cause can carry the request host and a malformed-URL error can carry the whole URL. `exitCode` is computed exactly as today.

### D6 — Spec checkpoint push (pending human)

Recommended: `skills/spec/SKILL.md` §6 runs `interlock notify checkpoint <change>` immediately before printing `GOAL MET: interlock spec stopped at the checkpoint.`, pinned in `test/skills.test.mjs` as tokens (`interlock notify checkpoint`). The ideas doc calls this quick win "idea 1's sender", and idea 1's first story is the checkpoint push. If answered "ship-only", delete task 3.4 and the last requirement of `specs/ship/close-notification/spec.md`.

### D7 — The archive reminder is a verbatim line; "blocking" means unmissable, not non-zero

`ARCHIVE PENDING — <change>: after merge, run openspec archive <change>` printed on a clean complete with no leftovers, immediately before `Do not start another ship run unless the user asks.`; `  also unarchived: <n> completed change(s) — run interlock drift` beneath it when `detectUnarchived` returns other changes. Never on a halt, never with leftovers. Exit code untouched: the shipped change always satisfies the predicate (`lib/drift.mjs:90-93` vs `lib/run.mjs:2385-2392`), so a non-zero exit would halt every clean ship forever; `docs/14:53-57`, `lib/drift.mjs:27-36`, `bin/interlock:1536` and `test/spine/cli.test.mjs:2102-2119` all forbid a drift-derived gate, and `test/spine/run.test.mjs:203` asserts `exitCode 0`. The fix command is the exact string `lib/drift.mjs:334` and `skills/mr/SKILL.md:168` already print, and a test cross-checks the three surfaces.

### D8 — `runClose` owns the check, `formatRunSummary` owns the wording

`runClose` calls `detectUnarchived(root)` directly (no re-exec of `interlock drift --json`, which would also run the inferred stale-spec signal and one `git log` per spec), filters out `manifest.change`, and passes `unarchived: {thisChange: boolean, others: number}` to `formatRunSummary`. The read is wrapped in `try/catch` exactly as `readLeftoverIds` wraps the same reader (`lib/run.mjs:2385`): `inspectChange` uses `readFileSync`/`statSync` unguarded, so an unreadable sibling change must not turn a clean close into exit 1. On failure no reminder is printed and a note row `archive check skipped: <reason>` is added to `summary.notes`, so the degradation is spoken. The receipt module stays import-free; all new inputs (`unarchived`, `runId`, `root`, `projectSlug`, `push`) default so `test/workflows.test.mjs:2289-2293` keeps passing.

### D9 — Identity rows and a pure slug helper

`  run: <runId>` (or `  run: none — the run halted before a plan was adopted`), `  project: <slug>`, `  cwd: <absolute root>` as receipt rows after the `commit:` row and notes. `lib/project-slug.mjs` exports `projectSlug(absPath)` = `absPath.replace(/[^A-Za-z0-9]/g, '-')`, verified against `~/.claude/projects` on the authoring machine for `/`, `.`, space and `_`. `runClose` passes `resolve(root)`; the docs say the slug is derived from the directory the close ran in. Not in `lib/run-paths.mjs`, which despite its name holds the touched/predicted path readers.

### D10 — Nothing new in the receipt JSON, the outcome record, or a session-id file

`runId` is already the trajectory filename and every event's envelope (`lib/run-log.mjs:385-387, 490-495`); a payload copy is the duplicate-source class `lib/run-log.mjs:275-282` refuses. `cwd`/slug on the receipt would need the six-site `TYPE_FIELDS` sweep and a `ship-run` spec delta; on the outcome record it would change the agent refusal list (`lib/outcomes.mjs:67-75`). Session-id capture needs a new stdin path on `hooks/preflight.mjs`, is last-writer-wins across concurrent sessions, and rests on an undocumented Workflow/session relationship. All three are follow-ups with the printed lines as their join key.

### D11 — Commit `.claude/settings.json`; keep `Bash(git:*)`; the human makes the edit

The file is the entire reason the doctor is green here; a fresh clone loses it silently. It is also a host-protected settings file: an in-run agent editing it can raise a permission prompt no allow rule pre-approves, which is the stall this change exists to remove. So the three new rules are added and the file staged **by the human at the checkpoint** (the exact snippet is in the spec handoff), and task 1.6 verifies rather than edits; the repo-fact test in 1.5 is the enforcement. `.gitignore:18` ignores only `settings.local.json`; `test/spine/package.test.mjs:122-131` keeps `.claude/` out of the tarball. `ruleCovers` refuses narrower rules (`lib/doctor.mjs:230-247`), `docs/04:100` endorses the breadth, and the commit briefing already forbids `git push` and `--amend` (`lib/prompts/commit.mjs:22-24`).

### D12 — `REQUIRED_COMMANDS` gains `test`, `printenv` and `mkdir`; two tests make the claim checkable

Each with a `why` naming the probe (`workflows/ship.js:368-382`). `.claude/settings.json` gains the three rules. `test/spine/doctor.test.mjs:256-274` updates its expected uncovered list and `:234-254` its required count. New in `test/spine/doctor.test.mjs`: (a) a **repo-fact** test reading `<repo>/.claude/settings.json` and asserting, with `parseRule`/`ruleCovers`, that every entry of `REQUIRED_COMMANDS` plus this repository's own runner commands — `npm test` and `node --test`, pinned explicitly because `.claude/testing/profile.json` is gitignored (`.gitignore:21`) and absent on CI — is covered, and additionally `profileCommands(profile)` when the profile is present; never `diagnose(REPO)`, which would read `~/.claude`; (b) a **drift** test built on an exported `extractInstructedCommands(text)` in `lib/doctor.mjs` with an explicit rule — every `Run:` / `Then run:` line of the driver's probe, and every backticked span in a briefing whose first token matches `/^[a-z][a-z0-9-]*$/` and that also contains a space, a flag or a path — split on the shell separators, first token after stripping quotes, `$(` and env assignments, with a pinned `IGNORED_INSTRUCTION_SPANS` list for known non-command spans. The extractor is unit-tested against synthetic strings (one instructing `chmod +x`, which must be reported), and then run over the live `workflows/ship.js` and `lib/prompts/*.mjs`, asserting every extracted command is in `REQUIRED_COMMANDS ∪ runner commands ∪ HOST_READ_ONLY`, failing with file and command. `HOST_READ_ONLY` is exported from `lib/doctor.mjs` with the doc URL and the date it was checked. *Alternative deferred:* rewrite the probe to use `ls`/`echo` and have the CLI create `.claude/ship/` — a driver behaviour change resting on the same host list, and pinned prompt text; the drift test makes it safe to do later.

### D13 — One change; tasks grouped by file, leaf modules before the close

Three concerns edit `runClose` and `formatRunSummary`. Section 1 holds every file no other task needs to exist first (`lib/notify.mjs`, `lib/project-slug.mjs`, `lib/receipt.mjs` inputs, `lib/limits.mjs`, `lib/doctor.mjs`, `.claude/settings.json`, docs). Section 2 integrates (`lib/run.mjs`, `bin/interlock`, both drivers) and extends the spine tests. Section 3 is the cross-cutting pins and the skill line.

### D14 — `runClose` becomes async; `main()` becomes async with the same failure handling

`postNtfy` awaits `fetch`. `runClose` is `async` and awaits the push between `degradationLines` and `buildReceipt`; `bin/interlock:2376` awaits it; `main()` becomes `async function main()` and the entry point becomes `main().catch(err => { … same body as today … })` so `die()`, `userFacing` errors and the exit code behave exactly as before. No other caller exists (`grep runClose( test/ lib/ bin/` → one site). Every other `case` stays synchronous; `await` only appears on the close.

## Risks / Trade-offs

- **[Env may not reach `run close` on the Workflow host]** → the ping's Bash already sees `CLAUDE_CODE_SUBAGENT_MODEL` (`ship.js:372`); if the topic still does not arrive, the doctor's `notify: skip` row in the same session says so, and the gitignored-file fallback is the follow-up (D2).
- **[Halt reasons reach a public relay]** → body is headline + change + run id only (D4); `INTERLOCK_NTFY_URL` selects a self-hosted server; docs call the topic a secret.
- **[A hanging network stalls the close]** → `notifyTimeoutMs` via `AbortController`; a timeout is a failed push, never a failed close (D5).
- **[Doctor goes red on consumer repos]** → the fix string names the three rules; that is the doctor reporting a real prompt (D12).
- **[`HOST_READ_ONLY` encodes a host claim]** → dated, cited, and wrong only in a visible way (a red drift test), never silently (D12).
- **[Async close]** → one caller; `test/spine/cli.test.mjs` and `test/spine/run.test.mjs` drive the close through the CLI and are unaffected (D14).
- **[The settings edit is skipped at the checkpoint]** → task 1.6 halts naming the exact edit, and the repo-fact test in 1.5 is red until it lands; nothing ships with the doctor lying (D11).
- **[Prose restates the required-command list]** → `docs/01:24`, `docs/04:100` and `README:54` are updated to point at `interlock doctor` rather than enumerate, per CLAUDE.md's thresholds-in-the-CLI rule (task 1.7).
- **[Three new summary rows on every run]** → all indented receipt rows; the contract lines (`LEAN SHIP`, degradation block, first line) are untouched and pinned (`close-summary` spec, third requirement).

## Migration Plan

Additive. Unset `INTERLOCK_NTFY_TOPIC` → identical behaviour to today plus three identity rows and, on a clean ship, the archive line. Rollback is reverting the change; no state format changes. `.claude/settings.json` is a plain `git add`.

## Open Questions

- D6 (ledger): include the spec-checkpoint push, or ship-only.
