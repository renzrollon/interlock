# Security policy

## Reporting a vulnerability

Report it privately through [GitHub's private vulnerability reporting](https://github.com/renzrollon/interlock/security/advisories/new). If you cannot use GitHub, email carl.rollon@gmail.com instead.

**Do not open a public issue, discussion or pull request for a suspected vulnerability.**

Include what you can:

- the Interlock version, and whether it ran inside Claude Code or under `interlock-run --host <id>`; `interlock doctor` prints the version
- the steps that reproduce it, or a proof of concept
- the impact you believe it has, and what an attacker needs to reach it

## Supported versions

Fixes ship in the latest release only: the version on npm, which is also the version the `release` branch carries for plugin installs. Older versions are not patched; upgrade to pick up a fix.

## What happens next

- An acknowledgement within 7 days.
- A fix, or a decision with the reasoning, worked out with you in a private GitHub Security Advisory.
- The fix is released, then the advisory is published. You are credited in it unless you would rather not be.

Interlock has one maintainer, so these are best-effort targets, not a contract. If a date slips, you hear about it in the advisory.

## Scope

Interlock runs on your machine with your permissions. It installs hooks into every Claude Code session, spawns agents and vendor CLIs, creates git worktrees and runs the commands its run program names. These are in scope:

- **The hooks.** The `PreToolUse` and `SessionStart` guards registered in `.claude-plugin/plugin.json`, and `hooks/mod.mjs`. Examples: a hook that runs or writes something it was not asked to, or that writes outside the repository it runs in.
- **The CLIs in `cli/`** and the argv they build. Examples: a path or argument that escapes into a shell or another command.
- **The ship drivers.** `workflows/ship.js` and `cli/interlock-run` spawn agents and create lane worktrees, and the host adapters in `lib/host/` spawn vendor CLIs. Examples: a worktree or spawn that reaches outside the repository, or a credential passed to a host that was not meant to get it.
- **The network and credentials.** The bundle makes no network request of its own and reads no credential, and `test/spine/package.test.mjs` pins both. A shipped path that opens a connection, or reads a key, a token or a credential file, is a vulnerability.
- **The release supply chain.** `release.yml` publishes to npm with provenance, and `plugin-bundle.yml` commits the published tarball to the `release` branch. Examples: a path for a fork, a pull request or a tampered tarball to reach either.

## Not a vulnerability here

- **A guard that allows.** The guards fail open by design: each one allows anything it cannot establish. They keep a ship run's agents on the workflow; they are not a sandbox and do not contain a hostile agent. [docs/13 — The guards](./docs/13-the-guards.md#the-fail-open-rule) explains why. A guard that *blocks* something it should allow is a bug, so file it as a bug.
- **Claude Code itself.** Report it to Anthropic through the [Claude Code security policy](https://github.com/anthropics/claude-code/blob/main/SECURITY.md).
- **The OpenSpec CLI.** Report it to Fission AI through [OpenSpec's security policy](https://github.com/Fission-AI/OpenSpec/blob/main/SECURITY.md).
