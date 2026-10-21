# Research: reusing a scheduler for MiseFlow

13 Oct 2026 · answers "Can the MVP reuse an existing scheduler instead of writing one?" and feeds "What are the scheduler's input and output?"

Method: a multi-agent web search (5 angles, 23 sources fetched, 25 claims put through 3-vote adversarial checks, all confirmed), plus a manual check of npm metadata on 13 Oct 2026. Claims marked **(unverified)** were not confirmed against a primary source. Claims marked **(reasoned)** are my inference, not measured.

## Recommendation

**1. Write our own deterministic greedy scheduler in TypeScript.** Backward serial schedule generation, with a bounded, count-based repair loop and its own rule checker. Copy the *shapes* of the mature solvers (CP-SAT intervals, Timefold pins and justifications), not their code.

Why:

- **No candidate fits all the hard constraints.** Each one fails at least one of: $0, licence, the same code in the browser and Node 24, no COOP/COEP, or offline. See the table.
- **A solver would only replace the easy part.** Whatever solves, we still have to write pre-checks, the rule checker that reports pin conflicts, domain-language Unplaced reasons, the diff against the previous Plan, progress and "behind", and translation to and from ADR 0010 rows. With a solver we would also write the model translation. The placement search itself is a few hundred lines.
- **Stability is easier in a greedy.** "Only what must move moves" and "try the previous start first, then the nearest slots" is a placement rule a greedy applies directly. In CP-SAT it becomes a weighted distance term plus hints, and hints alone don't guarantee anything.
- **Size.** The CP-SAT WASM runtime alone is 7.3 MB, against tens of KB for the greedy. Speed no longer decides it (see below).

**Speed budget (revised 14 Oct 2026).** The owner accepts a re-plan of a few seconds in the MVP, so <100 ms is a goal, not a requirement. A serial SGS at 200–500 Tasks should still run in milliseconds **(reasoned, not measured)**. Whichever scheduler runs, any re-plan that can be slow needs these:

- **A pending indicator on the Plan.** Show a "Re-planning…" pill on the Gantt as soon as an edit is made. Show the edited Task where it was dropped, and dim the rest until the new Plan arrives. Show it only after a short delay (about 150 ms), so fast re-plans don't flicker.
- **Latest edit wins.** Run the scheduler in a Web Worker so the Gantt stays draggable. Tag each run with the mutation id and drop results from older runs, so a second drag mid-solve doesn't flash a stale Plan.
- **The server answer still wins** (ADR 0007). If it differs from the browser's, the pill becomes a brief "Plan updated" highlight of what moved.
- **Measure before building the indicator.** Time the greedy on a 500-Task generated menu in the test suite. If it stays under ~100 ms, the indicator is a safety net for the slow server round trip only.

**2. The same greedy, plus CP-SAT as an optional "better Plan" in phase 5.** It runs on the server through `or-tools-wasm` in Node, or native OR-Tools, and the greedy stays the offline core. Use it earlier as a **test oracle**: in the test suite, run CP-SAT on generated menus and assert that the greedy places as many Tasks. This turns "where does greedy fail?" into a measured question.

**3. highs-js as an exact fallback.** It is MIT, isomorphic and single-threaded. But a time-indexed MIP for this problem is a poor fit (no intervals, one variable per Task per slot) and could take seconds or more at 500 Tasks **(reasoned)**. Keep it only as a curiosity.

**What would change the ranking:**

- The greedy-vs-oracle tests show realistic menus where the greedy leaves Tasks unplaced that CP-SAT fits, and repairs don't close the gap. Then option 2 moves forward from phase 5.
- `or-tools-wasm` matures, meaning a track record beyond its 1.0.0 release (27 Sep 2026) and a single-threaded build that needs no COOP/COEP. It would also need to be shown deterministic between browser and Node, with `numWorkers: 1` and a deterministic time limit. With a speed budget of seconds, solve time is no longer the blocker; size, headers and determinism are. Then CP-SAT could be the core, while our checker, reasons and diff still stay ours.
- Bryntum offers a free non-commercial licence for its engine **(not found; unverified)**. It still wouldn't fit well: one constraint per task, and calendars that split durations.

## Comparison table

Checked 13 Oct 2026. Sizes are npm unpacked sizes unless stated.

