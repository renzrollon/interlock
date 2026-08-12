# Mini App Architecture

Overview of the sample authentication stack used in interlock-graph tests.

## Authentication

Session handling lives in `lib/session.ts`. It imports `normalizeEmail` from
`lib/auth.ts` and uses it when building cache keys.

The `AuthService` class in `lib/auth.ts` validates credentials and issues tokens.

## Deployment

Northflank builds run on every push. Unrelated to auth — should not rank for auth queries.
