# Mutation lifecycle

Every write in MiseFlow is one named mutation `{id, name, args}` sent to the single endpoint
`POST /mutate` ([ADR 0007](../../adr/0007-writes-are-named-mutations-to-one-endpoint.md)). These
diagrams follow one real mutation, `tickStep`, from the cook ticking a Step on the Today checklist
to the re-read Plan. The first diagram is the happy path, the second the ways the request can fail.

## Happy path: ticking a Step

```mermaid
sequenceDiagram
    autonumber
    actor Cook
    participant Hook as useTodayChecklist (TodayScreen.tsx)
    participant TC as tickSave (today-checklist.ts)
    participant Api as mutate (api.ts)
    participant Vite as Vite dev proxy /api
    participant Auth as requireAuth (auth.ts)
    participant Route as mutateRoute (routes/mutate.ts)
    participant Mut as tickStep (mutators/progress.ts)
    participant Rep as replan (plan/replan.ts)
    participant DB as Postgres
    participant QC as TanStack QueryClient

    Cook->>Hook: onTick(task, stepId, done = true)
    Hook->>Hook: setTicking({key, done}), the box shows ticked at once
    Hook->>TC: tickSave(serviceId, {task, stepId, done}, intent)
    TC-->>Hook: {id: intent.id(key, "mutation"), name: "tickStep", args: {eventId, serviceId, owner, stepId}}
    Hook->>Api: mutate(call) via useMutation mutationFn
    Api->>Api: authHeaders() reads supabase.auth.getSession(), Bearer access_token
    Api->>Vite: POST /api/mutate, JSON body {id, name, args}
    Vite->>Auth: POST /mutate (the /api prefix is rewritten away)
    Auth->>Auth: jwk() verifies the token (ES256 or RS256, iss, aud "authenticated")
    Auth->>Route: c.set("ownerId", sub), then next()
    Route->>Route: mutationBody.safeParse, strict {id: uuid, name, args: record}
    Route->>Route: getMutator("tickStep", registry), own keys only
    Route->>Route: tickStep.args.safeParse(args) {eventId, serviceId, owner, stepId}
    Route->>DB: db.transaction(tx) begins
    Route->>DB: INSERT applied_mutations {id, ownerId, name} ON CONFLICT DO NOTHING RETURNING id
    DB-->>Route: one row, the id is claimed
    Route->>Mut: run(tx, args, {ownerId, timeZone, now})
    Mut->>DB: lockService, SELECT the live Service FOR NO KEY UPDATE
    Mut->>DB: ownerRecipe and Step lookup (live, same owner, in this Service)
    Mut->>DB: SELECT the Step's latest step_events.at
    Mut->>DB: INSERT step_events {id: eventId, kind: "done", at}
    Mut->>Rep: replan(tx, ctx, serviceId)
    Rep->>DB: loadPlanRows, reconcileBatches, then schedule and diffPlacements in memory
    Rep->>DB: insert, update or soft-delete only the task_placements that moved
    Route->>DB: transaction commits (outcome "applied")
    Route-->>Api: 200 {ok: true, id}
    Api-->>Hook: resolves
    Hook->>QC: onSuccess, intent.reset() then invalidateQueries(["plan", serviceId])
    QC->>Api: refetch fetchPlan(serviceId), GET /services/:serviceId/plan
    Hook->>Hook: onSettled, setTicking(null), the box now follows the re-read Plan
```

`tickSave` builds the call. `intent.id(key, ...)` makes the mutation id and the `eventId` once per
intended tick (`key` is the Task key, Step id and `done`), so a retry after a lost response sends
the same ids and is replayed, not applied twice. `intent.reset()` runs only after a success.

On the server, the mutation id is claimed in `applied_mutations` inside the same transaction as the
mutator's writes. If `run` throws, the transaction rolls back and the claim goes with it, so a retry
can apply the mutation. `tickStep` appends a `done` event to the append-only `step_events` and then
re-plans the Service with `replan`, which locks the Service again and writes only the
`task_placements` that moved. `untickStep` is the same with `kind: "undone"`.

The Vite proxy exists only in development (`web/vite.config.ts`): the API's routes sit at the root,
and `/api` is the proxy's prefix.

## Error paths

