# Spec Delta

## MODIFIED Requirements

### Requirement: `review-code` SHALL run at the published depth, `--strict` SHALL select the strict depth, and the record SHALL say which ran

`/interlock:review-code` SHALL read its depth from the `interlock routing --json` answer it already reads for its routing, passing `--depth strict` when it was given `--strict` and no `--depth` otherwise, SHALL print, once its dimension set is selected and before it spawns any dimension, `REVIEW DEPTH: <depth> (<n> dimensions: <a> always-on + <t> triggered)`, with the depth from that answer, `<a>` the count of the answer's `review.dimensions`, `<t>` the count of conditional dimensions its triggers selected and `<n>` their sum, or `REVIEW DEPTH: <depth> (<n> dimensions: --dimensions)` under a `--dimensions` override, and SHALL run as its always-on dimensions the answer's `review.dimensions`, the conditional dimensions on their own triggers as before, and `--dimensions a,b,c` as a total override as before. The dimension record SHALL carry `depth` equal to the depth that ran; `interlock review` SHALL accept an optional string `depth` in the record equal to `lean` or `strict`, SHALL record it under `dimensions.depth`, SHALL refuse any other value naming the file and the fault, and SHALL record none when the record carries none. When the routing command exits non-zero, the skill SHALL run the strict depth's shape at the session defaults, after the `ROUTING UNAVAILABLE` line, and its banner SHALL read `REVIEW DEPTH: strict` with the same counts. The skill SHALL NOT select `strict` because the diff looks large, SHALL NOT name the default depth, and SHALL name the counts in its own prose only as placeholders.

Rationale: the default depth is the cheap one, and the only way a lean review is honest is that its record says so and the full review is one flag away. A bare `lean` over a seven-dimension review, four of them triggered, reads as a smaller review than ran; the counts beside the word say what the depth governs and what the triggers added.

#### Scenario: Happy path — the default depth runs and is recorded

- **GIVEN** `/interlock:review-code <change>` with no `--strict`, on a host where `interlock routing --json` answers `depth: lean` with `review.dimensions` of two names, and whose triggers select one conditional dimension
- **WHEN** the skill runs
- **THEN** it prints `REVIEW DEPTH: lean (3 dimensions: 2 always-on + 1 triggered)` after the selection and before the first dimension spawn, spawns those three dimensions, and writes `"depth": "lean"` into the dimension record
- **AND** `interlock review --dimensions <that record> --json` carries `dimensions.depth` equal to `lean`

#### Scenario: Happy path — `--strict` selects the strict depth

- **GIVEN** `/interlock:review-code <change> --strict`
- **WHEN** the skill reads its routing
- **THEN** it runs `interlock routing --depth strict --json`, prints a line opening `REVIEW DEPTH: strict (` that names the always-on and triggered counts, spawns the strict `review.dimensions` plus the conditional ones, and records `"depth": "strict"`
- **AND** its dimension reviewers carry the `review-dimension` row's strict override

#### Scenario: Failure — a record with an unknown depth is refused

- **GIVEN** a dimension record carrying `"depth": "deep"` and `--out` naming a writable path
- **WHEN** `interlock review --dimensions <that record> --out <path>` runs
- **THEN** it exits 1 naming the file and the value on standard error
- **AND** nothing is printed on standard output and nothing exists at the `--out` path

#### Scenario: Edge case — a record without a depth, and a routing failure

- **GIVEN** a dimension record with no `depth` key, and separately a review pass on which `interlock routing --json` exits non-zero
- **WHEN** `interlock review` reads the first, and the skill runs the second
- **THEN** the first records no `dimensions.depth` and is otherwise read as before
- **AND** the second prints `ROUTING UNAVAILABLE:`, then a line opening `REVIEW DEPTH: strict (` with its counts, and runs the strict depth's always-on set with two skeptics per blocker and warning at the session defaults

#### Scenario: Edge case — the skill's pins

- **GIVEN** the shipped `skills/review-code/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** `argument-hint` carries `--strict`, the prose carries `REVIEW DEPTH:` followed by `<depth>` and the placeholders `always-on` and `triggered` in one line, the dimension table has no row whose `Run when` column reads `always` and its paragraph names `review.dimensions`, and the dimension record fence carries `depth`
- **AND** no sentence beside `lean` or `strict` names a number of dimensions or skeptics

### Requirement: `settle --strict` SHALL pass the strict depth to every review pass of the loop, and the default SHALL be the CLI's

`/interlock:settle` SHALL accept `--strict`, SHALL pass `--strict` to the first `review-code` pass and to every round's `review-code` pass when it was given, SHALL pass no depth flag otherwise so the published default applies, SHALL print the `REVIEW DEPTH:` line once, whole and with its counts, as `review-code` reported it, and SHALL NOT select `--strict` because the diff looks large. The assessment, the conformance worker, the verification and the platform wait SHALL run the same at both depths.

Rationale: the loop's cost is set once, at its entry, the same way ship's is; a default the CLI publishes is one the owner can budget.

#### Scenario: Happy path — the default loop runs lean

- **GIVEN** `/interlock:settle --review` with no `--strict`
- **WHEN** the loop runs its first review and a round's review
- **THEN** neither `review-code` invocation carries `--strict`, and each prints the published default depth with its counts
- **AND** the skill prints `REVIEW DEPTH:` once, with that depth and the first pass's counts

#### Scenario: Happy path — `--strict` reaches every pass

- **GIVEN** `/interlock:settle --review --strict` whose loop runs two rounds
- **WHEN** the three `review-code` passes run
- **THEN** each carries `--strict` and each prints a line opening `REVIEW DEPTH: strict`
- **AND** the conformance worker, the verification and the assessment run as they do without the flag

#### Scenario: Edge case — the skill's pins

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** `argument-hint` and the flag table carry `--strict`, both fenced `review-code` lines carry `--strict` inside a placeholder the paragraph before explains, the prose carries `REVIEW DEPTH:` and says the skill does not `invent` `--strict`
- **AND** the loop-order pin still finds both `review-code` lines with `--base origin/` and `--out .claude/ship/settle/review-r`
