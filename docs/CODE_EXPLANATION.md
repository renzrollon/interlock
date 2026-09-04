# Code Explanation: last 7 commits on `feat/interlock-report` (simplified, high-level)

This branch is all about **Interlock** — the tool that runs OpenSpec "ship" workflows (plan → implement → review → commit) using Claude agents. Each commit below adds one capability to that pipeline. None of this is React/frontend code — it's a Node.js CLI plus a set of "skills" (markdown instructions for agents) and "hooks" (safety checks).

---

## 1. `2b0c1de` — feat(evals): add the eval suite, model-free triage, and doctor preflight

**What it does:** Adds an automated test suite for *agent behavior*, not just code. Each "eval" (in `evals/`) is a small scenario (`case.yaml`) plus "graders" — checklists that judge whether an agent handled it correctly (e.g. "did it cite a real file path instead of inventing one?").

**Why:** Interlock's real product is agent behavior. Normal unit tests can't catch "the agent invented a file that doesn't exist" — you need a scenario + a grader for that.

**Think of it like:** a driving test. The `case.yaml` is the test course, the `graders/*.md` are the examiner's checklist items.

---

## 2. `09328d5` — feat(report): read the recorded corpora without gating on them

**What it does:** Adds `lib/report.mjs` and a `report` skill that reads back the data Interlock already records during a run (measurements, outcomes) and turns it into a human-readable summary — without blocking or failing the run if that data is missing or messy.

**Why:** The team wanted visibility into how ship runs are actually going, but didn't want a reporting feature to become a new way for runs to fail. "Non-gating" means: read best-effort, never block.

---

## 3. `ffaa4e5` — feat(waves): add dependency-aware planning and lane effort routing

**What it does:** Interlock splits implementation work into "waves" (parallel batches of tasks). This commit teaches the planner to respect *dependencies* between tasks (don't run a task in parallel with one it needs first) and to route each "lane" of work to the right model/effort tier based on how hard the task looks.

**Why:** Before this, waves were planned more naively. Now the scheduler is aware that some tasks must be sequenced, and that not every task deserves the same amount of "thinking effort."

**Note:** Most of the file changes here are just older `openspec/changes/*` proposal folders being moved into an `archive/` subfolder — bookkeeping, not new behavior.

---

## 4. `1b666a9` — feat(review): add repo-root REVIEW.md policy for scope and advice

**What it does:** Lets a repo drop a `REVIEW.md` file at its root to tell Interlock's automated code-reviewer what to focus on (scope) and what house style/advice to apply, instead of the reviewer using only hardcoded defaults.

**Why:** Different repos care about different things during review. A policy file makes review rules configurable per-project instead of baked into Interlock itself.

**Think of it like:** a linter config file, but for an AI reviewer's instructions rather than syntax rules.

---

## 5. `08d4826` — feat(hooks): add PreToolUse guards and SessionStart preflight

**What it does:** Adds `hooks/` — small scripts that Claude Code runs automatically *before* certain tool calls (like committing, editing tests, or ticking off a task) to block unsafe or out-of-order actions. Also adds a "preflight" check that runs once at session start to catch obvious setup problems early.

**Why:** Agents can otherwise commit half-finished work, edit tests to force them to pass, or mark a task done without actually doing it. Guards intercept these specific failure patterns before they happen, rather than relying on review to catch them after the fact.

**Think of it like:** seatbelt sensors — they don't drive the car, they just refuse to let something unsafe happen.

---

## 6. `5a8ccae` — feat(ship): isolate wave lanes in worktrees and fold with a halting merge

**What it does:** Each parallel "lane" of implementation work now runs in its own **git worktree** (an isolated checkout of the repo) instead of sharing one working directory. When lanes finish, `lib/merge-lanes.mjs` folds their changes back together — and if a merge conflict happens, it **halts** and reports it rather than trying to auto-resolve.

**Why:** Running multiple agents in parallel against the same files was risky — one agent's half-finished edit could corrupt another's. Isolating each lane in its own worktree removes that risk; a deliberate halt-on-conflict avoids silently merging something wrong.

**Think of it like:** giving each construction crew their own copy of the blueprints, then having a foreman manually check for clashes before combining the final building.

---

## 7. `f67bbc3` — chore: bump version to 0.2.0

**What it does:** Updates the version number in `package.json` and the plugin manifests to `0.2.0`.

**Why:** Marks a release point after the six feature commits above. No behavior change.

---

## Change Flow (how these commits build on each other)

```
evals (test agent behavior)
   → report (see how runs actually went)
   → waves (plan work better, respecting dependencies)
   → review policy (let repos customize what gets reviewed)
   → hooks (block unsafe actions before they happen)
   → worktree isolation (make parallel work physically safe)
   → version bump (ship it)
```

Each commit hardens a different part of the same pipeline: **plan → implement (in parallel) → guard against mistakes → review → report on results.**

---

## Beginner Takeaway

This whole branch is about making an *AI agent pipeline* safer and more observable — evals catch bad agent behavior in testing, hooks catch it live, worktree isolation prevents parallel agents from stepping on each other, and reporting/review make the results visible and tunable. The common thread: **don't just hope agents behave — build guardrails and checks around every stage where they could go wrong.**
