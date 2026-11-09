# Decisions — remove-the-push-notification

| id | question | class | resolution | evidence |
|----|----------|-------|------------|----------|
| D1 | Remove the push, or keep it behind a `${user_config.KEY}` channel? | agent_resolved | Remove; the owner chose it on 2026-11-05 over a docs-first Validate and an MCP server | the hold's text: "remove every part that reads a credential, which clears this hold"; checklist hook-command row refuses `${user_config.…}` args (PR #34); 1.14.0 scan still held |
| D2 | What marks the spec checkpoint once nothing is sent? | agent_resolved | `interlock notify checkpoint <change>` stays, local, exit 0 | `lib/spec-meter.mjs` `KEYED_LINES` keys on the argv; `checkpoint` is not in `TEXT_KINDS` |
| D3 | Does `run close` still accept `--notify`? | agent_resolved | Yes until 1.16.0, as a no-op with one summary row | `cli/interlock` exits 2 on an unknown flag; drivers call `interlock` from PATH (`distribution/upgrade-compatibility`) |
| D4 | What does `interlock notify --title` do? | agent_resolved | Until 1.16.0 it prints that the push was removed and exits 0 | the unconfigured push always exited 0 |
| D5 | Keep a stub requirement in `ship/close-notification`? | agent_resolved | No; retire it with `retire_capabilities: true` and move the hook-command rule to `distribution/npm-package` | OpenSpec 1.15.0 `dist/core/archive.js` honours `retire_capabilities`; a delta cannot rewrite a Purpose |
| D6 | Reword the changelog's old entries, or stop shipping it? | agent_resolved | Stop shipping it | the 1.6.0 report cited "CHANGELOG.md: host"; nothing reads it at runtime; `npm pack --dry-run` on npm 11 leaves it out once `files` does |
| D7 | Which guardrails? | agent_resolved | Five package checks, each with a self-test | design D7 |
| D8 | Do old records still parse? | agent_resolved | Yes; no schema carries a push field | `lib/run-log.mjs` keeps `degradations` as strings |
| D9 | Who retires a saved topic? | agent_resolved | The person; the changelog says how | a sensitive option lives in the host's secure store |
