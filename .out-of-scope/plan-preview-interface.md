# Plan preview interface (hiding the scheduler input from the Plan read)

MiseFlow won't take the scheduler's input (`PlanRead.model`) out of the Plan read. It also won't add a separate shared "Plan preview" module just so the browser doesn't call the scheduler directly.

## Why this is out of scope

The browser shows a drag's result before the server answers. While a `pinTask` saves, it runs the same scheduler over the stored Plan with the dragged Task pinned (#89, ADR 0010). To do that, it needs the scheduler's input. It can only get that input from the Plan read, because the browser never sees the rows the server builds it from. Taking `model` out of `PlanRead` would therefore remove the optimistic preview, not hide it.

The Plan screen already reaches the preview through one call. Its pure core (ADR 0011) has a function that pins the Task in the read's model, reruns the scheduler and lays the new placements over the read:

```ts
optimisticPlan(read, task, start) // => the Plan to show while the pin saves
```

That function has its own unit tests. The view and the hook don't import the scheduler at all. Moving those few lines into `shared` would add a module without hiding anything more.

## What this doesn't cover

The web imports pure `shared` modules by file path (`@miseflow/shared/src/...`) rather than from `@miseflow/shared`. That's because the package entry also re-exports database code (Drizzle-backed reads and re-plans), which can't go in the browser bundle. A browser-safe entry point for `shared` is a separate idea and hasn't been rejected.

## Prior requests

- #131: candidate 3 of the 2026-10-26 architecture review ("Give the browser a Plan preview interface")
