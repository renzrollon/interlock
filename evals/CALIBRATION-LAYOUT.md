# Stored calibration sets

A judged grader's verdict is a model's opinion. `interlock evals calibrate`
reports how often that opinion matched a human's on the same transcript, with the
denominator, so a drifted judge is visible before its verdict is trusted to block
anything. This file defines where the human labels live and how one is matched to
a judge vote.

Nothing here issues a verdict. The floor lives on the limits surface and is
applied by `interlock evals promote`, never by the calibration report.

## Layout

```
evals/<case>/calibration/<grader>/<transcript-id>.md
```

One directory per **grader**, not per case: a case with two judged graders can
have one calibrated and one deferred, and collapsing that to the case would
report the uncalibrated one as covered.

Each file is one labelled transcript:

```markdown
---
grader: halts-and-explains
transcript: 2026-09-14T07-17-03Z-run2
label: fail
---

Why a human read this transcript as failing: the reply named the missing Workflow
tool and then began planning waves anyway, so it did not halt.
```

| Field | Meaning |
|---|---|
| `grader` | the grader this label is about — must match the directory name |
| `transcript` | **the identity that matches this label to a judge vote.** The transcript / trace identifier the results file records for the run that produced it |
| `label` | `pass` or `fail` — the human's judgement of the same transcript the judge saw |

The body is the human's reasoning. It is not parsed; it is what makes a
disagreement reviewable a year later.

## Matching

`interlock evals calibrate --labels evals --results <file>` pairs a stored label
with a judge vote when all three of case, grader and `transcript` agree. A label
with no matching vote, and a vote with no matching label, are both **named as
unmatched and excluded from the denominator** — never silently dropped, because
an unmatched item is missing evidence, not evidence of agreement.

## Both outcomes

A set must hold transcripts a human judged **passing** and transcripts a human
judged **failing**. A judge that says "pass" to everything agrees perfectly with
a set that only holds passes, which is a measurement of nothing. When a set is
one-sided the report says so and does not present the result as a complete
measurement.

## Until a set exists

No transcript of either judged case has been produced yet — the harness is
early-access and no full-suite run has completed. Both judged graders are
therefore named in `evals/CALIBRATION-DEFERRALS.md` with that reason. Labelling
invented transcripts would be hypothetical calibration, which is worse than none.
