import { schedule } from "../scheduler/schedule.ts";
import { fits, normalize, subtract, type Timeline } from "../scheduler/timeline.ts";
import {
  type Interval,
  type Minute,
  type Plan,
  type TaskKey,
  type TaskSpec,
  taskKey,
} from "../scheduler/types.ts";
import { type Hours, type PlanRows, toPlanningModel } from "./model.ts";
import { addDays, type LocalDate, localParts, weekdayOf, zonedMinute } from "./time.ts";

// Pure: "give the Cook more time" (#90, spec §6.5). The smallest one-date Availability override
// that places an Unplaced Task while every other placement keeps its start (spec §6.6).

/** One date's new hours, as `setAvailabilityOverride` stores them (minutes of day, end may be 1440). */
export type OverrideProposal = { date: LocalDate; start: number; end: number };

/**
 * The search's outcome and its `schedule()` runs, not counting the base run: a proposal, a proven
 * refusal (`none`), or a refusal because it reached `MAX_TRIALS` before an answer (`capped`).
 */
export type OverrideSearch =
  | { kind: "found"; proposal: OverrideProposal; runs: number }
  | { kind: "none"; runs: number }
  | { kind: "capped"; runs: number };

const GRID = 5;
const DAY = 1440;
/** The most full `schedule()` runs one search makes past the base run (#121). */
export const MAX_TRIALS = 50;
const PLACEHOLDER_ACTIVE = 10;
const roundUp = (minutes: number) => Math.ceil(minutes / GRID) * GRID;

// A Task's active stretches and length, as the scheduler counts them (a Step with no duration is 10 active).
function shapeOf(spec: TaskSpec): {
  duration: number;
  stretches: { offset: number; minutes: number }[];
} {
  let offset = 0;
  const stretches = [];
  for (const s of spec.steps) {
    const passive = s.passiveMinutes === null ? 0 : roundUp(s.passiveMinutes);
    const unknown = s.activeMinutes === null && passive === 0;
    const active = unknown ? PLACEHOLDER_ACTIVE : roundUp(s.activeMinutes ?? 0);
    if (active > 0) stretches.push({ offset, minutes: active });
    offset += active + passive;
  }
  return { duration: offset, stretches };
}

// One date of the searched window: its hours now, each minute of day as an instant, the free time of
// every other date less the other placements, and how much of that lies in the window.
type Day = {
  date: LocalDate;
  hours: Hours[];
  at: Minute[];
  others: Interval[];
  othersInWindow: number;
};
type Candidate = OverrideProposal & { range: Interval; others: Interval[]; othersInWindow: number };

// A date's hours now: its override if any (an empty list when it is off), else its weekday's.
function hoursOn(
  rows: PlanRows,
  overrides: Map<LocalDate, Hours | null>,
  date: LocalDate,
): Hours[] {
  if (overrides.has(date)) return [overrides.get(date)].filter((x): x is Hours => x != null);
  return rows.weekly
    .filter((w) => w.weekday === weekdayOf(date))
    .map(({ start, end }) => ({ start, end }));
}

// One date's candidates of one cost, the one that ends later first.
function* widenings(day: Day, cost: number): Generator<Candidate> {
  const { date, hours, at, others, othersInWindow } = day;
  const make = (start: number, end: number) => ({
    date,
    start,
    end,
    range: { start: at[start / GRID], end: at[end / GRID] },
    others,
    othersInWindow,
  });
  if (!hours.length) {
    for (let start = DAY - cost; start >= 0; start -= GRID) yield make(start, start + cost);
    return;
  }
  const from = Math.min(...hours.map((x) => x.start));
  const to = Math.max(...hours.map((x) => x.end));
  const gap = to - from - hours.reduce((n, x) => n + x.end - x.start, 0);
  for (let earlier = 0; earlier <= cost - gap; earlier += GRID) {
    const later = cost - gap - earlier;
    if (from - earlier >= 0 && to + later <= DAY) yield make(from - earlier, to + later);
  }
}

// Every candidate, cheapest first: fewest added minutes, then the later date, then ending later.
function* candidates(days: Day[]): Generator<Candidate> {
  for (let cost = GRID; cost <= DAY; cost += GRID)
    for (const day of days) yield* widenings(day, cost);
}

// Whether the Task's active stretches fit `free` at a start on the grid in `[lo, hi]` that reaches
// into `range`: a start that fits without it would have placed the Task already.
function fitsAround(
  task: ReturnType<typeof shapeOf>,
  free: Timeline,
  range: Interval,
  lo: Minute,
  hi: Minute,
): boolean {
  for (
    let start = Math.min(hi, Math.floor(range.end / GRID) * GRID);
    start >= Math.max(lo, range.start - task.duration);
    start -= GRID
  )
    if (task.stretches.every((s) => fits(free, start + s.offset, start + s.offset + s.minutes)))
      return true;
  return false;
}

