## Why

When the openspec CLI is missing, the spec, bootstrap and dispatch skills explored and wrote before the first `openspec` command failed, and dispatch read the missing CLI as an empty project. They should probe `openspec --version` first and, on `command not found`, stop with the install line before doing anything else. The doctor is what the session-start preflight reads, so its openspec check must agree with where the skills stop.

## What Changes

- spec, bootstrap and dispatch probe `openspec --version` first and stop with the install line when the CLI is missing.
- dispatch no longer routes a fresh repo with no CLI to bootstrap as if it were an empty project.
- The doctor exports `OPENSPEC_INSTALL`, and its no-CLI fix strings spell the command.
- The diff under review is `lib/doctor.mjs`: `checkOpenSpec` and `probeVersion`.

## Impact

- `lib/doctor.mjs`: the openspec check's statuses, evidence and fix text.
