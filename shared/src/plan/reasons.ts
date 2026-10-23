import type { Interval, Minute, TaskKey, UnplacedReason } from "../scheduler/types.ts";
import type { TaskInfo } from "./model.ts";

// Pure: an Unplaced Task's reason as a sentence, times in the kitchen's zone ("Fri 19:50").

const WEEK = 7 * 1440;

function clock(minute: Minute, timeZone: string, withDate: boolean): string {
  const date = new Date(minute * 60_000);
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(date);
  const day = part({ weekday: "short" });
  const time = part({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return withDate ? `${day} ${part({ day: "numeric", month: "short" })} ${time}` : `${day} ${time}`;
}

function between(window: Interval, timeZone: string): string {
  const withDate = window.end - window.start >= WEEK;
  return `between ${clock(window.start, timeZone, withDate)} and ${clock(window.end, timeZone, withDate)}`;
}

/** "20 min", "3 h", "2 h 10 min". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function describeUnplaced(
  reason: UnplacedReason,
  task: TaskInfo,
  timeZone: string,
  labelOf: (key: TaskKey) => string,
): string {
  switch (reason.kind) {
    case "NoAvailability": {
      const passive = task.passiveMinutes ? `, with ${formatMinutes(task.passiveMinutes)} of passive time after` : "";
      return `No Cook has ${task.activeMinutes} free minutes ${between(reason.searched, timeZone)}${passive}`;
    }
    case "WindowTooTight":
      return `It needs ${formatMinutes(reason.minutesNeeded)}, but only ${formatMinutes(Math.max(0, reason.window.end - reason.window.start))} lie ${between(reason.window, timeZone)}`;
    case "BlockedByPin":
      return `The pinned Task ${labelOf(reason.pin)} leaves no room ${between(reason.searched, timeZone)}`;
  }
}
