# Proposal

## Why

1.15.0 removed the push notification and kept two forms accepted until 1.16.0, so a driver older than the CLI on PATH could still close its run. The release that carries that promise is this one, and a test (`test/spine/cli-arguments.test.mjs`) fails at 1.16.0 until the forms are gone. The living `ship/run-program` spec still says the close MUST accept `--notify`, which stops being true here.

## What Changes

- **`interlock run close --notify` is an unknown flag.** It exits 2 before the close runs, like any unknown flag, and its message names the cause: the driver that passed it is older than the CLI.
- **`interlock notify --title`, `--body` and `--priority` exit 2; a bare `interlock notify` exits 1** and names the one remaining form, `interlock notify checkpoint <change>`, which is unchanged.
- **The receipt no longer carries a retired-push row.** `RETIRED_PUSH_TEXT`, `RETIRED_PUSH_ROW`, `pushRetired` and `runClose`'s `notify` option are deleted.
- **The release notes, the CLI reference, the upgrade guide and the stop-conditions page say so**, including what a refused close from an older driver leaves behind.
- **BREAKING**, announced in 1.15.0 and released as a minor version.

## Capabilities

### Modified Capabilities

- `ship/run-program`: the closing-step requirement drops the accepted retired push request and refuses it instead.

## Impact

`cli/interlock`, `lib/cli-flags.mjs`, `lib/receipt.mjs`, `lib/run.mjs`, four test files, three docs, the changelog. A plugin at 1.14.x or earlier against a 1.16.0 CLI can no longer close a run; the upgrade notes name the recovery.
