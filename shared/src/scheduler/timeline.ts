import type { Interval, Minute } from "./types.ts";

/**
 * Free time of one Cook as sorted, disjoint, non-empty half-open intervals.
 * All functions are pure: they return new arrays.
 */
export type Timeline = Interval[];

export function normalize(intervals: Interval[]): Timeline {
  const sorted = intervals
    .filter((iv) => iv.end > iv.start)
    .map((iv) => ({ start: iv.start, end: iv.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Timeline = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push(iv);
  }
  return out;
}

/** Removes `[start, end)` from the timeline. */
export function subtract(timeline: Timeline, start: Minute, end: Minute): Timeline {
  if (end <= start) return timeline;
  const out: Timeline = [];
  for (const iv of timeline) {
    if (iv.end <= start || iv.start >= end) {
      out.push(iv);
      continue;
    }
    if (iv.start < start) out.push({ start: iv.start, end: start });
    if (iv.end > end) out.push({ start: end, end: iv.end });
  }
  return out;
}

/** True when `[start, end)` lies inside a single interval. An empty stretch always fits. */
export function fits(timeline: Timeline, start: Minute, end: Minute): boolean {
  if (end <= start) return true;
  // Last interval whose start is <= `start`.
  let lo = 0;
  let hi = timeline.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].start <= start) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 && timeline[found].end >= end;
}
