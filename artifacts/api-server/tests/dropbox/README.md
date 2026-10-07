# Isolated Dropbox OAuth integration tests

Run `pnpm --filter @workspace/api-server run test:dropbox` (also included in `test`).

The runner bundles the actual OAuth service, security helpers, connection state,
Express router and generated request schemas. Only the database/Drizzle boundary
and Clerk identity lookup are replaced. Requests traverse a local Express server,
while every provider request uses a strict mock that rejects unexpected URLs.
The child test process receives a fixed test-only encryption secret and no
workspace credentials or database URL.

Each test loads a fresh module instance with its own in-memory settings store.
The store models atomic delete/returning, upsert and transaction rollback. It is
not a PostgreSQL emulator: these tests check application behavior, not PostgreSQL
locking or Drizzle SQL generation. The restart test transfers only encrypted
test records to a separate Node process, which must obtain a new access token.

Clerk identity is synthetic; production parent-router authentication and real
Dropbox consent are not exercised. No saved Dropbox connection is read or changed.
