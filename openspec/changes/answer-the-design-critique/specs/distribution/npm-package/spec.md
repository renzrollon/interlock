# Spec Delta

## ADDED Requirements

### Requirement: cli/interlock SHALL stay inside the directory headroom by moving subcommand bodies into lib

`cli/interlock` SHALL stay inside the size headroom that `test/spine/package.test.mjs` pins below the plugin directory's file limit. A subcommand whose body would push it past that headroom SHALL move into a `lib/*-cli.mjs` module that takes the entry file's output and exit helpers as `io`, as `interlock pipeline` does in `lib/pipeline-cli.mjs`, so its stdout, stderr and exit codes are unchanged.

#### Scenario: Happy path — a moved subcommand behaves as before

- **GIVEN** the `interlock pipeline` body is held in `lib/pipeline-cli.mjs` and called with `emit`, `die`, `warn`, `readStdin` and `writeJsonAtomic`
- **WHEN** `interlock pipeline --github <file> --out <file>` runs
- **THEN** it prints the same `pipeline <sha>:` line, writes the same file and exits 0 as before the move

#### Scenario: Failure — a refused document still clears an earlier output file

- **GIVEN** an earlier file at `--out` and a `--github` document that is not valid JSON
- **WHEN** `interlock pipeline` runs
- **THEN** it removes the earlier file, says so on stderr, and exits 1 with the parse error

#### Scenario: Edge case — the headroom pin holds after the move

- **GIVEN** the bundle's shipped files at the head
- **WHEN** `test/spine/package.test.mjs` runs
- **THEN** no shipped text file is inside the headroom below the directory's size limit
