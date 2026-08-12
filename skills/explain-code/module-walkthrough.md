# Module walkthrough — explain-code

Teach TypeScript/React/Next.js code to a frontend beginner. Not reviewing — teaching.

## Scope

**Ecosystems covered:**
- TypeScript (strict mode, generics, utility types, Zod, discriminated unions)
- React 19 (hooks, components, context, refs, suspense, error boundaries)
- Next.js 15 App Router (server components, client components, server actions, route handlers, middleware, layouts, streaming)
- Related dependencies: Prisma ORM, Zustand, Radix UI, Tailwind CSS, better-auth, class-variance-authority

**Infrastructure & cloud services — always include when called:**
- PostgreSQL (via Prisma)
- AWS S3 (file storage/retrieval)
- AWS SQS (message queues)
- Any HTTP/REST calls to external services
- Authentication services (better-auth sessions)

**Context sources:**
- If `.claude/graph/DOCS_DIGEST.md` exists, Read it once as the domain primer (agent-only; see `/specflow:docs-digest`)
- Then use `specflow-graph context "<scope terms>" --budget 2000` for task-specific prose — do **not** read all of `docs/` upfront (see `${CLAUDE_PLUGIN_ROOT}/shared/TOOL-ECONOMY.md` Rule 0.5)
- If graph missing: `specflow-graph docs "<terms>" --budget 800`, or grep headings in `docs/` then Read spans

**Files to explain:**
- **Module walkthrough:** every `.ts` / `.tsx` in the scoped tree (`src/`, `app/`, `lib/`, …)
- **Commit teach-in:** every source file touched in the commit range (skip binaries/lockfiles; cap ~25)

**Skip:**
- Test files (`*.test.ts`, `*.test.tsx`, `__tests__/`) — unless they are the only files in a commit teach-in and the user asked about them
- `node_modules/`, generated files, config files outside source trees
- Boilerplate: import statements, simple variable declarations, trivial type aliases, basic for loops

**This mode:** every `.ts` / `.tsx` in the scoped tree (`src/`, `app/`, `lib/`, …).

## Steps

1. Retrieve domain context on demand — Read `.claude/graph/DOCS_DIGEST.md` if present; then `specflow-graph context "<scope>" --budget 2000` (or `docs` with `--budget 800` if no graph). Do not preload every `docs/*.md`.
2. If `$ARGUMENTS` specifies a directory or file, explain only that scope; pass paths to `--changed` when using `context`.
3. If no arguments, use the graph to list modules/files in `app/`, `lib/`, `components/`, `types/`, and `prisma/` instead of blind `find`.
4. Graph-backed scope and call links: if `.claude/graph/graph.json` exists, use `specflow-graph explain <file>` and `specflow-graph consumers <symbol>` for **Called by** / **Calls into**. If missing and scope is large, `specflow-graph build .` once first.
5. Read each in-scope file; extract functions and logic blocks worth explaining (Read with offset/limit when locating via graph/grep).
6. Trace imports only where the graph is incomplete.
7. Order output: foundational files → data layer → components → pages/routes.
8. Build flow diagrams last; write to the output path resolved in `SKILL.md` — `docs/CODE_EXPLANATION.md` for an ad-hoc walkthrough, or `openspec/changes/<change-name>/code-explanation.md` when the walkthrough is scoped to an OpenSpec change.

## Per-file structure

### File Header (module walkthrough)

```markdown
## `src/path/to/file.ts`

**Role:** [one sentence — what this file's job is in the app]
**Called by:** [files that import from this one]
**Calls into:** [files this one imports, excluding node_modules]
**Infra/services touched:** [PostgreSQL, S3, SQS, external APIs — or "None"]
```

### Function/Block Breakdown

For each exported function, named function, or significant logic block:

```markdown
### `functionName(params)` → returnType

**What it does:** [1-2 sentences in plain language]

**How it works:**
- [Step-by-step walkthrough of the logic, skipping boilerplate]
- [Highlight conditionals, transformations, and side effects]

**Cross-file calls:**
- `helperFunction()` from `src/lib/helpers.ts` — [why it's called here]
- `prisma.user.findMany()` → PostgreSQL — [what data it fetches]
- `s3Client.send(PutObjectCommand)` → AWS S3 — [what it uploads and when]

**Pattern:** [Name the pattern if one applies]
```

