# Codebase diagrams

Diagrams of MiseFlow as the code stands, for a newcomer finding their way around. Each file holds a
Mermaid diagram (it renders on GitHub), a short explanation, and links to the source it was drawn
from. The words follow [CONTEXT.md](../../../CONTEXT.md); the decisions behind the shape are in
[docs/adr](../../adr/).

| Diagram | Why it earns its place |
|---|---|
| [System context](system-context.md) | The four moving parts (React SPA, Hono API, Supabase Auth, Postgres) and who talks to whom, the first thing to hold in your head (ADR 0005, 0006, 0008). |
| [Workspaces and modules](workspaces-and-modules.md) | How `web`, `server` and `shared` depend on each other, and what lives in each `shared/src` folder, so you know where a change belongs. |
| [Database: catalog and recipes](database-catalog-and-recipes.md) | ER diagram of the Ingredient catalog and Recipe tables in `shared/src/schema.ts`. The schema has 23 tables, so it is split in two. |
| [Database: menus, services and planning](database-menus-and-planning.md) | ER diagram of Menus, Services, Batches, Cooks, Availability and the Plan's stored state (pins, Step events, Shopping marks). |
| [Mutation lifecycle](mutation-lifecycle.md) | Every write is a named mutation to `POST /mutate` (ADR 0007). A sequence diagram follows one from the browser through idempotency, the mutator and the transaction. |
| [Sign-in and request auth](sign-in-and-auth.md) | How the browser signs in with Supabase Auth and how the server checks the bearer token on every request (ADR 0008). |
| [Plan read and re-plan](plan-read-and-replan.md) | How a Service's Plan is computed and shown: `readPlan`, re-plan, the scheduler, and the Gantt chart that pins Tasks (ADR 0009). |
| [Ingredient seed pipeline](ingredient-seed-pipeline.md) | How the ODbL seed JSON becomes catalog rows, with its validation and idempotent upsert (ADR 0003). |
| [Web screens](web-screens.md) | The `?view=` navigation in the app shell, the screens it switches between, and their core/hook/view split (ADR 0011). |
| [Domain model](domain-model.md) | The main CONTEXT.md terms as a class diagram, marked where the code implements them, to connect the glossary to the tables. |

Left out on purpose: **Recipe import/export (Cooklang)**. The spec exists
([recipe-import-export-spec.md](../../recipe-import-export-spec.md)) but no import or export code
does yet; only the Cooklang-style Step text helpers in `shared/src/recipe/tokens.ts` and
`quantity.ts` exist, so there is no flow to draw.
