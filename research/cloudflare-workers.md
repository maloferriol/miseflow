# Research: Cloudflare Workers and Durable Objects, and could they run MiseFlow's server?

21 Oct 2026 · answers [#75](https://github.com/maloferriol/miseflow/issues/75), part of [map #72](https://github.com/maloferriol/miseflow/issues/72). Feeds the fit/no-fit verdict on [#77](https://github.com/maloferriol/miseflow/issues/77).

Method: read Cloudflare's developer docs, plus hono.dev, Supabase, Zero, Electric, PowerSync, PartyKit and LiveStore docs, on 21 Oct 2026. Every fact is from a primary source listed at the end unless marked. **(inference)** marks my own reasoning. **(unverified)** marks something I could not confirm in a primary source. Prices and limits change often; they are as of 21 Oct 2026.

Nothing here changes ADRs 0005–0008. It is understanding and assessment only.

## Short answer

- **MVP server: yes, it would fit, with three adjustments.** Hono runs on Workers natively. Drizzle reaches Supabase through **Hyperdrive** with the `pg` driver. Hono's `jwk()` middleware checks Supabase tokens unchanged. The adjustments: turn off Hyperdrive's query cache (it does not invalidate on writes, which breaks "mutate then re-read"); read config from `c.env` rather than `process.env` habits; and check that Hyperdrive can reach Supabase's IPv6-only direct connection, or pay for the IPv4 add-on **(unverified)**.
- **Scheduler: the TypeScript greedy fits easily.** The CP-SAT WASM (7.3 MB) fits under the 64 MiB bundle limit, but runs **single-threaded** and needs the paid plan's CPU budget. Free plan's 10 ms CPU per request is too small for any real Plan.
- **Phase 2 LLM route: fits.** No wall-time limit while the client is connected, waiting on the model costs no CPU, and streaming is supported.
- **Laptop first: partly.** `wrangler dev` runs the real runtime (`workerd`) locally, but you'd be writing for the Workers runtime, not Node. Hono itself stays portable.
- **Phase 4 sync: Durable Objects don't host Zero, Electric or PowerSync.** All three are long-running Docker services with a disk and a Postgres replication connection. Durable Objects can hold WebSockets cheaply and power DO-native sync (PartyServer, LiveStore, Agents SDK state), but those keep data in the object's SQLite, not in Postgres. **Cloudflare Containers** (GA since 13 Apr 2026) could run the sync engines' Docker images, though they sleep by default and a sync server must not.

## How Workers work

**Isolates, not containers.** A Worker is a JavaScript (or WASM) program run by Cloudflare's runtime, `workerd`, which is built on V8, the engine in Chrome and Node. Instead of starting a process or container per app, one runtime process hosts thousands of **isolates**: lightweight sandboxes with their own memory. Cloudflare says an isolate starts about a hundred times faster than a Node process in a container, with an order of magnitude less memory, which is why there are effectively no cold starts in the VM sense.

**Request lifecycle.** A request reaches the nearest Cloudflare data centre. The runtime calls your exported `fetch(request, env, ctx)` handler. You return a `Response`. One isolate can serve several requests at once on one event loop, interleaving at `await`s. Isolates can be evicted at any time and requests may land on different ones, so global variables are a cache at best, never state. `ctx.waitUntil()` lets work continue up to 30 s after the response is sent.

**Bindings, not environment.** Resources (secrets, Hyperdrive, Durable Objects, KV, R2, static assets) are handed to the Worker as **bindings** on `env`, declared in `wrangler.jsonc`. In Hono they're `c.env`.

**Not Node, but close.** The runtime implements web-standard APIs (`fetch`, `Request`, Web Crypto, streams) first. The `nodejs_compat` flag adds Node built-ins: `crypto`, `fs`, `http`, `https` and `net` are listed as fully supported; `tls`, `dns`, `os` and others partially. Missing pieces are stubbed through `unenv` and throw "not implemented" when called. Since compatibility date **2026-08-04**, `nodejs_compat` is on by default. With it, `process.env` is populated from text bindings and secrets (compat date 2025-04-01 or later). Threads and the Web Worker API don't exist: each Worker is single-threaded.

**Outbound TCP.** `connect()` from `cloudflare:sockets` opens raw TCP (this is how Postgres drivers work). Sockets can't reach localhost, private IPs, Cloudflare's own ranges or port 25, and can't be created in global scope or shared across requests.

**Placement.** By default a Worker runs near the user. **Smart Placement**, or a placement hint such as `region = "aws:eu-west-1"`, runs it near the database instead. Cloudflare's example: per-query latency drops from 20–30 ms to 1–3 ms when a Worker makes many sequential queries.

### Limits (Free vs Paid)

| | Free | Paid ($5/month minimum) |
|---|---|---|
| Requests | 100,000/day | 10 M/month included, then $0.30/M |
| CPU time per HTTP request | **10 ms** | 30 s default, up to **5 min** |
| CPU included | n/a | 30 M CPU-ms/month, then $0.02/M CPU-ms |
| Memory per isolate | 128 MB | 128 MB |
| Bundle size (uncompressed) | 64 MiB | 64 MiB |
| Startup (global scope) time | 1 s | 1 s |
| Subrequests per request | 50 | 10,000 |
| Wall time, HTTP request | no hard limit while client is connected | same |
| Wall time, cron / queue / DO alarm | 15 min | 15 min |

CPU time counts only time the JavaScript is running, not time spent waiting on the network or database. Duration is not billed on Workers.

## How Durable Objects work

A **Durable Object** (DO) is a Worker class with an identity and its own storage. You ask for an object by name (`env.ROOMS.getByName("menu-42")`) or ID, and Cloudflare guarantees that **exactly one instance** of that object exists in the world. Every request for that name is routed to it, created on first use and placed near whoever first asked (a location hint can override that). You call it over RPC (`stub.someMethod()`) or `fetch`.

- **Single-threaded.** An object runs one piece of work at a time, like a browser tab. **Input and output gates** stop other events from interleaving while storage operations are in flight, so most read-modify-write races disappear without locks. Consecutive writes with no `await` between them are coalesced and committed atomically.
- **SQLite storage.** New objects use a private, embedded SQLite database (`ctx.storage.sql.exec(...)`, `transactionSync`), with 30-day point-in-time recovery. The older key-value backend is Paid-only and legacy. Limits: 10 GB per object (the docs' FAQ also says 1 GB on Free; the pages disagree), 5 GB per account on Free, unlimited on Paid.
- **Alarms.** Each object can set one alarm (`setAlarm(ms)`) to wake itself later. At-least-once, retried with backoff up to 6 times. Good for "do this at 18:30" or periodic work.
- **Lifecycle and hibernation.** An object stays in memory while busy and a few seconds after, then is evicted; in-memory state is lost, storage stays.
- **WebSocket hibernation.** With `ctx.acceptWebSocket(ws)`, the object can be evicted from memory **while clients stay connected**. A message re-creates the object and calls `webSocketMessage()`. Per-socket data survives through `serializeAttachment()` (16 KB max). Pings are auto-answered without waking it. **No duration is billed while hibernated**, which is what makes "one object per room with a socket per client" cheap. Deploying new code disconnects every socket. Outbound sockets (including TCP to a database) do *not* hibernate and pin the object in memory up to 15 min.
- **CPU:** 30 s per request or WebSocket message by default, up to 5 min. Soft limit about 1,000 requests/s per object.

### Durable Objects pricing

DOs are available on **both** Free and Paid; Free objects must use SQLite.

| | Free | Paid |
|---|---|---|
| Requests | 100,000/day | 1 M/month, then $0.15/M |
| Duration | 13,000 GB-s/day | 400,000 GB-s/month, then $12.50/M GB-s |
| SQLite rows read | 5 M/day | 25 B/month, then $0.001/M |
| SQLite rows written | 100,000/day | 50 M/month, then $1.00/M |
| Stored data | 5 GB total | 5 GB-month, then $0.20/GB-month |

Duration is billed on wall clock while the object is in memory (active, or idle but unable to hibernate).

**For one user, all of this is within the free allowances** **(inference)**.

## Could Workers run MiseFlow's server?

### Hono on Workers

Hono was built for this: `npm create hono@latest` has a `cloudflare-workers` template, the app is `export default app`, and bindings are typed with `new Hono<{ Bindings: ... }>()` or generated by `wrangler types`. Watch-outs from the Hono docs: read config from `c.env` (or `import { env } from "cloudflare:workers"`), and middleware that needs a binding must read it inside the handler, not at setup. The same Worker can serve the React SPA's built files through **Static Assets** (`not_found_handling = "single-page-application"`, with `run_worker_first = ["/api/*"]`), so one deploy covers SPA and API.

The typed RPC client, `/mutate` and the shared mutators package are plain TypeScript and don't care about the host **(inference)**. Code that leans on Node-only APIs would need `nodejs_compat` or rewriting; Hono's own code doesn't.

### Drizzle to Supabase Postgres

Two routes:

1. **Hyperdrive (recommended by Cloudflare).** A connection pooler run by Cloudflare, placed near the database. The Worker opens a `pg` client per request against `env.HYPERDRIVE.connectionString`, wraps it with `drizzle(client)` from `drizzle-orm/node-postgres`, and Hyperdrive reuses warm connections to Postgres. Cloudflare's Drizzle guide uses `pg` and says Drizzle with Postgres.js over Hyperdrive is "not currently supported". The Supabase guide says to give Hyperdrive Supabase's **direct connection** string, not the pooler, because Hyperdrive pools; it wants `pg` 8.16.3+. `drizzle-kit` migrations still use a direct `DATABASE_URL` from the laptop, unchanged from ADR 0006.
   - **Pooling is transaction mode.** A client holds a real connection for one transaction, so `/mutate`'s one-transaction-per-mutation fits. `SET` doesn't survive across transactions. Unsupported: SQL-level `PREPARE`/`EXECUTE`, advisory locks, `LISTEN`/`NOTIFY`.
   - **Query caching is on by default and does not invalidate on writes.** Hyperdrive caches read results for `max_age` and the docs say it "does not invalidate cached read query results when your application writes to your database". MiseFlow's browser posts a mutation and then re-reads (ADR 0007). With caching on, that re-read could return the old rows. **Caching must be turned off for MiseFlow's config** **(inference from the docs)**.
   - **Limits:** about 20 origin connections per config on Free, 100 on Paid; 60 s max statement; idle timeout 10 min. Free plan: 100,000 queries/day. Plenty for one user.
   - **IPv6.** Supabase's direct connection is IPv6-only unless you buy the IPv4 add-on (with Pro, ≈ $29/month, per ADR 0006). Cloudflare says to use the direct connection but I found no statement that Hyperdrive reaches IPv6-only origins **(unverified; test before relying on it)**. If it can't, the fallback is the IPv4 add-on, or pointing Hyperdrive at Supabase's shared pooler (IPv4) against Cloudflare's advice: two poolers in series **(inference)**.
2. **Direct TCP without Hyperdrive.** `pg` over `connect()` works in principle, but each request pays a full TCP + TLS + Postgres handshake to the database region, and nothing pools across requests. Cloudflare steers Postgres users to Hyperdrive. Not worth it **(inference)**.

### Verifying Supabase Auth JWTs

Unchanged from ADR 0008. Hono's `jwk()` middleware takes `jwks_uri` (Supabase's `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`), requires a `kid`, rejects HS256, and checks `exp`/`nbf`/`iat` (plus `iss`/`aud` if set). Verification uses Web Crypto, which Workers has natively **(inference: Hono's JWT helpers are built on Web Crypto; the jwk page doesn't say)**. Supabase caches its JWKS for about 10 minutes and asks apps not to cache longer than that. Because Worker globals don't persist reliably, an in-memory key cache may refetch more often than on Node; Hono's `verifyWithJwks` example passes Cloudflare `cf` cache options to the JWKS fetch, which would let Cloudflare's edge cache it. One extra fetch per cold isolate is fine for one user **(inference)**.

### The scheduler

- **TypeScript greedy:** tens of KB, plain TS, no Node APIs. Runs anywhere. On Free, the **10 ms CPU** cap per request is the risk: a Plan for a big menu with repair passes could exceed it **(inference; not measured)**. On Paid (30 s default) it's a non-issue. Since the scheduler also runs in the browser, the server rarely needs to run it in the MVP **(inference from ADR 0005's shared package)**.
- **CP-SAT via `or-tools-wasm` (phase 5):** the runtime `.wasm` is 7.3 MB (11.6 MB asyncify build) per [scheduler-reuse.md](../docs/research/scheduler-reuse.md). That fits under the **64 MiB** bundle limit; the 345 MB npm package does not ship whole. Constraints:
  - **No threads.** Workers are single-threaded, so CP-SAT must run with `numWorkers: 1`, which scheduler-reuse.md already wants for determinism.
  - **Pre-compiled WASM only.** `WebAssembly.instantiate()` accepts only modules bundled at deploy time, not bytes fetched at runtime. Whether `or-tools-wasm`'s loader works with that needs a test **(unverified)**.
  - **Startup:** the global scope must finish in 1 s. Large WASM makes startup slower; instantiate lazily inside the handler **(inference)**.
  - **Memory:** 128 MB per isolate, shared with everything else. Fine for menus of tens of Tasks, unknown for 500 **(unverified)**.
  - **CPU:** up to 5 min on Paid; seconds are fine.
  - If any of these bite, **Cloudflare Containers** can run native OR-Tools or Node with threads (see below).

