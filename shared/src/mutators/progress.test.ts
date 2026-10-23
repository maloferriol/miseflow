import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { buildWalkthrough, SERVICE_DATE, SERVICE_TIME, setWalkthroughAvailability } from "../../test/walkthrough.ts";
import { readPlan, type PlanRead } from "../plan/replan.ts";
import { taskPlacements } from "../schema.ts";
import { getMutator, type Tx } from "./registry.ts";

// A fixed clock (a Monday before the walkthrough), so no test reads the wall clock (#88).
const FIXED_NOW = new Date("2026-10-26T12:00:00Z");
const ownerId = crypto.randomUUID();
const timeZone = "Europe/Paris";

async function run(tx: Tx, name: string, args: unknown, options: { owner?: string; now?: () => Date } = {}) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId: options.owner ?? ownerId, timeZone, now: options.now ?? (() => FIXED_NOW) });
}

// The walkthrough (with the stock when asked) with its Service and Availability, inside the test's transaction.
async function walkthrough(tx: Tx, options: { stock?: boolean } = {}) {
  const s = crypto.randomUUID().slice(0, 8);
  const w = await buildWalkthrough((name, args) => run(tx, name, args), s, options);
  await setWalkthroughAvailability((name, args) => run(tx, name, args));
  const serviceId = crypto.randomUUID();
  await run(tx, "createService", { serviceId, menuId: w.menuId, date: SERVICE_DATE, time: SERVICE_TIME });
  return { w, s, serviceId };
}

// Each live placement's start minute, by the Step that keys its Task.
async function starts(tx: Tx, serviceId: string) {
  const rows = await tx
    .select({ stepId: taskPlacements.firstStepId, start: taskPlacements.startMinute })
    .from(taskPlacements)
    .where(and(eq(taskPlacements.serviceId, serviceId), isNull(taskPlacements.deletedAt)));
  return new Map(rows.map((r) => [r.stepId, r.start]));
}

const taskOf = (plan: PlanRead, stepId: string) => plan.days.flatMap((d) => d.tasks).find((t) => t.steps[0]!.id === stepId)!;

describe("Behind on the Plan read", () => {
  it("AC3: with the clock 5 minutes past D2's due time and nothing ticked, D2 is behind and holds up D3 and D4; 5 minutes before, it isn't", async () => {
    await inRollback(async (tx) => {
      const { w, s, serviceId } = await walkthrough(tx);
      const d2 = (await starts(tx, serviceId)).get(w.steps.D2)!;
      // D2 (Score and season) is 10 minutes of active time, so it's due 10 minutes after its start.
      const due = new Date((d2 + 10) * 60_000);
      const late = await readPlan(tx, ownerId, serviceId, timeZone, new Date(due.getTime() + 5 * 60_000));
      const duck = `Duck breast with beurre blanc ${s}`;
      expect(taskOf(late, w.steps.D2).behind).toEqual({
        dueAt: "17:30",
        dueDate: "2026-10-31",
        holdsUp: [
          { key: `dish:${w.dishes.duck}:${w.steps.D3}`, label: `${duck} · Sear the duck` },
          { key: `dish:${w.dishes.duck}:${w.steps.D4}`, label: `${duck} · Make the beurre blanc` },
        ],
      });
      expect(taskOf(late, w.steps.V3).behind).toBeNull();
      expect(late.asOf).toBe("Sat 31 Oct 17:35");

      const early = await readPlan(tx, ownerId, serviceId, timeZone, new Date(due.getTime() - 5 * 60_000));
      expect(taskOf(early, w.steps.D2).behind).toBeNull();
    });
  });
});
