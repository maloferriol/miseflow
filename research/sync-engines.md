# What do sync engines need from the MVP's database and API?

Research for [#55](https://github.com/maloferriol/miseflow/issues/55) (map [#53](https://github.com/maloferriol/miseflow/issues/53)). Checked against primary sources on 2026-10-13. Phase 4 picks the engine; this note only asks which MVP choices keep the options open.

## Answer in brief

- **Database: Postgres 15 or newer (pick 17), on a host that allows `wal_level = logical`, a direct (unpooled) replication connection, and ideally event triggers.** That one choice keeps Zero, PowerSync and Electric open, and costs the MVP nothing. Any other database rules out Zero and Electric outright.
- **Ids: one `id uuid` primary key on every table, made in the browser.** No serials. No composite primary keys, including on join tables (PowerSync can't sync them without a concatenated id).
- **API: writes as named mutations (`{id, name, args}` sent to a single mutate endpoint), with mutation logic in shared TypeScript that could also run on the client.** This is the shape Zero, Replicache, TanStack DB's offline transactions and a home-made queue all expect. Electric and PowerSync take any write API, so it suits them too.
- **Reads: keep them behind a thin data-access module.** In every option the sync engine *replaces* the read path (ZQL, local SQLite, shapes). A GraphQL client cache spread through the components would be the most expensive thing to rip out. GraphQL as such isn't required by any engine.
- **Auth: a session that can also mint a JWT checked against a JWKS endpoint, and an `account_id` (owner) on each root row.** PowerSync and Triplit need JWTs; Zero and Electric accept anything your API checks. Per-account partitioning is how all of them filter sync, and how teams can be added later.
- **Drop from the list:** InstantDB (sunsetting, cloud shuts down 2027-08-31), Triplit (inactive since its founder joined Supabase, AGPL, its own storage, not Postgres) and Replicache (maintenance mode; its successor is Zero). Automerge and Yjs are document CRDTs: possibly useful later for free-text recipe editing, not for the relational Plan.
- **The conventions all fit.** Soft deletes and versions are *required* only by Replicache-style pull and a home-made queue. WAL-based engines (Zero, PowerSync, Electric) capture hard deletes themselves, so for them soft deletes are harmless but optional.

## Per candidate

### Zero (Rocicorp)

- **Database:** Postgres only: "Today only Postgres is supported." Needs Postgres 15.0 or newer, `wal_level = logical`, and event triggers if available. Without them "any schema change triggers a full reset of all server-side and client-side state". Heroku lacks event triggers. Supabase, Fly and Render are only partly supported, and Render HA must stay off. Fully supported hosts: RDS, Aurora 15.6+, PlanetScale, Neon, Cloud SQL, Docker. ([Connecting to Postgres](https://zero.rocicorp.dev/docs/connecting-to-postgres))
- **Schema:** each synced table needs a primary key or a unique index. Views aren't synced. Unsupported column types are dropped with a warning. Arrays sync but can't be filtered or joined on. ([Postgres support](https://zero.rocicorp.dev/docs/postgres-support))
- **API:** named mutators written in TypeScript with `defineMutator`. They run optimistically on the client, then on your server through a mutate endpoint (`ZERO_MUTATE_URL`, `handleMutateRequest`) in a database transaction. Reads are named queries (`defineQuery`) that your server resolves through `ZERO_QUERY_URL`, which is where read permissions are enforced through `ctx`. ([Mutators](https://zero.rocicorp.dev/docs/mutators), [Queries](https://zero.rocicorp.dev/docs/queries))
- **Ids:** the docs recommend client-made ids (`crypto.randomUUID()`, uuid, ulid, nanoid). ([Mutators](https://zero.rocicorp.dev/docs/mutators))
- **Auth:** cookie or token. Your endpoints authenticate and pass a `ctx`; a 401/403 puts the client into a needs-auth state. ([Mutators](https://zero.rocicorp.dev/docs/mutators))
- **Hosting:** you self-host `zero-cache` (Docker, Fly, SST/AWS, Kubernetes). It needs a direct upstream connection, a CVR database, a change database and a SQLite replica on persistent disk. The deployment docs mention no managed offering. ([Deployment](https://zero.rocicorp.dev/docs/deployment))
- **Licence and maturity:** Apache-2.0. 1.0 shipped 2026-03-24 and 1.10.0 on 2026-10-09 (npm `@rocicorp/zero`). One thing to watch: on 2026-09-30 the tests for zero-cache and zql were removed from the public repo and its history was rewritten; the code is still Apache-2.0. ([rocicorp/mono README](https://github.com/rocicorp/mono))
- **Conventions:** all fit closely. Named mutations map one to one onto mutators, and the pure TS scheduler can be called inside a mutator on both sides.

### Replicache

- In **maintenance mode**: "Existing users should migrate to Zero as they are able." It's free and its code is open. ([replicache.dev](https://replicache.dev/))
- **Database:** none prescribed. You write a push endpoint that applies named mutations in order and tracks `lastMutationID` per client, and a pull endpoint that returns a patch since a cookie. ([How it works](https://doc.replicache.dev/concepts/how-it-works))
- **Schema:** the Global Version strategy needs `lastModifiedVersion` and a `deleted` (soft delete) flag on every entity, plus client and client-group tables. ([Global version](https://doc.replicache.dev/strategies/global-version), [Strategies](https://doc.replicache.dev/strategies/overview))
- Worth reading even though it's not a candidate: it's the reference design for the home-made option below, and it explains why the map's version and soft-delete conventions exist.

### PowerSync

- **Database:** Postgres 11+ with logical replication, a role with REPLICATION, and a publication named `powersync`. MongoDB 6+, MySQL 5.7+ (beta) and SQL Server 2019+ (beta, CDC) are also supported. ([Source database setup](https://docs.powersync.com/configuration/source-db/setup)) The service stores its buckets in MongoDB or Postgres ([service modules](https://github.com/powersync-ja/powersync-service)).
- **Ids:** "a single text-type primary key column named `id`" on every table. UUIDs made on the client are recommended. Composite keys aren't supported (you concatenate them into an `id` in the sync query). Uniqueness isn't checked. ([Client ID](https://docs.powersync.com/usage/sync-rules/client-id))
- **API:** reads go to a local SQLite database through Sync Streams (YAML plus SQL-like queries, for example `WHERE owner_id = auth.user_id()`) ([Sync Streams](https://docs.powersync.com/usage/sync-streams)). Writes go into a local CRUD queue of `PUT/PATCH/DELETE` row operations, which your `uploadData()` sends to *your own* API in any style (REST, GraphQL, gRPC). The API must apply them synchronously, and must return 2xx (not 4xx) for validation errors, because a 4xx blocks the queue. ([Writing client changes](https://docs.powersync.com/installation/app-backend-setup/writing-client-changes))
- **Auth:** JWTs from your backend or a provider, checked against JWKS (Supabase, Auth0, Clerk, Firebase, custom...). ([Authentication](https://docs.powersync.com/installation/authentication-setup))
- **Licence and hosting:** the service is under FSL-1.1-ALv2 (source-available, and each release becomes Apache-2.0 later) ([LICENSE](https://github.com/powersync-ja/powersync-service/blob/main/LICENSE)). Client SDKs are Apache-2.0 (`@powersync/web` 2.4.2). Hosted PowerSync Cloud plans: Free, Pro from $49, Team, Enterprise; or the free self-hosted Open Edition ([pricing](https://www.powersync.com/pricing)). Service v1.27.0 shipped 2026-10-06.
- **Conventions:** UUIDs, events and the scheduler fit. **Named mutations only partly fit.** The queue is row-level, so the mutation's name and intent are lost unless the client also writes them, for example as a row in a `mutations` or progress-event table that the server interprets. (That's our inference, not a documented pattern.) Soft deletes are optional.

### ElectricSQL (+ TanStack DB)

- **Database:** Postgres 14+ with logical replication, a role with `REPLICATION`, and a direct (unpooled) connection. Electric creates its own publication and slot. ([Deployment](https://electric.ax/docs/guides/deployment); electric-sql.com now redirects to electric.ax)
- **API:** **read path only**: "Electric does not do write-path sync". Writes go through your own API, with optimistic state layered on top. ([Writes](https://electric.ax/docs/guides/writes)) TanStack DB collections add `onInsert/onUpdate/onDelete` handlers and `awaitTxId` to match a write to its sync ([TanStack DB overview](https://tanstack.com/db/latest/docs/overview)). TanStack DB offline transactions keep an outbox in IndexedDB, keyed by **named `mutationFns`** with an `idempotencyKey`, with Web Locks leader election across tabs ([Offline transactions](https://tanstack.com/db/latest/docs/guides/offline-transactions)).
- **Auth:** plain HTTP. Your proxy or gatekeeper authorises each shape request and fixes its `WHERE`. ([Auth](https://electric.ax/docs/guides/auth))
- **Licence and hosting:** Apache-2.0. Self-hosted Docker image (Elixir) or Electric Cloud (pay as you go, Pro $249, Scale, Enterprise) ([pricing](https://electric.ax/pricing)). sync-service 1.8.1 shipped 2026-09-07. TanStack DB itself is still 0.x (`@tanstack/db` 0.13.0); `@tanstack/offline-transactions` is at 1.1.0.
- **Conventions:** all fit. Of all the options it needs the least of the MVP: keep the named-mutation API, add shapes for reads.

### InstantDB: rule out

- "Instant is sunsetting. Services will continue until August 31st, 2027." New signups are closed and cloud apps shut down on 2027-08-31 ([instantdb.com](https://www.instantdb.com/), [announcement](https://www.instantdb.com/essays/instant_team_joins_openai)).
- Even before that, it owns the data model: writes are `db.transact` chunks keyed by a UUID per namespace ([InstaML](https://www.instantdb.com/docs/instaml)), and permissions are CEL rules ([Permissions](https://www.instantdb.com/docs/permissions)). Self-hosting runs its JVM server on its own Postgres (`wal_level = logical` plus `pg_hint_plan`) ([server README](https://github.com/instantdb/instant/blob/main/server/README.md)), not on the app's schema. Apache-2.0.

### Triplit: rule out

- Its co-founder joined Supabase in October 2025, and Triplit wasn't folded into Supabase ([Supabase blog](https://supabase.com/blog/triplit-joins-supabase)). The repo's last commit was 2025-09-11 ([aspen-cloud/triplit](https://github.com/aspen-cloud/triplit)); `@triplit/client` 1.0.50 was last published in July 2025.
- The server is its own database (SQLite or LMDB on a volume, `LOCAL_DATABASE_URL`), not Postgres, with JWT auth (`JWT_SECRET`) ([self-hosting docs](https://github.com/aspen-cloud/triplit/blob/main/packages/docs/src/pages/self-hosting/index.mdx)). AGPL-3.0.

### Automerge / Yjs

- **Database:** none. These are CRDT document libraries. Automerge-repo has storage and network adapters, and a server is optional ([Automerge](https://automerge.org/docs/hello/)). Yjs syncs through providers such as y-websocket, Hocuspocus (SQLite) or y-sweet (S3) ([Yjs README](https://github.com/yjs/yjs)). Both are MIT. Automerge is at 3.5.0 and Yjs at 13.6.33.
- **Fit:** "an Automerge document is best suited to being a unit of collaboration between two people or a small group", and syncing many thousands of documents is costly ([Modeling data](https://automerge.org/docs/cookbook/modeling-data/)). There are no relational queries, server-side named mutations or row-level auth. That doesn't suit Tasks, Batches and a Plan that the server needs to query. It could still be used later for collaborative editing of one Recipe's text inside a Postgres-backed app.

### Home-made: GraphQL subscriptions + offline mutation queue

- **Needs:** an outbox in IndexedDB holding `{mutationId, name, args}`; a mutate endpoint that is idempotent per mutation id and tracks the last applied mutation per client; a pull or "changes since version" endpoint; and a poke over a subscription (`graphql-ws` 6.3.0, MIT) or SSE. In other words, Replicache's protocol rebuilt by hand ([How it works](https://doc.replicache.dev/concepts/how-it-works)), which in turn **requires** the version column and soft deletes ([Global version](https://doc.replicache.dev/strategies/global-version)). Postgres isn't required, but any database works only if you write the change tracking yourself.
- **Fit:** the map's conventions are exactly its prerequisites. The cost is building and owning the conflict, rebase and multi-tab logic that the engines already provide. TanStack DB offline transactions cover the client outbox if needed.

## Requirements matrix

| | Postgres | Logical replication | Other DBs | Write API | Ids | Auth | Licence | Status Oct 2026 |
|---|---|---|---|---|---|---|---|---|
| Zero | 15+ only | yes, + event triggers | no | named TS mutators + mutate/query endpoints | any PK; client UUID advised | cookie or token, your endpoints | Apache-2.0 | 1.10, self-host |
| Replicache | any | no | any | push/pull endpoints, named mutators | any | yours | free, open | maintenance mode |
| PowerSync | 11+ | yes | Mongo, MySQL β, MSSQL β | row CRUD queue → your API | single text `id`, no composite | JWT/JWKS | FSL→Apache (service), Apache (SDK) | 1.27, Cloud or self-host |
| Electric | 14+ only | yes | no | your API (+ TanStack DB) | any PK | your proxy | Apache-2.0 | 1.8, Cloud or self-host |
| InstantDB | its own | its own | n/a | `transact` | UUID | CEL rules | Apache-2.0 | sunsetting |
| Triplit | no | n/a | its own SQLite/LMDB | client writes | its own | JWT | AGPL-3.0 | inactive |
| Automerge/Yjs | n/a | n/a | n/a | CRDT changes | doc UUIDs | yours | MIT | active |
| Home-made | any | optional | any | named mutations | client UUID | yours | n/a | you build it |

## Conventions against each candidate

| Convention | Zero | PowerSync | Electric | Home-made / Replicache | Automerge/Yjs |
|---|---|---|---|---|---|
| UUIDs made in the browser | recommended | recommended; column must be `id` | fits | needed | fits (doc ids) |
| One named mutation per write | native | partial (row CRUD); keep names in your API or in an intent row | native via your API / TanStack `mutationFns` | native | n/a |
| Append-only progress events | fits | fits; scope streams per Service | fits; scope shapes per Service | fits | fits naturally |
| Version / `updatedAt` + soft deletes | optional (WAL sees deletes) | optional | optional; a row leaving a shape's `WHERE` is sent as a delete | **required** | n/a |
| Pure TS scheduler | fits; callable inside mutators | fits; runs over local SQLite | fits | fits | fits |

## MVP choices that would close doors

- **A database other than Postgres** closes Zero and Electric.
- **A host without logical replication, or with pooled-only connections** closes Zero, Electric and PowerSync. Heroku's missing event triggers make Zero do full resets on every schema change.
- **Serial ids or composite primary keys** hurt PowerSync and offline creation everywhere.
- **Generic row PATCH endpoints, or business logic that exists only on the server**, cost the most with Zero (whose mutators run on the client too). They suit PowerSync's CRUD queue.
- **A normalised GraphQL client cache throughout the UI** would have to be torn out for any engine, since each one brings its own local store and reactive queries.
- **Synced data in views or Postgres-only types** is a problem: Zero doesn't sync views and drops unsupported types.

## Open points for phase 4

- Whether PowerSync's queue can carry mutation names directly wasn't found in the docs read here; check before relying on it.
- Zero has no managed hosting listed, and its server tests are no longer public. Weigh that against Electric Cloud and PowerSync Cloud when phase 4 comes.
