# Skill Candidate Brief — Author Contract

A durable handoff from a retro/review skill into a skill-author agent. It
captures evidence that a repeatable session procedure should become a new
`SKILL.md`, without writing the skill itself.

**Path:** `.claude/handoff/skill-candidate-<slug>-<YYYYMMDD-HHMMSS>.md`
Slug = the proposed skill name in kebab-case. Same handoff directory as explore
briefs (`${CLAUDE_PLUGIN_ROOT}/shared/EXPLORE-BRIEF.md`).

**When to write**

- The retro finds a repeatable procedure not covered by an existing skill.
- Cap at the top 3 candidates per review. Skip one-offs, pure chat, and duplicates
  of existing skills (suggest extending those instead).

**Bound the brief** (~1–3k tokens): cite the concrete moments and the tool pattern;
treat the procedure steps as hypotheses the author must refine.

---

## Template (stable — skill-author agents depend on these headings)

```markdown
# Skill Candidate Brief: <slug>

## Meta
- source: interactive | loop
- slug: <kebab-case proposed skill name>
- confidence: high | med | low
- created: <ISO-8601 timestamp>
- session_refs: <e.g. this session, 2026-08-20>
- evidence_basis: current-session (live context, no transcript re-read)

## Proposed Skill
- name: <kebab-case>
- description: <pushy trigger description — what it does AND when to use it>
- when_to_use: <bullet list of user phrases / contexts>
- when_not_to_use: <bullet list — overlaps, one-offs, better existing skills>

## Evidence
<!-- The concrete moments this session, the tool pattern, the assigned shape + score.
     State clearly which steps below are inferred rather than directly observed. -->

## Procedure to Encode
<!-- Ordered steps a SKILL.md should teach. Hypotheses from what the session did — author must refine. -->
1. ...
2. ...

## Inputs / Outputs / Exit Criteria
- inputs: <args, flags, natural-language triggers>
- outputs: <files written, chat summary shape>
- exit_criteria:
  - [ ] ...

## Related Existing Skills
<!-- From the enumerated skill list. Name overlaps and why this is NOT a duplicate
     (or: "extend <skill> instead" and stop — do not invent a parallel skill). -->

## Open Questions
<!-- Gaps the author must resolve before writing SKILL.md (scope, tools, output path, etc.). -->

## Author Checklist
- [ ] Name + description are distinct from Related Existing Skills
- [ ] Trigger phrases are concrete enough to avoid under-triggering
- [ ] Procedure steps refined against at least one real session or user confirmation
- [ ] Inputs / outputs / exit criteria are testable
- [ ] Open questions resolved or explicitly deferred in the skill body
```

---

## Section rules

| Section | Rule |
|---------|------|
| **Meta.confidence** | `high` = a repeated procedural shape with durable domain knowledge; `med` = a single strong session; `low` = weak signal / thin evidence |
| **Evidence** | Cite the concrete moments. Never invent tool calls, quotes, or token counts. |
| **Procedure to Encode** | Hypotheses labeled as such. Prefer a locate → act → verify shape. |
| **Related Existing Skills** | Must check the enumerated skill list. Prefer "extend X" over a new skill when overlap is high. |
| **Author Checklist** | If unchecked blockers remain, say so when pointing the user at the brief. |

## Candidacy signals (what a retro looks for)

- The same multi-step procedure performed by hand that no skill covers
- A long, high-tool-count stretch reinventing a workflow absent from existing skills
- A mid/low shape score where a skill would have prevented the named failure mode
- A clear procedural shape (locate → transform → verify) with durable domain knowledge

**Skip:** one-off Targeted Fixes, chat-only stretches, and work already covered by
an existing skill (suggest extending that skill instead).

## Chat reply after write

Do **not** re-dump full briefs into chat. Reply with:

1. Paths to each `.claude/handoff/skill-candidate-*.md` written
2. A one-line summary per candidate (slug + confidence + why)
3. "Hand these to a skill-author agent to write the SKILL.md"

## Author consumption

A skill-author agent reads the brief, resolves the Open Questions with the user,
then writes `skills/<name>/SKILL.md` (and docs / manifest wiring as needed). Prefer
the brief's recommendations over re-deriving the procedure; reopen the session only
for gaps or contradictions.