| Candidate | Licence (private, never sold) | Latest release / activity | Size | Browser + Node 24 | Deterministic | Hard rules & objectives | Pins / previous Plan | Explains a Task that didn't fit | Our code still needed |
|---|---|---|---|---|---|---|---|---|---|
| **Own greedy (TS)** | Ours | n/a | ~tens of KB **(reasoned)** | Yes, plain TS | Yes, by construction (no clock, count-based budgets, ties broken by key) | All, written by us. ALAP is the backward direction itself. Placed-count via repair passes | Pins are fixed occupants. Previous start tried first, then nearest slots | Reason built at the failing step: window, free time, blocking pin | All of it (~1–2k lines **(reasoned)**) |
| **or-tools-wasm (CP-SAT)** | Apache-2.0 ✅ | 1.0.0, 27 Sep 2026. First release 0.5.0 on 13 May 2026; 7 releases | CP-SAT runtime `.wasm` 7.3 MB (11.6 MB asyncify), 345 MB whole package | Yes. CI badges for Node 24, Chromium, Firefox and Vite 8. **Threads need COOP/COEP in the browser** | Only with `numWorkers: 1` and a deterministic time limit **(unverified for this port)** | Intervals with optional presence, NoOverlap per Cook and Equipment, max lags as linear constraints, ALAP as maximize Σ end. Availability needs fixed blocking intervals or domains | `add_hint` warm start (not a guarantee). Pins as fixed variables, but then a pin breaking a rule makes the model infeasible, so pins must be taken out of the rules and checked by our checker | Assumption cores (`sufficient_assumptions_for_infeasibility`): sufficient, not minimal, single worker, needs an extra infeasible re-solve | Model translation, checker, reasons, diff, pre-checks |
| **OR-Tools CP-SAT, native** | Apache-2.0 ✅ | v9.15 (pdoc) | n/a (server) | No, server only. Official bindings are C++/Python/Java/.NET; no official Node binding **(from prior knowledge)** | As above | As above | As above | As above | As above, plus a non-TS process. Doesn't fit Vercel functions or offline |
| **MiniZinc (`minizinc` npm)** | MPL-2.0 ✅; bundled solvers MIT/EPL | 4.5.2, modified 7 Oct 2026 | 19.6 MB unpacked (wasm + data) | **No**: browser uses WASM, Node needs a native MiniZinc on PATH | Solver-dependent | `cumulative`/`disjunctive` globals in a modelling language | Solver-dependent hints | None built in | Model in a second language, plus everything above |
| **Timefold Solver** | Apache-2.0 Community; ScoreAnalysis is **Enterprise (paid)** | v2.7.1, 6 Oct 2026 | JVM | **No** (JVM) | Yes with a fixed seed and step limit **(unverified)** | Constraint streams; scores in hard/medium/soft levels | `@PlanningPin`: "never changed during planning" | `ConstraintMatch` + user-defined `ConstraintJustification`; JSON analysis needs Enterprise | Java service. Fails offline |
| **Bryntum Scheduling Engine** | Proprietary, "All rights reserved" ❌ | Docs dated 2018–2023; current version not checked | n/a | Isomorphic per secondary sources **(unverified)** | Yes (propagation, not search) | Project/event/resource calendars; `ConstraintType` ASAP, ALAP, MSO, MFO, SNET, SNLT, FNET, FNLT, **one per task** | `manuallyScheduled` | Conflict resolution UI | Does not fit: no release date and deadline at once, and calendars split durations |
| **DHTMLX Gantt PRO auto-scheduling** | Community MIT (v10+), but **auto-scheduling is PRO, from $799** ❌ | v10 line, 2026 | n/a | Browser (UI library) | Yes (propagation) | `schedule_from_end` + `project_end` = ALAP; constraint types | Manual-schedule flag | Not a resource solver | Doesn't fit cost; it's a Gantt widget, and ADR 0009 builds our own |
| **highs-js (`highs`)** | MIT ✅ | 1.15.3, modified 11 Sep 2026 | 4.0 MB unpacked | Yes; **single-threaded, no COOP/COEP** | Yes (single thread) | Only as a time-indexed MIP: binary per Task per slot. No intervals | MIP start possible **(unverified in highs-js)** | Infeasible status only | Model generator, checker, reasons, diff |
| **javascript-lp-solver** | Unlicense ✅ | 1.0.3, modified 24 Jan 2026 | 2.4 MB unpacked | Yes (pure JS) | Yes | LP/small MIP only | No | No | Same as highs-js, and slower **(reasoned)** |
| **glpk.js** | **GPL-3.0** ⚠️ (fine while private, but avoid) | 5.0.0, modified 23 Dec 2025 | 2.6 MB | Yes | Yes | Time-indexed MIP | No | No | Same as highs-js |
| npm "RCPSP" / job-shop packages | — | npm search for `rcpsp` returned nothing relevant | — | — | — | — | — | — | Not a candidate |