### Phase 2 LLM import route

Fits. HTTP Workers have **no wall-time limit while the client stays connected**, and time waiting on the LLM provider isn't CPU time. Streaming the model's response back (through a `TransformStream` or Hono's `streamSSE`) keeps the Worker alive and avoids buffering into 128 MB. Outbound subrequests have no fixed timeout. The API key lives as a Worker secret. Caveats: if the browser disconnects, work is cancelled except for 30 s of `waitUntil`; a runtime update gives in-flight streams up to 20 minutes to finish. For one user pressing "import", that's acceptable **(inference)**. If an import had to survive the tab closing, **Workflows** (unlimited step wall time) or a Queue would be the tool.

### Local development vs "runs on my laptop"

`wrangler dev` (or the Cloudflare Vite plugin, `vite dev`) runs your Worker in a local **`workerd`** process through **Miniflare**. That is the same runtime as production, open-sourced. Bindings are simulated locally by default; individual bindings can be pointed at the real cloud resource with `remote: true`. Durable Objects always run locally. Hyperdrive can't be used remotely from local dev; locally you point the binding at a plain Postgres connection string (local Supabase or the direct URL) **(the dev-testing page says remote Hyperdrive is unsupported; the local connection-string setting is from prior knowledge, unverified)**. Testing uses `@cloudflare/vitest-plugin`, which runs tests inside `workerd`.

What changes against ADR 0005's "laptop first" **(inference)**:

- It still runs entirely on the laptop, offline from Cloudflare, but as `workerd`, not `node`. Anything that only works on Node shows up locally, which is good.
- It ties the server to Cloudflare's way of reading config (bindings) and deploying (wrangler). Hono itself stays portable: the same `app` runs on Node via `@hono/node-server`. Keeping the database client and config behind a small adapter keeps the Node path open.
- celld (ticket #74) is relevant here: it runs Workers/DO code off Cloudflare, so writing for the Workers model need not mean being stuck on Cloudflare (see the map's "Not yet specified").

## Phase 4: could Durable Objects serve sync?

**Zero, Electric and PowerSync don't run on Workers or Durable Objects.** Each is a long-running server shipped as a Docker image:

- **Zero's `zero-cache`** keeps a SQLite replica on a disk volume, needs `ZERO_UPSTREAM_DB` to be "a direct connection (not via pgbouncer)" with `wal_level=logical`, and its deploy examples keep one machine always running. Zero's docs say the API behind its query and mutate URLs "can live anywhere zero-cache can reach", so **Hono-on-Workers could be Zero's mutate/query API**, with `zero-cache` hosted elsewhere. Rocicorp's `hello-zero-cf` sample runs the Hono API on Workers and even a zero-client inside a DO, but not `zero-cache` itself.
- **Electric** is an Elixir service that needs a persistent disk, a direct replication connection, and a role with `REPLICATION`. Electric's docs mention Cloudflare only as a CDN or edge proxy in front of it, which is a role a Worker could play (auth plus caching of shape requests).
- **PowerSync** self-hosts as the `journeyapps/powersync-service` Docker image. Its backend write API (the upload queue target) could be a Worker **(inference)**.

Why a DO can't host them **(inference)**: a DO is JavaScript in an isolate with no filesystem, 128 MB memory, no logical replication client, and outbound TCP sockets that don't hibernate; a replication stream would keep the object (and duration billing) awake permanently, and Hyperdrive doesn't carry replication.

**DO-native sync does exist, but it replaces Postgres as the source of truth for synced data:**

- **PartyServer** (successor of PartyKit; hosted PartyKit shuts down 23 Oct 2026) is a thin framework over DOs for rooms and WebSockets.
- **LiveStore's `@livestore/sync-cf`** syncs an event log through a DO per store, kept in DO SQLite (or D1). No Postgres.
- **Cloudflare Agents SDK** state: `setState()` persists to the agent's SQLite and broadcasts to `useAgent` clients over WebSockets.
- TinyBase also has a DO sync integration (third-party guide).

Choosing one of these would mean the phase-4 sync model is "a DO per user (or per Menu) holding the live data", with Postgres as a backup or export target. That's a different architecture from ADR 0006/0007's "Postgres is the database" **(inference)**. A smaller, compatible role for DOs: a per-user DO that holds browser WebSockets and pushes "something changed, refetch" after each `/mutate`, giving live updates without a sync engine **(inference; not what phase 4 planned)**.

### Cloudflare Containers

Containers (GA 13 Apr 2026, Paid plan only) run any Docker image, controlled by a Durable Object class (one DO per container instance). Instance types range from `lite` (1/16 vCPU, 256 MiB) to `standard-4` (4 vCPU, 12 GiB, 20 GB disk). Billing: CPU on active use ($0.000020/vCPU-s after 375 vCPU-min/month), memory and disk on provisioned size while running, **nothing while asleep**. Instances start on demand and sleep after an inactivity timeout you set.

Relevance **(inference)**:

- **Phase 4:** a Container could run `zero-cache`, Electric or PowerSync next to a Hono Worker. Two doubts: a sync server must stay up to keep its replication slot drained, so it would have to be prevented from sleeping (and then billed continuously); and the docs I read don't promise the disk survives restarts **(unverified)**, while Electric and Zero want a persistent volume (Zero can restore from Litestream backups). A conventional always-on host (Fly.io, Railway) fits these better.
- **Phase 5:** native OR-Tools with threads, or `or-tools-wasm` in Node, could run in a Container behind the Worker if the in-Worker WASM limits bite.

## Fit by phase (for #77)

| Phase | Fit | Why |
|---|---|---|
| MVP server (Hono + Drizzle + Supabase Auth) | **Fits**, on Free for one user | Hono native; Drizzle via Hyperdrive + `pg`; `jwk()` unchanged. Turn off Hyperdrive caching; confirm IPv6. Free plan's 10 ms CPU is the main risk if the server ever runs the scheduler. |
| Phase 2 LLM import | **Fits** | No wall-time limit while connected; streaming; waiting isn't CPU. |
| Phase 4 sync engines | **No** for hosting them on Workers/DOs; **maybe** via Containers | They need an always-on process, disk and a replication connection. Workers can still be their API/auth layer. DO-native sync means leaving Postgres as the synced store. |
| Phase 5 CP-SAT | **Probably fits on Paid** (single-thread WASM, 7.3 MB) **(unverified until tested)**; Containers as fallback | 64 MiB bundle, 128 MB memory, 5 min CPU, no threads, pre-compiled WASM only. |

## Open questions

- Does Hyperdrive reach Supabase's IPv6-only direct connection?
- Does `or-tools-wasm` instantiate under Workers' pre-compiled-module rule, and how much memory does a 500-Task solve take?
- Do Cloudflare Containers keep their disk across restarts, and can one be kept always on?
- Local Hyperdrive setting (`localConnectionString` or equivalent): confirm current name.

## Sources

Cloudflare (developers.cloudflare.com):

- How Workers works: /workers/reference/how-workers-works/
- Limits: /workers/platform/limits/
- Pricing: /workers/platform/pricing/
- Node.js compatibility: /workers/runtime-apis/nodejs/ and compatibility flags: /workers/configuration/compatibility-flags/
- TCP sockets: /workers/runtime-apis/tcp-sockets/
- WebAssembly: /workers/runtime-apis/webassembly/
- Smart Placement: /workers/configuration/smart-placement/
- Static Assets: /workers/static-assets/
- Development and testing: /workers/development-testing/
- RPC: /workers/runtime-apis/bindings/service-bindings/rpc/
- What are Durable Objects: /durable-objects/concepts/what-are-durable-objects/
- Durable Objects limits: /durable-objects/platform/limits/
- WebSocket hibernation: /durable-objects/best-practices/websockets/
- SQLite storage API: /durable-objects/api/sqlite-storage-api/
- Alarms: /durable-objects/api/alarms/
- Hyperdrive overview: /hyperdrive/ ; how it works: /hyperdrive/concepts/how-hyperdrive-works/ ; limits: /hyperdrive/platform/limits/ ; supported features: /hyperdrive/reference/supported-databases-and-features/
- Hyperdrive + Drizzle: /hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/
- Hyperdrive + Supabase: /hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/
- Containers: /containers/ ; limits: /containers/platform-details/limits/ ; pricing: /containers/pricing/
- Containers GA changelog (13 Apr 2026): /changelog/post/2026-04-13-containers-sandbox-ga/
- Agents SDK state: /agents/api-reference/store-and-sync-state/

Others:

- Hono on Cloudflare Workers: https://hono.dev/docs/getting-started/cloudflare-workers
- Hono JWK middleware: https://hono.dev/docs/middleware/builtin/jwk
- Supabase JWTs and JWKS: https://supabase.com/docs/guides/auth/jwts
- Supabase IPv4/IPv6 compatibility: https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP
- Zero deployment: https://zero.rocicorp.dev/docs/deployment ; Cloudflare sample: https://github.com/rocicorp/hello-zero-cf
- Electric deployment: https://electric.ax/docs/guides/deployment
- PowerSync self-hosting: https://docs.powersync.com/self-hosting/getting-started
- PartyKit (shutdown notice): https://docs.partykit.io/
- LiveStore Cloudflare sync provider: https://docs.livestore.dev/reference/syncing/sync-provider/cloudflare/
- Scheduler sizes: [docs/research/scheduler-reuse.md](../docs/research/scheduler-reuse.md)
