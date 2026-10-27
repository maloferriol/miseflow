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

const GRID = 5;
const DAY = 1440;
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

/**
 * The smallest override that places the Unplaced Task `key`, or null: when it is placed, isn't a
 * Task, is `WindowTooTight`, or every override that places it would move another placement.
 *
 * Candidates are the dates in the window the scheduler searched, each date's hours widened in
 * 5-minute steps (start earlier, end later, or new hours on a date with none). A date with two
 * ranges becomes one override range, so the gap between them counts. Cheapest first: fewest added
 * free minutes, then the later date, then ending later (#90 owner decision 1). Each candidate is
 * checked against the free time left after the other placements, then by a real `schedule()` run:
 * it must place the Task and keep every other placement's start (owner decision 2).
 */
export function smallestOverride(
  rows: PlanRows,
  timeZone: string,
  key: TaskKey,
): OverrideProposal | null {
  const { model } = toPlanningModel(rows, timeZone);
  const base = schedule(model);
  const unplaced = base.unplaced.find((u) => u.key === key);
  if (!unplaced || unplaced.reason.kind === "WindowTooTight") return null;
  const window = unplaced.reason.searched;
  const specs = new Map(model.tasks.map((t) => [taskKey(t.owner, t.steps[0].stepId), t]));
  const task = shapeOf(specs.get(key)!);
  const lo = Math.ceil(window.start / GRID) * GRID;
  const hi = Math.floor((window.end - task.duration) / GRID) * GRID;
  if (hi < lo) return null;

  // Every other placement's active time, where it is now.
  const taken: Interval[] = base.placements.flatMap((p) =>
    shapeOf(specs.get(p.key)!).stretches.map((s) => ({
      start: p.start + s.offset,
      end: p.start + s.offset + s.minutes,
    })),
  );
  // A start that fits now would have placed the Task already, so only starts that reach into the new range are tried.
  const fitsIn = (free: Timeline, range: Interval) => {
    for (const t of taken) free = subtract(free, t.start, t.end);
    for (
      let start = Math.min(hi, Math.floor(range.end / GRID) * GRID);
      start >= Math.max(lo, range.start - task.duration);
      start -= GRID
    )
      if (task.stretches.every((s) => fits(free, start + s.offset, start + s.offset + s.minutes)))
        return true;
    return false;
  };

  const overrides = new Map(rows.overrides.map((o) => [o.date, o.hours]));
  const free = model.cooks[0].free;
  // Each date in the window, latest first: its hours now, each minute of day as an instant, and the free time of every other date.
  const days: { date: LocalDate; hours: Hours[]; at: Minute[]; others: Interval[] }[] = [];
  for (
    let date = localParts(window.start, timeZone).date;
    date <= localParts(window.end - 1, timeZone).date;
    date = addDays(date, 1)
  ) {
    const at = Array.from({ length: DAY / GRID + 1 }, (_, i) =>
      zonedMinute(date, i * GRID, timeZone),
    );
    const hours = overrides.has(date)
      ? [overrides.get(date)].filter((x): x is Hours => x != null)
      : rows.weekly
          .filter((w) => w.weekday === weekdayOf(date))
          .map(({ start, end }) => ({ start, end }));
    days.unshift({
      date,
      hours,
      at,
      others: free.filter((iv) => iv.start < at[0] || iv.start >= at.at(-1)!),
    });
  }

  // The candidates of one cost: the later date first, then the one that ends later.
  function* candidates(
    cost: number,
  ): Generator<OverrideProposal & { range: Interval; others: Interval[] }> {
    for (const { date, hours, at, others } of days) {
      const make = (start: number, end: number) => ({
        date,
        start,
        end,
        range: { start: at[start / GRID], end: at[end / GRID] },
        others,
      });
      if (!hours.length) {
        for (let start = DAY - cost; start >= 0; start -= GRID) yield make(start, start + cost);
        continue;
      }
      const from = Math.min(...hours.map((x) => x.start));
      const to = Math.max(...hours.map((x) => x.end));
      const gap = to - from - hours.reduce((n, x) => n + x.end - x.start, 0);
      for (let earlier = 0; earlier <= cost - gap; earlier += GRID) {
        const later = cost - gap - earlier;
        if (from - earlier >= 0 && to + later <= DAY) yield make(from - earlier, to + later);
      }
    }
  }

  const kept = (plan: Plan) => {
    const after = new Map(plan.placements.map((p) => [p.key, p.start]));
    return after.has(key) && base.placements.every((p) => after.get(p.key) === p.start);
  };
  for (let cost = GRID; cost <= DAY; cost += GRID) {
    for (const c of candidates(cost)) {
      // A new range must reach into the window to help.
      if (c.range.start >= window.end || c.range.end <= window.start) continue;
      if (!fitsIn(normalize([...c.others, c.range]), c.range)) continue;
      const trial = {
        ...rows,
        overrides: [
          ...rows.overrides.filter((o) => o.date !== c.date),
          { date: c.date, hours: { start: c.start, end: c.end } },
        ],
      };
      if (kept(schedule(toPlanningModel(trial, timeZone).model)))
        return { date: c.date, start: c.start, end: c.end };
    }
  }
  return null;
}
