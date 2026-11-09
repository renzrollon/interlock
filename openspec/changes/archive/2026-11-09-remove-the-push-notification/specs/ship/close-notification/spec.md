## REMOVED Requirements

### Requirement: The closing step SHALL post one message per terminal close when a topic is configured and the caller requested it

**Reason**: The push is removed (design D1). It sent a credential the CLI read from the environment to a server, which the plugin directory holds every version for.

**Migration**: `interlock run close --notify` is accepted until 1.16.0 and adds one summary row saying the push was removed (`ship/run-program`). Claude Code's Remote Control pushes to a phone when a session needs a person.

### Requirement: The message SHALL carry the terminal line, the change and the run id, and nothing that identifies the machine

**Reason**: No message is composed once the push is removed.

**Migration**: None; the summary the close prints is unchanged.

### Requirement: The push outcome SHALL be spoken and SHALL NOT change the exit code

**Reason**: No push is attempted, so there is no outcome to speak.

**Migration**: The close's exit code is unchanged. A close called with `--notify` prints the retired-push row (`ship/run-program`).

### Requirement: Configuration SHALL come from the environment and SHALL never be written to the tree

**Reason**: Nothing is read: `INTERLOCK_NTFY_TOPIC` and `INTERLOCK_NTFY_URL` have no reader.

**Migration**: A person who set either variable can unset it; it has no effect.

### Requirement: No CLI path other than notify SHALL open a network connection

**Reason**: Superseded by a stricter rule with no exception: no shipped code opens a network connection (`distribution/npm-package`).

**Migration**: The network pin in `test/spine/package.test.mjs` covers every shipped file.

### Requirement: The spec checkpoint SHALL announce itself through the same transport

**Reason**: The checkpoint sends nothing. `interlock notify checkpoint <change>` stays as the local marker the spec meter keys on (`hooks/spec-meter`), and prints one `checkpoint:` line.

**Migration**: None for the skill; its line is unchanged.

### Requirement: A plugin option SHALL reach the push through one hook that reads the host's option variables

**Reason**: Both plugin options and `hooks/notify-option.mjs` are removed.

**Migration**: A saved `ntfy topic` stays in the host's secure store until the person removes it. The changelog's Upgrading note says how to retire it.

### Requirement: No hook command SHALL name a variable other than the plugin root, and only the option hook SHALL read the host's option variables

**Reason**: Moved, and tightened: with no option hook, no shipped file may read the host's option variables at all.

**Migration**: `distribution/npm-package` carries the hook-command rule and the option-variable pin.