```mermaid
sequenceDiagram
    participant Api as mutate (api.ts)
    participant Auth as requireAuth (auth.ts)
    participant Route as mutateRoute (routes/mutate.ts)
    participant Mut as tickStep (mutators/progress.ts)
    participant DB as Postgres
    participant Hook as useTodayChecklist (TodayScreen.tsx)

    Api->>Auth: POST /mutate with Authorization Bearer token
    alt no token, bad token, or sub is not a uuid
        Auth-->>Api: 401 (HTTPException, returned by app.onError)
    else token valid
        Auth->>Route: next() with ownerId
        alt body is not {id: uuid, name, args: object}
            Route-->>Api: 400 {error: {code: "INVALID_BODY", message: "Expected {id: uuid, name, args: object}"}}
        else getMutator finds no such name
            Route-->>Api: 400 {error: {code: "UNKNOWN_MUTATION", message: "Unknown mutation: name"}}
        else mutator.args.safeParse fails
            Route-->>Api: 400 {error: {code: "INVALID_ARGS", message: z.prettifyError(...)}}
        else args valid
            Route->>DB: INSERT applied_mutations ON CONFLICT DO NOTHING
            alt id already claimed by the same owner
                DB-->>Route: no row, SELECT finds the same ownerId
                Note over Route,DB: outcome "replayed", run is skipped, nothing is written
                Route-->>Api: 200 {ok: true, id}
            else id already claimed by another owner
                DB-->>Route: no row, SELECT finds another ownerId
                Route-->>Api: 409 {error: {code: "CONFLICT", message: "This mutation id was already used"}}
            else id claimed
                Route->>Mut: run(tx, args, ctx)
                alt Service or Step missing, deleted, or another owner's
                    Mut-->>Route: throws NotFoundError ("Service not found" or "Step not found")
                    Note over Route,DB: the transaction rolls back and releases the claim
                    Route-->>Api: 404 {error: {code: "NOT_FOUND", message}}
                else eventId already used (Postgres 23505)
                    Mut-->>Route: unique violation from INSERT step_events
                    Route-->>Api: 409 {error: {code: "CONFLICT", message: "A row with one of these ids already exists"}}
                else a mutator throws ConflictError or InvalidArgsError
                    Route-->>Api: 409 CONFLICT or 400 INVALID_ARGS, {error: {code, message: error.message}}
                else any other error
                    Route-->>Api: 500 {error: {code: "INTERNAL", message: "Internal error"}} via app.onError
                end
            end
        end
    end
    opt response is not ok
        Api-->>Hook: throws Error(body.error.message, or "tickStep failed (status)")
        Hook->>Hook: onSettled setTicking(null), tickError shows, intent keeps its ids for a retry
    end
```

`tickStep` itself only throws `NotFoundError` or hits a unique violation. `ConflictError` and
`InvalidArgsError` come from other mutators (an Ingredient name already taken, a unit of the wrong
kind), but every mutation shares this route, so their mappings are shown. A replayed id returns the
same `200 {ok: true, id}` as a first apply, without comparing args: the browser must send a new id
whenever the args change, which is what `intent.id` keyed on the tick does.

## Source files

- [docs/adr/0007-writes-are-named-mutations-to-one-endpoint.md](../../adr/0007-writes-are-named-mutations-to-one-endpoint.md): the decision
- [web/src/TodayScreen.tsx](../../../web/src/TodayScreen.tsx): `useTodayChecklist`, its `useMutation`, `onSuccess` and `onSettled`
- [web/src/today-checklist.ts](../../../web/src/today-checklist.ts): `tickSave`, `tickKey`, `Ticking`
- [web/src/intent.ts](../../../web/src/intent.ts): `createIntent`, `useIntent`, ids reused by a retry
- [web/src/mutation-call.ts](../../../web/src/mutation-call.ts): the `MutationCall` type
- [web/src/api.ts](../../../web/src/api.ts): `mutate`, `authHeaders`, `fetchPlan`
- [web/vite.config.ts](../../../web/vite.config.ts): the `/api` dev proxy
- [server/src/app.ts](../../../server/src/app.ts): `createApp`, `requireAuth` on every route but `/health`, `app.onError`
- [server/src/auth.ts](../../../server/src/auth.ts): `requireAuth`, the JWKS cache
- [server/src/routes/mutate.ts](../../../server/src/routes/mutate.ts): `mutateRoute`, `mutationBody`, the claim and outcomes, `isUniqueViolation`
- [server/src/errors.ts](../../../server/src/errors.ts): `errorBody` and the error codes
- [shared/src/mutators/registry.ts](../../../shared/src/mutators/registry.ts): `mutators`, `getMutator`
- [shared/src/mutators/define.ts](../../../shared/src/mutators/define.ts): `Mutator`, `MutatorContext`, `NotFoundError`, `ConflictError`, `InvalidArgsError`
- [shared/src/mutators/progress.ts](../../../shared/src/mutators/progress.ts): `tickStep`, `untickStep`, `appendEvent`
- [shared/src/plan/replan.ts](../../../shared/src/plan/replan.ts): `lockService`, `replan`, `replanWith`
- [shared/src/schema.ts](../../../shared/src/schema.ts): `applied_mutations`, `step_events`, `task_placements`
