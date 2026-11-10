# Tasks

## 1. Remove the shim

- [x] 1.1 In `cli/interlock`, `lib/cli-flags.mjs`, `lib/receipt.mjs` and `lib/run.mjs`, delete `--notify`, the `notify` leaf's three flags, `RETIRED_PUSH_TEXT`, `RETIRED_PUSH_ROW`, `pushRetired` and `runClose`'s `notify` option; make any `notify` word but `checkpoint` exit 1; name the cause in the refusal of the retired flags.

## 2. Tests

- [x] 2.1 Replace the tests that pinned the accepted forms with refusal pins: `test/spine/run.test.mjs` (the refused close writes nothing, and the close without the flag still closes), `test/spine/cli.test.mjs`, `test/spine/cli-arguments.test.mjs`, `test/workflows.test.mjs`.

## 3. Docs

- [x] 3.1 Update `CHANGELOG.md`, `docs/04-when-it-stops.md`, `docs/07-cli-and-configuration.md` and `docs/16-upgrading.md`.
