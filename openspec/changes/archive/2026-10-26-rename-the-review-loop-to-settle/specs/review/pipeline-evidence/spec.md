## MODIFIED Requirements

### Requirement: A GitLab pipeline SHALL be read from the merge request's head pipeline, for the head commit the merge request itself states

GitLab SHALL be read in two steps, and no commit SHALL be typed by the caller. `interlock pipeline --gitlab-pr <file> --out <path>` SHALL read the merge request document `glab mr view <iid> --output json` prints. A document without a head commit, or without a `head_pipeline` key, SHALL be refused. When `head_pipeline` is null the command SHALL write a pipeline input with the merge request's head commit and no checks. When it names a pipeline the command SHALL write a pending record carrying the head commit and the pipeline's identifier and no check list, which is not a well-formed pipeline input and which `interlock merge-confidence` therefore refuses.

`interlock pipeline --gitlab <file> --pending <path> --out <path>` SHALL read the document `glab ci get --merge-request <iid> --output json` prints, and the pending record. It SHALL refuse a pipeline whose identifier is not the one the record names. A job SHALL read `pass` for success, `fail` for failed, `skipped` for skipped, `skipped` for a manual job that is allowed to fail, and `pending` for every other status, a manual job that is not allowed to fail included. The `sha` of the input SHALL be the head commit the record carries. When the pipeline's reference is not a merged-result or merge-train reference and the pipeline's own commit differs from that head, the command SHALL exit 1 naming both commits.

Rationale: a merged-result pipeline runs on a commit the platform made, so its own commit never equals the head; the merge request is the platform's statement of which commit the head pipeline answers for. Carrying that commit from one command to the next in a file keeps it out of anyone's hands, and "no pipeline" has to be something the platform said, not an error message somebody read.

#### Scenario: Happy path — a branch pipeline for the head commit

- **GIVEN** a pending record for a head commit and a pipeline, and that pipeline's document on a branch reference with the same commit, holding a successful job that is not allowed to fail, a failed job that is allowed to fail and a failed job that is not
- **WHEN** `interlock pipeline --gitlab <file> --pending <path> --out <path>` runs
- **THEN** the input carries the head commit, the first job as `pass` and required, the second as `fail` and not required, and the third as `fail` and required

#### Scenario: Failure — another pipeline, another commit, or a document missing the key

- **GIVEN** a pipeline document whose identifier differs from the record's; a branch pipeline document whose commit differs from the record's head; and a merge request document with no `head_pipeline` key
- **WHEN** each is given to its flag
- **THEN** each exits 1 naming what did not match or what was missing, and no pipeline input is left at the output path

#### Scenario: Edge case — a merged-result pipeline, a manual job and no pipeline at all

- **GIVEN** a pipeline document on a merged-result reference whose own commit differs from the record's head, holding a manual job that is not allowed to fail; and a merge request document whose `head_pipeline` is null
- **WHEN** each is given to its flag
- **THEN** the first produces an input whose `sha` is the record's head and whose manual job reads `pending` and required
- **AND** the second produces an input with the merge request's head commit and no checks

#### Scenario: Edge case — the second step never ran

- **GIVEN** a pending record written for a merge request that has a head pipeline, and no second step
- **WHEN** `interlock merge-confidence --pipeline <path>` is given the record
- **THEN** it exits 1 saying the file carries no check list, and prints no verdict
