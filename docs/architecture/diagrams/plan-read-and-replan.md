# Plan read and re-plan

A Service's Plan is stored as one `task_placements` row per placed Task. Mutators that change a
Task re-plan inside their own transaction and write only what moved. The Plan read never writes:
it lays out the stored rows and works out progress, behind, Unplaced Tasks and conflicts each time
it is read. The web app shows that read as a Gantt chart, day lists, a printed Plan and the Today
checklist. Dragging a bar pins the Task, and the browser runs the same scheduler to show the
result straight away.

## 1. Re-plan: computing and storing the Plan

```mermaid
flowchart TD
  subgraph triggers["Mutators that re-plan (shared/src/mutators)"]
    PIN["pinTask → replan<br/>unpinTask → replanReleasing<br/>(pins.ts)"]
    TICK["tickStep / untickStep → replan<br/>(progress.ts)"]
    SVC["createService, setServiceTime, replanService → replan<br/>replanFromScratch → replanFromScratchOf<br/>(services.ts)"]
    AV["setWeeklyAvailability, setAvailabilityOverride<br/>lockServices, then replan each<br/>(services.ts)"]
    AFF["planning.ts, steps.ts, subrecipes.ts,<br/>addDish / removeDish (menus.ts),<br/>setKitchenSettings, giveCookMoreTime"]
  end

  AFF --> RA["replanAffected(scope)"]
  RA --> SIS["servicesInScope()<br/>recipe / menu / service / all"]
  SIS --> REPLAN["replan()"]
  PIN --> REPLAN
  TICK --> REPLAN
  SVC --> REPLAN
  AV --> REPLAN
  PIN --> RREL["replanReleasing()<br/>drops one Task's previous start"]
  SVC --> RFS["replanFromScratchOf()<br/>keeps only pinned or ticked Tasks"]

  REPLAN --> RW["replanWith()<br/>findService lock: FOR NO KEY UPDATE<br/>ensureCook()"]
  RREL --> RW
  RFS --> RW

  RW --> LPR["loadPlanRows()<br/>(replan.ts)"]
  RW --> RB["deriveScale() + reconcileBatches()<br/>(model.ts, batch-rows.ts)"]
  RW --> TPM["toPlanningModel()<br/>(model.ts)"]
  RW --> DIFF["diffPlacements() vs loadStored()<br/>(diff.ts)"]

  subgraph SCH["schedule() (scheduler/schedule.ts), pure"]
    S1["prepare() + Kahn cycle check over links"]
    S2["pins first, then done / in-progress Tasks<br/>fixed at their previous start"]
    S3["backward from Service time: latestFit(),<br/>or nearestFit() to a previous start;<br/>no fit → Unplaced via reasonFor()"]
    S1 --> S2 --> S3
  end
  RW --> SCH

  T1[("services, menus")] --> LPR
  T2[("kitchen_settings")] --> LPR
  T3[("availability_weekly<br/>availability_overrides")] --> LPR
  T4[("dishes, courses, recipes, steps,<br/>ingredient_lines, step_dependencies")] --> LPR
  T7[("step_events")] --> LPR
  T5[("batches")] --> LPR
  RB -- "insert / revive / soft-delete" --> T5
  RW -- "ensureCook()" --> T8[("cooks")]
  T6[("task_placements")] --> LPR
  DIFF -- "insert / update / soft-delete" --> T6
```

A re-plan always runs inside the calling mutator's transaction. There are three ways in:

- `replan(serviceId)` re-plans one Service.
- `replanAffected(scope)` finds every live Service using a Recipe, a Menu, or all of them (`servicesInScope`) and calls `replan` on each.
- The variants `replanReleasing` (used by `unpinTask`) and `replanFromScratchOf` (used by `replanFromScratch`) change which stored placements reach the scheduler as `previous`.

All three end in `replanWith()`, which does this:

1. Locks the Service row.
2. Makes sure the implicit Cook row exists.
3. Loads every row the Plan needs (`loadPlanRows`). Recipe rows come through `loadScaleRows` / `loadRecipeSnapshot`, Step progress comes from `step_events`, and the stored placements become `previous`.
4. Makes the `batches` rows match the sub-recipes in use.
5. Builds the `PlanningModel` and runs the pure `schedule()`.
6. Diffs the result against every stored `task_placements` row, soft-deleted ones included. Only rows that moved are written.

`schedule()` places pins first, then done and in-progress Tasks. It then places the remaining Tasks backward from Service time in the Cook's free time. A Task that has a previous start is placed as close to it as it fits (`nearestFit`), and any other Task as late as it fits (`latestFit`). A Task with no room becomes Unplaced, with a reason. Shelf life (`keepsOf`) and progress bounds (`progressBounds`) can shift a Task's window.

