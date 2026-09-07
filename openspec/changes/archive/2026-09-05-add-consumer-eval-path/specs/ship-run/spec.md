## ADDED Requirements

### Requirement: The receipt SHALL record the paths the run's commit touched

The receipt SHALL carry the set of repository-relative paths the run's commit touched, observed from version control rather than reported by an agent. The set MUST be bounded and copied by name, like every other receipt field, so the run's summary object cannot leak diffs, file contents or handoff bodies into the trajectory through it.

The set MUST be tri-state. A run that made a commit whose paths were read records the observed set, which MAY be empty only if the commit genuinely touched nothing. A run that made no commit, whose commit step failed, or whose paths could not be read from version control MUST record the set as **unobserved**, not as empty — an empty set asserts a measured zero, and this indicator's whole value depends on that distinction surviving into the corpus.

The reason a set is unobserved MUST be recorded with it, so a reader of a copied trajectory can tell "no commit was made" from "a commit was made and its paths could not be read".

#### Scenario: Happy path — a committing run records the paths its commit touched

- **GIVEN** a run whose commit step reports success with an identifier and whose commit touched three files
- **WHEN** the receipt is written
- **THEN** the receipt carries those three repository-relative paths as the observed touched set

#### Scenario: Failure — a run that made no commit records the touched set as unobserved

- **GIVEN** a run that halted before its commit step, or was invoked so that it does not commit
- **WHEN** the receipt is written
- **THEN** the touched set is recorded as unobserved with a reason naming the absent commit
- **AND** it is not recorded as an empty set, which would assert that a commit touched nothing

#### Scenario: Edge case — an unreadable commit records unobserved rather than partial

- **GIVEN** a run whose commit identifier is present but whose touched paths could not be read from version control
- **WHEN** the receipt is written
- **THEN** the touched set is recorded as unobserved with a reason naming the failed read
- **AND** no partial or fabricated path list is recorded

#### Scenario: Edge case — a fat summary object cannot leak file content through the path set

- **GIVEN** a summary object whose commit result also carries diff hunks and per-file contents
- **WHEN** the receipt is appended from that object
- **THEN** the written event carries only the named path strings
- **AND** it carries no diff content and no file content

### Requirement: The receipt SHALL record the paths the executed plan predicted

The receipt SHALL carry the set of repository-relative paths the executed plan predicted its tasks would touch, taken from the plan the run actually executed. The set MUST be bounded and copied by name on the same terms as the touched set.

Path prediction is optional for a plan's task: a classifier that cannot predict which files a task will touch is required to say nothing rather than guess. The receipt MUST therefore also record whether the prediction was **complete** — whether every task in the executed plan declared its paths — so a later reader can tell a plan that predicted nothing extra from a plan that declined to predict. A run whose plan could not be read at all MUST record both the set and its completeness as unobserved.

#### Scenario: Happy path — a plan whose every task declared paths records a complete predicted set

- **GIVEN** a run whose executed plan has four tasks, each declaring the paths it expects to touch
- **WHEN** the receipt is written
- **THEN** the receipt carries the union of those declared paths as the predicted set
- **AND** it records the prediction as complete

#### Scenario: Failure — a plan with an unpredicting task records the prediction as incomplete

- **GIVEN** a run whose executed plan has four tasks, one of which declared no paths
- **WHEN** the receipt is written
- **THEN** the receipt carries the union of the declared paths of the other three
- **AND** it records the prediction as incomplete, naming that not every task declared paths

#### Scenario: Edge case — an unreadable plan records the predicted set as unobserved

- **GIVEN** a run whose executed plan could not be read back at close
- **WHEN** the receipt is written
- **THEN** the predicted set and its completeness are both recorded as unobserved
- **AND** neither is recorded as empty or as complete

### Requirement: A path set that exceeded its bound SHALL say so

Each recorded path set is bounded, and a set that reached its bound MUST be recorded as truncated rather than silently shortened. A truncated set is not the set the run touched or predicted, and any comparison made over it would be a comparison over a denominator nobody stated.

The bound itself SHALL live in code, not in this specification and not in any prose surface, so it cannot be re-argued per reading.

#### Scenario: Happy path — a set within its bound is not marked truncated

- **GIVEN** a run whose touched and predicted sets both fit within the recorded bound
- **WHEN** the receipt is written
- **THEN** neither set is marked truncated

#### Scenario: Failure — a set that reached its bound is marked truncated

- **GIVEN** a run whose commit touched more paths than the recorded bound admits
- **WHEN** the receipt is written
- **THEN** the touched set is marked truncated
- **AND** a reader can tell that the recorded paths are a prefix of the real set rather than the whole of it

#### Scenario: Edge case — truncation does not fail the append

- **GIVEN** a run whose predicted set far exceeds the bound
- **WHEN** the receipt is appended
- **THEN** the append succeeds with the bounded set and the truncation marker
- **AND** the run's close is not failed on account of the truncation
