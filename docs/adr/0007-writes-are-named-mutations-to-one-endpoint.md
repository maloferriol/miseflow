# Writes are named mutations to one endpoint

Every write is one **named mutation**, `{id, name, args}` (`pinTask`, `tickStep`, `editRecipe`), sent to a single idempotent `POST /mutate` on the Hono server. The server runs the matching mutator from the shared TypeScript package inside one database transaction, and a retried `id` is applied only once. Reads are separate, through Hono's typed RPC behind a thin data-access layer in the browser. A domain action touches several rows and must apply whole or not at all, and the same mutators can run optimistically in the browser for live re-plan. The shape also matches what every phase-4 sync engine expects for writes: Zero's custom mutators, TanStack DB's mutation functions, and the write-your-own-API model of Electric and PowerSync. Decided on [#57](https://github.com/maloferriol/miseflow/issues/57), following the sync research on [#55](https://github.com/maloferriol/miseflow/issues/55).

## Considered Options

- **Resource-style REST writes (`PATCH /tasks/:id`).** Familiar, but a domain action spreads across several requests with no shared transaction, and the sync engines replace this layer anyway.
- **Writing straight to tables from the browser (Supabase data API with row-level security).** It skips the server, but mutations aren't atomic and the domain rules would end up in SQL.

## Consequences

- In the browser, TanStack Query's `useMutation` posts to `/mutate` and then invalidates what changed. A drag updates the cache first, so the re-planned Gantt chart shows at once.
- PowerSync's upload queue works in row changes, not named mutations. If it's chosen in phase 4, mutators must also produce row changes.
