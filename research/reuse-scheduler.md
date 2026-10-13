# Research: can the MVP reuse an existing scheduler instead of writing one?

Ticket: [#69](https://github.com/maloferriol/miseflow/issues/69) (map: [#53](https://github.com/maloferriol/miseflow/issues/53), feeds [#68](https://github.com/maloferriol/miseflow/issues/68)). Researched 2026-10-13. Terms follow [CONTEXT.md](../CONTEXT.md). This builds on the [scheduling-approach research](https://github.com/maloferriol/miseflow/blob/research/scheduling-approach/research/scheduling-approach.md) (#7), which compared *approaches*. This note looks for *code to reuse*, and re-verifies the facts it relies on. Versions and dates come from the npm registry (`npm view`), the GitHub API and PyPI on the date above.

## Short answer

No existing library knows MiseFlow's rules, so some of our own code stays whichever option we pick. What can be reused is the **search**: the part that tries arrangements and finds a good one. The best reusable search is **Google's CP-SAT solver compiled to WebAssembly**, which runs the same way in the browser and in Node. With it, our own code shrinks to:

- a **model builder** that turns Tasks, Availability and pins into CP-SAT rules,
- the **explanations** for Unplaced Tasks and the **conflict check** for pins.

Both of these exist in the plan-editing prototype already. The ~120 lines of greedy search order and slot-walking go away.

Gantt-chart "scheduling engines" (Bryntum, DHTMLX, `gantt-schedule-engine`) solve a different problem. They push dates along dependencies, project-management style. They don't fit Tasks into a Cook's free hours without double-booking, and the good ones are paid.

The recommendation depends on a **spike** that hasn't been run: a 200-Task Service solved by single-threaded WASM CP-SAT in a browser worker. If that takes much over ~300 ms, the spec's current plan (our own greedy scheduler) stays first. See [Recommendation](#4-ranked-recommendation).

## MiseFlow's rules, as a checklist

These come from spec §5 and §6 and ADR 0004. The candidate tables below use these numbers.

1. **Dependencies** are finish-to-start, passive time included.
2. **Active time** sits inside one Availability window and is never split.
3. **Passive time** may run outside Availability. It needs no Cook, but still holds its Equipment (phase 3).
4. **Make-ahead windows** set an earliest start. **Shelf life** means the result must still be good when it is used, by the next Task or at Service. Last-minute Tasks run on the Service date only.
5. The Plan sits on a **5-minute grid**.
6. Tasks go **as late as possible** (ALAP).
7. **Pins** never move, even when they break a rule. A broken rule shows as a conflict.
8. A re-plan **stays close to the previous Plan**. "Extra time" only pulls in Unplaced Tasks, and Re-plan from scratch ignores the previous Plan but keeps pins.
9. **Unplaced Tasks** each get a plain reason, and the rest of the Plan still stands.
10. **`now` and progress:** done and started work is fixed, and nothing new starts in the past.
11. The scheduler is **pure TypeScript, deterministic, and runs in the browser and in Hono/Node** (ADR 0004, 0005, 0007).

The MVP has one Cook and no Equipment. Phase 3 adds several Cooks, a Cook lock, and Equipment.

---

## 1. Candidates for reusing code

### 1a. CP-SAT compiled to WebAssembly (browser and Node)

CP-SAT is the constraint solver in Google OR-Tools: Apache-2.0, [google/or-tools](https://github.com/google/or-tools), 14.2k stars, latest release **v9.15 on 2026-01-12**, pushed to today. Google ships it for C++, Python, Java and .NET. Two community packages now compile it to WASM with a TypeScript API.

| | **[or-tools-wasm](https://github.com/Axelwickm/or-tools-wasm)** | **[cpsat-js](https://github.com/owen-lacey/cpsat-js)** |
| --- | --- | --- |
| Licence | Apache-2.0 (repo and npm). Fine. | npm and README say Apache-2.0, but the repo's `LICENSE` file is **MIT**. Both are permissive, and the bundled OR-Tools is Apache-2.0. Fine for us, but the mismatch is worth a line in our `THIRD_PARTY` notes. |
| Latest | v1.0.0, 2026-09-27; repo pushed 2026-10-11; 66 stars; 1 open issue | v1.4.0, 2026-10-04; 9 releases since 2026-04-16; 6 stars |
| Maintainers | One person (Axel Wickman). The repo also carries Google's upstream history. | One person (Owen Lacey, 18 commits) |
| OR-Tools inside | 9.15 (`Version.txt`) | 9.12 (`CMakeLists.txt` `GIT_TAG v9.12`) |
| Size | npm package unpacked **345 MB** (264 files), because it ships every OR-Tools solver (routing, MIP, MathOpt, …). The CP-SAT-only WASM size isn't documented, and jsDelivr refuses to list the package (>150 MB). | **12 MB unpacked**. Two ~6 MB `cpsat.wasm` builds: *threaded* and *portable*. The WASM is "fetched lazily" by `CpSolver.create()`, not at import. |
| Browser | Threads only. It needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, "Without these headers, solving can fail". Runs in a worker by default, with `signal` cancellation and progress events. | The **portable build needs no headers** (single thread) and is the default `browser` export. Threaded is opt-in with the same headers. Vite needs `optimizeDeps.exclude: ['cpsat-js']`. |
| Node | Yes (CI: Node 24, Deno, Bun). It can also send solves to a native C++ server it provides (`executor: {type:'server'}`). | Yes. It picks the threaded build (8 workers) automatically. |
| CP-SAT surface | Full: `newOptionalIntervalVar`, `addNoOverlap`, `addCumulative`, `addReservoirConstraint`, `addHint`, **`addAssumptions`**, `onlyEnforceIf`, `CpSat.solveProto()`, plus an `RcpspModelBuilder` (makespan-only, renewable resources) ([api.md](https://github.com/Axelwickm/or-tools-wasm/blob/main/docs/api.md)) | Partial: `newIntervalVar`, `addNoOverlap`, linear constraints, `onlyEnforceIf` on constraints, `addHint`, min/max. **No optional intervals, no `addCumulative`, no assumptions** in the TypeScript API (checked in `src/model/cp-model.ts`). `cpsat-js/proto` exposes the raw `CpModelProto`, and native OR-Tools reads the same bytes. |
| Quirks | It prints a one-time `console.info` cloud notice, which `setCloudNoticeEnabled(false)` turns off. Integers come back as `bigint`. | Its README says use 1 or ≥6 workers, "never in between". The portable build clamps to 1. |

**Fit to MiseFlow's rules** (the same for both packages, except where noted):

| Rule | How CP-SAT expresses it | Verdict |
| --- | --- | --- |
| 1 Dependencies incl. passive | `start[b] ≥ start[a] + active[a] + passive[a]`, a linear constraint | ✅ |
| 2 Active inside one window, never split | The start variable's **domain** is the union of `[w.start, w.end − active]` over the Cook's windows (`Domain.fromIntervals`). Not splitting is then automatic. The Cook's active intervals go in one `NoOverlap`. | ✅ and simpler than the greedy's slot walk |
| 3 Passive outside Availability | The passive part is left out of the Cook's `NoOverlap`. Phase 3 puts an `active+passive` interval in each Equipment unit's `NoOverlap` / `Cumulative`. | ✅ (`Cumulative` needs or-tools-wasm, or `NoOverlap` per unit) |
| 4 Make-ahead and shelf life | Earliest start is a domain bound. Shelf life is `start[user] ≤ end[made] + shelf`, or `Service ≤ end + shelf` when Service itself is the use. Last-minute means a domain restricted to the Service date. | ✅ |
| 5 5-minute grid | Variables count 5-minute slots. A week is 2,016 slots, which is a small domain. | ✅ |
| 6 ALAP | Maximize the sum of starts (or minimize Service − end) | ✅ |
| 7 Pins fixed, even when they break rules | A pin is a fixed value. A pin that breaks a rule would make the model infeasible, so for pinned Tasks the builder must **leave out the rules about the pin itself** and keep only its effect on others (its Cook time is taken, and its dependants wait for it). **Conflicts are our own code** (the prototype's `conflicts()`). | ⚠️ needs care in the builder |
| 8 Stay close to previous Plan | A hint is **not** enough: the proto says "no guarantee that the solver will … return a solution 'close' to this assignment" ([cp_model.proto](https://github.com/google/or-tools/blob/stable/ortools/sat/cp_model.proto)). Use an **objective term**: minimize `Σ |start − previousStart|` (`addAbsEquality`), weighted above ALAP. Also pass the previous Plan as a hint for speed. "Extra time only pulls in Unplaced Tasks" fixes the placed Tasks. | ✅ by objective |
| 9 Unplaced with a reason | **Placing:** optional intervals with a presence literal, maximizing the number present. This is or-tools-wasm only; cpsat-js would need a small PR or a raw-proto patch. **Reason:** CP-SAT doesn't give one. `sufficient_assumptions_for_infeasibility` is "sufficient", not minimal (proto), and still needs mapping to sentences. **Our own explainer stays** (see below). | ⚠️ placing yes, reason ours |
| 10 `now` / progress | Done and started Tasks are fixed values. Every other start gets a lower bound of `ceil(now)`. | ✅ |
| 11 Same answer in browser and Node | Yes, if both run **the same WASM with the same parameters**: one worker, a fixed `random_seed`, and a `max_deterministic_time` limit instead of a wall-clock one. `interleave_search` "is deterministic (independently of num_workers!)" but is marked experimental ([sat_parameters.proto](https://github.com/google/or-tools/blob/stable/ortools/sat/sat_parameters.proto)). Native OR-Tools on a server, or the threaded 8-worker default, can return a *different* equally good Plan. | ✅ with discipline |

**Priority order of the objective.** Spec §5 ranks: fit the most Tasks, then stability, then ALAP. CP-SAT takes one objective, so there are two ways to get this order:

- **Weights:** `W_fit ≫ W_stable ≫ 1`. With 200 Tasks × 2,016 slots this fits easily in int64.
- **Up to three solves**, each fixing the previous level's optimum.

**What of our own code remains:**

- types and the model builder (~150–250 lines),
- the pre-checks and the Unplaced explainer (the prototype's `bounds()` plus a slot scan, ~100 lines),
- `conflicts()` (~80 lines),
- the diff and "moved" log,
- worker plumbing.

What goes away is the search order, the latest-first and nearest-first slot walk, and the Cook ordering heuristic. Phase 3's several Cooks and Equipment become extra constraints, not a new heuristic.

**Risks:**

- **Both packages are months old and each has one maintainer.**
  - Mitigation: both build the same `CpModelProto`, so the model can move to `cpsat-js`, `or-tools-wasm`, or native OR-Tools (Python `ortools` 9.15, PyPI, 2026-01-14) without rewriting it.
- **Live re-plan speed in a single-threaded browser build is unmeasured.** cpsat-js's README shows the single-threaded build ~10× slower than 8 workers on one model.
- **or-tools-wasm's COOP/COEP headers are a decision for the whole app.** They block cross-origin resources that don't opt in.

### 1b. Our own greedy (the plan-editing prototype)

- **What it is:** No dependency: ~200 lines of prototype `place`, `bounds`, `schedule` and `conflicts` ([prototype](https://github.com/maloferriol/miseflow/blob/prototype/plan-editing/prototypes/plan-editing.prototype.html)).
- **Fit:** Every rule is already handled, including pins, reasons ("Must finish by … because …"), "nearest to where it was" stability, and cook lock and Equipment.
- **Determinism:** Exact and instant, in the browser and in Node.
- **Weakness:** It can leave a Task Unplaced when a valid Plan exists. The prototype showed this, and the spec accepts it for now. The owner would maintain the scheduling logic itself.
- **Licence, size:** ours, ~0 KB.

### 1c. CP-SAT natively on the server (Python or native sidecar)

- **Versions:** `ortools` 9.15.6755 on PyPI (Apache-2.0, 2026-01-14, ~28 MB wheel). or-tools-wasm also ships a Docker native server.
- **Strengths:** The most mature runtime, multi-threaded and fastest. It has the full API, including assumptions.
- **Weaknesses:**
  - It breaks rule 11 (browser and Node).
  - It adds a second runtime next to Hono.
  - Every live re-plan becomes a network round trip.
- **Best use:** Only as the "try harder" engine the spec already reserves for phase 5, or as an exit route if the WASM packages die. The same `CpModelProto` is accepted.
- **Rejected:** `@ortools-node/cp-sat`, a native Node binding (npm 9.15.0-node.0-rc.0). Its source fork `tomquist/or-tools` is **archived**, it was never released beyond rc, and the package is 326 MB unpacked.

### 1d. Timefold Solver (JVM sidecar)

- **Versions:** Apache-2.0 Community Edition, v2.7.1, 2026-10-06, 1.8k stars. The Python package is still beta (`timefold` 1.24.0b0 on PyPI).
- **Fit on paper:**
  - `@PlanningPin` ("A pinned planning entity doesn't change during solving").
  - `allowsUnassigned` for Unplaced Tasks.
  - hard/medium/soft scores.
- **Against:**
  - **JVM server only**, so it fails rule 11.
  - Score explanation (`ScoreAnalysis`) is "exclusive to Timefold Solver Enterprise Edition" ([docs](https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/understanding-the-score)), so reasons would still be ours.
- **Not recommended.**

### 1e. Gantt / project-management scheduling engines

These implement **Microsoft-Project-style scheduling**. They push dates through dependencies and date constraints, by forward or backward pass with working calendars. They **don't place work so that one person isn't doing two things at once**, which is the core of MiseFlow's problem (rule 2 plus the Cook's `NoOverlap`). Dragging a task typically turns it into a manual date constraint.

| Engine | Licence and cost | Latest | What it does | Fit |
| --- | --- | --- | --- | --- |
| Bryntum Gantt / Scheduler Pro engine (built on [ChronoGraph](https://github.com/bryntum/chronograph), MIT, v2.0.3) | **Commercial**. Gantt is "from $940 per developer", Scheduler Pro $1,100 ([store](https://bryntum.com/store/)). No free personal licence is listed. ChronoGraph alone is only a reactive computation graph, not a scheduler. | `@bryntum/gantt-trial` 7.3.7, 2026-09-24 | Forward/backward projects, MSO/MFO/SNET/SNLT/FNET/FNLT constraints, `manuallyScheduled`, FS/SS/FF/SF links with lag, calendars, and headless operation on Node ([engine docs](https://bryntum.com/dist/gantt/docs/engine/classes/_docs_src_gantt_tasks_scheduling_.gantttasksscheduling.html)). ALAP is project-level only, per a Bryntum forum answer of unknown date. In 2021 Bryntum said it had no resource levelling ([forum](https://forum.bryntum.com/viewtopic.php?p=90440)). Current status is unverified. | ❌ no unary-resource placement, no Unplaced reasons, paid |
| DHTMLX Gantt auto-scheduling | Community edition MIT, but auto-scheduling "is available only in the PRO edition" ([guide](https://docs.dhtmlx.com/gantt/guides/auto-scheduling/)). Individual licence **$799**, one developer, one project ([licences](https://dhtmlx.com/docs/products/licenses.shtml)). | `dhtmlx-gantt` 10.0.3, 2026-09-03 | `constraint_type` (asap, alap, snet, …) plus `constraint_date`, `auto_scheduling:false` for manual tasks, and backward planning via `schedule_from_end` + `project_end`. Conflict reporting covers circular links only. | ❌ same gap, paid |
| [gantt-schedule-engine](https://github.com/handyhandymanadam/gantt-schedule-engine) | MIT | 0.1.0, 2026-08-30, 0 stars | Pure functions: CPM, forward FS auto-schedule, calendars. Resource conflicts are *flagged, not resolved*. Backward planning and ALAP are "Deferred". | ❌ forward-only, no placement, brand new |
| `@braedonsaunders/appkit-scheduling` | **AGPL-3.0-or-later** | 2.0.0, 2026-09-12 | CPM, calendars, levelling, Gantt UI | ❌ AGPL in a browser bundle, plus the same mismatch |
| `@korastd/critical-path-method` | MIT | 0.1.0, 2026-08-20 | CPM only | ❌ |

ADR 0009 already decided to build our own Gantt chart, so nothing here is needed for display either.

### 1f. Other solvers checked and rejected

- **[minizinc](https://github.com/MiniZinc/minizinc-js) (MPL-2.0, 4.5.2, 2026-10-07, 19.6 MB):**
  - It has the same modelling power as CP-SAT, but in a second language.
  - It has no hint or stability mechanism.
  - FindMUS (minimal explanations) is likely server-only.
  - The prior research's view still holds: an option, not the first choice.
- **LP/MIP:**
  - [`highs`](https://github.com/lovasoa/highs-js) (MIT, 1.15.3, 2026-09-11, 4 MB)
  - [`javascript-lp-solver`](https://github.com/JWally/jsLPSolver) (Unlicense, 1.0.3)
  - `yalps` (MIT, 0.6.4)
  - `glpk.js` (**GPL-3.0**, 5.0.0)

  They have no interval or no-overlap primitives, so scheduling becomes a time-indexed MIP with ~200 Tasks × 2,016 slots. Infeasible results come back as yes/no only. Poor fit.
- **`z3-solver` (MIT, 5.2.0, 2026-08-21, 35.8 MB):** an SMT solver with an optimizer, but no scheduling globals. Not built for this.
- **`dabke` (MIT, 0.84.0):** CP-SAT for **shift rostering** (coverage, shifts, max hours). It needs a Docker solver. Wrong problem.
- **Job-queue "schedulers"** (`agenda`, `node-cron`, `node-schedule`): cron-style job runners, not planners.
- **No npm package for RCPSP** or job-shop scheduling turned up beyond the above. Searches covered `rcpsp`, "job shop scheduling", "resource constrained project scheduling", `cp-sat`, "project scheduling engine" and "critical path method".

---

## 2. How existing schedulers shape input and output

| | Input | Pins | Previous solution | Not everything fits | Output |
| --- | --- | --- | --- | --- | --- |
| **CP-SAT** ([scheduling.md](https://github.com/google/or-tools/blob/stable/ortools/sat/docs/scheduling.md), `cp_model.proto`) | Integer variables with domains. **Interval variables** (`start + size == end`), optional when a presence literal is attached. Constraints: linear, `NoOverlap`, `Cumulative`. One objective. Parameters: time limit, workers, seed. | Fixed domains (start = value) | `solution_hint`: partial, not binding, no "closeness" guarantee. Closeness comes from an objective term. | Status `INFEASIBLE`, plus `sufficient_assumptions_for_infeasibility` (a sufficient core, not a minimal one) if assumptions were given. With optional intervals, the result is a partial solution with presence = false. | Status (`OPTIMAL`, `FEASIBLE`, `INFEASIBLE`, `UNKNOWN`, `MODEL_INVALID`), a value per variable, objective and bound |
| **Timefold** ([building blocks](https://docs.timefold.ai/timefold-solver/latest/domain-modeling/modeling-planning-problems)) | **Problem facts**: unchanging data such as Cooks, windows and Equipment. **Planning entities** with **planning variables** the solver sets, such as a Task's start or Cook. Constraints are code that scores a solution as hard/medium/soft. | `@PlanningPin` on an entity, `@PlanningPinToIndex` on a list | The solution object *is* the input. You pass in the last solution and it starts from there. | `allowsUnassigned`: the variable stays null and must be penalised (medium score) | The same solution object with variables filled in, plus a score. `ScoreAnalysis` per constraint is Enterprise-only. |
| **MS Project / Bryntum / DHTMLX** | Tasks (duration or effort, constraint type and date, manual flag), dependencies (type plus lag), calendars (project, task, resource), and a project start or end with a direction | `manuallyScheduled` / `auto_scheduling:false`, or a Must-Start-On constraint | None. The engine recomputes deterministically from the constraints. A drag becomes a new constraint. | Constraint conflicts are raised as events or dialogs. Overallocation is shown in a histogram, not resolved. | The same task records with computed start and end dates, plus slack and critical-path flags |
| **gantt-schedule-engine** | Plain arrays of tasks, links and a `Calendar` port | n/a | n/a | Resource conflicts *flagged* with candidate tasks | `autoSchedule` **returns proposed changes** and never mutates. The app shows "this moves six tasks". |
| **RCPSP (PSPLIB, or-tools-wasm `RcpspModelBuilder`)** | Activities: duration, demands per resource, successors. Resources with capacities. | n/a | n/a | n/a (makespan only) | Start and end per activity, plus makespan |

**What MiseFlow should take from this:**

- **From Timefold**, the split between *facts* (Cooks, Availability, Service, `now`) and *things to place* (Tasks). Pins live on the Task.
- **From MS-Project-style engines:** they compute from rules alone, so they never feel "sticky". MiseFlow wants stickiness, so the previous Plan must be an explicit input.
- **From CP-SAT:** a solver's answer is *status plus values*. The reasons are ours.
- **From gantt-schedule-engine:** return a **result to apply**, not a mutated state. That matches ADR 0010, where the re-plan mutator writes the difference.

### Proposed input/output for MiseFlow's scheduler (feeds #68)

```ts
// All times are absolute instants on the 5-minute grid (UTC epoch minutes, multiples of 5).
// The caller expands weekly Availability plus overrides into concrete windows, so the
// scheduler knows nothing about time zones or weekdays.
type Instant = number;
type TaskKey = string; // `${'dish'|'batch'}:${ownerId}:${firstStepId}` (ADR 0010)
type CookId = string;
type Window = { from: Instant; to: Instant };

interface ScheduleInput {
  service: { at: Instant; dayStart: Instant }; // dayStart bounds last-minute Tasks
  now: Instant | null; // null while planning far ahead; rounded up to the grid
  cooks: { id: CookId; availability: Window[] }[]; // MVP: exactly one
  equipment?: { id: string; units: number }[]; // phase 3
  tasks: TaskIn[];
  previous: Record<TaskKey, Placement>; // last stored Plan (empty = from scratch)
  mode: "replan" | "fromScratch" | "pullInUnplacedOnly";
  focus?: TaskKey; // the Task just edited goes first / weighs most
}

interface TaskIn {
  key: TaskKey;
  label: string; // for reasons: "Make the stock"
  activeMin: number; // multiple of 5; placeholder 10 if missing
  passiveMin: number;
  approximate: boolean; // a Step used the 10-minute placeholder
  after: TaskKey[]; // finish-to-start, passive time included
  makeAhead: { earliestStart: Instant; shelfLifeMin: number } | null; // null = last-minute
  usedAtService: boolean; // shelf life is checked at Service if nothing else uses it
  cook?: CookId; // Cook lock (phase 3)
  equipment?: string[]; // phase 3
  pin?: { start: Instant; cook?: CookId };
  progress: { state: "todo" } | { state: "started"; at: Instant } | { state: "done"; at: Instant };
}

interface Placement {
  start: Instant;
  cook: CookId;
}

interface ScheduleOutput {
  placements: Record<TaskKey, Placement & {
    activeEnd: Instant;
    end: Instant;
    why: "pinned" | "progress" | "kept" | "moved" | "new";
  }>;
  unplaced: Record<TaskKey, UnplacedReason>;
  conflicts: Conflict[]; // rules broken by pins or progress; the Plan fits around them
  approximate: boolean;
  meta: {
    engine: "greedy" | "cp-sat";
    status: "optimal" | "feasible" | "timeout";
    ms: number;
    moved: TaskKey[];
  };
}

interface UnplacedReason {
  kind: "window" | "noAvailability" | "cookBusy" | "equipmentBusy" | "shelfLife" | "dependencyUnplaced";
  text: string; // "No Cook has 20 free minutes between Fri 00:00 and Fri 19:50"
  earliestStart: Instant;
  latestStart: Instant;
  blockers: TaskKey[]; // pinned/placed Tasks in the way → "unpin the blocking Task"
  fixes: ("moreTime" | "unpinBlocker" | "removeDish" | "addEquipment" | "splitBatch")[];
}

interface Conflict {
  kind: "outsideAvailability" | "beforeDependency" | "pastShelfLife" | "afterService" | "doubleBooked" | "lastMinuteTooEarly";
  tasks: TaskKey[];
  text: string;
}

declare function schedule(input: ScheduleInput): ScheduleOutput; // pure, deterministic
```

**Who supplies what:**

| Part | Greedy (ours) | CP-SAT WASM | Timefold | Gantt engines |
| --- | --- | --- | --- | --- |
| Building `ScheduleInput` from rows (Tasks, Batches, windows) | ours | ours | ours | ours |
| `placements` (the search) | ours | **solver** | **solver** | partly (dependency dates only; no Cook no-overlap) |
| Stability (`previous`, `mode`) | ours (nearest-first slot walk) | ours (an objective term), solver optimises | ours (score), solver optimises | none |
| `unplaced` set | ours | **solver** (presence literals) | **solver** (`allowsUnassigned`) | none |
| `unplaced[].text`, `blockers`, `fixes` | ours | ours | ours (ScoreAnalysis is Enterprise) | none |
| `conflicts` | ours | ours | ours | partial (constraint conflicts) |
| `meta.status` | trivial | **solver** | **solver** | n/a |

---

## 3. Primer: how the recommended option plans a dinner party

*No jargon. The example is ADR 0004's walkthrough.*

Think of the scheduler as **a very fast puzzle solver**. We don't tell it *how* to plan. We give it **the rules** and **a way to score a plan**. It tries a huge number of arrangements, throws away any that break a rule, and keeps the best-scoring one. The solver is Google's CP-SAT, the same engine used for airline crews and factory floors, and it runs inside the browser tab.

**What we hand it.** Saturday's dinner for 6, Service at 19:30. You're free Thursday and Friday evenings and all day Saturday. The jobs are:

- the **chicken stock**: one Batch ×1.5, for the velouté and the beurre blanc. It can be made 3 days ahead and keeps 4.
- the **velouté**
- the **duck** and its **beurre blanc**
- the **tarte tatin** and its **pastry**

Each job has hands-on minutes and waiting minutes (simmering, chilling).

**The rules it must keep:**

- You can't do two hands-on jobs at once.
- Hands-on work only happens when you're free, in one go: no starting the duck at the end of Thursday evening and finishing it on Saturday.
- Waiting time can happen while you're away. The stock can cool overnight.
- A job can't start until what it needs is finished and cooled. The velouté waits for the stock.
- Nothing is made earlier than its make-ahead window allows, and nothing is used after it has gone off.
- Everything is done by 19:30. Last-minute jobs happen on Saturday.
- Times sit on 5-minute marks.

**How it scores a plan.** First, fit in as many jobs as possible. Next, if there was a plan before, move as little as possible. Finally, do everything as late as possible, so food is fresh.

**What comes back.** The stock goes on Thursday evening, as late as it can while still feeding Saturday. The pastry goes on Friday, and the velouté, duck, beurre blanc and tarte on Saturday, each as late as it fits. The solver didn't follow a recipe for doing this. It found that this arrangement keeps every rule and scores best.

**You drag the stock to Wednesday.** That job is now **pinned**: a fixed rule, "the stock starts here". The solver runs again with the pin, scoring "move as little as possible" highly, so the velouté and the rest stay put unless they have to move. If Wednesday breaks a rule (say the stock would be past its 4 days by Saturday), the pin still stays. MiseFlow's own checker then flags it as a conflict.

**You shorten Friday's hours.** The pastry may no longer fit anywhere. The solver is allowed to leave a job out, and it does: the pastry becomes an **Unplaced Task**, and the rest of the plan stands. The solver can say *that* it couldn't fit, but not *why*, so MiseFlow's own checker looks at the pastry's window and your free time and writes the sentence: "You don't have 40 free minutes between Thu 19:00 and Fri 21:00". Press "give the Cook more time", and the solver pulls the pastry back in without moving anything else.

**Why it gives the same answer every time.** The browser and the server run the same solver with the same settings, one worker and a fixed amount of "thinking work" rather than seconds. The same inputs then always give the same plan.

---

## 4. Ranked recommendation

1. **CP-SAT via WASM behind the I/O shape above, with our own explainer and conflict check kept from the prototype.** Prefer **or-tools-wasm** for its complete API (optional intervals, assumptions, `Cumulative` for phase 3), run single-threaded in a browser worker and in Node. Choose **cpsat-js** instead if COOP/COEP headers are unacceptable. That needs a small addition for optional intervals: the proto supports an enforcement literal on intervals, but the TypeScript API doesn't expose it. Keep the model as a `CpModelProto`, so native OR-Tools stays an exit route.
   **Condition:** a spike must show a 200-Task Service solving in roughly ≤300 ms single-threaded in a browser worker, with identical results in Node.
2. **Our own greedy**, the spec's current choice, ported from the prototype. This becomes #1 if the spike is too slow or the WASM packages look unmaintained. It is also the safe fallback, because the explainer code is shared.
3. **Native CP-SAT on the server** (Python `ortools` or or-tools-wasm's native server), for a phase-5 "try harder". It isn't the MVP engine, because it breaks browser-and-Node parity.
4. **MiniZinc (minizinc-js)**: works in both places, but means a second language and no stability mechanism.
5. **Timefold**: JVM-only, and explanations are paid.
6. **Gantt engines (Bryntum, DHTMLX, gantt-schedule-engine)**: the wrong kind of engine, and the capable ones are paid.
7. **LP/MIP libraries**: poor fit.

**What would change this:**

- **Spike too slow, or results that differ between browser and Node:** greedy goes first. CP-SAT stays for server-side "try harder" only.
- **or-tools-wasm or cpsat-js going quiet:** no release or response for months. With a single maintainer, that is the main risk. Go greedy-first, or vendor the WASM build.
- **The owner accepts server-only scheduling for the MVP**, which ADR 0004 allows since the MVP is online-only. Native CP-SAT via or-tools-wasm's native server or Python becomes viable, with the browser showing only the dragged Task until the server answers. This conflicts with ADR 0005's shared-package scheduler and with phase-4 offline use.
- **Phase 3's Equipment and several Cooks arriving sooner:** this favours CP-SAT more, because greedy heuristics get weaker as resources multiply.
- **A free licence for Bryntum's engine, plus resource levelling:** neither exists as far as this research found. Even then, it would not provide Unplaced Tasks or pins-as-conflicts.

## Gaps and things not verified

- **No benchmark was run.** This research didn't install or execute either WASM package. Solve time for a realistic MiseFlow model is the deciding unknown. The spike: model the ADR 0004 dinner and a synthetic 200-Task Service. Time `fromScratch` and `replan` single-threaded in a Chromium worker and in Node 24, and diff the outputs.
- **The CP-SAT-only WASM size inside or-tools-wasm** isn't documented. The npm package is 345 MB because it ships every solver. Measure the Vite production bundle in the spike.
- **Bryntum's current resource-levelling and conflict APIs** weren't checked against the 7.3 docs. Only the engine overview and a 2021 forum answer were read. This doesn't change the verdict, given the licence.
- **Unplaced Tasks with dependants** is a product rule. If the stock is Unplaced, are the velouté and beurre blanc Unplaced too ("dependencyUnplaced"), or placed as if the stock existed? The prototype does the latter. CP-SAT would need `present[b] ⇒ present[a]` for the former.
- **The cpsat-js licence mismatch** (MIT `LICENSE` file vs Apache-2.0 `package.json`) is harmless here, but worth an issue upstream.
