# Design

## Context

The directory's finding pairs a **read** of a credential from the user's environment or files with a **send** off the machine. Three scanned versions carried a credential read and the send, and each was held:

- **1.5.1:** the preflight read the topic option, and the doctor read four key variables.
- **1.6.0:** the topic came in as hook args. The doctor still read the key variables.
- **1.14.0:** PR #32 removed the doctor's key reads. In the same release, PR #34 moved the topic to a read from the hook environment.

In every one of them, `lib/notify.mjs` reads the topic and `fetch`es it to the server. The topic is a credential by the plugin's own words: `sensitive: true`, "the only auth the public server has", "treat it as a secret".

The shipped docs also describe the forbidden shape. The README says the topic comes from `INTERLOCK_NTFY_TOPIC` "unless you already set them". The shipped changelog names the key variables the doctor used to read.

The finding codes are not in the local `claude` binary, so no local check reproduces the hold.

## Goals / Non-Goals

**Goals:**

- The bundle reads no credential and opens no network connection of its own.
- Every surface that loses its input either goes or says plainly that it is gone.
- An older driver on PATH still closes its run.
- Tests pin each of these, in forms a later change cannot quietly undo.

**Non-Goals:**

- A replacement push. Claude Code's Remote Control already pushes to a phone when a session needs a person, and needs no credential from Interlock. The README points there.
- Requests made by the tools a run spawns: `git`, `gh`, `glab`, `npm` (for `openspec provision`) and the vendor CLIs. They are named in the README as theirs.
- Regenerating the screenshots in `docs/assets/` that still show the removed rows. They are listed as owed.

## Decisions

- **D1 — remove the push, don't gate it.**
  - A `${user_config.KEY}` reference is the hold's remedy for a related read and send. It can reach a command run from the Bash tool only through a hook: either as args, which the hook-command rule refuses, or through the hook environment, which is the read now held.
  - Moving the push behind an MCP server whose `env` carries the reference would turn a deterministic close step into a tool the model calls.
  - Removal is the remedy the hold says clears it.
- **D2 — keep `interlock notify checkpoint <change>` as a local marker.**
  - The spec meter keys the checkpoint on that command's argv and never reads its output (`lib/spec-meter.mjs` `TEXT_KINDS`). Keeping the words keeps the meter, its spec and a newer skill working against an older CLI.
  - The command prints `checkpoint: <change> — waiting for review; nothing is sent` and exits 0. Its `--json` form keeps `{ sent: false, reason }`.
- **D3 — `run close --notify` is accepted until 1.16.0.**
  - An unknown flag exits 2, and the drivers call `interlock` from PATH, where an older driver can meet a newer CLI. Without the flag, a close would fail and leave no receipt.
  - The flag does nothing except add one summary row, `RETIRED_PUSH_ROW`, exported once from `lib/receipt.mjs`.
  - It is a row, not a banner, so it neither removes the "No degradation banners" line nor reaches the trajectory's `degradations`.
- **D4 — `interlock notify --title` is accepted until 1.16.0.** It prints `push: removed in 1.15.0 — interlock sends no notifications` and exits 0. That is the exit an unconfigured push always had, so a script calling it keeps working and is told.
- **D5 — retire `ship/close-notification`.** Every requirement there is about the push. The change carries `retire_capabilities: true`, so archive deletes the emptied spec, whose Purpose a delta cannot rewrite. The hook-command rule from that capability moves to `distribution/npm-package`, because the bundle is what the directory judges.
- **D6 — `CHANGELOG.md` stops shipping.**
  - The directory reads shipped prose as evidence: its 1.6.0 report cited "CHANGELOG.md: host".
  - The changelog is history, and it names what old versions read.
  - Nothing reads it at runtime, and npm 11 does not force-include it.
  - The repository keeps it. `cli/interlock-ship-acp` stops naming it.
- **D7 — the guardrails are named checks with self-tests,** in the shape of `bundleLimitProblems` (a sketch of two follows the list):
  - (a) no shipped code opens a network connection;
  - (b) no shipped file names a credential variable or file, the host's option variables, or the push's variables;
  - (c) every sensitive option is consumed only as `${user_config.KEY}` in a server's `env` or `headers`, and no shipped file but the manifest spells `${user_config.`;
  - (d) `CHANGELOG.md` does not ship;
  - (e) no shipped file carries the push's residue.
- **D8 — old records parse as before.** No receipt, outcome or trajectory schema has a `push` field. Old `PUSH FAILED:` strings in a trajectory's `degradations` are opaque text that nothing parses.
- **D9 — retiring a saved topic is the person's job.** The host keeps a saved sensitive option in its secure store, and Interlock cannot clear it. The changelog's Upgrading note says to remove the option, unset `INTERLOCK_NTFY_*` in the shell, and stop using the topic.

The sketch for (c) and (a):

```js
// (c): one problem string per sensitive option used outside a server's env/headers
function sensitiveOptionProblems(manifest, shippedTexts) { /* … */ }
// (a): one problem string per shipped file reaching for a network API
function networkProblems(files) { /* … */ }
```

## Risks / Trade-offs

- **The hold may still be raised for a reason the bundle's text alone cannot show.** For example, a scanner could read child processes inheriting the environment as a forward. The directory's Validate of a pack is the only oracle. `npm run scan-pack` makes building that pack one command, and pushing it plus running Validate is the owner's step.
- **A person who relied on the push loses it.** The changelog marks the change BREAKING, the next release is a minor bump, and the README names Remote Control's push.
- **Two compatibility paths stay for one minor.** Each is commented with its removal version.
