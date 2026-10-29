import { applyPlacements, withPin } from "@miseflow/shared/src/plan/pin.ts";
import { schedule } from "@miseflow/shared/src/scheduler/schedule.ts";
import type { Menu, Plan, PlanTask } from "./api.ts";
import type { MutationCall } from "./mutation-call.ts";
import type { QuickFix } from "./quick-fixes.ts";

// Pure: the Plan screen's decisions, formatting and named mutations (ADR 0011, ADR 0007).
// PlanScreen's hook sends them and its view renders them.

/** A named mutation as the Plan screen sends it: each send makes its own id. */
export type PlanMutation = Omit<MutationCall, "id">;

/** "1 h 30 min", "2 h", "45 min": a Task's passive time on its Plan line. */
export function passive(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The Gantt chart's lanes: the Menu's Courses with their Dishes, named by Recipe. */
export function ganttCourses(menu: Pick<Menu, "courses">) {
  return menu.courses.map((c) => ({
    id: c.id,
    name: c.name,
    dishes: c.dishes.map((d) => ({ id: d.id, name: d.recipe.name })),
  }));
}

/**
 * The Plan the browser shows while a pin saves: the read with `task` pinned at `start` and the
 * rest re-fitted by the same scheduler (ADR 0010), or undefined, to leave it, before any read.
 */
export function optimisticPlan(read: Plan | undefined, task: PlanTask, start: number) {
  return read && applyPlacements(read, schedule(withPin(read.model, task.key, start)));
}

/** Whether no pin is pending, so a refetch can't show an earlier pin's answer over a later drag. */
export const noPinPending = (pendingPins: number) => pendingPins === 0;

/** Whether a settling pin is the last one pending: it is still counted while it settles. */
export const lastPinSettling = (pendingPins: number) => pendingPins === 1;

/** Dragging a Task's bar to `start` pins it there (#89). */
export const pinTask = (serviceId: string, task: PlanTask, start: number): PlanMutation => ({
  name: "pinTask",
  args: { serviceId, owner: task.owner, firstStepId: task.steps[0].id, start },
});

/** Re-plan from scratch (#90): asks nothing first. */
export const replanFromScratch = (serviceId: string): PlanMutation => ({
  name: "replanFromScratch",
  args: { serviceId },
});

/**
 * The quick fix to send, or null when the cook cancels its question. `ask` is asked only when
 * the fix has one (removing a Dish).
 */
export function confirmedFix(fix: QuickFix, ask: (question: string) => boolean) {
  return fix.confirm === null || ask(fix.confirm) ? { name: fix.name, args: fix.args } : null;
}
