---
type: regex
pattern: '(?=[\s\S]*settleWatching)(?=[\s\S]*(?:(?:[eE]very|[aA]ll|[eE]ach|[aA]ny)[^.]{0,80}(?:[rR]eaders?|[cC]allers?|[cC]onsumers?|[cC]all sites?)|(?:[rR]eaders?|[cC]allers?|[cC]onsumers?|[cC]all sites?)[^.]{0,80}(?:[eE]very|[aA]ll|[eE]ach|[aA]ny)))(?=[\s\S]*[lL]oads?)'
weight: 1
---

B1 (comment 6471618730): before the diff only a `--review` load started a settle
run; after it, every settle load does, so every reader of `settleWatching()` in
hooks/mod.mjs now runs after any load. This grader requires `settleWatching` to
be named together with its readers or callers being affected on every or any
load. Deterministic, no judge.
