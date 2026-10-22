## Why

The session-start preflight printed its findings once and they scrolled away, and an interrupted run's notes and halt resume cards were only on disk. The hook should leave one report file, and the hooks module should draw it on a band above the prompt with two panes behind it, so the person sees at session start what needs their attention.

## What Changes

- `hooks/preflight.mjs` writes `.claude/ship/preflight.json`: the doctor's verdict and checks, the interrupted-run notes it spoke and the halt resume cards it listed.
- `lib/preflight-file.mjs` builds and reads that report and composes the `AbovePrompt` band's lines and the `/interlock-preflight` and `/interlock-handoff` panes from it.
- The diff under review is `lib/preflight-file.mjs`: `shouldDraw`, `bandLines` and the card helpers.

## Impact

- `lib/preflight-file.mjs`: when the band draws and what it lists.