Notes:
- `pinTask` and `unpinTask` write `pinned` and `startMinute` on the `task_placements` row themselves before re-planning, because the diff writes only the start and the Cook.
- `setDishScale` (menus.ts) does not call a re-plan.

## 2. Plan read: `readPlan` (no writes)

```mermaid
flowchart TD
  ROUTE["GET /services/:serviceId/plan<br/>servicesRoute() (server/src/routes/services.ts)"]
  ROUTE --> RP["readPlan(db, ownerId, serviceId, timeZone, now())<br/>(read.ts)"]
  RP --> FLS["findLiveService()<br/>no row lock"]
  RP --> LPR["loadPlanRows()<br/>same loader as re-plan"]
  LPR --> TABLES[("task_placements, step_events, batches,<br/>dishes, recipes, steps, availability_*, ...")]
  RP --> PRO["planReadOf(rows, timeZone, now)<br/>pure, no I/O"]

  PRO --> TPM["toPlanningModel()<br/>model, tasks, scale"]
  PRO --> TBR["toBatchRead() (batches.ts)"]
  PRO --> BH["behindTasks() (behind.ts)<br/>past due with a Step not done"]
  PRO --> PROG["rows.progress (stepStates, progress.ts)<br/>steps done / doneAt"]
  PRO --> CO["conflictsOf() over stored placements<br/>(scheduler)"]
  PRO --> UN["schedule(model).unplaced<br/>minus stored keys"]
  PRO --> TIME["localParts(), formatMinuteOfDay(),<br/>formatInstant() (time.ts)"]
  CO --> DC["describeConflict() (reasons.ts)"]
  UN --> DU["describeUnplaced() (reasons.ts)"]

  TBR --> OUT
  BH --> OUT
  PROG --> OUT
  DC --> OUT
  DU --> OUT
  TPM --> OUT
  TIME --> OUT
  OUT["PlanRead<br/>service, timeZone, model, asOf, approximate,<br/>days[].tasks (PlanTask), batches, unplaced, conflicts"]
```

`readPlan` loads the same rows as a re-plan, without a lock, and hands them to the pure
`planReadOf`. Placed Tasks come straight from the stored `task_placements` rows (`rows.previous`)
and are grouped into days in the kitchen's time zone. Each `PlanTask` gets its Steps with
`done` / `doneAt`, and a `behind` block if `behindTasks()` measures it as late at `now`. Unplaced
Tasks and conflicts are not stored. They are worked out on each read: one `schedule()` run gives
the Unplaced Tasks that have no stored row, `conflictsOf()` checks the stored placements, and
`reasons.ts` turns both into sentences. The read also returns `model` (with `previous` sorted by
key), so the browser can run the same scheduler for an optimistic pin.

`readPlan` does not call `trouble.ts` or `lanes.ts`. The browser calls them (see below).
`more-time.ts` (`smallestOverride`) is used only by the `giveCookMoreTime` mutator.

## 3. Web side: showing and pinning the Plan

```mermaid
flowchart TD
  API["GET /services/:serviceId/plan<br/>readPlan()"]
  FP["fetchPlan(serviceId)<br/>(web/src/api.ts)"]
  API --> FP

  subgraph planScreen["Plan screen"]
    UPS["usePlanScreen() (PlanScreen.tsx)<br/>useQuery key plan, serviceId"]
    GC["fetchMenu() + ganttCourses()<br/>(plan-screen.ts)"]
    PV["PlanView.tsx"]
    TRB["troubleBadge() (quick-fixes.ts)<br/>→ planTrouble() (trouble.ts)"]
    PD["dayHeading(), ownerOf(), taskTimes()<br/>(plan-display.ts)"]
    GANTT["Gantt.tsx"]
    AX["buildAxis(), toAxis(), fromAxis(),<br/>snap5(), barParts(), firstDate()<br/>(plan/axis.ts)"]
    LN["laneTree(), collapse()<br/>(plan/lanes.ts)"]
    UPT["usePinTask() onMutate:<br/>optimisticPlan() = withPin() + schedule()<br/>+ applyPlacements() (plan/pin.ts)"]
    FIX["usePlanFix(): quickFixes(),<br/>replanFromScratch()"]
  end

  subgraph todayScreen["Today checklist"]
    UTC["useTodayChecklist() (TodayScreen.tsx)<br/>refetchInterval 60 s"]
    TV["TodayView.tsx<br/>tickSave() → tickStep / untickStep"]
  end

  PP["PrintedPlan.tsx<br/>print-only"]
  MUT["mutate() → POST /mutate"]
  PINM["pinTask mutator → replan()"]

  FP --> UPS
  FP --> UTC
  UPS --> GC
  UPS --> PV
  PV --> TRB
  PV --> PD
  PV --> GANTT
  PV --> PP
  PV --> FIX
  GANTT --> AX
  GANTT --> LN
  GANTT -- "drag: onPin(task, start)" --> UPT
  UPT -- "mutate(pinTask())" --> MUT
  FIX --> MUT
  MUT --> PINM
  UPT -. "last pin settles: invalidate plan query" .-> FP
  UTC --> TV
  TV --> PP
  TV --> MUT
```

