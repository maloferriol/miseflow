# Research: which Gantt chart libraries fit the Plan editor?

Ticket: [#56](https://github.com/maloferriol/miseflow/issues/56) (map: [#53](https://github.com/maloferriol/miseflow/issues/53)). Researched 2026-10-13. Terms follow [CONTEXT.md](../CONTEXT.md). Requirements come from [spec §5–§6](../docs/menu-planner-spec.md#6-editing-the-plan) and the [plan-editing prototype](https://github.com/maloferriol/miseflow/blob/prototype/plan-editing/prototypes/plan-editing.prototype.html).

## TL;DR

- What the Plan editor needs is a **resource scheduler** (many Tasks in one lane per Cook or Equipment unit), not a classic **project Gantt** (one row per task). Most "Gantt" libraries, including Frappe, SVAR, DHTMLX Gantt and gantt-task-react, are the second kind. They can only fake lanes through PRO-only features (resource views or split/rollup rendering), and even then they fight the model.
- The only off-the-shelf product that covers nearly everything is **Bryntum Scheduler Pro**: resource lanes, split (segmented) events, dependencies, working time, and a renderer per event. But a paid SaaS product like ours needs Bryntum's **OEM licence (quote only, subscription)**, and Bryntum ships official wrappers for React, Vue and Angular only.
- The best free fit is **vis-timeline** (MIT/Apache-2.0, maintained). It has groups as lanes, `hiddenDates` to hide nights, a 5-minute `timeAxis`, a snap function, drag with validation hooks and HTML templates. It has no dependency arrows (there is a small third-party plugin) and no split bars (use a template or two items).
- **Recommendation: build it ourselves on SVG/DOM**, owned by us and framework-agnostic. The hard parts of the Plan editor are domain logic we write anyway: the live re-plan, pins, conflicts and Unplaced Tasks. The drawing is a few hundred bars, a compressed time axis, pointer-drag with 5-minute snapping, and arrows. The prototype already draws lanes, Availability and hatched passive time with plain absolutely-positioned divs. Keep vis-timeline as the fallback if building stalls.

## Requirements, restated

| # | Need | Source |
|---|---|---|
| R1 | One **lane per Cook** (MVP: one Cook) and later **per Equipment unit**, with many Tasks per lane | spec §6.1, map #53 phase 3 |
| R2 | **Several days with gaps**: nights and times outside Availability should be collapsed or de-emphasised | spec §5 rule 1, §6.1 |
| R3 | **5-minute grid** (snap), with display rounding allowed | spec §5 rule 2 |
| R4 | One bar with **active time solid and passive time hatched**. Passive time can run overnight, so a bar may cross a hidden gap | spec §5 rule 1, §6.1 |
| R5 | **Drag to move**, which pins the Task; reassigning a Task to another lane fixes its Cook | spec §6.4 |
| R6 | **Dependency arrows** (finish-to-start, passive time included) | spec §5 Tasks |
| R7 | **Conflict styling** for pins that break rules | spec §6.3–6.4 |
| R8 | **Unplaced Tasks** live off-chart, in a list with reasons and quick fixes | spec §6.5 |
| R9 | **Live re-plan** redraws on every edit, so the chart must re-render cheaply with ~200–500 Tasks | spec §6.2 |
| R10 | Framework not chosen yet (React, Svelte, Vue, Solid), so we want options that don't lock the choice | map #53, #57 |

R7 and R8 are mostly ours whatever we pick: conflicts are computed by our scheduler and only need a CSS class, and the Unplaced list is ordinary UI outside the chart. Neither discriminates much between libraries. R1, R2, R4 and R6 do.

## Candidates

Maintenance data comes from the GitHub API and the npm registry, queried 2026-10-13.

### Bryntum Scheduler Pro (and Gantt, Scheduler)

- **Model fit.** Scheduler/Scheduler Pro is resource-row based, with many events per resource. Bryntum Gantt is task-row based. Scheduler Pro adds the scheduling engine, dependencies and calendars ([Scheduler vs Scheduler Pro](https://bryntum.com/products/schedulerpro/scheduler-vs-schedulerpro/); [product page](https://bryntum.com/products/schedulerpro/)).
- **R4 split bars.** Scheduler Pro has segmented events (`EventSegments`, `EventSegmentDrag`, `EventSegmentResize`, `splitToSegments`), added in 5.2.0 ([what's new 5.2.0, mirror](https://epms.tataconsultingengineers.com/gantt-5.6.0/docs/data/SchedulerPro/guides/whats-new/5.2.0.md); [split events demo](https://www.bryntum.com/examples/scheduler-pro)). Segments are pieces of work with gaps between them, not "active then passive" within a single bar. The hatching would be a custom event renderer either way.
- **R2 gaps.** Non-working time is shown via calendars or `workingTime`. A Bryntum engineer says limiting `workingTime` hides non-working ticks but disables zoom, and that finer control means filtering or overriding `generateTicks` on the TimeAxis ([forum](https://forum.bryntum.com/viewtopic.php?p=91396)). This works, but it is a customisation.
- **R6, R5.** Dependencies and drag/drop are built in.
- **Frameworks.** Official guides cover React, Angular, Vue and Salesforce, plus vanilla JS ([Scheduler docs, v7.3.7](https://bryntum.com/products/scheduler/docs/)). Svelte or Solid would use the vanilla widget wrapped by hand.
- **Licence and price.** From $680/dev (Scheduler), $1,100/dev (Scheduler Pro) and $940/dev (Gantt) at the 3+ developer rate ([store](https://bryntum.com/store/)). The End-User Licence is perpetual but covers only apps whose end users don't pay. A **SaaS product sold to third parties needs an OEM licence, priced by quote** ([licensing](https://bryntum.com/?p=1240)). The OEM licence is a subscription, and support/updates renew yearly at list price since June 2025 ([renewal policy](https://bryntum.com/blog/revised-renewal-policy-for-bryntum-end-user-licenses/)).
- **Maintenance.** Active: v7.3.7 on npm, 2026-09-24 (`@bryntum/schedulerpro-trial`).
- **Verdict.** It has the most features, but it is heavy and commercial with unknown OEM cost, and we would still customise the axis and bar rendering. It is overkill for one Cook and has no official Svelte or Solid wrapper.

### DHTMLX Gantt and DHTMLX Scheduler

- **Gantt Community edition is now MIT** ([repo README](https://github.com/DHTMLX/gantt); v10.0.3, 2026-09-03). It is task-row based. Everything we would need to turn it into lanes is **PRO-only**: resource management and the resource timeline ([docs](https://docs.dhtmlx.com/gantt/guides/resource-management/)), split tasks shown in one row via `render: "split"` ([docs](https://docs.dhtmlx.com/gantt/guides/split-tasks/)), and `ignore_time` to hide nights ([docs](https://docs.dhtmlx.com/gantt/guides/custom-scale/)). Working-time calendars are PRO as well ([README comparison](https://github.com/DHTMLX/gantt)).
- **Scheduler** has a Timeline view that is resource-row based and the right shape, but it is **PRO-only**. Standard Scheduler is GPL-2.0 ([product page](https://dhtmlx.com/docs/products/dhtmlxScheduler/); repo `DHTMLX/scheduler` GPL-2.0, v7.2.15, 2026-08-17). I found no dependency arrows in the Scheduler Timeline. DHTMLX itself describes Scheduler as for events "without task relationships" ([DHTMLX blog](https://dhtmlx.com/blog/javascript-timeline-chart-functionality-dhtmlx/)), so arrows would be a custom overlay.
- **Price.** Gantt PRO is $799 Individual / $1,599 Commercial / $2,999 Enterprise ([Gantt page](https://dhtmlx.com/docs/products/dhtmlxGantt/)). Scheduler PRO is $599 / $1,299 / $2,899 ([Scheduler page](https://dhtmlx.com/docs/products/dhtmlxScheduler/)). Licences are perpetual with one year of support. **SaaS use is not allowed on Individual and is "upon request for a fee" on Commercial** ([licences](https://dhtmlx.com/docs/products/licenses.shtml)).
- **Frameworks.** Vanilla JS with React, Angular, Vue and Svelte integrations; Scheduler's Svelte support is a community demo ([Gantt page](https://dhtmlx.com/docs/products/dhtmlxGantt/); [Scheduler page](https://dhtmlx.com/docs/products/dhtmlxScheduler/)).
- **Verdict.** It would mean paying for PRO plus a SaaS fee and still bending a task-row Gantt into lanes, or buying Scheduler PRO and drawing arrows ourselves. Neither beats building.

### SVAR Gantt

- MIT core with commercial PRO ([product page](https://svar.dev/svelte/gantt/)). Native Svelte 5, React and Vue packages, all at 2.8.1 on npm, published 2026-10-12. The repo is active but small (258 stars).
- **Task-row Gantt.** The PRO-only features are split tasks, working-time calendars, resource planning, rollups/grouping and vertical markers ([product page](https://svar.dev/svelte/gantt/); [repo](https://github.com/svar-widgets/gantt)). Scales accept a `minute` unit ([scales API](https://docs.svar.dev/react/gantt/api/properties/scales)). I found no way to hide non-working time in the docs: weekends can only be highlighted ([scales guide](https://docs.svar.dev/react/gantt/guides/configuration/configure_scales)).
- **Price.** PRO is a perpetual licence with one year of updates: $749 Developer (no SaaS), $1,899 Application (5 devs, SaaS allowed), $3,399 Team, $6,799 Enterprise ([pricing](https://svar.dev/react/gantt/pricing/)).
- **Verdict.** It has the best framework coverage of the commercial options, but it is the wrong shape: lanes need PRO rollups or resources, and nights can't be hidden.

### Syncfusion Gantt / Scheduler

- Syncfusion Gantt has a resource view in which tasks are grouped under resource parent nodes, still as tree rows ([docs](https://ej2.syncfusion.com/react/documentation/gantt/resource-view)). The Scheduler has timeline views. Packages are active (`@syncfusion/ej2-gantt` 35.1.37, 2026-09-29).
- **Licence.** The Community Licence is free for under $1M revenue, 5 or fewer developers, 10 or fewer employees and under $3M outside capital ([community licence](https://www.syncfusion.com/products/communitylicense)). Otherwise the suite is $1,199/dev/year, subscription only ([team licence](https://www.syncfusion.com/sales/teamlicense)). The licence is proprietary either way.
- Official wrappers exist for React, Vue, Angular and Blazor. Svelte and Solid would go through the plain JS controls.
- **Verdict.** It's free for us today, but a large suite with a proprietary licence and a paywall later, and its Gantt is still row-per-task.

### vis-timeline

- Dual MIT / Apache-2.0 ([repo](https://github.com/visjs/vis-timeline)), v8.5.4 on 2026-08-12 and still active. Vanilla JS, so any framework can wrap it.
- **R1.** `groups` give one lane per group; `editable.updateGroup` allows dragging to another lane. **R2.** `hiddenDates` with `repeat: 'daily'` collapses nights. **R3.** `timeAxis: {scale: 'minute', step: 5}` plus a custom `snap(date)`. **R5.** `onMoving`/`onMove` hooks validate a move or turn it into a pin. **R4.** `template`/`visibleFrameTemplate` and per-item `className` allow a custom bar with a hatched passive part. **R7** is a CSS class. Background items can show Availability. All from the [Timeline docs](https://visjs.github.io/vis-timeline/docs/timeline/).
- **R6.** Not built in. The community plugin [timeline-arrows](https://github.com/javdome/timeline-arrows) (MIT, 52 stars, last pushed 2025-09-27) draws SVG arrows over it.
- **Gaps.** A bar that crosses a hidden night needs care: we would have to render passive time as its own item, or check how a range spanning `hiddenDates` draws. The DOM is one element per item, which is fine at 500 items. The look and feel are dated and we would restyle most of it.
- **Verdict.** It is the best free fallback and covers R1–R5 with configuration and templates.

### react-calendar-timeline

- MIT, React only, with groups, cross-group drag, `dragSnap`, `itemRenderer` and minute `timeSteps`. It has no dependency arrows and no hidden time ranges in the README ([repo](https://github.com/namespace-ee/react-calendar-timeline)). Stable is still 0.28 (moment.js); 0.30 has been in beta all year (beta.19 on GitHub, 2026-07-24).
- **Verdict.** It locks us into React, is still in beta, and has no arrows or gap-hiding.

### MUI X Scheduler (Event Timeline)

- The Event Timeline is resource-rows-as-bars and **Premium-only**. The whole Scheduler is still **beta** (v9.0.0-beta.13, npm 2026-10-06). It has drag and resize; dependencies are not mentioned ([docs](https://mui.com/x/react-scheduler/)). It is React and Material UI only.
- **Verdict.** Too early, React plus MUI lock-in, and no arrows.

### AG Grid

- I found no Gantt or timeline component in AG Grid. Its site's product menu lists Bryntum Gantt as a partner product ([ag-grid.com](https://www.ag-grid.com/example/)), and the AG Charts roadmap only plans a "timeline" chart type for Q3 2026 ([roadmap](https://ag-grid.com/charts/roadmap/)). Not a candidate.

### Frappe Gantt

- MIT, 6.1k stars, `frappe-gantt` 1.2.2 on npm (2026-02-25), repo pushed 2026-06-18 ([repo](https://github.com/frappe/gantt)). It is a task-row Gantt with arrows and drag snapping. Its view modes go from Day to Year plus Hour/custom; nothing below an hour is documented. `ignore` excludes weekends or holidays. It has no lanes.
- **Verdict.** Wrong shape (one task per row) and too coarse.

### gantt-task-react

- MIT, but **archived** (last release 0.3.9 in July 2022) ([repo](https://github.com/MaTeMaTuK/gantt-task-react)). Excluded.

### Planby

- A React EPG/TV-guide timeline. The licence is **custom, "All Rights Reserved"**, and drag-and-drop, resizing, multi-day and highlighted areas are all PRO ([repo](https://github.com/karolkozer/planby)). v2.1.0, 2026-08-23. Excluded.

## Comparison

| | Lanes (R1) | Hide nights (R2) | 5-min (R3) | Split / hatched bar (R4) | Drag (R5) | Arrows (R6) | Frameworks | Licence / price for a paid SaaS | Maintained (Oct 2026) |
|---|---|---|---|---|---|---|---|---|---|
| Bryntum Scheduler Pro | yes | customise TimeAxis | yes | segments + renderer | yes | yes | React, Vue, Angular, vanilla | OEM, by quote, subscription | yes, v7.3.7 |
| DHTMLX Gantt | PRO (resource view / split render) | PRO `ignore_time` | custom scale | PRO split | yes | yes | React, Vue, Angular, Svelte, vanilla | PRO $799+; SaaS "upon request for a fee" | yes, v10.0.3 |
| DHTMLX Scheduler | PRO Timeline | yes | yes | template | yes | no | same | PRO $599+; SaaS fee | yes, v7.2.15 |
| SVAR Gantt | PRO (resources / rollups) | not found | `minute` unit | PRO split | yes | yes | Svelte, React, Vue | PRO $1,899+ with SaaS, perpetual | yes, 2.8.1 |
| Syncfusion | tree rows per resource | via work time | ? | ? | yes | yes | React, Vue, Angular, Blazor | free community / $1,199/dev/yr | yes |
| vis-timeline | yes (groups) | yes (`hiddenDates`) | yes | template | yes | plugin | vanilla (any) | MIT/Apache-2.0, free | yes, 8.5.4 |
| react-calendar-timeline | yes | no | yes | renderer | yes | no | React | MIT | beta only |
| MUI X Scheduler | Premium | ? | ? | ? | yes | no | React + MUI | Premium per dev | beta |
| Frappe Gantt | no | `ignore` (days) | no | no | yes | yes | vanilla | MIT | slow |
| gantt-task-react | no | no | no | no | yes | yes | React | MIT | archived |
| Planby | channels | no | ? | no | PRO | no | React | proprietary | yes |

"?" means not documented in the sources read.

## Building it ourselves (SVG or DOM)

What we would write:

1. **A time-to-x mapping with compressed gaps.** Take the Plan window and remove the stretches no Cook is available for (nights). Each removed stretch becomes a thin "gap" marker. This is a piecewise-linear function and its inverse, roughly 50 lines, and easy to unit-test. Passive time that runs through a gap is drawn as hatched up to the gap and continues after it, which is exactly the overnight case in spec §5.
2. **Lanes.** One row per Cook (later one per Equipment unit), with the Availability backdrop. The prototype already does this with absolutely-positioned divs.
3. **Bars.** Each bar is one element with a solid active segment and a hatched passive segment. The prototype already uses a CSS `repeating-linear-gradient` for the hatching. Bars also carry the ≈, pin and 🔒 markers and a conflict class.
4. **Drag.** Pointer events, snapped to 5 minutes through the inverse mapping, a vertical drop into another lane, and a ghost bar. On drop we call the named mutation (`pinTask` / reassign) and the live re-plan.
5. **Arrows.** One SVG overlay drawing finish-to-start elbow paths between bar rects.
6. **Performance (R9).** 500 bars plus a few hundred arrows is small for the DOM or SVG; no canvas or virtualisation is needed at this size. The main cost is re-running the layout on each re-plan, and that is the scheduler's own millisecond-scale job (spec §5 Engine). Animating bars that moved (FLIP/CSS transitions) makes "only what must move moves" visible, and that is easier with our own DOM than inside a library.

The estimate is on the order of 1–2k lines, including tests. The code is framework-agnostic (pure layout functions plus a thin view), so it does not constrain #57. The things a library would give us that we don't need are task-row grids, critical path, baselines, export, project-style auto-scheduling, and calendars of their own. Our scheduler already owns scheduling, and two scheduling engines (theirs and ours) would conflict.

**Risks of building:** accessibility of drag (keyboard moves), touch/phone (phase 4), zoom levels, and print. All are manageable, and none is solved by the free libraries either.

## Recommendation

Build the Plan editor's chart on SVG/DOM ourselves, starting from the prototype's layout. Use vis-timeline as the fallback if the custom build stalls: it is the only free, maintained, framework-agnostic option that covers lanes, hidden nights, 5-minute snapping and templated bars, with arrows from a plugin. Look at Bryntum Scheduler Pro only if we later need much more, such as heavy multi-resource Equipment views, and only after getting an OEM quote.

## Sources

- Bryntum: [store](https://bryntum.com/store/), [licensing (EUL vs OEM)](https://bryntum.com/?p=1240), [renewal policy](https://bryntum.com/blog/revised-renewal-policy-for-bryntum-end-user-licenses/), [Scheduler Pro](https://bryntum.com/products/schedulerpro/), [Scheduler vs Pro](https://bryntum.com/products/schedulerpro/scheduler-vs-schedulerpro/), [Scheduler docs](https://bryntum.com/products/scheduler/docs/), [hiding non-working ticks (forum)](https://forum.bryntum.com/viewtopic.php?p=91396)
- DHTMLX: [Gantt repo](https://github.com/DHTMLX/gantt), [Gantt product](https://dhtmlx.com/docs/products/dhtmlxGantt/), [Scheduler product](https://dhtmlx.com/docs/products/dhtmlxScheduler/), [licences](https://dhtmlx.com/docs/products/licenses.shtml), [resource management](https://docs.dhtmlx.com/gantt/guides/resource-management/), [split tasks](https://docs.dhtmlx.com/gantt/guides/split-tasks/), [custom scale / ignore_time](https://docs.dhtmlx.com/gantt/guides/custom-scale/), [timeline blog](https://dhtmlx.com/blog/javascript-timeline-chart-functionality-dhtmlx/)
- SVAR: [Gantt](https://svar.dev/svelte/gantt/), [pricing](https://svar.dev/react/gantt/pricing/), [repo](https://github.com/svar-widgets/gantt), [scales API](https://docs.svar.dev/react/gantt/api/properties/scales), [scales guide](https://docs.svar.dev/react/gantt/guides/configuration/configure_scales)
- Syncfusion: [resource view](https://ej2.syncfusion.com/react/documentation/gantt/resource-view), [community licence](https://www.syncfusion.com/products/communitylicense), [team licence](https://www.syncfusion.com/sales/teamlicense)
- vis-timeline: [repo](https://github.com/visjs/vis-timeline), [docs](https://visjs.github.io/vis-timeline/docs/timeline/), [timeline-arrows](https://github.com/javdome/timeline-arrows)
- [react-calendar-timeline](https://github.com/namespace-ee/react-calendar-timeline), [MUI X Scheduler](https://mui.com/x/react-scheduler/), [Frappe Gantt](https://github.com/frappe/gantt), [gantt-task-react](https://github.com/MaTeMaTuK/gantt-task-react), [Planby](https://github.com/karolkozer/planby)
- Versions and dates: GitHub REST API (`repos/{owner}/{repo}`, `releases/latest`) and `npm view`, 2026-10-13.
