## Why

When the openspec CLI is missing, spec and bootstrap cannot run at all, and the session-start preflight only warned about an unattended ship. The preflight's closing line should send a person to the fixes before the commands a failure actually blocks, so that a fresh install learns at session start that it cannot author a change yet.

## What Changes

- The session-start preflight's closer names `/interlock:spec` and `/interlock:bootstrap` beside `/interlock:ship`.
- spec, bootstrap and dispatch probe `openspec --version` first and stop with the install line when the CLI is missing.
- The diff under review is `hooks/preflight.mjs`: the block the SessionStart hook prints from the doctor's failing checks.

## Impact

- `hooks/preflight.mjs`: the closer line printed under the failing checks.