## API & Data Flows (Required for route handlers and server actions)

### Route Handler Flow

```markdown
### API Flow: `POST /api/v1/batches`

**Request:**
- Method: POST
- Body: `{ name: string, type: "BILLING" | "ACCRUAL", groupId: string }`
- Auth: Session cookie (better-auth)
- Headers: `Content-Type: application/json`

**Processing:**
1. Authenticate → `auth.api.getSession()` → checks session cookie
2. Authorize → `makeAuthorizationChecker()` → verifies user belongs to group
3. Validate → Zod schema `CreateBatchSchema` → rejects malformed input
4. Execute → `prisma.batch.create()` → **PostgreSQL** INSERT
5. Side effect → `sendToQueue()` → **AWS SQS** sends processing message
6. Respond → return created batch with 201

**Response:**
- 201: `{ id, name, type, status, createdAt }`
- 400: `{ error: "Validation failed", details: [...] }`
- 401: `{ error: "Unauthorized" }`
- 403: `{ error: "Forbidden" }`

**Flow diagram:**
```
Browser (fetch POST)
  → Next.js Route Handler (src/app/api/v1/batches/route.ts)
    → better-auth session check
    → Zod validation
    → Prisma ORM
      → [PostgreSQL] INSERT INTO batches
    → SQS client
      → [AWS SQS] SendMessage to processing queue
  ← 201 JSON response
← UI updates with new batch
```
```

### Server Action Flow

```markdown
### Server Action: `submitBatch(batchId)`

**Trigger:** Called from `SubmitButton` component via form action or onClick
**Input:** `batchId: string`
**Output:** `ActionResponse<{ batch: Batch }>` — `{ data }` or `{ error }`

**Flow:**
1. Client component calls `submitBatch(id)` — crosses network boundary
2. `'use server'` — executes on the server process, not the browser
3. `auth.api.getSession()` → validates session cookie
4. `makeAuthorizationChecker()` → checks SUBMIT permission on this batch
5. `prisma.batch.findUnique()` → **PostgreSQL** SELECT — verifies batch is DRAFT
6. `prisma.batch.update({ status: 'SUBMITTED' })` → **PostgreSQL** UPDATE
7. `sendToQueue(batch)` → **AWS SQS** — triggers async processing pipeline
8. Returns `{ data: { batch } }` to client component
9. Client re-renders with updated batch status

**Infra calls and when they happen:**
| Step | Service | Operation | Trigger condition |
|------|---------|-----------|-------------------|
| 3 | better-auth | Session lookup | Every call (authentication) |
| 5 | PostgreSQL | SELECT batch | After auth passes |
| 6 | PostgreSQL | UPDATE status | Only if batch is DRAFT |
| 7 | AWS SQS | SendMessage | Only after successful UPDATE |

**Error scenarios:**
- No session → returns `{ error: { message: "Unauthorized" } }`
- No permission → returns `{ error: { message: "Forbidden" } }`
- Batch not DRAFT → returns `{ error: { message: "Batch already submitted" } }`
- DB failure → caught by try/catch, logged via `logError()`, returns generic error
```

---

## Infrastructure & Cloud Service Documentation

Whenever a file interacts with an external service, document:

```markdown
### Infrastructure Call: `uploadToS3(file, key)`

**Service:** AWS S3
**SDK:** `@aws-sdk/client-s3` → `S3Client` + `PutObjectCommand`
**When called:** User uploads a file via the batch item form
**How called:**
  - Client: form submission → server action `uploadFile()`
  - Server: validates file type/size → generates S3 key → calls `s3Client.send()`
**Configuration:** Bucket name from `process.env.S3_BUCKET`, region from `AWS_REGION`
**What flows in:** File buffer + content type + generated key path
**What flows out:** S3 URL (constructed from bucket + key)
**Error handling:** Wrapped in try/catch → logs error → returns `{ error }` to client
```

Document these services whenever they appear:

