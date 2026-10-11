# Research: what scheduling approach fits Tasks into Availability?

Ticket: [#7](https://github.com/maloferriol/miseflow/issues/7) (map: [#1](https://github.com/maloferriol/miseflow/issues/1)). Researched 2026-10-11. Terms follow [CONTEXT.md](../CONTEXT.md).

## The problem, restated

For one Service we have tens to a few hundred **Tasks**. Each Task has:

- a duration,
- an optional assignee,
- exactly one **Station**,
- optional **Equipment** needs. Each unit is named, with capacity 1 by default and an optional count.
- dependencies (a DAG from the sub-recipe graph plus manual Step links),
- a **Make-ahead window**:
  - _earliest start_: start ≥ Service − make-ahead;
  - _shelf life_: finish ≥ Service − shelf life;
  - _deadline_: finish ≤ Service. Courses are ordered but have no clock times.

People have **Availability** windows spread over several days, with a kitchen-wide default and per-person overrides. The output is a **suggested, editable Plan**. The user can pin, move or reassign Tasks and then re-plan around those pins. The scheduler has to run inside a web app, fast enough for interactive re-planning, and it has to explain infeasibility: what doesn't fit, and why.

In OR terms this is a **resource-constrained project scheduling problem (RCPSP)** with these features:

- **Release dates and deadlines**: the make-ahead windows.
- **Calendars**: people's Availability.
- **Unary resources**: Equipment units and people.
- **Multi-mode choice**: which person does an unassigned Task.
- **A backward ("as late as possible") objective**: food is made as close to Service as possible.

RCPSP is NP-hard. In practice, though, a few hundred activities is small for both priority-rule heuristics and modern CP solvers (see below).

## Candidates

### 1. Greedy list scheduling, run backward (serial schedule-generation scheme)

**What it is.** Sort Tasks by a priority rule, then place them one at a time at the latest feasible slot that respects resources and calendars. "Latest" means walking backward from the Service through successors, which gives ALAP placement. This is the classic _serial schedule-generation scheme_ (SGS) studied by Kolisch (1996), who compared it with the _parallel_ scheme as both single-pass and sampled multi-pass heuristics ([EJOR 90(2):320–333](https://ideas.repec.org/a/eee/ejores/v90y1996i2p320-333.html); [working paper](https://econpapers.repec.org/RePEc:zbw:cauman:344)). Kolisch & Hartmann's benchmark surveys rank many RCPSP heuristics built on these schemes ([EJOR 174(1):23–37, 2006](https://ideas.repec.org/a/eee/ejores/v174y2006i1p23-37.html), doi:10.1016/j.ejor.2005.01.065). Calendars, meaning periods when resources are unavailable, have known algorithms: Franck, Neumann & Schwindt give earliest and latest start/finish computations for activities that can and cannot be interrupted under calendars, and show how they plug into priority-rule methods ([OR Spektrum 23:325–334, 2001](https://link.springer.com/doi/10.1007/PL00013355)).

- **Fit.** Every constraint here is a local check when placing one Task: it must fit inside a person's free window, the Equipment units must be free, it must finish before its successors' starts, it must lie within the make-ahead window, and an explicit assignee must be respected. Two choices are needed: a priority rule (for example latest-finish or longest-tail first) and a rule for picking a person when no assignee is set (for example the person with the most free time at that slot). Interruptible Tasks are a product decision. Can a 3-hour stock span someone's lunch break? The calendar paper above covers both cases.
- **Pinning and re-planning.** This is natural. Place pinned Tasks first as fixed reservations, then schedule the rest around them. The output is deterministic, so the same input gives the same Plan, and small edits tend to produce small diffs if the priority order is stable.
- **Infeasibility explanation.** This is the strongest point. When a Task can't be placed, the algorithm knows the exact reason at that moment. Examples: "no window between its earliest start (Thu 18:00) and its successor's start (Fri 09:00)"; "oven busy with X and Y"; "assignee Ana has no Availability in that range". Before placing anything, a cheap pre-pass can catch problems that are infeasible regardless of resources. One is a dependency chain longer than its make-ahead window allows, found by critical-path / longest-path on the DAG. Another is a shelf life shorter than the time needed downstream.
- **Weakness.** It isn't optimal. A single greedy pass can fail on an instance that is actually feasible: an earlier choice blocks a later Task. The usual fix is the multi-pass or randomized-priority sampling studied by Kolisch (1996), or a small repair or backtracking step. "Why didn't it fit" then becomes heuristic: it is true for _this_ construction, not a proof.
- **Runtime and licence.** Plain TypeScript, no dependency, so it runs identically in the browser (offline cache) and on the server. For a few hundred Tasks, a pass costs milliseconds; this is an estimate, since the work is roughly O(n × resources × windows).
- **Maturity.** The method is textbook (decades old). The implementation would be our own code.

### 2. Constraint programming: Google OR-Tools CP-SAT

**What it is.** CP-SAT models scheduling directly with _interval variables_ (`start + size == end`), _optional intervals_ governed by a presence literal, `NoOverlap` ("all intervals are disjoint"), and `Cumulative` (total demand ≤ capacity at every point) ([scheduling docs](https://github.com/google/or-tools/blob/stable/ortools/sat/docs/scheduling.md); [job-shop guide](https://developers.google.com/optimization/scheduling/job_shop)). The docs model unavailable time as _fixed intervals_ placed in a resource's `NoOverlap`, for example blocking weekends or a lunch break. They also show how to make a Task's duration depend on whether it spans a break (scheduling.md, same link).

- **Fit.** Each constraint maps onto a documented construct:
  - **Equipment unit**: `NoOverlap`, or a `Cumulative` with capacity = count.
  - **Person**: one optional interval per (Task, eligible person). Exactly one is present, and each person's `NoOverlap` includes fixed intervals for that person's non-Availability.
  - **Dependencies**: linear `end ≤ start` constraints.
  - **Make-ahead / shelf life / Service**: bounds on start and end.
  - **ALAP**: maximize the sum of starts (or minimize the sum of `Service − end`).
  - **Load balancing or "prefer Station batching"**: added as objective terms.
- **Pinning and re-planning.** Pins become fixed domains on that Task's start and presence. For stability between re-plans, CP-SAT accepts a _solution hint_: a partial or full prior solution. Per the docs, the hint is not a hard constraint; partial and even infeasible hints are allowed ([model.md](https://github.com/google/or-tools/blob/stable/ortools/sat/docs/model.md)). Related parameters are `repair_hint` ("tries to repair the solution given in the hint") and `fix_variables_to_their_hinted_value` ([sat_parameters.proto](https://github.com/google/or-tools/blob/stable/ortools/sat/sat_parameters.proto)). A time limit (`max_time_in_seconds`) gives anytime behaviour, returning the best solution found so far ([solver.md](https://github.com/google/or-tools/blob/stable/ortools/sat/docs/solver.md)).
- **Infeasibility explanation.** Two mechanisms:
  1. **Assumptions.** Put a literal on each group of constraints (per Task window, per pin, per assignee) and pass them as `assumptions`. If the status is INFEASIBLE, the response fills `sufficient_assumptions_for_infeasibility`, a subset of the assumptions that is still infeasible ([cp_model.proto](https://github.com/google/or-tools/blob/stable/ortools/sat/cp_model.proto)). The proto states it is a sufficient subset. It does not promise a minimal one. The proto also notes that assumptions are slower than fixing domains.
  2. **Make Tasks optional** (presence literal), then maximize the number scheduled. The solver always returns a Plan, and the Tasks left out are "what doesn't fit". Saying _why_ still needs a follow-up step: an assumptions core for that Task, or the deterministic pre-checks from candidate 1.

  Neither mechanism gives a human-readable reason on its own. We would map cores back to domain sentences.

- **Runtime and licence.**
  - **Licence and version.** OR-Tools is Apache-2.0 (14k stars, latest release v9.15, Jan 2026, active Oct 2026; per GitHub API). Official bindings are C++, Python, Java and .NET, so the natural home is a **server** endpoint.
  - **Browser.** Possible via the community port [`or-tools-wasm`](https://github.com/Axelwickm/or-tools-wasm): Apache-2.0, on npm, CP-SAT included, typed TS API (`CpModel`, `CpSat.solve`) with Web Worker execution, cancellation and progress events, CI on Chromium and Firefox. It is young: created May 2026, v1.0.0 released 27 Sep 2026, 65 stars, effectively a single maintainer. Browser threading requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, and without them "solving can fail" (README). Those headers constrain the rest of the app, such as third-party embeds. Bundle size isn't documented.
- **Maturity.** CP-SAT itself is very mature and widely used for scheduling. The WASM path is not.

### 3. MiniZinc (modelling language) via `minizinc-js`

**What it is.** A solver-independent modelling language with global constraints (`cumulative`, `disjunctive`). [`minizinc-js`](https://github.com/MiniZinc/minizinc-js) (MPL-2.0, 62 stars, active Sep 2026) runs in the **browser via WASM** in a Web Worker, with Gecode, Chuffed, CBC and HiGHS compiled in, or in Node via a native MiniZinc install. It powers the MiniZinc Playground. Native MiniZinc bundles additional solvers, including OR-Tools CP-SAT ([installation docs](https://docs.minizinc.dev/en/stable/installation.html)).

- **Fit.** It expresses the same model as CP-SAT, in a declarative file.
- **Pinning.** Pins become extra data or constraints passed to the model. MiniZinc has no built-in incremental re-solve or hinting comparable to CP-SAT's.
- **Infeasibility.** [FindMUS](https://docs.minizinc.dev/en/stable/find_mus.html) enumerates minimal unsatisfiable subsets and maps them back to named constraints and source locations, with JSON output. That is a good fit for "why doesn't this fit". The docs don't say it is available in the WASM/JS build, so it is likely server-only (unverified).
- **Trade-off.** Adds a second language (MiniZinc) plus a compile step. The browser solvers (Gecode, Chuffed) are generally slower than CP-SAT on scheduling. That is a general claim and wasn't benchmarked here.

### 4. Timefold Solver (formerly OptaPlanner)

**What it is.** A Java/Kotlin local-search planning engine. The Community Edition is Apache-2.0 (1.8k stars, v2.7.1 Oct 2026) and runs on **Java 21+** ([intro](https://docs.timefold.ai/timefold-solver/latest/introduction); [repo](https://github.com/TimefoldAI/timefold-solver)). The Python port is **archived** ([timefold-solver-python](https://github.com/TimefoldAI/timefold-solver-python)).

- **Fit.** Built for exactly this product shape: a "suggested, editable" plan with hard/medium/soft scores.
- **Pinning and re-planning.** Pinning is first-class: "A pinned planning entity doesn't change during solving" (`@PlanningPin`). Real-time `ProblemChange` lets you edit while solving ([modeling](https://docs.timefold.ai/timefold-solver/latest/domain-modeling/modeling-planning-problems), [real-time planning](https://docs.timefold.ai/timefold-solver/latest/responding-to-change/real-time-planning)).
- **Overconstrained planning.** `allowsUnassigned` leaves Tasks unplaced, penalized at the medium level. That is a natural "what didn't fit".
- **Infeasibility explanation.** Per-constraint breakdown with justifications (`ScoreAnalysis`). Per the docs this is **"exclusive to Timefold Solver Enterprise Edition"** ([understanding the score](https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/understanding-the-score)). Multithreaded solving and the Recommendation API are also commercial.
- **Runtime.** JVM **server only**. No browser or offline path.

### 5. LP/MIP libraries in JS: javascript-lp-solver, glpk.js, highs-js

- [`javascript-lp-solver`](https://github.com/JWally/jsLPSolver): pure JS LP/MIP (simplex plus branch-and-cut), Unlicense, 465 stars, active. Infeasible results only return `feasible: false`.
- [`glpk.js`](https://github.com/jvail/glpk.js): GLPK compiled to WASM, browser and Node. **GPL-3.0**, which is a real licence concern when shipping it to browsers inside a proprietary app.
- [`highs-js`](https://github.com/lovasoa/highs-js): HiGHS compiled to WASM, MIT.
- **Fit.** Poor. None of them has interval, no-overlap or calendar primitives. Scheduling must be encoded as a time-indexed MIP: one binary per (Task, person, time slot). Several days at 5–15 min granularity across a few hundred Tasks means hundreds of thousands of binaries, or big-M disjunctions with weak relaxations. Infeasibility comes back as a yes/no with no explanation. Pinning means fixing variables. Not recommended as the core engine. They are fine for a side problem like shopping quantities.

## Comparison

|                                           | Constraint fit                                                                               | Pins / re-plan                          | Explains infeasibility                                                          | Runs where                                        | Licence                      | Maturity                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------- | ------------------------------------ |
| Greedy backward list scheduling (own TS)  | Good, with priority/person rules; may miss feasible plans                                    | Excellent, deterministic                | **Best**: exact local reason per Task, plus DAG pre-checks                      | Browser and server, ms                            | ours                         | Method: decades. Code: new           |
| CP-SAT (server, native)                   | **Best**: intervals, NoOverlap, Cumulative, optional intervals, calendars as fixed intervals | Good: fixed domains plus hints          | Sufficient (not minimal) assumption cores; optional Tasks; needs domain mapping | Server (Py/Java/C++/.NET)                         | Apache-2.0                   | Very high                            |
| CP-SAT via `or-tools-wasm`                | Same                                                                                         | Same                                    | Same                                                                            | Browser (needs COOP/COEP for threads) or Node     | Apache-2.0                   | Low: v1.0.0 Sep 2026, one maintainer |
| MiniZinc + minizinc-js                    | Very good (declarative)                                                                      | Data-level only                         | FindMUS (minimal subsets), likely server-only                                   | Browser WASM (Gecode/Chuffed/HiGHS/CBC) or server | MPL-2.0                      | Medium                               |
| Timefold Solver CE                        | Very good (built for editable plans)                                                         | **Best**: `@PlanningPin`, ProblemChange | Unassigned Tasks: yes. Score analysis: Enterprise only                          | JVM server only                                   | Apache-2.0 (CE) + commercial | High                                 |
| JS LP/MIP (jsLPSolver, glpk.js, highs-js) | Poor (time-indexed MIP)                                                                      | Fix vars                                | Yes/no only                                                                     | Browser and server                                | Unlicense / GPL-3.0 / MIT    | Mixed                                |

## Takeaways (facts and trade-offs; the decision is made downstream)

1. **The strongest pair is a backward greedy list scheduler plus CP-SAT.** The greedy scheduler runs everywhere, including offline, re-plans instantly around pins, and gives exact human-readable "why it didn't fit" messages. CP-SAT is the stronger optimizer when greedy fails or produces a poor Plan. Both use the same domain model (Tasks as intervals; people and Equipment as unary resources with calendars), so a greedy v1 doesn't block a CP-SAT upgrade.
2. **Infeasibility explanation is mostly _our_ code whichever engine we pick.** Deterministic pre-checks catch most of the obvious cases: a dependency chain too long for its make-ahead window, shelf life too short, no Availability between a Task's earliest start and its deadline, an assignee without Availability. Greedy reports the blocking constraint at placement time. CP-SAT's assumption core and MiniZinc's FindMUS identify the constraint _sets_ involved, but both still need mapping into domain sentences.
3. **"Not everything fits" should still produce a Plan.** All solver options support a partial Plan with leftovers: optional intervals in CP-SAT, `allowsUnassigned` in Timefold, skipped Tasks in greedy. That matches "suggested, editable" better than a bare "infeasible".
4. **Browser-side optimal solving is now possible but immature.** `or-tools-wasm` (CP-SAT) and `minizinc-js` both run solvers in a Web Worker. The former is months old, and threaded mode needs cross-origin isolation headers. A server endpoint for CP-SAT is the conservative path, with greedy kept as the offline fallback (the baseline is cloud-synced with an offline cache).
5. **Timefold fits the product shape best on paper** (pinning, real-time changes, unassigned Tasks). But it forces a JVM service, and its explanation feature is Enterprise-only.
6. **JS LP/MIP libraries are a poor fit** for calendars and no-overlap, and glpk.js is GPL-3.0.

## Open questions for the downstream decision

- Can a Task be interrupted by an Availability gap (for example a stock spanning a break)? This changes the calendar model in every candidate. Franck et al. (2001) cover both cases.
- Time granularity (5 min? 15 min?). This matters for CP-SAT domain sizes and is critical for any MIP.
- Does a Station have capacity (one person per Station at a time?), or is it only a label? Today CONTEXT.md treats it as an attribute.
- Objective beyond ALAP: balance load across people, minimize Station switching, keep re-plans close to the previous Plan?
- Performance numbers here are estimates. A small prototype that runs greedy and CP-SAT on a realistic 200-Task Service would settle runtime and quality.