/**
 * The smallest override that places the Unplaced Task `key`, or `none`: when it is placed, isn't a
 * Task, is `WindowTooTight`, or every override that places it would move another placement. Gives
 * up as `capped` rather than make more than `MAX_TRIALS` `schedule()` runs.
 *
 * Candidates are the dates in the window the scheduler searched, each date's hours widened in
 * 5-minute steps (start earlier, end later, or new hours on a date with none). A date with two
 * ranges becomes one override range, so the gap between them counts. Cheapest first: fewest added
 * free minutes, then the later date, then ending later (#90 owner decision 1). Each candidate is
 * checked against the free time left after the other placements, then by a real `schedule()` run:
 * it must place the Task and keep every other placement's start (owner decision 2).
 */
export function smallestOverride(rows: PlanRows, timeZone: string, key: TaskKey): OverrideSearch {
  const { model } = toPlanningModel(rows, timeZone);
  const base = schedule(model);
  const unplaced = base.unplaced.find((u) => u.key === key);
  const none = { kind: "none", runs: 0 } as const;
  if (!unplaced || unplaced.reason.kind === "WindowTooTight") return none;
  const window = unplaced.reason.searched;
  const specs = new Map(model.tasks.map((t) => [taskKey(t.owner, t.steps[0].stepId), t]));
  const task = shapeOf(specs.get(key)!);
  const lo = Math.ceil(window.start / GRID) * GRID;
  const hi = Math.floor((window.end - task.duration) / GRID) * GRID;
  if (hi < lo) return none;

  // Every other placement's active time, where it is now.
  const taken: Interval[] = base.placements.flatMap((p) =>
    shapeOf(specs.get(p.key)!).stretches.map((s) => ({
      start: p.start + s.offset,
      end: p.start + s.offset + s.minutes,
    })),
  );
  const withoutTaken = (free: Timeline) =>
    taken.reduce((left, t) => subtract(left, t.start, t.end), free);
  const active = task.stretches.reduce((n, s) => n + s.minutes, 0);
  const inWindow = (iv: Interval) =>
    Math.max(0, Math.min(iv.end, window.end) - Math.max(iv.start, window.start));

  const overrides = new Map(rows.overrides.map((o) => [o.date, o.hours]));
  const free = model.cooks[0].free;
  // Each date in the window, latest first. `others` has the other placements taken out once per date.
  const days: Day[] = [];
  for (
    let date = localParts(window.start, timeZone).date;
    date <= localParts(window.end - 1, timeZone).date;
    date = addDays(date, 1)
  ) {
    const at = Array.from({ length: DAY / GRID + 1 }, (_, i) =>
      zonedMinute(date, i * GRID, timeZone),
    );
    const others = withoutTaken(free.filter((iv) => iv.start < at[0] || iv.start >= at.at(-1)!));
    days.unshift({
      date,
      hours: hoursOn(rows, overrides, date),
      at,
      others,
      othersInWindow: others.reduce((n, iv) => n + inWindow(iv), 0),
    });
  }

  const kept = (plan: Plan) => {
    const after = new Map(plan.placements.map((p) => [p.key, p.start]));
    return after.has(key) && base.placements.every((p) => after.get(p.key) === p.start);
  };
  let runs = 0;
  for (const c of candidates(days)) {
    // A new range must reach into the window to help, the window's free time must at least hold
    // the Task's active minutes (a bound in instants, so a DST day's longer hours count), and the
    // Task must fit the free time with the new range, the other placements taken out of it.
    if (
      c.range.start >= window.end ||
      c.range.end <= window.start ||
      c.othersInWindow + inWindow(c.range) < active ||
      !fitsAround(task, normalize([...c.others, ...withoutTaken([c.range])]), c.range, lo, hi)
    )
      continue;
    if (runs === MAX_TRIALS) return { kind: "capped", runs };
    runs++;
    const trial = {
      ...rows,
      overrides: [
        ...rows.overrides.filter((o) => o.date !== c.date),
        { date: c.date, hours: { start: c.start, end: c.end } },
      ],
    };
    if (kept(schedule(toPlanningModel(trial, timeZone).model)))
      return { kind: "found", proposal: { date: c.date, start: c.start, end: c.end }, runs };
  }
  return { kind: "none", runs };
}
