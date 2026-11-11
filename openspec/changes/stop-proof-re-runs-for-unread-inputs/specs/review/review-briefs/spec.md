## MODIFIED Requirements

### Requirement: `interlock review brief` SHALL print a dimension's whole prompt

`interlock review brief --dimension <name> --base <ref> [--change <c>] [--changed <files|->] [--rerun-of <draft>]` SHALL resolve the change as the review's read paths do, an archived one included, and print one prompt: the dimension's bundled rubric verbatim, its `# Dimension: <name>` line included; the scope the CLI computed (base, head, changed files and their changed line ranges, the change's artifact paths); the emit shape with the coverage ledger and the proof rules it is judged by; and the dimension's inputs. Without `--rerun-of` the scope SHALL be the whole diff; with it, the requirement "`interlock review brief --dimension` SHALL print a re-run's prompt from the draft that names it" decides what is printed. A name with no bundled rubric SHALL exit 1 listing the names that resolve.

#### Scenario: Happy path — a lean dimension's prompt

- **GIVEN** a diff against `origin/main` that changes `lib/settle-meter.mjs`
- **WHEN** `interlock review brief --dimension regression --base origin/main --changed lib/settle-meter.mjs` runs
- **THEN** standard output holds the `regression` rubric verbatim, a line that is exactly `# Dimension: regression`, the changed file with its changed line ranges, and the emit shape with `coverage.checked` and `coverage.unread`

#### Scenario: Failure — an unknown dimension

- **GIVEN** the dimension name `delivery`
- **WHEN** `interlock review brief --dimension delivery --base origin/main` runs
- **THEN** it exits 1 with nothing on standard output, and standard error names `delivery` and lists every bundled dimension

#### Scenario: Happy path — the prompt states what makes a review proven

- **GIVEN** a diff that changes three coverable source files
- **WHEN** any dimension's prompt is printed without `--rerun-of`
- **THEN** it lists the three files, says each must be cited in a checked entry or a finding by some dimension, says a dimension that raises nothing must still say what it checked, and says an input left unread is recorded under `unread`, not left out
- **AND** it says a requirement the domain cap left out is `degraded`, recorded by the skill, never an `unread` entry, and that `unread` is an input the prompt contained that the reviewer did not open

#### Scenario: Edge case — an empty diff

- **GIVEN** a base whose diff against the head changes no file
- **WHEN** the command runs
- **THEN** it exits 1 saying there is nothing to review

## ADDED Requirements

### Requirement: `interlock review brief --dimension` SHALL print a re-run's prompt from the draft that names it

With `--rerun-of <draft>`, the brief SHALL read the draft's proof. For an unproven dimension it SHALL print the same prompt as without the flag. For a dimension re-run for uncited files alone it SHALL print a prompt whose scope and must-cite list hold only those files, with one `RE-RUN FOR UNCITED FILES:` line and the same first line. For any other dimension, an unreadable file, a record with no proof, or uncited files none of which is in its changed list, it SHALL exit 1 and print no prompt.

#### Scenario: Happy path — an unproven dimension is re-run with the whole prompt

- **GIVEN** a draft whose proof names `language` unproven
- **WHEN** `interlock review brief --dimension language --base <base> --changed <the changed files> --rerun-of <draft>` runs
- **THEN** standard output is, byte for byte, what the same line prints without `--rerun-of`

#### Scenario: Edge case — a re-run for uncited files is scoped to them

- **GIVEN** a diff that changes `lib/a.mjs`, `lib/b.mjs` and `hooks/mod.mjs`, and a draft in which `regression` ran, no dimension is unproven, and the proof lists `hooks/mod.mjs` as uncited
- **WHEN** `interlock review brief --dimension regression --base <base> --changed <the changed files> --rerun-of <draft>` runs
- **THEN** the scope names `hooks/mod.mjs` with its changed line ranges and neither other file, and the list of files that must be cited holds `hooks/mod.mjs` alone
- **AND** one line begins `RE-RUN FOR UNCITED FILES:`, and the first line is the first line of the prompt printed without the flag

#### Scenario: Failure — a dimension the draft names no re-run for

- **GIVEN** the same draft, in which `language` recorded an `unread` input and is neither unproven nor the uncited target
- **WHEN** `interlock review brief --dimension language --base <base> --changed <the changed files> --rerun-of <draft>` runs
- **THEN** it exits 1 with nothing on standard output, and standard error says the draft names no re-run for `language`

#### Scenario: Failure — a file that is not a draft

- **GIVEN** a file that does not parse, and a review record that carries no `proof`
- **WHEN** `interlock review brief --dimension regression --base <base> --rerun-of <file>` runs for each
- **THEN** each exits 1 with nothing on standard output and the reason on standard error

#### Scenario: Failure — the draft's uncited files are not in the diff

- **GIVEN** a draft whose proof lists `hooks/mod.mjs` as uncited, a base whose diff against the head does not change that file, and a `--changed` list that does not hold it either (the draft was written with a `--changed` path git does not list, and the brief call omits it)
- **WHEN** `interlock review brief --dimension regression --base <base> --changed <that list> --rerun-of <draft>` runs
- **THEN** it exits 1 with nothing on standard output, and standard error says none of the draft's uncited files is in the diff or the `--changed` list

#### Scenario: Edge case — the settle meter still attributes a scoped re-run

- **GIVEN** the prompt printed for a `regression` re-run scoped to uncited files
- **WHEN** the settle meter classifies it
- **THEN** it is attributed to the `regression` dimension, as the prompt printed without the flag is
