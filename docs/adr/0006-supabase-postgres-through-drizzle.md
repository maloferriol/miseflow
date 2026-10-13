# Supabase Postgres, used only as Postgres, through Drizzle

The database is **Postgres 17 on Supabase**. Only the Hono server reaches it, through **Drizzle**, and **drizzle-kit is the only migration tool**. The browser never uses Supabase's data API (supabase-js, PostgREST), Edge Functions, Storage or Realtime. Whether to use Supabase Auth is decided separately. Supabase keeps phase 4 open: logical replication is on, the `postgres` role can create publications, replication slots and event triggers, and Electric and PowerSync have official Supabase guides. Drizzle writes its schema in TypeScript and its queries in SQL's shape, and Zero can generate its schema from it. Decided on [#57](https://github.com/maloferriol/miseflow/issues/57); facts checked on 2026-10-13.

## Considered Options

- **Another Postgres host (Neon, RDS).** Equally valid. The owner wanted to try Supabase.
- **Prisma or Kysely.** Prisma's engine and generated client are heavier and less SQL-shaped. Kysely has no schema or migrations of its own.

## Consequences

- Every table has a single `id uuid` primary key made in the browser and an owner column (the signed-in user's id). Team sharing is permanently out of scope, but the owner column is cheap and the sign-in check needs it.
- Supabase's CLI migrations aren't used, because two migration trackers on one database would disagree about what has been applied.
- Phase 4 needs the **direct connection** for replication, because Supabase's pooler can't carry it. The direct connection is IPv6-only unless you buy the IPv4 add-on, which needs Pro (≈ $29/month together).
- **Zero on Supabase works with caveats:** it doesn't survive Supabase's high-availability failover, and `ALTER PUBLICATION` needs a manual schema-change hook.
- The free tier (500 MB, paused after 7 days without activity) suits the MVP.