`usePlanScreen` and `useTodayChecklist` both read the same stored Plan through `fetchPlan`, under
the query key `["plan", serviceId]`. `PlanView` and `TodayView` both render `PrintedPlan`, which
is shown only in print. The Gantt chart is our own component (ADR 0009). It uses `axis.ts` for the
time axis with nights removed and `lanes.ts` for the Course → Dish → Batch lanes, which take their
Courses from the Menu (`ganttCourses`).

Dragging a bar snaps the new start to 5 minutes and calls `onPin`. `usePinTask` then:

1. Sends the `pinTask` mutation through `POST /mutate`. On the server, the mutator re-plans.
2. Meanwhile shows an optimistic Plan, by running the shared scheduler in the browser over `read.model` with the new pin.
3. Reads the Plan again once the last pending pin settles, so the stored Plan wins.

Quick fixes, "Re-plan from scratch" and Today ticks are not shown optimistically. They wait for the server and then read the Plan again.

## Source files

- [shared/src/plan/replan.ts](../../../shared/src/plan/replan.ts)
- [shared/src/plan/read.ts](../../../shared/src/plan/read.ts)
- [shared/src/plan/model.ts](../../../shared/src/plan/model.ts)
- [shared/src/plan/batch-rows.ts](../../../shared/src/plan/batch-rows.ts)
- [shared/src/plan/batches.ts](../../../shared/src/plan/batches.ts)
- [shared/src/plan/diff.ts](../../../shared/src/plan/diff.ts)
- [shared/src/plan/progress.ts](../../../shared/src/plan/progress.ts)
- [shared/src/plan/behind.ts](../../../shared/src/plan/behind.ts)
- [shared/src/plan/reasons.ts](../../../shared/src/plan/reasons.ts)
- [shared/src/plan/trouble.ts](../../../shared/src/plan/trouble.ts)
- [shared/src/plan/lanes.ts](../../../shared/src/plan/lanes.ts)
- [shared/src/plan/axis.ts](../../../shared/src/plan/axis.ts)
- [shared/src/plan/pin.ts](../../../shared/src/plan/pin.ts)
- [shared/src/plan/time.ts](../../../shared/src/plan/time.ts)
- [shared/src/plan/more-time.ts](../../../shared/src/plan/more-time.ts)
- [shared/src/recipe/snapshot.ts](../../../shared/src/recipe/snapshot.ts)
- [shared/src/scheduler/schedule.ts](../../../shared/src/scheduler/schedule.ts)
- [shared/src/scheduler/types.ts](../../../shared/src/scheduler/types.ts)
- [shared/src/scheduler/timeline.ts](../../../shared/src/scheduler/timeline.ts)
- [shared/src/mutators/pins.ts](../../../shared/src/mutators/pins.ts)
- [shared/src/mutators/progress.ts](../../../shared/src/mutators/progress.ts)
- [shared/src/mutators/planning.ts](../../../shared/src/mutators/planning.ts)
- [shared/src/mutators/services.ts](../../../shared/src/mutators/services.ts)
- [shared/src/mutators/menus.ts](../../../shared/src/mutators/menus.ts)
- [shared/src/mutators/steps.ts](../../../shared/src/mutators/steps.ts)
- [shared/src/mutators/subrecipes.ts](../../../shared/src/mutators/subrecipes.ts)
- [server/src/routes/services.ts](../../../server/src/routes/services.ts)
- [web/src/api.ts](../../../web/src/api.ts)
- [web/src/PlanScreen.tsx](../../../web/src/PlanScreen.tsx)
- [web/src/plan-screen.ts](../../../web/src/plan-screen.ts)
- [web/src/PlanView.tsx](../../../web/src/PlanView.tsx)
- [web/src/plan-display.ts](../../../web/src/plan-display.ts)
- [web/src/Gantt.tsx](../../../web/src/Gantt.tsx)
- [web/src/quick-fixes.ts](../../../web/src/quick-fixes.ts)
- [web/src/PrintedPlan.tsx](../../../web/src/PrintedPlan.tsx)
- [web/src/TodayScreen.tsx](../../../web/src/TodayScreen.tsx)
- [web/src/TodayView.tsx](../../../web/src/TodayView.tsx)
- [web/src/today-checklist.ts](../../../web/src/today-checklist.ts)
- [docs/adr/0009-build-our-own-gantt-chart.md](../../adr/0009-build-our-own-gantt-chart.md)
