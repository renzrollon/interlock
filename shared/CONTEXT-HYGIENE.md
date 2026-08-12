# Context Hygiene — `[[VARIABLE_NAME]]` Placeholder Pattern

Shared discipline for all specflow skills that embed user-supplied strings in downstream prompts.

## The problem

Agents fill missing context with any string in their active window — leaking PII, credentials, deprecated endpoints, or plausible-but-wrong values. This is **context hallucination**: gap-filling from ambient context rather than verified sources.

Hard-coded prompt rules ("don't leak PII") are insufficient. Contexts overflow; prompt injection bypasses inline constraints. The fix is **structural** — wrap sensitive values as opaque placeholders and let a resolver substitute them at call time.

## The syntax

Wrap any user-supplied or ambient value that will appear inside a prompt template as `[[VARIABLE_NAME]]`:

```
[[USER_PROMPT]]        Original user request
[[CHANGE_NAME]]        OpenSpec change slug (kebab-case)
[[REPO_ROOT]]          Absolute path to the current repo
[[ISSUE_REF]]          Extracted from branch (e.g., RD-65)
[[BASE_BRANCH]]        Merge target (main / master / trunk)
[[SANITIZED_EMAIL]]    Redacted email from user input
[[SANITIZED_TOKEN]]    Redacted 32+ char alphanumeric token
[[SANITIZED_AUTH]]     Redacted Bearer/Basic auth header
```

Names are `SCREAMING_SNAKE_CASE`, enclosed in double brackets. No nesting, no expressions.

## The rules

1. **Wrap on emit, resolve on consume.** When a skill composes a downstream prompt, wrap sensitive values. The resolver runs immediately before the tool call.

2. **Resolution order** (highest priority wins):
   - Runtime state overrides (values captured this session)
   - Environment variables of the same name
   - Explicit `AskUserQuestion` prompt if the value is required

3. **Unresolved placeholders stay visible.** Never silently substitute a plausible value. If `[[COMMENTER_EMAIL]]` reaches a tool call unresolved, halt and ask the user. Gap-filling is what this pattern exists to prevent.

4. **Sanitize on ingress.** When a skill receives freeform user text that will be echoed downstream, redact obvious secrets to `[[SANITIZED_*]]` form immediately. Preserve the mapping in session state for later resolution.

5. **Never round-trip through the model.** A resolved value must go directly from the resolver to the tool argument. Do not paste it into a prompt the model reads first.

## Common patterns

**Composing a subagent prompt:**

```
INVESTIGATE: [[USER_PROMPT]]
CHANGE: [[CHANGE_NAME]]
FILES TO READ:
  - [[REPO_ROOT]]/openspec/changes/[[CHANGE_NAME]]/proposal.md
```

**Handing to `gh pr create`:**

```
--title "feat([[SCOPE]]): [[VERB_PHRASE]]"
--body "$(...contains [[SUMMARY]], [[RISK]], [[TEST_PLAN]]...)"
```

**Detecting a leak in output:**

If model output contains a literal email, phone number, or long token that was NOT in the user's input, treat it as a hallucination. Do not commit, do not send. Halt and ask.

## What NOT to wrap

Placeholders are for **values**, not concepts. Do not wrap:

- Verbs or actions (`[[ACTION]]` is meaningless)
- Boolean state (`[[IS_ACTIVE]]` — just use the boolean)
- Full sentences (`[[FULL_PROMPT]]` — defeats the purpose)
- Values already sourced from a schema-validated tool result (they're structured, not freeform)

## Skill integration

Skills that emit prompts to subagents or external tools:

- **/specflow:spec** — wraps user description, change name, repo root before passing to `openspec new change` and downstream artifact generators.
- **/specflow:explore** — wraps user question and any file references before fanning out to Explore subagents.
- **/specflow:ship** — wraps goal and file lists in each subtask prompt.
- **openspec-create-pr** — wraps branch name, issue ref, summary before invoking `gh pr create`.
- **dispatch** — sanitizes freeform user input (emails, tokens, auth headers) at ingress.

When adding a new skill that echoes user-supplied strings into a prompt template or tool call, follow the same pattern.
