# Spec Delta

## MODIFIED Requirements

### Requirement: The prompt SHALL let the reviewer run read-only checks and SHALL ask it to measure what it claims

Every dimension prompt SHALL say the reviewer may run read-only commands, including a single test file and the repository's own CLI, SHALL say the reviewer writes nothing, since the reviewer's agent type takes away the tools that edit a file but not the shell, so the prompt stays a bound beside the type, and SHALL say that a claim about a size, a width, a count or a duration is measured and the measurement cited, with a measurement the reviewer cannot take recorded under `unread`. No prompt SHALL tell a reviewer not to run tests, with one exception: a prompt printed under `--target` for a target that does not allow running the code SHALL say, in place of the read-only run line, that the reviewer reads the code under review and runs none of it, and may run `git` and the graph's query commands only. That line SHALL come from the CLI, read from the target, and SHALL never be written by a skill. In a dimension prompt it SHALL also say that a measurement only a run could take is recorded under `unread`, with the reason that this review does not run the code. The write-nothing line and the measure-what-you-claim line SHALL be printed either way, and a skeptic prompt printed under such a target SHALL carry the same read-and-run-nothing line.

#### Scenario: Happy path — the run-and-measure lines are present

- **GIVEN** any bundled dimension
- **WHEN** its prompt is printed without a target
- **THEN** it holds the read-only run line, the write-nothing line and the measure-what-you-claim line

#### Scenario: Failure — the skill suite catches a prompt that forbids tests

- **GIVEN** an assembler edited so a prompt printed without a target says not to run the tests
- **WHEN** the skill suite runs
- **THEN** a test fails naming the prompt

#### Scenario: Edge case — the write-nothing line stays under a typed spawn

- **GIVEN** a dimension prompt printed for the review skill, whose reviewers run as `interlock:reviewer`
- **WHEN** the prompt is read
- **THEN** it still holds the write-nothing line, word for word as before this change

#### Scenario: Edge case — a target that does not allow running the code

- **GIVEN** a target whose `runCode` is false
- **WHEN** a dimension prompt and the skeptic prompts are printed under `--target`
- **THEN** each says the reviewer reads the code under review and runs none of it, and names `git` and the graph's query commands as what it may run
- **AND** none of them holds the line that allows a single test file and the repository's own CLI
- **AND** the dimension prompt still holds the write-nothing line and the measure-what-you-claim line
- **AND** the dimension prompt says a measurement only a run could take is recorded under `unread`, with the reason that this review does not run the code

#### Scenario: Edge case — a target that allows running the code

- **GIVEN** a target whose `runCode` is true
- **WHEN** a dimension prompt is printed under `--target`
- **THEN** it holds the read-only run line, word for word as a prompt printed without a target does

## ADDED Requirements

### Requirement: Under `--target` every prompt SHALL name the review root and SHALL quote the reviewer's own review context

A dimension or skeptic prompt printed under `--target` SHALL carry a `REVIEW ROOT` paragraph: the worktree's absolute path, that every path in the prompt is relative to it, that `git` runs as `git -C <root>` and graph queries with `--root <root>`, and that the directory the agent starts in is another working copy at another commit. The review context SHALL be read from the directory the command runs in, never from the worktree.

#### Scenario: Happy path — a dimension prompt names the root

- **GIVEN** a target whose worktree is at its pinned head
- **WHEN** `interlock review brief --dimension regression --target <file> --changed <files>` runs
- **THEN** the prompt holds a `REVIEW ROOT` paragraph with the worktree's absolute path, the `git -C` form and the `--root` form
- **AND** the scope names the target's base and head commits, and each changed file with its changed line ranges

#### Scenario: Happy path — the skeptic prompts name it too

- **GIVEN** the same target and a findings file with one warning
- **WHEN** `interlock review brief --skeptics --findings <f> --target <file> --json` runs
- **THEN** every entry's `prompt` holds the same `REVIEW ROOT` paragraph

#### Scenario: Edge case — the review context is the reviewer's own

- **GIVEN** a `.claude/graph/REVIEW_CONTEXT.md` in the directory the command runs in, and a different one inside the worktree
- **WHEN** a dimension prompt is printed under `--target`
- **THEN** it quotes the first and holds no text of the second

#### Scenario: Edge case — nothing is added without a target

- **GIVEN** a diff against `origin/main` and no `--target`
- **WHEN** a dimension prompt and the skeptic prompts are printed
- **THEN** none holds a `REVIEW ROOT` paragraph, and each is the same byte for byte as before this change

### Requirement: A prompt printed under `--target` SHALL keep the first line it has without a target

The `REVIEW ROOT` paragraph SHALL never open a prompt. A dimension prompt SHALL still open with its rubric, whose `# Dimension: <name>` line the settle meter reads to attribute the spawn, and a skeptic prompt SHALL still open with its skeptic's published first sentence.

#### Scenario: Happy path — a dimension prompt still opens with its rubric

- **GIVEN** a valid target
- **WHEN** `interlock review brief --dimension regression --target <file> --changed <files>` runs
- **THEN** the prompt's first line is the first line of the same prompt printed without a target
- **AND** the line `# Dimension: regression` comes before the `REVIEW ROOT` paragraph

#### Scenario: Edge case — a skeptic prompt still opens with its first sentence

- **GIVEN** the same target and a findings file with one warning
- **WHEN** `interlock review brief --skeptics --findings <f> --target <file> --json` runs
- **THEN** one prompt opens `You are a skeptical code reviewer.` and the other `You are an independent reviewer giving a second opinion.`, as they do without a target

### Requirement: Under `--target` a dimension prompt SHALL ask for the pre-existing mark

A dimension prompt printed under `--target` SHALL tell the reviewer to set `preExisting: true` on a finding only when the defect is on a line the diff did not change and would be there without this pull request, and never on a finding about what the change breaks, leaves stale or fails to update elsewhere. Its emit shape SHALL show the optional field. Without `--target` neither the prompt nor its emit shape SHALL mention the field.

#### Scenario: Happy path — the instruction and the field are printed

- **GIVEN** a valid target
- **WHEN** any dimension's prompt is printed under `--target`
- **THEN** it holds the pre-existing instruction, with both halves: when to set the mark and when never to
- **AND** the emit shape lists `preExisting` as an optional boolean on a finding

#### Scenario: Edge case — the author's path does not carry it

- **GIVEN** no `--target`
- **WHEN** any dimension's prompt is printed
- **THEN** the text `preExisting` appears nowhere in it
