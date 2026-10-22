## Why

A spawn's prompt is several kilobytes, and the Workflow host has no filesystem and a cap on every result field it relays. So the run program writes each spawn's prompt to a briefing file and hands the host a fixed bootstrap that names the file and requires its sha256 back, which proves the worker read the briefing it was given. The runner hosts read the same file's text and send it inline, so one file serves both.

## What Changes

- `writeBriefing(root, label, text)` writes `.claude/ship/briefings/<label>.md`, headed by a comment carrying the label and the text's sha256, and returns its path, hash and text.
- `spawn()` writes the briefing for every agent a step names, keyed by the step's label: the program's own labels (`plan-waves`, `commit`) and each lane's label from `laneLabel(lane)`.
- The diff under review is `lib/run.mjs`.

## Impact

- `lib/run.mjs`: `writeBriefing`, `briefingHash` and `spawn`.
