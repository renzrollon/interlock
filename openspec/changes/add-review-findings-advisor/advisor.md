# Checkpoint advisor — add-review-findings-advisor

drafted 2026-10-22T16:02:33Z from .claude/metrics/advisor-brief-add-review-findings-advisor-20261022-160100.md

## Questions for the human

| id | question | why | cites |
|----|----------|-----|-------|
| Q1 | Is two of six labelled cases passing matches-label (reviewAdvisorKeepMinMatches: 2 with reviewAdvisorVerdictMinLabels: 6) really enough to call the advisor KEEP, given that a KEEP is the stated trigger for making the consult default later? | The bar is a judgment about how often the advisor must catch a planted wrong dismissal to be worth an opus spawn on every review. The repository can store the number but cannot choose it, and D14 leaves it to the owner. | design.md#Cap values (D14) |
| Q2 | Should flags that only repeat survivors count toward KILL, or should repeats-survivor stay an observation only? Right now the verdict reads only matches-label, even though design names a repeatMax option and graders read both. | An advisor that hits the planted dismissal but buries it among restated survivors could still score KEEP. Whether noise disqualifies it is a product tradeoff, not a fact the code can find. | specs/review/findings-advisor/spec.md#Requirement: The verdict SHALL be tallied from Review Range labels |
| Q3 | Is a set of six cases from only four fix commits acceptable? cb6313a and 133aa8a each supply two cases, and one case (advisor-check-exits) plants a bug in the advisor's own CLI. Or do you want six separate fixes from more than one area of the code? | Cases from the same commit share an author, a style and a context, so the six labels are less independent than the count suggests. Only the owner can decide whether that correlation is acceptable for kill-criterion data (D15). | design.md#Review Range (D10, D12, D15, D16) |
| Q4 | Who labels the Review Range transcripts, by when, and who pays for the first metered run? No ANTHROPIC_API_KEY repo secret exists, and tasks 4.1 hands the first paid run to the owner. | Without a named labeller and a funded run, the verdict prints INSUFFICIENT LABELS indefinitely, the same way the Spec Range D19 question is still open. D16 cannot be settled from the repository. | design.md#Risks / Trade-offs |
| Q5 | Is a KEEP measured only on dismissals you planted yourself good enough to justify making the consult default? Or should the default switch also require observed catches on real review-code runs? | The design admits that the cases measure catching an authored weak citation, not the real rate of wrong dismissals. What counts as enough evidence to change the default is a decision about intent. | design.md#Risks / Trade-offs |
| Q6 | Should the checkpoint advisor's helpers be lifted into brief-kit and advisor-kit in this change, while that advisor's own verdict is still pending? Or should review-advisor duplicate them until at least one advisor reaches KEEP? | If either advisor is KILLed, the shared kit becomes a two-caller abstraction serving one advisor. The lift also edits a shipped surface whose behaviour this change promises not to alter. That tradeoff between scope and reuse belongs to the owner. | design.md#Shared helpers (D5, D6) |
| Q7 | Excluding ship --strict means unattended ship runs, where nobody reads the dismissals, get no consult. Is that exclusion a sequencing step until a verdict exists, or a principle that the advisor serves only human-attended reviews? | Unattended ship runs are arguably where an invisible wrong dismissal costs the most. Whether the exclusion is temporary or permanent changes how this change should be described and what a follow-up may assume. | proposal.md#What Changes |
| Q8 | Each --advisor review overwrites review-advisor.md in the change folder, and the file is archived with the change. Do you want only the last consult kept, or a history of every consult across review rounds? | Earlier flags vanish after a re-review, while the persisted drafts sit in .claude/metrics and are never linked from the change. Which record is the one that matters is a choice of intent. | design.md#Raise-only, and pinned (D8) |

## Risks

| id | where | kind | note |
|----|-------|------|------|
| R1 | design.md#Flags, targets and order (D7) | unstated-assumption | The brief carries findings and per-dimension counts but no record of which files each dimension read. So an `uncovered` flag can only mean 'no finding names this path', not 'no dimension engaged it'. A file that was read cleanly and a file that was never read look the same to the advisor. |
| R2 | task 3.1 | single-caller-abstraction | `--check <file>` is implemented and documented, but neither the skill nor the eval prompt calls it. Only `-` and `--failed` have callers, so the third input mode is surface with no user. |
| R3 | task 4.2 | unstated-assumption | Task 4.2 says each deferral row expires on the first run that produces transcripts. The review-range spec says a row goes stale only once a calibration set exists. With labelling unassigned (D16), these two triggers can disagree, and the suite could fail after the first paid run even though no labels exist yet. |
| R4 | task 2.2 | scope-expansion | Moving the checkpoint advisor onto shared kits, and giving verdictFromLabels five new options, puts a refactor of a shipped advisor whose verdict is still pending into the same change as a new feature. The only proof of no regression is that the existing assertions still pass. |
| R5 | specs/evals/review-range/spec.md#Requirement: Each case SHALL carry a deterministic floor and two judged graders | untestable-spec | matches-label passes when a kept dismissal-doubt targets the labelled dismissal. Because each fixture holds only two dismissals, an advisor that flags both scores a pass. The decoy guards repeats-survivor, not matches-label, so the flag-everything advisor the design says is not rewarded is in fact rewarded. |

## Dropped

none

## Not a gate

This file is advisory: `interlock ready`, `interlock ledger` and `interlock validate` do not read it, and a question becomes a decision only when a person writes it into `decisions.md`.
