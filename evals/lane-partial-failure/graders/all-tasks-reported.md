---
type: regex
pattern: '5\.3'
weight: 1
---

A result that omits a task it was given fails every task in the lane, so all
three ids must appear (workflows/ship.js:167). The last task, 5.3, is the one a
model is most likely to drop when it stops early — reporting it (as
not-attempted) is the id-set evidence. This grader asserts `5.3` is present in
the returned packets. Deterministic — no judge.
