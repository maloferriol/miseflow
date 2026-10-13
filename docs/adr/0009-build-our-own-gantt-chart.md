# Build our own Gantt chart for the Plan

The Plan's Gantt chart is **our own React component, drawn with DOM and SVG**, not a library. Its lanes are a Course → Dish → Batch tree ([spec §6.1](../menu-planner-spec.md)), and the two features that define it are the ones every library makes us fake: a shared Batch shows under every parent, and collapsing a Dish folds its Batches into its lane. Libraries tie each bar to one row, so both mean duplicated rows we keep in sync. In our own component every copy reads the same Task, so both come for free. The rest is small: about 900–1,400 lines for lanes, solid and hatched bars, 5-minute drag-to-pin, load strips and dependency arrows, and the [prototype](https://github.com/maloferriol/miseflow/blob/prototype/gantt-lanes/prototypes/gantt-lanes.prototype.html) (variant C) already does all but the arrows. It also keeps a second scheduling engine out of the app. Decided on [#62](https://github.com/maloferriol/miseflow/issues/62), from the research in [gantt-dish-tree.md](https://github.com/maloferriol/miseflow/blob/research/gantt-dish-tree/research/gantt-dish-tree.md) (and the earlier [gantt-libraries.md](https://github.com/maloferriol/miseflow/blob/research/gantt-libraries/research/gantt-libraries.md)).

## Consequences

- **The time mapping is its own module.** Converting real time to time with nights removed, and back, is pure, tested code with no drawing in it. It keeps the active and passive parts of a bar exact across a night, and it works with any library, so the fallback stays cheap.
- **Fallback:** if the time axis or dragging turns out hard, switch to vis-timeline for those, fed the mapped time. If arrows turn out hard, Highcharts Gantt is next. There's no time limit.

## Considered Options

- **vis-timeline** (MIT). Nights, snapping and move hooks are settings, but a shared Batch means duplicate groups and items, arrows need a third-party plugin, and there's no React wrapper.
- **Highcharts Gantt** (free for personal use). Built-in arrows and dragging all copies together, but lanes that hold many Tasks are awkward, collapsing doesn't fold bars in, and the free licence ends if MiseFlow is ever sold.
- **FullCalendar Premium** (about $480; the free tier is AGPL). The best fit for shared Batches, but no arrows, and it hides the same hours every night while Availability differs by day.
- **Bryntum Scheduler.** Does everything, load strips included, but paid with no personal tier, and heavy.