## Proposed TypeScript types

Design choices taken from the research:

- **Times are integer minutes on a 5-minute grid, relative to an epoch the caller chooses** (for example, midnight on the first plan day in kitchen time). The scheduler never sees a `Date` or a time zone, so it stays pure and the same in both runtimes.
- **Pins work like `@PlanningPin`**: a boolean on the placement. A pinned Task is never moved and is excluded from search. It is still *checked*, and breaking a rule yields a Conflict.
- **Unplaced works like a CP-SAT optional interval with presence false.** Every Task ends up either in `placements` or in `unplaced`, never in both.
- **Reasons and conflicts are typed justifications** (Timefold's `ConstraintJustification`). The UI renders them as sentences and picks the quick fix, so the scheduler holds no copy text.
- **Make-ahead and shelf life follow Bryntum/DHTMLX vocabulary**: earliest start = SNET; Service = FNLT; shelf life = a maximum time lag (RCPSP/max).

```ts
// ---- shared ----
type Minute = number;            // minutes since input.epoch, multiple of 5
type CookId = string;
type EquipmentId = string;
/** Whose Step it is: the same Recipe's Step can belong to two Dishes (ADR 0010). */
type Owner = { kind: 'dish'; dishId: string } | { kind: 'batch'; batchId: string };
/** ADR 0010 key: Dish or Batch plus first Step id. */
type TaskKey = `${'dish' | 'batch'}:${string}:${string}`;

interface Interval { start: Minute; end: Minute }   // half-open [start, end)

// ---- input ----
interface SchedulerInput {
  epoch: string;                  // opaque, echoed back; caller converts to dates
  service: { start: Minute; end: Minute };          // rule 9: nothing inside
  tasks: TaskSpec[];
  links: Link[];                  // finish-to-start, sub-recipe graph + manual
  cooks: CookSpec[];              // MVP: exactly one
  equipment: EquipmentSpec[];     // phase 3; [] in MVP
  previous: PreviousPlacement[];  // from task_placements
  progress: ProgressEvent[];      // append-only, already filtered to this Service
  now: Minute | null;             // null while planning ahead
  mode: 'live' | 'fromScratch';
  focus?: TaskKey;                // the Task just edited: placed first
  budget?: { repairPasses: number; backtrackNodes: number };  // counts, never ms
}

interface TaskSpec {
  key: TaskKey;
  owner: Owner;
  stepIds: string[];              // consecutive Steps grouped in this Task, all of this owner
  /** In order. Each active segment must sit inside one Availability window. */
  segments: { kind: 'active' | 'passive'; minutes: number; approximate: boolean }[];
  window:
    | { kind: 'lastMinute' }                                       // rule 6
    | { kind: 'makeAhead'; earliestStart: Minute; shelfLifeMin: number | null }; // rule 7
  cook?: { fixed?: CookId; eligible?: CookId[] };   // phase 3
  equipment?: EquipmentId[];                         // phase 3, held active + passive
  station?: string;                                  // phase 3
}

interface Link { before: TaskKey; after: TaskKey; source: 'subRecipe' | 'manual' }

interface CookSpec { id: CookId; availability: Interval[] }  // weekly + overrides, already expanded
interface EquipmentSpec { id: EquipmentId; units: 1 }

interface PreviousPlacement { key: TaskKey; start: Minute; cookId: CookId; pinned: boolean }

/**
 * Mirrors a step_events row (ADR 0010): Dish or Batch plus Step, not a TaskKey.
 * A ticked Step need not be its Task's first Step, and Task grouping is derived,
 * so the scheduler maps (owner, stepId) to the Task holding that Step.
 */
interface ProgressEvent { owner: Owner; stepId: string; kind: 'done' | 'undone'; at: Minute }

// ---- output ----
interface SchedulerOutput {
  placements: Placement[];
  unplaced: Unplaced[];
  conflicts: Conflict[];          // pins (and Service-day edits) that break rules
  prechecks: PrecheckFailure[];   // fail regardless of Availability
  behind: { key: TaskKey; holdsUp: TaskKey[] }[];
  approximate: boolean;           // any segment uses the 10-minute placeholder
  diff: PlanDiff;
  stats: { passes: number; backtracks: number };   // for tests and tuning
}

interface Placement {
  key: TaskKey;
  start: Minute;
  cookId: CookId;
  pinned: boolean;
  segments: (Interval & { kind: 'active' | 'passive' })[];  // derived, for the Gantt
  end: Minute;
}

interface Unplaced { key: TaskKey; reason: UnplacedReason }

type UnplacedReason =
  | { kind: 'noFreeTime'; minutesNeeded: number; between: Interval; cookIds: CookId[] }
  | { kind: 'blockedByPin'; pin: TaskKey; between: Interval }
  | { kind: 'dependencyUnplaced'; dependency: TaskKey }
  | { kind: 'precheck'; failure: PrecheckFailure['kind'] };

type Conflict =
  | { kind: 'outsideAvailability'; key: TaskKey; segment: Interval }
  | { kind: 'overlap'; key: TaskKey; with: TaskKey; resource: CookId | EquipmentId }
  | { kind: 'beforeDependency'; key: TaskKey; dependency: TaskKey; byMin: number }
  | { kind: 'pastShelfLife'; key: TaskKey; usedBy: TaskKey | 'service'; byMin: number }
  | { kind: 'tooEarly'; key: TaskKey; earliestStart: Minute }
  | { kind: 'duringService'; key: TaskKey };

type PrecheckFailure =
  | { kind: 'chainTooLong'; chain: TaskKey[]; needMin: number; window: Interval }
  | { kind: 'shelfLifeTooShort'; key: TaskKey; shelfLifeMin: number; gapMin: number }
  | { kind: 'noAvailability'; cookIds: CookId[] }
  | { kind: 'cycle'; keys: TaskKey[] };

interface PlanDiff {
  moved: { key: TaskKey; from: Minute; to: Minute }[];
  newlyPlaced: TaskKey[];
  newlyUnplaced: TaskKey[];
}
```

**Which parts each top candidate would supply:**

| Part | Own greedy | + CP-SAT (option 2) | highs-js |
|---|---|---|---|
| Input normalising, time windows, pre-checks | ours | ours | ours |
| Placement search (`placements`, which Tasks are `unplaced`) | ours | **CP-SAT** (presence literals, NoOverlap, maximize presence ≫ −distance ≫ Σ end) | **HiGHS** (time-indexed MIP) |
| Stay close to previous Plan | ours (previous start first) | CP-SAT hints + distance term | objective term |
| `conflicts` for pins | ours (rule checker) | ours: pins are excluded from the model and checked afterwards | ours |
| `UnplacedReason` | ours, at the failing step | partly CP-SAT (assumption core), mapped by us | ours |
| `diff`, `behind`, `approximate` | ours | ours | ours |

The rule checker (`check(input, placements) → Conflict[]`) is worth writing first. It reports pin conflicts, serves as the property-test oracle for any scheduler, and validates a CP-SAT answer.

## How a greedy should work (question 4)

The literature frames this as RCPSP with minimum and maximum time lags (make-ahead, shelf life) and break calendars (Availability). See Kreter, Rieck & Zimmermann 2016 and Kreter, Schutt & Stuckey 2017. The standard heuristic is a **serial schedule generation scheme (SGS)**: take the next eligible activity by priority and place it at its best feasible time. Search methods only change the *order*, not the start times. Run backward, a serial SGS gives ALAP directly.

**Algorithm sketch:**

1. **Normalise.** Build the graph and detect cycles. Fold in progress: done Tasks are fixed at their actual times. Pins are fixed occupants of their Cook's timeline.
2. **Time windows.** Propagate the bounds: latest finish backward from Service through links; earliest start forward from make-ahead. Shelf life adds a lower bound, since a Task must finish no earlier than its user's start minus shelf life. **Pre-checks** come out of this pass: a chain longer than its window, or shelf life shorter than the forced gap.
3. **Order.** Eligible = all successors already placed (backward). Priority:
   - live mode: the `focus` Task first, then Tasks with a previous placement by previous start, latest first;
   - from scratch: latest latest-finish first, then least slack (the LST/MSLK family; slack-based rules also won in Kimura et al.'s restaurant study), then longest active segment first (fights window fragmentation), then `TaskKey` as a deterministic tie-break.
4. **Place.** The upper bound is the earliest successor start (or Service end). The lower bound is the maximum of make-ahead and shelf life to successors. The Cook's free timeline is Availability minus Service minus occupied intervals. Each active segment must fit inside one free interval; passive segments are unconstrained (except Equipment, phase 3).
   - live mode: the previous start if still feasible, else the nearest feasible slot, preferring later;
   - from scratch: the latest feasible start.
   - Phase 3: try each eligible Cook and pick by the same rule, then by load.
5. **Fail → reason.** With no slot in `[lower, upper]`: if a pin occupies the only big-enough gap → `blockedByPin`; otherwise `noFreeTime` with that window. Mark the Task's predecessors `dependencyUnplaced`.

**Where single-pass greedy fails:**

- **Shelf life (maximum lags).** A successor placed late leaves its predecessor a window too narrow. Example: whipped cream that keeps 2 h, with the cook busy before plating. Moving the successor earlier would have fixed it. This is the classic RCPSP/max dead end.
- **Window fragmentation.** Short Tasks split an evening window, and a 90-minute active Task then fits nowhere.
- **Pins.** A pin in the middle of a window splits it the same way.

**Cheap repairs, all deterministic and budgeted by count, never by wall-clock (time budgets break browser–server agreement):**

1. **Bump-and-retry ("squeaky wheel").** Re-run with the unplaced Tasks moved to the front of the priority list, for up to N passes. Keep the result with the most Tasks placed, then the least moved, then the latest. Gonçalves, Resende & Mendes (2011) show the general pattern: perturb the priority list, keep a greedy decoder.
2. **One-level backtracking.** When Task *t* fails, find the placed non-pinned Tasks in its window, unplace them, place *t*, then re-place them. Accept only if the placed count goes up. Cap the node count.
3. **Justification (forward-backward improvement), from-scratch mode only.** A right-shift pass in order of decreasing end time pushes everything as late as the new gaps allow (Valls, Ballestín & Quintanilla 2005; Gonçalves et al. 2011). Never run it in live mode, where it would move stable Tasks.
4. If randomised priorities are ever wanted, seed the PRNG with a hash of the input. Same input → same seed → same Plan.

## The example dinner, in plain language

*Assumed Availability: Thu and Fri 18:00–22:00, Sat 09:00–19:30. Service Sat 19:30.*

The menu has a velouté made from a stock. The stock is a Batch with three jobs: **start the stock** (30 min hands-on), **simmer** (3 h, no hands, can run overnight) and **skim and strain** (20 min hands-on). Then the stock **cools** for 1 h, hands-off. The velouté takes 30 min hands-on and a 10-minute **plate and serve**, not yet timed, so the Plan shows ≈. The stock may be made up to 3 days ahead and keeps 4 days.

**How the scheduler thinks.** It works *backward from dinner*, like a cook counting back from "plates go out at 19:30". It takes the job closest to Service first and puts it as late as it can. Then it steps back to the job before it, and so on. Hands-on jobs must fit inside a stretch of your free time without a break. Hands-off jobs can run any time, even overnight.

1. **Plate and serve** goes last: Sat 19:20–19:30.
2. **Velouté** must finish before plating: 18:50–19:20.
3. **Cooling** must finish before the velouté starts: 17:50–18:50. You're not needed, so it could run outside your free time.
4. **Skim and strain** must finish before cooling: 17:30–17:50, inside your Saturday hours.
5. **Simmer**: 14:30–17:30. **Start the stock**: 14:00–14:30.

Everything lands on Saturday afternoon, because "as late as possible" means as fresh as possible. Nothing is more than 4 days old, and nothing starts more than 3 days early.

**You change something.** Say Saturday fills up and you're now free only from 18:00. The scheduler re-fits *only what no longer fits*. Plating and the velouté still fit, so they stay put. Skimming must end by 17:50, and you're not free then on Saturday. The scheduler looks at the previous free stretch, Friday evening: skim 21:40–22:00, simmer 18:40–21:40, start the stock 18:10–18:40. The stock cools overnight, which is fine because cooling is hands-off. The Gantt highlights the three stock jobs that moved.

**You drag something.** Drag "start the stock" to Thursday 19:00 and it becomes **pinned**: it never moves again until you unpin it. The rest re-fits around it. If a pin breaks a rule (say you drag it to Tuesday, more than 3 days before dinner), it stays where you put it. The Plan then shows a **conflict**: "Started before its make-ahead window".

**Something can't fit.** If your only free time is Saturday 18:00–19:30, the stock can't be done in time. It shows up as **Unplaced**, with a reason in kitchen terms: "You have no 20 free minutes between Wed 19:30 and Sat 17:50". The Plan offers quick fixes: add time, unpin what's in the way, or remove the dish. Everything else still gets planned.

**Same answer everywhere.** The scheduler uses no clock and no dice. Your browser and the server get exactly the same Plan from the same inputs, which is why the browser can show it instantly and the server can confirm it.

## Prior art

- **Kreter, Rieck & Zimmermann (2016)**, *Models and solution procedures for the RCPSP with general temporal constraints and calendars*, EJOR 251(2):387–403, doi:10.1016/j.ejor.2015.11.021. The closest formal match: break calendars plus min/max lags; priority-rule method, scatter search. Abstract only checked.
- **Kreter, Schutt & Stuckey (2017)**, *Using constraint programming for solving RCPSP/max-cal*, Constraints, doi:10.1007/s10601-016-9266-6. Six CP models plus a calendar propagator. The objective is makespan, so it would need reversing for ALAP. Abstract truncated.
- **Kimura et al. (2018)**, *Cooking scheduling in restaurants* (JAMDSM 12(3), doi:10.1299/jamdsm.2018jamdsm0076). Restaurant cooking as online job shop; the SLACK dispatching rule did best on real order data. Reactive and order-driven, not multi-day prep, but the only kitchen-domain source found.
- **Valls, Ballestín & Quintanilla (2005)**, *Justification and RCPSP: a technique that pays*, EJOR 165(2):375–386. Metadata only; the findings are **unverified** from this source and cited via the handout and the 2014 ICAPS paper below.
- **Gonçalves, Resende & Mendes (2011)**, BRKGA with forward-backward improvement, J. Heuristics 17:467–486. A greedy decoder with perturbed priorities, plus justification on every solution.
- **ICAPS 2014**, a justification-inspired priority rule (ojs.aaai.org/index.php/ICAPS/article/view/13645). Justification improves even random schedules; a priority rule that imitates it beats prior rules.
- **Chiarandini, DM865 handout** (SDU, 2020). A clear tutorial on serial vs parallel SGS, forward, backward and justification, and time-dependent capacity for calendars.
- No open-source meal-prep or catering prep scheduler survived verification. Home-care and shift scheduling were searched but yielded no verified claims.

## Sources

Primary sources, opened 13 Oct 2026:

- OR-Tools CP-SAT scheduling guide: https://github.com/google/or-tools/blob/stable/ortools/sat/docs/scheduling.md
- CP-SAT Python API (v9.15): https://or-tools.github.io/docs/pdoc/ortools/sat/python/cp_model.html and `cp_model.py` in the same repo. The developers.google.com reference page returned 404.
- or-tools-wasm README: https://github.com/Axelwickm/or-tools-wasm and npm `or-tools-wasm` (versions, file list via `npm pack --dry-run`)
- Timefold, understanding the score: https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/understanding-the-score; repo https://github.com/TimefoldAI/timefold-solver
- OptaPlanner `@PlanningPin` javadoc: https://docs.optaplanner.org/latest/optaplanner-javadoc/org/optaplanner/core/api/domain/entity/PlanningPin.html
- Bryntum engine: https://bryntum.com/products/gantt/docs/engine/ and its `ConstraintType` enum page
- DHTMLX auto-scheduling: https://docs.dhtmlx.com/gantt/guides/auto-scheduling/; licensing blog https://dhtmlx.com/blog/?p=15737; pricing https://dhtmlx.com/docs/products/dhtmlxGantt/#licensing
- MiniZinc JS docs: https://js.minizinc.org/docs/stable/; https://github.com/MiniZinc/minizinc-js
- highs-js: https://github.com/lovasoa/highs-js; npm `highs`
- npm metadata (`npm view`) for `highs`, `minizinc`, `javascript-lp-solver`, `glpk.js`, `@bubblyworld/highs-ts`, `or-tools-wasm`
- Papers: see Prior art. Also https://www.imada.sdu.dk/~marco/Teaching/AY2019-2020/DM865/assets/dm865-scheduling-rcpsp-handout.pdf and https://mauricio.resende.info/abstracts/rcpsp-fbi.html

**Unverified or not checked:**

- the determinism of `or-tools-wasm` across browser and Node;
- CP-SAT solve times for 500 Tasks;
- the greedy's speed (reasoned, not measured);
- Bryntum's current version and any non-commercial licence;
- whether highs-js supports MIP starts;
- that OR-Tools has no official Node bindings (from prior knowledge);
- Timefold determinism settings.