| Service | Look for | What to document |
|---------|----------|------------------|
| PostgreSQL | `prisma.*` calls | Which model, which operation (SELECT/INSERT/UPDATE/DELETE), what data |
| AWS S3 | `s3Client`, `PutObjectCommand`, `GetObjectCommand` | Upload/download, bucket, key pattern, when triggered |
| AWS SQS | `sqsClient`, `SendMessageCommand` | Queue name, message shape, what triggers the send |
| External HTTP | `fetch()` to external URLs | URL pattern, method, request/response shape |
| better-auth | `auth.api.*` | Which auth operation, what it returns, session shape |

---

## Design Patterns to Detect and Explain

### TypeScript Patterns
| Pattern | What to look for | Why it matters |
|---------|-----------------|----------------|
| Discriminated Unions | `type Result = { ok: true; data: T } \| { ok: false; error: E }` | Type-safe branching without runtime checks |
| Type Guards | `function isX(val): val is X` | Narrows types so TS trusts your logic |
| Generics | `function fetch<T>(url): Promise<T>` | One function works with any type safely |
| Zod Schema Inference | `z.infer<typeof Schema>` | Single source of truth for runtime + compile-time types |
| Utility Types | `Partial<T>`, `Pick<T, K>`, `Omit<T, K>` | Transform types without rewriting them |
| Const Assertions | `as const` | Locks values to their literal types |
| Branded Types | `type Id = string & { __brand: 'Id' }` | Prevents mixing up IDs that are all strings |

### React Patterns
| Pattern | What to look for | Why it matters |
|---------|-----------------|----------------|
| Custom Hooks | `function useX()` | Reusable stateful logic extracted from components |
| Provider Pattern | Context + `useX()` hook | Dependency injection without prop drilling |
| Compound Components | Related components sharing implicit state | Flexible API for complex UI (like Radix) |
| Controlled Components | State owned by parent, passed via props | Predictable form behavior |
| Composition | Small components assembled via children/slots | Flexible, testable, reusable UI |
| Optimistic Updates | Update UI before server confirms | Feels instant to the user |
| Memoization | `useMemo`, `useCallback`, `React.memo` | Avoids expensive re-renders |
| Ref Forwarding | `forwardRef` | Lets parent access child's DOM node |
| Error Boundaries | Class component with `getDerivedStateFromError` | Catches render crashes gracefully |

### Next.js App Router Patterns
| Pattern | What to look for | Why it matters |
|---------|-----------------|----------------|
| Server Components | No `'use client'`, no hooks, no browser APIs | Zero JS shipped to client, fast initial load |
| Client Components | `'use client'` at top | Interactive, stateful, has access to browser |
| Server Actions | `'use server'` functions | Server-side mutations callable directly from client |
| Route Handlers | `route.ts` with `GET`/`POST`/etc exports | API endpoints within App Router |
| Layout Nesting | `layout.tsx` wrapping child routes | Persistent UI across navigation |
| Loading Convention | `loading.tsx` | Automatic Suspense boundary per route segment |
| Error Convention | `error.tsx` | Automatic error boundary per route segment |
| Middleware | `middleware.ts` at project root | Request interception (auth, redirects, headers) |
| Streaming | `<Suspense>` wrapping async server components | Progressive rendering — show what's ready |
| Metadata API | `export const metadata` or `generateMetadata()` | Per-route SEO and head management |

### Architectural Patterns
| Pattern | What to look for | Why it matters |
|---------|-----------------|----------------|
| Repository | Functions in `lib/db.ts` abstracting Prisma | Swap DB without touching business logic |
| Singleton | Single `prisma` or `auth` instance exported | One connection pool, not one per request |
| Adapter | Wrappers around S3/SQS SDK calls | Consistent interface; easy to mock/swap |
| Middleware/Pipeline | Chained checks (auth → authz → validate → execute) | Each step has one job; easy to reorder |
| Factory | Functions returning configured objects | Encapsulate complex creation logic |
| Strategy | Behavior varies by parameter/config | Same interface, different implementations |

## Important Scenarios to Cover

For each file, identify and explain the scenarios that matter:

