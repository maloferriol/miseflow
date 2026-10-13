# Research: build or buy the Plan's Gantt chart, with Dish-tree lanes?

Ticket: [#62](https://github.com/maloferriol/miseflow/issues/62) (map: [#53](https://github.com/maloferriol/miseflow/issues/53)). Researched 2026-10-13. Terms follow [CONTEXT.md](../CONTEXT.md). The layout comes from [#60](https://github.com/maloferriol/miseflow/issues/60) and [spec §6.1](../docs/menu-planner-spec.md#6-editing-the-plan). The reference drawing is variant C of the [gantt-lanes prototype](https://github.com/maloferriol/miseflow/blob/prototype/gantt-lanes/prototypes/gantt-lanes.prototype.html). The stack is from [ADR 0005](../docs/adr/0005-react-spa-with-a-thin-hono-api.md): a React SPA.

This replaces the earlier [Gantt libraries research](https://github.com/maloferriol/miseflow/blob/research/gantt-libraries/research/gantt-libraries.md) (#56). That note assumed one lane per Cook, a paid SaaS, and an open framework choice. All three have changed: lanes are now a Dish tree, the app is one person's personal project, and the framework is React. Every claim below was checked again against current docs, source code or registries.

## TL;DR

- **Recommendation: build it ourselves** as a React component over plain DOM and SVG. The new layout makes the hard parts specific to us: a Task drawn in several lanes, folding Batches into a collapsed Dish, a bar split into active and passive time across a collapsed night, and per-Cook load strips. Every library does at least two of these through workarounds. The prototype already does all of them except arrows, in about 250 lines of script. A production version is roughly 900–1,400 lines plus tests.
- **Best free fallback: vis-timeline** (MIT/Apache-2.0). It has nested groups that collapse, `hiddenDates` for nights, its own snap function, `onMoving`/`onMove` hooks and HTML templates, so most requirements are configuration. Two gaps: a group has only one parent and an item only one group, so a shared Batch means duplicated groups and items that we keep in sync ourselves. Arrows come from a small third-party plugin. There is no official React wrapper.
- **Highcharts Gantt** is now a real option, because its EULA grants a free "Personal Use" licence for non-commercial hobby projects. It has dependency arrows built in, `dragDrop.groupBy`, which drags several points as one (this solves the shared Batch), `dragPrecisionX` for snapping, a `drop` event that returns `false` to cancel, axis `breaks` for nights, and an official React package. Its rows are tied to points through `parent` and `uniqueNames`, which is awkward for "a lane holding many Tasks", and a collapsed parent doesn't fold its children's bars. The licence ends if the app is ever sold.
- **FullCalendar Premium** fits best for the shared Batch: one event with `resourceIds: [...]` renders once per lane, and the render hook knows which lane it is drawing. It has no dependency arrows, and `slotMinTime`/`slotMaxTime` hide the same hours every day, whereas our Availability differs per day. It costs from $480: no free licence covers a private personal app (AGPL needs an open-source frontend and backend; Creative Commons is for registered non-profits only).
- **Bryntum Scheduler** covers everything natively: a tree, multi-assignment, `TimelineHistogram` for load strips, dependencies, drag validators and working time. It is paid (from $680 per developer at the 3+ rate, more for one developer), with no free personal tier, and it is heavy. Use plain Scheduler, not Scheduler Pro, so that no scheduling engine runs alongside ours.

## What the layout needs

| # | Requirement | Source |
|---|---|---|
| R1 | A **tree of lanes**: Service lane on top, then Course → Dish → Batch, nested as deep as sub-recipes go. Dishes collapse, and a collapsed Dish **folds its Batches' bars into its own lane**. | spec §6.1, #60 |
| R2 | **Several Tasks per lane**, not one Task per row | #60 |
| R3 | A **shared Batch shows under every parent**. Extra copies are greyed out but draggable, and dragging any copy moves the one Task. | #60 |
| R4 | **Horizontal drag only** (the Cook is chosen with a picker), **5-minute snap**, a drop **pins** the Task, and hooks let us turn the move into our own state change. **The library must not run a scheduler of its own.** | spec §5, §6.4 |
| R5 | One bar with **active time solid and passive time hatched** | spec §6.1 |
| R6 | **Nights collapsed** across a 2–5 day Plan. A bar whose passive time crosses a collapsed night still reads sensibly. | spec §5, §6.1 |
| R7 | **Load strips**: one per Cook (later one per Equipment unit) showing active-time load, red where doubled up. These are summary rows, not lanes. | spec §6.1, #60 |
| R8 | **Dependency arrows** between Tasks (manual dependencies are in the MVP) | spec §5 |
| R9 | **Per-bar styling** (red conflict outline, ghost, faded, pin marker), with ~200–500 Tasks | spec §6.3–6.4 |
| R10 | **Works well in React**, maintained, and a licence that fits a personal, never-sold, self-hosted app in a **private** repo | ADR 0005; `gh repo view`: private, no licence |

Two facts frame the licence verdicts. The repo is private and has no licence, so "open source" licence options (GPL, AGPL) would mean publishing the code. The app is personal and has a single user (#60: team sharing is ruled out for good), so a "personal / non-commercial" licence is acceptable if its wording covers a natural person's hobby project.

**A trick that works with any library: virtual time.** Our scheduler can map real minutes to a compressed "display time" with nights removed, which is the piecewise-linear `X()`/`INV()` pair in the prototype. That display time is what we pass to the library, and the axis labels are formatted back into real times. This solves R6 even for libraries with no hidden-time support (dnd-timeline, react-calendar-timeline), and it keeps R5's active/passive split exact across a night, because widths are computed in display time. It costs custom tick labels, and the library's own date handling (DST, "today" markers) stops meaning anything.

## Fit tables

**yes** = documented, built-in behaviour. **with work** = possible with configuration plus our own code (the note says what). **no** = not supported; we would have to draw it outside the library.

### 1. vis-timeline 8.5.4

Licence: dual **Apache-2.0 or MIT** (npm `license: (Apache-2.0 OR MIT)`). **Free; fits.**
Maintenance: v8.5.4 released 2026-08-12; repo pushed 2026-10-13; 2.6k stars (GitHub API).
React: no official wrapper. It is vanilla JS that we would mount in a `useEffect` and feed through `DataSet`s, and it would not render React components inside bars (templates return HTML strings or elements).

| Req | Fit | How / gap |
|---|---|---|
| R1 tree | **with work** | Groups take `nestedGroups` and `showNested`, and clicking a nesting group's label toggles it ([docs](https://visjs.github.io/vis-timeline/docs/timeline/#groups); 3-level [example](https://github.com/visjs/vis-timeline/blob/master/examples/timeline/groups/nestedThreeLevels.html)). Collapsing **hides** child groups and their items. It does not fold them into the parent, so on collapse we would add faded copies of the Batch items to the Dish group ourselves (source: `toggleGroupShowNested` in [`ItemSet.js`](https://github.com/visjs/vis-timeline/blob/master/lib/timeline/component/ItemSet.js)). |
| R2 many per lane | **yes** | Every item with the same `group` is on that group's line. `stack: false`, or `subgroup`/`subgroupStack` to control overlap ([docs](https://visjs.github.io/vis-timeline/docs/timeline/#items)). |
| R3 shared Task | **with work** | An item has one `group`, and a nested group has one `nestedInGroup` (source: `ItemSet.js` sets `nestedInGroup = group.id`). So each copy of the stock is its own group (`stock@velo`, `stock@bb`) holding its own copies of the Task items (`s2@velo`, ...). We use `className` to grey the ghost copies, and in `onMoving` we update the sibling copies so they follow the drag. |
| R4 drag | **yes** | `editable: {updateTime: true, updateGroup: false}`. `snap: (date) => …` gives a custom 5-minute snap. `onMoving` fires during the drag and can change or clamp it; `onMove` fires after the drop, and calling `callback(null)` cancels it, which is where we dispatch `pinTask` ([docs](https://visjs.github.io/vis-timeline/docs/timeline/#Editing_Items)). It has no scheduling engine. |
| R5 split bar | **with work** | `template` renders our own HTML (two spans: a solid one and a `repeating-linear-gradient` one). The split ratio must be computed in **visible** time when the bar crosses a hidden night (see R6). The docs advise against "heavy CSS on items (such as box-shadow, gradient background colors…)" for performance. |
| R6 nights | **yes** | `hiddenDates` with `repeat: 'daily'`, or explicit ranges per night, which allows different Availability per day. A range that spans a hidden period is drawn continuously, with the hidden time taking zero width, and an end inside hidden time is drawn at the hidden start (source: `toScreen`/`getIsHidden` in [`DateUtil.js`](https://github.com/visjs/vis-timeline/blob/master/lib/timeline/DateUtil.js)). Moves snap out of hidden time (`snapAwayFromHidden`). |
| R7 load strips | **with work** | A top-level "Load: You" group holding read-only range items (`editable: false`) that we compute, coloured red where they overlap. `type: 'background'` items also accept a `group`. |
| R8 arrows | **with work** | Not built in. [timeline-arrows](https://github.com/javdome/timeline-arrows) (MIT, 52 stars, 4.8.0, last push 2025-09-27) draws SVG arrows between item ids. We would check how it behaves with collapsed groups. |
| R9 styling, scale | **yes** | Per-item `className`. The docs say many items "might affect … performance" and recommend `DataSet`s and fixed `start`/`end`; 500 items is within what the docs treat as normal. |
| R10 | **with work** | Licence and maintenance are fine. The React integration is ours to write, and the default look is dated, so we would restyle most of it. |

### 2. Highcharts Gantt (Highcharts 13.1.1)

Licence: proprietary EULA. **Free under the "Personal Use" tier**: the [EULA](https://shop.highcharts.com/license-eula) §1.2 defines it as use "by a natural person for purposes that are entirely non-commercial, non-professional", with "a personal hobby project" as an example. It excludes "any use, direct or indirect, in connection with any business". **Fits while the app stays personal.** Commercial use would need a paid licence: Core $366 per seat plus the Gantt add-on at $73 per seat ([shop](https://shop.highcharts.com/)). The EULA does not name Gantt, but it covers "Highcharts®" software generally.
Maintenance: `highcharts` 13.1.1 on npm, 2026-09-25; repo pushed 2026-10-13; 12.5k stars.
React: official [`@highcharts/react`](https://www.npmjs.com/package/@highcharts/react) 5.4.0 (2026-10-12).

| Req | Fit | How / gap |
|---|---|---|
| R1 tree | **with work** | A `treegrid` y-axis builds rows from points' `id`/`parent` and is collapsible, with `collapsed: true` per point ([grouping guide](https://www.highcharts.com/docs/gantt/gantt-grouping-tasks)). The rows **are** points: a Batch row's parent must be one specific Task point of the Dish. A collapsed parent hides its children's rows and does not fold their bars, so folding means re-parenting the data ourselves. |
| R2 many per lane | **with work** | `yAxis.uniqueNames: true`: points with the same `name` under the same parent "share grid cell" (source: [`TreeGridAxis.ts`](https://github.com/highcharts/highcharts/blob/master/ts/Core/Axis/TreeGrid/TreeGridAxis.ts); [sample](https://github.com/highcharts/highcharts/blob/master/samples/gantt/treegrid-axis/uniquenames-true/demo.js)). Labels then show the lane name, not the Task name, so Task names go in data labels. |
| R3 shared Task | **with work, but the drag is native** | Each copy is a separate point (one `parent` per point). `dragDrop.groupBy: 'groupId'` drags every point with the same `groupId` together ([`DragDropOptions.ts`](https://github.com/highcharts/highcharts/blob/master/ts/Extensions/DraggablePoints/DragDropOptions.ts); [sample](https://github.com/highcharts/highcharts/blob/master/samples/gantt/dragdrop/drag-gantt/demo.js)). Ghost copies are styled per point. |
| R4 drag | **yes** | `draggableX: true`, `draggableY: false`, `dragPrecisionX: 5 * 60e3`. Point `drag`/`drop` events: "To stop the default drop action, return false" (`DragDropOptions.ts`). It has no scheduling engine. |
| R5 split bar | **with work** | Either `completed`/`partialFill` (a filled fraction of the bar) combined with the pattern-fill module for the hatching, or two points (active and passive) sharing a `groupId`. Because `partialFill` is a fraction of the drawn width, crossing a break distorts it, so the two-point option or virtual time is safer. |
| R6 nights | **with work** | `xAxis.breaks` with `from`/`to`/`repeat` works on Gantt axes ([API](https://api.highcharts.com/gantt/xAxis.breaks)). There is no Gantt sample that combines breaks with the grid axis, so the rendering of grid cells and of bars that cross a break needs a spike. |
| R7 load strips | **with work** | A separate row (or a second, x-synchronised chart) with non-draggable points that we compute. |
| R8 arrows | **yes** | `dependency` on points, drawn by the pathfinder connectors ([sample](https://github.com/highcharts/highcharts/blob/master/samples/gantt/pathfinder/simple-connect/demo.js)). |
| R9 styling, scale | **yes** | Per-point `color`, `borderColor`, `className`; a `bigdata` Gantt sample exists. SVG output. |
| R10 | **yes** | Official React package, active, and free for us under Personal Use, provided the app is never sold. |

### 3. FullCalendar Premium, Resource Timeline (7.1.2)

Licence: **paid for us.** The [licence page](https://fullcalendar.io/license) offers AGPLv3, which in v7 replaced GPLv3, and only for projects whose frontend **and** backend are open source; that rules out our private repo. Creative Commons BY-NC-ND is for "Registered non-profit organizations" and does not allow source modifications. Commercial starts at $480 for 1–10 developers, with 50% renewals for upgrades; you keep the last version released before expiry ([pricing](https://fullcalendar.io/pricing)). **Fits only if we pay.**
Maintenance: `fullcalendar`/`fullcalendar-scheduler` 7.1.2, 2026-10-12; 20.7k stars.
React: official `@fullcalendar/react-scheduler` ([timeline view](https://fullcalendar.io/docs/timeline-view)).

| Req | Fit | How / gap |
|---|---|---|
| R1 tree | **with work** | Nested resources via `children` or `parentId`, with an expander arrow ([resource parsing](https://fullcalendar.io/docs/resource-parsing)); `resourcesInitiallyExpanded`. Collapsing hides children and does not fold their events, so we would add the collapsed Dish's id to the Batch events' `resourceIds` on collapse. |
| R2 many per lane | **yes** | Any number of events per resource row. |
| R3 shared Task | **yes** | `resourceIds: ['stock@velo', 'stock@bb']`: "The event renders once per resource. Each rendering's render hooks receive the resource it's rendered under as `info.resource`" ([resources and events](https://fullcalendar.io/docs/resources-and-events)). That lets us grey the ghost copy, and it is one event, so dragging any copy moves it. |
| R4 drag | **yes** | `snapDuration: '00:05'` ([docs](https://fullcalendar.io/docs/snapDuration)), `eventResourceEditable: false` ([docs](https://fullcalendar.io/docs/eventResourceEditable)), `eventAllow` for validation while dragging ([docs](https://fullcalendar.io/docs/eventAllow)), and `eventDrop` with `revert()` to hand off to our mutation. It has no scheduling engine. |
| R5 split bar | **with work** | `eventContent` renders our own markup. The proportions must be computed in visible time. |
| R6 nights | **with work** | `slotMinTime`/`slotMaxTime` apply "for each day" ([slotMaxTime](https://fullcalendar.io/docs/slotMaxTime)). That is one window for every day, but Availability here is Thu/Fri 18–22 and Sat 09–19:30, so a 09:00–23:00 window wastes Thursday daytime. Per-night collapse needs virtual time. How an event crossing hidden hours is drawn is not documented, so a spike is needed. |
| R7 load strips | **with work** | A "Load" resource row holding read-only events or `display: 'background'` events that we compute. |
| R8 arrows | **no** | No dependency feature. We would draw an SVG overlay positioned from event DOM rects. |
| R9 styling, scale | **yes** | `eventClassNames`; [virtual rendering](https://fullcalendar.io/docs/timeline-view) for large views. |
| R10 | **yes** | Official React package and very active, but paid. |

### 4. Bryntum Scheduler 7.3.7 (Scheduler Pro is not needed)

Licence: **paid; no free tier.** The [licensing page](https://bryntum.com/licensing/) lists only End-User and OEM licences. The End-User licence "is perpetual and applicable for applications where end-users do not pay for access", which fits a personal app. Scheduler costs from $680 per developer and Scheduler Pro from $1,100, both at the 3+ developer rate; the price for 1–2 developers is higher and not published ([store](https://bryntum.com/store/)).
Maintenance: 7.3.7, 2026-09-24 (`@bryntum/scheduler-trial` on npm).
React: official wrapper and guides ([Scheduler Pro LLM docs index](https://bryntum.com/products/schedulerpro/docs-llm/llms.txt)).

| Req | Fit | How / gap |
|---|---|---|
| R1 tree | **yes / with work** | Tree resource store with the `Tree` feature ([tree data](https://bryntum.com/products/scheduler/docs-llm/guide/Scheduler/data/treedata.md)). `TreeSummary` rolls children up into the parent row's cells, but as values rather than bars ([TreeSummary](https://bryntum.com/products/scheduler/docs-llm/api/Scheduler/feature/TreeSummary.md)). Folding bars is our own re-assignment. |
| R2 many per lane | **yes** | It is a resource scheduler, with many events per row. |
| R3 shared Task | **yes** | `AssignmentStore` assigns one event to many resources ([AssignmentStore](https://bryntum.com/products/scheduler/docs-llm/api/Scheduler/data/AssignmentStore.md)). Ghost copies are styled with `eventRenderer` per assignment. |
| R4 drag | **yes** | `EventDrag` has `constrainDragToResource`, `validatorFn` and `beforeEventDropFinalize` ([EventDrag](https://bryntum.com/products/scheduler/docs-llm/api/Scheduler/feature/EventDrag.md)); `timeResolution` gives the 5-minute snap. Plain Scheduler has **no** engine. Scheduler Pro adds a ChronoGraph scheduling engine that would compete with ours. |
| R5 split bar | **with work** | `eventRenderer` gives custom markup. Scheduler Pro's segmented events are pieces of work separated by gaps, not active vs passive time. |
| R6 nights | **yes / with work** | `workingTime: {fromHour, toHour}` fills `TimeAxis.include` and gives "a non-continuous time axis" ([TimelineBase](https://bryntum.com/products/schedulerpro/docs-llm/api/Scheduler/view/TimelineBase.md)), but with the same hours every day. Per-day windows need `timeAxis.filterBy` or `generateTicks` ([forum](https://forum.bryntum.com/viewtopic.php?p=91396)). |
| R7 load strips | **yes** | `TimelineHistogram` "renders histogram charts in the time axis column for each store record" and supports `TreeGroup` ([guide](https://bryntum.com/products/scheduler/docs-llm/guide/Scheduler/timelinehistogram.md)). |
| R8 arrows | **yes** | `Dependencies` feature and `DependencyStore`. |
| R9 styling, scale | **yes** | `eventRenderer`, `cls`; virtualised rows. |
| R10 | **with work** | Official React wrapper, but a large proprietary dependency, a separate theming system, and a paid licence. |

### 5. Others, briefly

| Candidate | Licence verdict | React / maintenance | Fit summary |
|---|---|---|---|
| **DHTMLX Scheduler** (Timeline view) | Timeline is PRO-only: "This view is available in the Scheduler PRO version only" ([docs](https://docs.dhtmlx.com/scheduler/views/timeline/)). Individual PRO is perpetual, 1 developer and 1 project, "No usage in SaaS" ([licences](https://dhtmlx.com/docs/products/licenses.shtml)), and was $599 per #56. The Standard edition is GPL-2.0, which a private repo can't use. No personal-use clause. | React integration; v7.2.15, 2026-08-17 | Tree mode (`render: "tree"`) ✓; Multisection extension puts one event in several sections ✓; `ignore_timeline(date)` hides hours ✓. **No dependency arrows**, and no histogram row. |
| **DHTMLX Gantt** | Community edition is MIT, but resource view, split-task rendering and `ignore_time` are PRO (#56). | v10.0.3, 2026-09-03 | One task per row: lanes with many Tasks need PRO split/resource rendering. Wrong shape. |
| **SVAR React Gantt** | MIT core. Rollups, split tasks, resource planning and working-time calendars are PRO; no free PRO tier, only a 30-day watermarked trial ([product page](https://svar.dev/react/gantt/)). | `@svar-ui/react-gantt` 2.8.1, 2026-10-12 | One task per row; no documented way to hide non-working time. Wrong shape. |
| **Syncfusion Scheduler** (timeline views) | Community licence is free for "individuals with less than $1 million USD in annual gross revenue", ≤5 developers and ≤10 employees ([community licence](https://www.syncfusion.com/products/communitylicense)). Fits, but proprietary, and the licence must be claimed and renewed. | Official React; `@syncfusion/ej2-react-gantt` 35.1.37, 2026-09-29 | Multi-level resource grouping with `expandedField` collapse; `allowMultiple` shows "multiple instances of the same appointment" ([resources](https://ej2.syncfusion.com/react/documentation/schedule/resources)). Grouping is **one resource collection per level** (fixed depth), but our tree is as deep as the sub-recipes go. No dependency arrows in Scheduler (Gantt has them but is row-per-task). |
| **MUI X Scheduler, Event Timeline** | Event Timeline is Premium, a paid annual per-developer licence; free only for 30 days in non-production ([licensing](https://mui.com/x/introduction/licensing/)). | `@mui/x-scheduler` 9.0.0-beta.13 (2026-10-06): **beta** | Nested, collapsible resources ✓; an event in several resources "renders once in each of its resource rows" ✓ ([resources](https://mui.com/x/react-scheduler/event-timeline/resources/)). Drag docs show no snap granularity or drop validation; no dependencies; no hidden hours. Too early, and it pulls in MUI. |
| **react-calendar-timeline** | MIT | Stable is 0.28 (moment.js); 0.30 still beta.19 (2026-07-24) | `dragSnap`, `canChangeGroup: false`, `moveResizeValidator`, `itemRenderer` ✓. Tree groups are "not a feature that is directly supported by the library" ([examples](https://github.com/namespace-ee/react-calendar-timeline/blob/master/examples/README.md)); no hidden time (virtual time works); no arrows. |
| **dnd-timeline** (new candidate) | MIT | 3.1.1, 2026-05-16; 252 stars; React + dnd-kit, headless | Hooks (`useRow`, `useItem`) and positioning only; "Nested" rows under collapsible rows is an example ([README](https://github.com/samuelarbibe/dnd-timeline)). Linear time only (virtual time works); no arrows, no axis. Essentially "build our own" with dnd-kit's drag (and touch) included. |
| **Apache ECharts** custom series | Apache-2.0 | 6.1.0, 2026-05-19; `echarts-for-react` | `renderItem` draws anything. Axis breaks are new in 6.0. Drag is hand-rolled: the official [flight Gantt example](https://github.com/apache/echarts-examples/blob/gh-pages/public/examples/ts/custom-gantt-flight.js) implements its own drag. Canvas-first, with no tree rows and no arrows. A chart engine, not a scheduler: more work than our own DOM. |
| **Frappe Gantt, gantt-task-react, Planby** | (#56) | | Ruled out in #56 (row-per-task, archived, or proprietary); the new layout doesn't change that. |

## Building our own

What variant C already does in `gantt-lanes.prototype.html` (463 lines, of which about 100 are CSS and markup and about 360 are script for three variants):

- Time mapping with collapsed nights: `X()`/`INV()`, about 30 lines.
- Course → Dish → Batch tree, ghost copies of a shared Batch, Dish collapse that folds Batch bars in as faded: `VARIANTS.C.rows()`, about 35 lines.
- Active-solid / passive-hatched bar that stays correct across a seam, because each segment's width is `X(end) - X(start)`: `bar()`, about 25 lines.
- Load strip with red clash spans (variant B), about 10 lines.
- Horizontal drag with a 5-minute snap through `INV()`, pinned on drop: about 20 lines.
- Conflict outlines from a conflict list: a CSS class.

Missing: dependency arrows, keyboard and touch drag, an axis with zoom, scroll and virtualisation, Equipment strips, accessibility, and tests.

Estimate for production in React (TypeScript, with tests):

| Piece | Lines (approx.) |
|---|---|
| Time mapping + inverse + tick generation (pure, unit-tested) | 120 + 120 tests |
| Lane tree flattening (ghosts, collapse folding, Service lane), pure | 100 + 120 tests |
| Bar component (segments, markers, classes) | 100 |
| Drag (pointer events, 5-min snap, ghost-copy sync for free since all copies read one Task, `pinTask` dispatch, Esc to cancel, arrow-key nudge) | 180 + 80 tests |
| Load strips (per Cook, then per Equipment unit) | 80 |
| Dependency arrows (SVG overlay, elbow paths, from computed bar rects, not the DOM) | 150 |
| Axis, sticky label column, horizontal scroll, Availability backdrop | 150 |
| **Total** | **~900–1,400** |

Because bars read from one Task record, the shared-Batch requirement (R3) is free in our own build: every copy re-renders from the same state. The same is true of folding (R1), which is a pure function of the collapse set. These are the two requirements every library handles through duplication or re-assignment. 500 bars plus arrows is small for the DOM (no canvas needed). React 18/19 with keyed bars and a `transform` during drag keeps re-renders cheap. dnd-kit or dnd-timeline could supply touch and keyboard sensors if we want them later.

Risks: accessibility of drag, touch (phase 4), arrow routing that stays readable at 500 Tasks, and print. No library on the list solves these for our layout anyway.

## Ranking

1. **Build our own** (React + DOM/SVG). It matches all ten requirements by construction, costs nothing, has no licence risk, and starts from working prototype code. The new requirements R1 (fold) and R3 (shared Task) are trivial with our own data model and awkward everywhere else.
2. **vis-timeline.** The best free library. Nights, snapping, drag hooks and nested groups are configuration. Shared Tasks and folding need duplication and sync, arrows need a small plugin, and React integration is manual.
3. **Highcharts Gantt.** Free under Personal Use, with built-in arrows, drag of a group of points (`groupBy`), axis breaks and an official React package. Its point-based treegrid rows make "lanes of many Tasks" and folding awkward, and the licence locks the app to non-commercial use.
4. **FullCalendar Premium.** The cleanest native shared-Task model (`resourceIds`) and the most polished React package. But it is paid ($480+), has no arrows, and hides the same hours on every day.
5. **Bryntum Scheduler.** It covers the most natively, including load-strip histograms, but it is paid with an unpublished single-developer price, heavy, and more than we need.
6. The rest (DHTMLX Scheduler PRO, Syncfusion Scheduler, MUI X, react-calendar-timeline, dnd-timeline, ECharts, SVAR, DHTMLX Gantt) each lack two or more of R1/R3/R6/R8, or are beta.

## What would change the recommendation

- **The custom build stalls on arrows or drag polish** → fall back to vis-timeline. Keep our pure layer (time mapping, lane tree, conflicts), which still works as the data feed for its `DataSet`s.
- **We decide we want a polished, maintained widget and are happy to pay about $500** → FullCalendar Premium, with an SVG arrow overlay of our own. If arrows had to be native and the budget were higher, Bryntum Scheduler.
- **Dependency arrows leave the MVP** → FullCalendar moves up; vis-timeline no longer needs its plugin.
- **The app ever goes commercial or multi-user** → Highcharts' Personal Use licence ends. FullCalendar or Bryntum need commercial or OEM terms (see #56). Our own build is unaffected.
- **Per-day Availability windows turn out not to matter** (one daily window is fine) → FullCalendar's and Bryntum's `slotMinTime`/`workingTime` become a straight "yes" for R6.
- **The open spikes come out badly**: how Highcharts' grid axis renders with `breaks`, and how FullCalendar draws an event crossing hidden hours. Neither is documented. Each would take about half a day if one of those libraries became the pick.

## Sources

- Repo context: [#60](https://github.com/maloferriol/miseflow/issues/60), [#62](https://github.com/maloferriol/miseflow/issues/62), [spec §6.1](../docs/menu-planner-spec.md#6-editing-the-plan), [prototype](https://github.com/maloferriol/miseflow/blob/prototype/gantt-lanes/prototypes/gantt-lanes.prototype.html), [previous research](https://github.com/maloferriol/miseflow/blob/research/gantt-libraries/research/gantt-libraries.md)
- vis-timeline: [docs](https://visjs.github.io/vis-timeline/docs/timeline/), [`DateUtil.js`](https://github.com/visjs/vis-timeline/blob/master/lib/timeline/DateUtil.js), [`ItemSet.js`](https://github.com/visjs/vis-timeline/blob/master/lib/timeline/component/ItemSet.js), [nested 3-level example](https://github.com/visjs/vis-timeline/blob/master/examples/timeline/groups/nestedThreeLevels.html), [timeline-arrows](https://github.com/javdome/timeline-arrows)
- Highcharts: [EULA](https://shop.highcharts.com/license-eula), [shop](https://shop.highcharts.com/), [grouping guide](https://www.highcharts.com/docs/gantt/gantt-grouping-tasks), [`xAxis.breaks`](https://api.highcharts.com/gantt/xAxis.breaks), [`TreeGridAxis.ts`](https://github.com/highcharts/highcharts/blob/master/ts/Core/Axis/TreeGrid/TreeGridAxis.ts), [`DragDropOptions.ts`](https://github.com/highcharts/highcharts/blob/master/ts/Extensions/DraggablePoints/DragDropOptions.ts), [drag sample](https://github.com/highcharts/highcharts/blob/master/samples/gantt/dragdrop/drag-gantt/demo.js), [uniqueNames sample](https://github.com/highcharts/highcharts/blob/master/samples/gantt/treegrid-axis/uniquenames-true/demo.js), [`@highcharts/react`](https://www.npmjs.com/package/@highcharts/react)
- FullCalendar (v7 docs): [licence](https://fullcalendar.io/license), [pricing](https://fullcalendar.io/pricing), [timeline view](https://fullcalendar.io/docs/timeline-view), [resource parsing](https://fullcalendar.io/docs/resource-parsing), [resources and events](https://fullcalendar.io/docs/resources-and-events), [snapDuration](https://fullcalendar.io/docs/snapDuration), [slotMinTime](https://fullcalendar.io/docs/slotMinTime), [slotMaxTime](https://fullcalendar.io/docs/slotMaxTime), [eventAllow](https://fullcalendar.io/docs/eventAllow), [eventResourceEditable](https://fullcalendar.io/docs/eventResourceEditable), [resourcesInitiallyExpanded](https://fullcalendar.io/docs/resourcesInitiallyExpanded)
- Bryntum: [store](https://bryntum.com/store/), [licensing](https://bryntum.com/licensing/), [TimelineBase](https://bryntum.com/products/schedulerpro/docs-llm/api/Scheduler/view/TimelineBase.md), [AssignmentStore](https://bryntum.com/products/scheduler/docs-llm/api/Scheduler/data/AssignmentStore.md), [EventDrag](https://bryntum.com/products/scheduler/docs-llm/api/Scheduler/feature/EventDrag.md), [TreeSummary](https://bryntum.com/products/scheduler/docs-llm/api/Scheduler/feature/TreeSummary.md), [tree data](https://bryntum.com/products/scheduler/docs-llm/guide/Scheduler/data/treedata.md), [timeline histogram](https://bryntum.com/products/scheduler/docs-llm/guide/Scheduler/timelinehistogram.md), [forum: hiding non-working ticks](https://forum.bryntum.com/viewtopic.php?p=91396)
- DHTMLX: [Scheduler timeline view](https://docs.dhtmlx.com/scheduler/views/timeline/), [licences](https://dhtmlx.com/docs/products/licenses.shtml)
- SVAR: [React Gantt](https://svar.dev/react/gantt/)
- Syncfusion: [community licence](https://www.syncfusion.com/products/communitylicense), [Scheduler resources](https://ej2.syncfusion.com/react/documentation/schedule/resources)
- MUI X: [Scheduler](https://mui.com/x/react-scheduler/), [Event Timeline resources](https://mui.com/x/react-scheduler/event-timeline/resources/), [drag interactions](https://mui.com/x/react-scheduler/event-timeline/drag-interactions/), [licensing](https://mui.com/x/introduction/licensing/)
- [react-calendar-timeline](https://github.com/namespace-ee/react-calendar-timeline), [dnd-timeline](https://github.com/samuelarbibe/dnd-timeline), [ECharts flight Gantt example](https://github.com/apache/echarts-examples/blob/gh-pages/public/examples/ts/custom-gantt-flight.js)
- Versions and dates: GitHub REST API (`repos/{owner}/{repo}`, `releases/latest`) and `npm view`, queried 2026-10-13.
