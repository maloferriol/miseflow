# Research: is Deno being deprecated, and does MiseFlow depend on it?

21 Oct 2026 · answers [#73](https://github.com/maloferriol/miseflow/issues/73) for [Map #72](https://github.com/maloferriol/miseflow/issues/72).

Method: read Deno's and Cloudflare's own posts, Deno's docs, the Supabase CLI and `supabase/edge-runtime` source on GitHub (via the GitHub API, 21 Oct 2026), Supabase's GitHub discussions, and Hono's docs. Each claim is tagged **official** (a first-party post, doc or source file), **staff, informal** (a company employee on a forum, not policy) or **not found**. **(reasoned)** marks my own inference.

## Answer

**The rumour is true in substance.** On 9 Oct 2026 Deno announced its team is joining Cloudflare. Deno Deploy shuts down about six months later, around April 2027. The Deno runtime gets one more year of bug-fix and security releases, until about October 2027, and then Deno stops developing it. It stays open source.

**MiseFlow is not affected.** Nothing we have chosen runs on Deno. Our server is Hono on Node 24 ([ADR 0005](../docs/adr/0005-react-spa-with-a-thin-hono-api.md)), and [ADR 0006](../docs/adr/0006-supabase-postgres-through-drizzle.md) already rules out Supabase Edge Functions, the only Deno-based part of Supabase. The one place Deno touches us is an optional container that `supabase start` launches by default. We don't use it and can switch it off.

## What Deno announced

| Claim | Status | Source |
|---|---|---|
| The Deno team is joining Cloudflare. Ryan Dahl, 9 Oct 2026. | official | [deno.com/blog/cloudflare](https://deno.com/blog/cloudflare) |
| "We will support the Deno runtime for another year with monthly releases containing bug fixes and security updates." After that year, Deno ends development of the runtime. | official, 9 Oct 2026 | same |
| "Deno will remain open source, and we welcome others who want to continue its development." | official, 9 Oct 2026 | same |
| "Deno Deploy will continue operating for six months before shutting down." No exact date is given. About 9 Apr 2027 **(reasoned)**. | official, 9 Oct 2026 | same |
| Paying Deno Deploy customers get migration support to Cloudflare Workers. | official, 9 Oct 2026 | same |
| JSR keeps running, with its infrastructure moving to Cloudflare. rusty_v8 stays supported and is headed into workerd. | official, 9 Oct 2026 | same |
| Cloudflare's side: workerd and celld are being merged, and the aim is to make self-hosted workerd a first-class way to run apps. Co-written by Ryan Dahl and Kenton Varda, 9 Oct 2026. | official | [blog.cloudflare.com/deno-joins-cloudflare](https://blog.cloudflare.com/deno-joins-cloudflare/) |
| Separately and earlier, **Deno Deploy Classic** was scheduled to shut down on 20 Jul 2026. This was the older version of Deploy, replaced by the new Deno Deploy, which is the one now shutting down. | official (docs, read 21 Oct 2026) | [docs.deno.com/deploy/classic](https://docs.deno.com/deploy/classic/) |
| "Acquisition" vs "joining": the official posts say "joining". Financial terms: **not found**. | — | — |

Not "deprecated" in the formal sense. There's no deprecation notice on Deno itself. It is a wind-down: a year of maintenance and then no new work from the Deno company.

## Does MiseFlow depend on Deno?

| Thing | Uses Deno? | Affects us? | Source |
|---|---|---|---|
| Our code and tooling | No. The repo has no `deno.json`, no Deno imports and no Deno mention (`git grep -i deno` on `main`, 21 Oct 2026). | No | this repo |
| Hono | Runs on both runtimes. We use the Node adapter `@hono/node-server`. | No | [hono.dev Node guide](https://hono.dev/docs/getting-started/nodejs) |
| Supabase Postgres, Auth (GoTrue), Drizzle, supabase-js auth module | No. These don't run on Deno. | No | ADR 0006, ADR 0008 |
| **Supabase Edge Functions** | **Yes.** They run on `supabase/edge-runtime`, "a server based on Deno runtime". | No: we don't use them (ADR 0006). | [github.com/supabase/edge-runtime](https://github.com/supabase/edge-runtime) |
| **Supabase CLI** (the `supabase` binary) | No. It's a TypeScript app built with Bun, targeting Node, plus a Go sidecar. | No | [apps/cli/package.json](https://github.com/supabase/cli/blob/main/apps/cli/package.json) |
| **Local stack (`supabase start`)** | Partly. One of the containers it starts is `edge_runtime`, the Deno-based Edge Functions server. It's gated on `[edge_runtime] enabled` in `config.toml` and can be skipped with `--exclude edge-runtime`. | Not really: it only runs functions we don't have. | [service-catalog.ts](https://github.com/supabase/cli/blob/main/apps/cli/src/command-internal/service-catalog.ts), [start/SIDE_EFFECTS.md](https://github.com/supabase/cli/blob/main/apps/cli/src/commands/start/SIDE_EFFECTS.md) |
| Supabase hosted platform | Supabase runs its own Edge Functions infrastructure, not Deno Deploy. | No | staff, informal (below) |

### How exposed is Supabase itself?

- **`edge-runtime` already pins Deno and maintains its own fork.** Its vendored `deno` crate is version **2.1.4**, and it uses a Supabase fork of `deno_core` (`branch = "324-supabase"`). Edge Functions therefore don't follow Deno's monthly releases anyway. **official** (source: [edge-runtime Cargo.toml](https://github.com/supabase/edge-runtime/blob/main/Cargo.toml), `deno/Cargo.toml`, read 21 Oct 2026). The repo is active: v1.77.7 was released on 21 Oct 2026 ([release](https://github.com/supabase/edge-runtime/releases/tag/v1.77.7)).
- **Supabase has made no formal announcement yet.** In [discussion #51507](https://github.com/orgs/supabase/discussions/51507), a Supabase maintainer wrote on 12 Oct 2026: "We should post a public announcement about this topic soon." **staff, informal**. Formal Supabase announcement: **not found** as of 21 Oct 2026.
- **A self-identified Supabase employee on Hacker News** said about 11 Oct 2026 that Supabase doesn't depend on Deno's hosted services. They also said "Existing Edge Functions will continue to be supported", and that Supabase's coming "Compute" product will support Node.js and Bun as well as Deno ([HN thread](https://news.ycombinator.com/item?id=50027914)). **staff, informal**, not policy.

**(reasoned)** The realistic risk to Supabase users is Edge Functions slowly falling behind the Deno ecosystem, or Supabase steering people to Compute. Neither touches a project that uses Supabase only as Postgres plus Auth.

## Does any Deno change affect us?

No action is needed. Two small, optional follow-ups for when the local stack is set up **(reasoned)**:

- Set `[edge_runtime] enabled = false` in `supabase/config.toml` (or run `supabase start -x edge-runtime`). This skips a container we never use, and with it our last indirect contact with Deno.
- Keep [ADR 0006](../docs/adr/0006-supabase-postgres-through-drizzle.md)'s rule against Edge Functions. This news strengthens it.

For the map: Deno and Deno Deploy no longer fit as future hosts for any phase. Deploy closes in about April 2027, and the runtime's development ends in about October 2027. The question turns into "write for the Workers model?", which [#72](https://github.com/maloferriol/miseflow/issues/72)'s celld and Workers tickets cover.

## Deno vs Node 24 for running Hono (brief)

- **Starting the server:** on Deno, `Deno.serve(app.fetch)`, with Hono imported via `deno.json` as `npm:hono` or `jsr:@hono/hono` and no install step ([hono.dev Deno guide](https://hono.dev/docs/getting-started/deno)). On Node, the `@hono/node-server` adapter's `serve(app)` ([hono.dev Node guide](https://hono.dev/docs/getting-started/nodejs)). Hono was written for Web-standard runtimes, and Node needs the adapter. The app code itself is the same.
- **Other differences (reasoned, from general knowledge, not re-verified here):** Deno runs TypeScript directly and has a permission sandbox (`--allow-net` and so on) and a built-in formatter, linter and test runner. Node 24 can also strip TypeScript types natively, has npm as its first-class ecosystem, and is what Drizzle's Postgres drivers and Vercel target first.
- **For MiseFlow** the difference no longer matters: Node 24 is decided, and Deno's own runtime is now in maintenance mode.

## Sources

- Deno, "Deno is joining Cloudflare", 9 Oct 2026: https://deno.com/blog/cloudflare
- Cloudflare, "Deno is joining Cloudflare", 9 Oct 2026: https://blog.cloudflare.com/deno-joins-cloudflare/
- Deno docs, Deploy Classic: https://docs.deno.com/deploy/classic/
- supabase/edge-runtime: https://github.com/supabase/edge-runtime
- supabase/cli: https://github.com/supabase/cli
- Supabase discussion #51507 "The future of Deno and Supabase", opened 10 Oct 2026: https://github.com/orgs/supabase/discussions/51507
- Hacker News thread with a Supabase employee's comment: https://news.ycombinator.com/item?id=50027914
- Hono docs: https://hono.dev/docs/getting-started/nodejs, https://hono.dev/docs/getting-started/deno
