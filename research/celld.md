# Research: what celld is and how it works

21 Oct 2026 · answers [#74](https://github.com/maloferriol/miseflow/issues/74) "What is celld and how does it work?" for [Map #72](https://github.com/maloferriol/miseflow/issues/72), and feeds #77.

Method: read the celld repo at v0.6.2 (README, `docs/`, `docs/services/`, selected source files, the issue list and releases) and the celld.dev home page on 21 Oct 2026. Cloudflare facts come from the Durable Objects limits page (updated 1 Jun 2026), or are marked **(not re-checked)**. Claims marked **(reasoned)** are my inference, not something a source says or I measured.

## Verdict

**celld is interesting, but it has no job in MiseFlow.** It is a self-hosted runtime for apps written *for Cloudflare Workers and Durable Objects*. MiseFlow's server is a Hono app on Node 24 talking to one Postgres. It has one user and none of the many-small-stateful-servers shape that celld exists for. It could probably run Hono plus Drizzle against Supabase, but that would swap Node for a beta runtime that is two and a half months old and buy nothing. It can't host the phase-4 sync servers, except as experimental containers. Its real relevance to the map: celld is the "exit from lock-in" if MiseFlow ever writes for the Workers model. That makes it a footnote to the Cloudflare question (#75/#77), not a separate option.

## What it is, in one paragraph

celld is an open-source daemon (Rust, with V8 embedded) from Deno Land Inc. It runs a Cloudflare Workers app on your own machines, deployed from the `wrangler.json` you already have. It covers Workers, Durable Objects, KV, Queues, D1, R2, Workflows, Cron Triggers and static assets. Each Durable Object is a **cell**: a small named server with its own SQLite database. Long-term state lives in **your** bucket (S3-compatible, Google Cloud Storage or Azure Blob). There is no control plane or consensus service. ([README](https://github.com/denoland/celld#readme))

## The model in plain language

**Cell.** Think "one tiny server per thing": one per user, chat room, document or AI agent. A cell answers HTTP, holds WebSockets, sets alarms and makes outbound connections. It runs on one thread: a second request can only slip in while the first is awaiting. Its storage calls are synchronous SQLite. Cells share no database. KV namespaces, D1 databases, queues and Workflows are also cells internally, so they get the same failover. ([docs/README "Cells and nodes"](https://github.com/denoland/celld/blob/main/docs/README.md), [README "What runs on celld"](https://github.com/denoland/celld#what-runs-on-celld))

**Node and fleet.** A node is one `celld` process per machine. The nodes that share one bucket are a fleet. A fleet runs exactly **one** application. Any node can serve any cell, so you add capacity by starting another node against the same bucket. There is no join command: nodes find each other through lease records in the bucket. ([docs/README "Add nodes"](https://github.com/denoland/celld/blob/main/docs/README.md), [limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md))

**Lifecycle.** A cell is *resident* (in memory, active or idle), *hibernated* (out of memory but its WebSocket clients stay connected on its node), or *inactive* (just objects in the bucket, costing almost nothing). The constructor runs again on each wake-up, so nothing survives in memory. ([docs/README "Cell lifecycle"](https://github.com/denoland/celld/blob/main/docs/README.md))

**Ownership via the bucket ("leases").** Each cell has one ownership record in the bucket. A node claims a cell with a *conditional* write: "create only if absent", or "overwrite only if unchanged since I read it". So the bucket itself decides who wins, and exactly one node owns a cell. Each claim bumps a **fencing epoch**. Data is written under `cells/<cell>/ltx/e<epoch>/`, so a node that lost ownership can only write into a dead prefix. Each node also holds its own lease (default 10 s, renewed every third of that). If it can't renew before expiry, it **fences itself**: it stops its cells, fails pending requests and exits with code 3. A supervisor (systemd, Docker restart policy, Kubernetes) must restart it. Before acknowledging, a node re-reads the ownership record instead of trusting its clock, so a paused process or a skewed clock can't sneak a write through. ([guarantees](https://github.com/denoland/celld/blob/main/docs/guarantees.md))

This only works if the bucket really honours conditional writes. Qualified stores are AWS S3, Cloudflare R2, Tigris, GCS and Azure Blob. Backblaze B2, Hetzner Object Storage and DigitalOcean Spaces **don't**, "so two nodes can own one cell on them". Every node self-tests the bucket at startup. ([guarantees "What the bucket must provide"](https://github.com/denoland/celld/blob/main/docs/guarantees.md))

**Routing.** A load balancer can send any request to any node, since every node holds the current deployment. That node runs the stateless Worker code. When the code calls a Durable Object stub, the node forwards the call over signed peer HTTP to whichever node owns that cell. If no one owns it, the receiving node activates it. `idFromName()` is an HMAC of the name, keyed by script and class name, so one name maps to one cell from every node. **Renaming the Worker script orphans every named object.** ([workers](https://github.com/denoland/celld/blob/main/docs/services/workers.md), [durable-objects](https://github.com/denoland/celld/blob/main/docs/services/durable-objects.md))

**Persistence and durability.** celld captures every committed SQLite write as an LTX segment (the Litestream-style replication format). It doesn't answer a request until the write is durable (RPO = 0), mirroring Cloudflare's "output gate". There are two ways to prove a write durable:

- **bucket**: the write reached the bucket. One object-store round trip, about 90 ms region-local, and ~600 ms against a distant store in one lab test.
- **fleet** (the default): one or two *other* nodes have fsynced it. About 25 ms in that same lab test. The bucket upload follows.

A **single node has no peers**, so every write waits for the bucket even in fleet mode. "Run two or more nodes if write latency matters." ([README](https://github.com/denoland/celld#run-it), [guarantees "The ensemble needs two nodes"](https://github.com/denoland/celld/blob/main/docs/guarantees.md)) Without `CELLD_LTX_RETENTION_SECS`, old epoch prefixes are never deleted, so a cell's bucket footprint **grows with every activation**. ([docs/README "Cell lifecycle"](https://github.com/denoland/celld/blob/main/docs/README.md))

**Failure behaviour.** If a node dies, its leases expire and another node takes its cells over. First it fences the dead node's log, collects any writes followers held but the bucket didn't yet have, then restores the cell from the epoch chain. celld.dev quotes **~20 s failover after node loss, 0 lost writes** (SIGKILL tests on 4 vCPU / 8 GB nodes). Recovery of a large dead node "can take minutes". WebSockets can't move: they close with code 1012 and the client must reconnect. Outbound TCP sockets never outlive the event that opened them. ([guarantees](https://github.com/denoland/celld/blob/main/docs/guarantees.md), [celld.dev](https://celld.dev), [cloudflare-compat](https://github.com/denoland/celld/blob/main/docs/cloudflare-compat.md))

## Running it

**Locally: `celld dev`.** It starts one node with a local object store, so no Docker and no cloud bucket. It deploys the project and serves on `http://127.0.0.1:9876`. It watches files and rebuilds, keeps state in `.celld/dev` across restarts (`--clean` wipes it), and reads `.dev.vars` / `.env` like `wrangler dev`. It needs `esbuild` on `PATH` for Worker code. Binaries ship for Linux x86-64/ARM64 and Apple Silicon (a 58 MB static executable); there's no Windows build. ([docs/README "Develop an application locally"](https://github.com/denoland/celld/blob/main/docs/README.md), [limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md), [celld.dev](https://celld.dev))

**Self-hosted.** `celld deploy . --bucket s3://…` uploads the bundle to the bucket. Then you run `celld --bucket … --listen 0.0.0.0:8080 --internal-listen <private-ip>:8081 --advertise <private-addr>` on each machine, under a supervisor. You must also provide yourself:

- **TLS**: celld terminates none, so put Caddy, nginx or a load balancer in front.
- **A private network for port 8081**: peer traffic is plaintext HTTP, and the operator API is unauthenticated. Use a VPC, WireGuard or Tailscale.

New deploys are picked up in place within 30 s. A container image exists at `ghcr.io/denoland/celld`. ([README](https://github.com/denoland/celld#container), [security](https://github.com/denoland/celld/blob/main/docs/security.md))

**What it costs.** Yes, the minimum is **one node + one bucket**. celld.dev's own chart assumes $48/month 8 GB DigitalOcean nodes, holding 2,500 resident cells each. It claims celld beats Durable Objects from about 10 resident cells up (DO is $5 + $4.15 per resident cell-month). Its base costs exclude traffic and bucket usage. The docs page gives a different density: 1,000 cells per 8 GB node, ~$0.05 per cell-month, against celld.dev's 2,500 cells and ~$0.02. Treat both as vendor numbers. ([celld.dev](https://celld.dev), [docs/README](https://github.com/denoland/celld/blob/main/docs/README.md))

For MiseFlow-sized use **(reasoned)**:

- A $5–6/month VM plus a Cloudflare R2 bucket would do.
- An idle fleet is not free on the bucket side. The node renews its lease every ~3.3 s, polls `deploy/current.json` every 30 s, and the waker lists `wake/` every 60 s. That is on the order of a million requests a month with zero traffic. It's near R2's free allowance **(not re-checked)**, so a few dollars a month at worst.
- One node means every write pays the ~90 ms bucket round trip. Fast writes need a second node, so double the VM.

## Maturity, limits, security

- **Beta.** "celld v0.6.2 is a beta release". "It is not safe for hostile multi-tenant use. Only the latest release receives security fixes." The operator API is labelled alpha. ([limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md), [security](https://github.com/denoland/celld/blob/main/docs/security.md))
- **Young and fast-moving.**
  - The repo was created 25 Apr 2025, but the first release (v0.1.0) is 5 Aug 2026. There have been 11 releases in ~10 weeks, up to v0.6.2 on 7 Oct 2026.
  - Upgrades between some versions need the **whole fleet stopped**: "Mixed versions cannot share a serving fleet". Rolling back means restoring a full bucket backup.
  - About 6k stars and 70 open issues on 21 Oct 2026. Four new issues that day alone: facets data reading back empty after an upgrade (#292), disk-full and disk-cleanup errors (#290, #291), and requests that never retire after a deploy (#289).

  ([releases](https://github.com/denoland/celld/releases), [README](https://github.com/denoland/celld#install), [guarantees "Start a fleet with this format"](https://github.com/denoland/celld/blob/main/docs/guarantees.md), [issues](https://github.com/denoland/celld/issues))
- **Security model.** One fleet = one trusted app.
  - Whoever holds the **bucket credentials controls the fleet**. The bucket even stores the peer-auth secret.
  - The fleet HMAC authenticates control requests and tunnel setup, but doesn't encrypt anything. Calls inside a tunnel are "plain, unsigned HTTP".
  - The public listener reserves only `/.well-known/celld/health`.

  ([security](https://github.com/denoland/celld/blob/main/docs/security.md))
- **Gaps against Cloudflare.**
  - Not available: Workers AI, Vectorize, **Hyperdrive**, Browser Rendering and Email Workers.
  - Partial: the Cache API (an always-miss cache) and Node.js compat.
  - `wrangler.toml` isn't accepted (JSON/JSONC only), and `routes` stops a deploy.
  - Durable Object migrations accept only `new_sqlite_classes`, so renames and deletes are refused.
  - There's a 30 s limit on a transaction or `blockConcurrencyWhile()`, and at most 64 concurrent requests per cell (then 503).

  ([cloudflare-compat](https://github.com/denoland/celld/blob/main/docs/cloudflare-compat.md), [durable-objects](https://github.com/denoland/celld/blob/main/docs/services/durable-objects.md), [docs/README "Hot-cell overload"](https://github.com/denoland/celld/blob/main/docs/README.md))

## Governance

The code is Apache-2.0, built by Deno Land Inc. (Ryan Dahl is the top committer). **Pull requests are disabled.** The README says coding agents make low-context changes too cheap to send. Patches go by `git format-patch` email to ry@deno.com. Emailing one assigns your rights in it to Deno Land Inc., or grants a perpetual licence that allows relicensing. Issues are open. ([README "Contributions"](https://github.com/denoland/celld#contributions))

**(reasoned)** In practice, it's open-source code with a single-vendor roadmap. You can fork it, but you can't easily steer it. If Deno loses interest, a beta distributed-storage system is a risky thing to be left holding.

## celld vs Cloudflare Durable Objects

| | Cloudflare Durable Objects | celld |
|---|---|---|
| Code you write | Workers + DO API | The **same** code and `wrangler.json(c)`. Gaps are listed in cloudflare-compat |
| Who runs it | Cloudflare, on its global network | You: your VMs, your bucket, your TLS proxy, your private network, your supervisor |
| Where a cell lives | Cloudflare places it, near its first caller; supports location hints and jurisdictions **(not re-checked)** | On some node of your fleet. No placement or jurisdiction promise; `jurisdiction` APIs throw |
| One-writer guarantee | Platform-internal | Conditional writes in your bucket + fencing epochs + self-fencing leases |
| Durability before reply | Output gate; replicated by Cloudflare **(not re-checked)** | Output gate with RPO = 0: bucket proof (~90 ms) or fsync on 1–2 peer nodes (~25 ms, needs ≥ 2 nodes) |
| Storage per object | 10 GB (SQLite-backed) | Bounded by node disk and bucket; no documented per-cell cap **(reasoned)** |
| Failover | Transparent **(not re-checked)** | ~20 s after node loss (vendor figure); WebSockets reconnect with 1012 |
| Ecosystem | Hyperdrive, Workers AI, Vectorize, Browser Rendering, Email, edge cache, custom domains | None of those; Cache always misses; Containers experimental |
| Cost shape | Free plan for small SQLite DO use; paid $5/month + usage (celld.dev models $4.15 per resident cell-month) | Flat per VM + bucket requests/storage. Cheaper only once many cells stay resident |
| Lock-in | Cloudflare-only | The bucket is yours, so it's the exit from Cloudflare's runtime, though you're still writing to Cloudflare's API |
| Maturity | GA platform | Beta v0.6.2, ~10 weeks of releases |

(celld facts from its docs as cited above; DO storage cap from [Cloudflare DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/).)

## Could celld host Hono + Drizzle → Supabase Postgres?

**Probably yes, with caveats, untested.**

- **Hono** runs on Workers, and celld runs Workers `fetch` handlers, so a Hono app's `export default app` should work as-is **(reasoned)**.
- **TCP sockets are supported.** celld implements `cloudflare:sockets` `connect()` with `startTls()`, following workerd's implementation ([sockets.js](https://github.com/denoland/celld/blob/main/crates/celld/js/sockets.js), [cloudflare-compat "TCP sockets"](https://github.com/denoland/celld/blob/main/docs/cloudflare-compat.md#tcp-sockets)). `node:net` and `node:tls` are **not** in the implemented Node modules. Importing an unlisted Node module succeeds, but "its first call throws".
- **Which Postgres driver?**
  - **postgres.js (`postgres`) likely works.** Its `exports` map has a `workerd` condition pointing at a `cloudflare:sockets` build. `celld deploy` runs esbuild with `--conditions=workerd,worker,browser` and keeps `cloudflare:*` external ([deploy.rs](https://github.com/denoland/celld/blob/main/crates/celld/deploy.rs), [postgres package.json](https://unpkg.com/postgres@latest/package.json)). Drizzle has a `drizzle-orm/postgres-js` adapter.
  - **`pg` (node-postgres) is uncertain.** It switches to `pg-cloudflare` only when `navigator.userAgent === 'Cloudflare-Workers'`, or when a `Response` keeps a `cf` init field ([pg lib/stream.js](https://unpkg.com/pg@latest/lib/stream.js)). I found no `navigator` in celld's source. If the check fails, `pg` falls back to `net.Socket` and throws on first use **(reasoned, untested)**.
- **No Hyperdrive equivalent.** celld lists Hyperdrive as "No", and "A socket cannot outlive its event". So every request opens a fresh TCP + TLS + Postgres connection: no pooling across requests **(reasoned from the socket rule)**. The fix would be Supabase's own pooler (Supavisor, transaction mode). That's the same thing ADR 0005 already plans for Vercel.
- **Egress** is the host's own network; celld doesn't block ports. So Supabase's IPv6-only direct connection works only if the VM has IPv6 **(reasoned)**.
- **What you'd lose vs Node 24** **(reasoned)**:
  - full Node APIs: `node:crypto` lacks ciphers, Diffie-Hellman and RSA-PSS, and `zlib` is sync-only;
  - normal npm compatibility;
  - the "runs on my laptop with `node`" simplicity.

  Nothing in MiseFlow uses cells, so it's all cost.

## Any role in MiseFlow's phases?

| Phase | Role for celld | Why |
|---|---|---|
| **MVP server** (Hono + Drizzle on Node 24, laptop then maybe Vercel) | **None** | It would work at best, via postgres.js + pooler, but adds a beta runtime, a bucket, a TLS proxy and Workers-compat gaps for no gain. MiseFlow's state lives in Postgres, not in cells. ADRs 0005/0006 already settle this. |
| **Phase 2 LLM import route** | **None worth it** | An outbound `fetch` to OpenRouter works in any Workers runtime. Two catches **(reasoned)**: long streamed responses meet celld's 60 s idle-stream expiry, and its `waitUntil` rules differ. Node does this with no new moving parts. |
| **Phase 4 sync servers** (Zero / Electric / PowerSync, continuous host + logical replication) | **No (experimental at best)** | The sync servers aren't Workers bundles: zero-cache is a Node service, Electric is Elixir, the PowerSync service is a Docker image **(not re-checked here; see #55)**. Logical replication needs a long-lived Postgres connection, but celld sockets die with their event. The only route is celld's **experimental Containers**: a Durable Object supervises a Docker container, whose disk is ephemeral. That just runs Docker with extra steps. A plain VM or container host is simpler. **(reasoned)** |
| **Phase 5 server-side CP-SAT (WASM)** | **Not a good fit** | celld runs WASM imported into a Worker. But a Durable Object request has a 30 s limit on transactions/`blockConcurrencyWhile`, and the V8 heap defaults to 128 MB. `or-tools-wasm` is 7.3 MB and multithreaded builds need workers and SharedArrayBuffer ([scheduler-reuse](../docs/research/scheduler-reuse.md)). A Node process has none of these ceilings. **(reasoned)** |

**Where celld *would* matter (reasoned):** only if MiseFlow chose to be written for the Workers / Durable Objects model. For example, one Durable Object per Service holding its live Plan and pushing changes over hibernating WebSockets, as a home-grown alternative to a phase-4 sync engine. Then celld is the answer to "and if we leave Cloudflare?" That's a question for #75/#77, and it would contradict ADR 0006 (Postgres as the one database).

## Sources

- denoland/celld at v0.6.2:
  - [README](https://github.com/denoland/celld#readme)
  - docs: [docs/README](https://github.com/denoland/celld/blob/main/docs/README.md), [guarantees](https://github.com/denoland/celld/blob/main/docs/guarantees.md), [limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md), [security](https://github.com/denoland/celld/blob/main/docs/security.md), [cloudflare-compat](https://github.com/denoland/celld/blob/main/docs/cloudflare-compat.md), [wasm](https://github.com/denoland/celld/blob/main/docs/wasm.md)
  - service docs: [services/workers](https://github.com/denoland/celld/blob/main/docs/services/workers.md), [services/durable-objects](https://github.com/denoland/celld/blob/main/docs/services/durable-objects.md), [services/containers](https://github.com/denoland/celld/blob/main/docs/services/containers.md)
  - source and project pages: [crates/celld/js/sockets.js](https://github.com/denoland/celld/blob/main/crates/celld/js/sockets.js), [crates/celld/deploy.rs](https://github.com/denoland/celld/blob/main/crates/celld/deploy.rs), [releases](https://github.com/denoland/celld/releases), [issues](https://github.com/denoland/celld/issues)
- [celld.dev](https://celld.dev) (vendor performance and cost figures), read 21 Oct 2026
- [Cloudflare Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) (updated 1 Jun 2026)
- [pg `lib/stream.js`](https://unpkg.com/pg@latest/lib/stream.js) (pg 8.23.1), [postgres.js `package.json`](https://unpkg.com/postgres@latest/package.json), [pg-cloudflare `package.json`](https://unpkg.com/pg-cloudflare@latest/package.json)
