# Spec Delta

## ADDED Requirements

### Requirement: Capabilities SHALL fill the domain-text cap in order of how many changed files they link

The domain text SHALL take selected capabilities in descending order of the number of changed files each links, then by name, so the capability the diff changes most is the last to be cut. The selection record SHALL list the order and each capability's linked count.

#### Scenario: Happy path — the most-linked capability goes first

- **GIVEN** a diff whose changed files link three to `hooks/settle-meter` and one to `distribution/npm-package`
- **WHEN** the domain text is assembled
- **THEN** `hooks/settle-meter`'s requirements come before `distribution/npm-package`'s, and the record lists the order with counts 3 and 1

#### Scenario: Edge case — equal counts fall back to name order

- **GIVEN** two capabilities each linked by one changed file
- **WHEN** the domain text is assembled
- **THEN** they are taken in name order

### Requirement: Any requirement left out for the cap SHALL make the selection partial, in the CLI as in a run

`interlock domain-context` SHALL set `partial` whenever the cap leaves a requirement out, stating how many and citing `maxDomainSpecChars` by key, and SHALL name each selected capability left with no requirement in the text. Its human output SHALL print `DOMAIN REVIEW PARTIAL` in that case, as a run does. The review's dimension record SHALL carry `domain` under `degraded` with that reason. A cut SHALL NOT be reported as a selection made without a graph: the living checklist's `no-graph` flag stays for a missing graph alone.

#### Scenario: Failure — the PR #28 cut is partial

- **GIVEN** the PR #28 diff, whose selected capabilities exceed the cap so that every `hooks/spec-meter` requirement is left out
- **WHEN** `interlock domain-context --changed … --base origin/main --json` runs
- **THEN** `partial` is set, names `hooks/spec-meter` as a capability with no requirement in the text, and cites `maxDomainSpecChars`
- **AND** the human output prints `DOMAIN REVIEW PARTIAL`

#### Scenario: Failure — a cut is not mistaken for a missing graph

- **GIVEN** a graph that exists and a diff whose selected capabilities exceed the cap
- **WHEN** the merge evidence builds the living checklist for the same diff
- **THEN** the checklist names the cut requirements as omitted and carries no `no-graph` flag

#### Scenario: Edge case — a run, the CLI and the merge evidence agree

- **GIVEN** the same diff, base and graph
- **WHEN** a strict run plans its review, `interlock domain-context` runs, and the merge evidence selects the living list
- **THEN** all three select the same capabilities in the same order, each `via` the same rule, with the same `ungraphed` files

#### Scenario: Edge case — the cut is degraded, not unread

- **GIVEN** a `domain` answer whose checked entries cite the requirements it was given and whose only gap is the requirements the cap left out
- **WHEN** the record is written with `domain` under `degraded` from `omitted`
- **THEN** `domain` is not in `proof.unread`, `proof.proven` holds, and the verdict carries `domain-partial`

#### Scenario: Edge case — a text that fits is not partial

- **GIVEN** a diff whose selected capabilities fit the cap
- **WHEN** `interlock domain-context` runs
- **THEN** `partial` is null and no `DOMAIN REVIEW PARTIAL` line is printed

### Requirement: A changed file the graph does not hold SHALL select the capability whose living spec cites it

When a changed source file is absent from the graph, the selection SHALL also take every capability whose living spec text cites that file's path, marked `via: cited`, and SHALL record the file under `ungraphed` with the graph's build time.

#### Scenario: Happy path — the settle meter is selected without the graph

- **GIVEN** a graph built before `lib/settle-meter.mjs` existed, a living `hooks/settle-meter` spec that cites `lib/settle-meter.mjs`, and a diff that changes that file
- **WHEN** domain context is selected
- **THEN** `hooks/settle-meter` is selected `via: cited`, and `lib/settle-meter.mjs` is listed under `ungraphed`

#### Scenario: Edge case — a file no spec cites

- **GIVEN** a changed file that is absent from the graph and cited by no living spec
- **WHEN** domain context is selected
- **THEN** no capability is selected for it, and the file is still listed under `ungraphed`
