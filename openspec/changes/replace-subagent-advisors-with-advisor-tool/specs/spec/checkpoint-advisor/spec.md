## REMOVED Requirements

### Requirement: The brief SHALL be assembled by the CLI, bounded, and name what it left out

**Reason**: The checkpoint consult was a subagent named "advisor", not Claude Code's advisor tool, which cannot fill a file a human reads (its advice reaches only the calling model and is redacted for current advisors). The owner chose to remove it (decisions D1).
**Migration**: `interlock advisor --brief` is gone. Compound notes the brief carried are read by the spec skill through `interlock note match` (see `spec/compound-notes`). Claude Code's own advisor tool is reported and counted per `advisor-tool`; no consult is asked for.

### Requirement: The consult SHALL be one Agent-tool spawn of the plugin's advisor agent, declared once

**Reason**: The `interlock:advisor` agent is removed with the consult (decisions D1).
**Migration**: None needed by a user. The spec skill no longer spawns an agent at the checkpoint and no longer grants itself the Agent tool.

### Requirement: The check SHALL validate the draft by code, render the file, and always exit 0

**Reason**: There is no draft to check once the consult is removed (decisions D1).
**Migration**: `interlock advisor --check` is gone. A script that called it exits with the CLI's unknown-subcommand error.

### Requirement: A consult that did not run SHALL be written down, and the spec SHALL continue

**Reason**: No consult runs, so no did-not-run stanza is written (decisions D1).
**Migration**: The spec hand-off reports instead whether Claude Code's advisor tool was available to the session and whether it was consulted (see `advisor-tool`).

### Requirement: No gate SHALL read advisor.md, and the ledger SHALL stay the human's to write

**Reason**: `advisor.md` is no longer written (decisions D1).
**Migration**: An `advisor.md` already in a change folder is left as it is; nothing reads it. The ledger rule is unchanged and lives in `spec/decision-ledger`.

### Requirement: The kill criterion SHALL be a CLI tally of human labels against caps

**Reason**: The Spec Range cases and their labels are removed with the consult they measured (decisions D1).
**Migration**: `interlock advisor --verdict` is gone, and its caps leave `interlock limits`.
