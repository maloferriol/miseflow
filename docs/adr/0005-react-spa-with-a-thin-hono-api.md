# A React single-page app with a thin Hono API

MiseFlow is a personal project with one user. The MVP is a **React 19 single-page app** built with Vite, with TanStack Query for data in the browser. It talks to a **thin Hono API on Node 24**, which runs on the owner's laptop first and possibly on Vercel later. The whole stack is TypeScript, and a shared package holds the scheduler and the mutators so they run in the browser and on the server. React keeps all three phase-4 sync engines (Zero, Electric, PowerSync) first-class. A single-page app fits an app that sits behind a sign-in and becomes offline-capable in phase 4, so server rendering buys nothing. Hono's typed RPC client gives the browser end-to-end types with no code generation, and the same app runs on Node and on Vercel. Decided on [#57](https://github.com/maloferriol/miseflow/issues/57).

## Considered Options

- **Full-stack frameworks (Next.js, TanStack Start, React Router framework mode).** Server rendering is wasted behind a sign-in, and server functions spread reads and writes across many endpoints, which works against [ADR 0007](0007-writes-are-named-mutations-to-one-endpoint.md).
- **No own server: the Supabase data API plus Edge Functions.** It would mean one less thing to host. The owner prefers their own server that can run on a laptop. Supabase's auto-generated API also can't apply a multi-row mutation atomically without moving logic into SQL functions.
- **Svelte, Solid or Vue.** Pleasant to write, but sync-engine support across the three candidates is uneven.
- **tRPC or REST/OpenAPI for reads.** tRPC duplicates what Hono's client already gives us. GraphQL was ruled out by the sync-engine research ([#55](https://github.com/maloferriol/miseflow/issues/55)).

## Consequences

- Hono is the only thing that touches the database. It checks the sign-in token on every request, serves reads, applies mutations, and in phase 2 holds the LLM import route and its API key. The LLM provider is undecided; OpenRouter is the first candidate.
- On Vercel, each request runs as a short-lived function, so the database connection goes through a pooler. Phase 4's sync servers need a host that runs continuously.
