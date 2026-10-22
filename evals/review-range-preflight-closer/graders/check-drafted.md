---
type: regex
pattern: '"step"\s*:\s*"check"[^{}]*?"status"\s*:\s*"drafted"'
weight: 1
---

The consult's deterministic floor: the transcript shows the JSON
`interlock review-advisor "preflight-closer" --check - --json` printed, with
`"step": "check"` followed by `"status": "drafted"`. A check that recorded a
consult that did not run prints `"status": "did-not-run"` and fails here, so an
unseeded run, a failed spawn or a reply that was not JSON cannot pass the floor
on the strength of a did-not-run stanza. The pattern stays inside the check
object's top level, where `status` precedes `flags`.