- **Happy path** — normal successful flow from trigger to result
- **Error propagation** — where errors are caught, how they travel back to the UI
- **Edge cases** — empty arrays, null values, missing env vars, expired sessions
- **State transitions** — DRAFT → SUBMITTED → APPROVED (explain the state machine)
- **Permission gates** — who can call this, what roles/groups are checked
- **Async behavior** — loading states, what happens during the await, cleanup on unmount
- **Infra failure** — what if S3 is down? What if SQS rejects? What if DB times out?

## Output Format

### Module walkthrough

```markdown
# Code Explanation: [directory or feature area]

## Overview
[2-3 sentences: what this area of the codebase does, in plain language]

## Tech & Services Involved
| Layer | Technology | Role |
|-------|-----------|------|
| Frontend | React 19 + Next.js 15 | UI rendering, routing, server components |
| State | Zustand | Client-side state management |
| Validation | Zod | Runtime type checking |
| Database | Prisma + PostgreSQL | Data persistence |
| Storage | AWS S3 | File uploads |
| Queue | AWS SQS | Async processing |
| Auth | better-auth | Session management |

## File Map
[Simple tree showing which files exist and their one-line role]

---

## `src/path/to/file.ts`

**Role:** ...
**Called by:** ...
**Calls into:** ...
**Infra/services touched:** ...

### `functionName(params)` → returnType
[explanation]

### Patterns Used
- **Pattern Name:** one-line explanation of why it's used here

---

[...repeat for each file...]

---

## Full Data Flow Diagram

```
User clicks "Submit Batch"
  → SubmitButton (client component, src/app/.../components/SubmitButton.tsx)
    → submitBatch(batchId) — server action (src/app/.../actions.ts)
      → [better-auth] session validation
      → [PostgreSQL] SELECT batch WHERE id = ?
      → [PostgreSQL] UPDATE batch SET status = 'SUBMITTED'
      → [AWS SQS] SendMessage { batchId, action: 'process' }
    ← { data: { batch: { ...updatedBatch } } }
  ← Re-render with new status badge showing "SUBMITTED"

Meanwhile, async:
  [AWS SQS] → Processing Worker (separate service)
    → [PostgreSQL] UPDATE batch SET status = 'PROCESSING'
    → validate each batch item
    → [PostgreSQL] UPDATE batch SET status = 'APPROVED' or 'REJECTED'
```

## Key Patterns Summary

| Pattern | Where Used | Why |
|---------|-----------|-----|
| Server Action | `actions.ts` | Secure server-side mutations callable from client |
| Discriminated Union | `ActionResponse<T>` | Type-safe success/error without exceptions |
| Singleton | `src/lib/prisma.ts` | One DB connection pool for the whole app |
| Adapter | `src/lib/s3.ts`, `src/lib/sqs.ts` | Wrap AWS SDK behind simple functions |
| ... | ... | ... |

## Concepts You Learned
[Bulleted list of every concept explained, with one-line definition — becomes a reference card]
```

## Tone & Style

## Tone & Style

- **Friendly, encouraging, zero condescension** — "we" language, like a senior sitting next to you
- **Skip the obvious** — don't explain what `const x = 5` does
- **Explain the non-obvious** — why this pattern? why server vs client? why does this call SQS here?
- **Name every external service call** — never skip an infra interaction, these are critical for understanding the system
- **Use analogies** — "Think of SQS like a to-do list for a background worker — we drop a note saying 'process this batch', and a separate service picks it up later"
- **Show the full journey** — from user action → through the code → to the database/service → back to the UI
- **Keep it scannable** — headers, bullet points, tables, code blocks. No walls of text.

---

## What NOT to Do

- Don't review or critique the code
- Don't suggest improvements (unless asked)
- Don't explain import statements, simple variable declarations, or trivial types
- Don't explain test files
- Don't use jargon without defining it on first use
- Don't be condescending ("as you probably know" / "this is simple")
- Don't explain node_modules or third-party library internals (just say what the library does)
- Don't skip infrastructure calls — every DB query, S3 operation, SQS message, and auth check must appear in the flow
- Don't use subagents or workflows — this skill requires sequential understanding across files
- In commit teach-in, don't skip Change Context fields — every changed source file needs Why / What / Blast radius / If left out
- Don't invent blast-radius callers or breakage modes not evidenced by the diff or reference search
