import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { buildWalkthrough, SERVICE_DATE, SERVICE_TIME, setWalkthroughAvailability, type Walkthrough } from "../../test/walkthrough.ts";
import { getMutator, type Tx } from "../mutators/registry.ts";
import { collapse, type LaneRow, laneTree } from "./lanes.ts";
import { readPlan, type PlanRead } from "./replan.ts";

const FIXED_NOW = new Date("2026-10-26T12:00:00Z");
const ownerId = crypto.randomUUID();
const timeZone = "Europe/Paris";

async function run(tx: Tx, name: string, args: unknown) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId, timeZone, now: () => FIXED_NOW });
}

// The stock walkthrough's Plan read, and its Courses as the Menu read lists them.
async function stockPlan(tx: Tx): Promise<{ w: Walkthrough; plan: PlanRead; tree: ReturnType<typeof laneTree> }> {
  const w = await buildWalkthrough((name, args) => run(tx, name, args), crypto.randomUUID().slice(0, 8), { stock: true });
  await setWalkthroughAvailability((name, args) => run(tx, name, args));
  const serviceId = crypto.randomUUID();
  await run(tx, "createService", { serviceId, menuId: w.menuId, date: SERVICE_DATE, time: SERVICE_TIME });
  const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
  const courses = (["Starter", "Main", "Dessert"] as const).map((name, i) => {
    const key = (["veloute", "duck", "tarte"] as const)[i]!;
    return { id: name, name, dishes: [{ id: w.dishes[key], name: w.names[key] }] };
  });
  const tasks = plan.days.flatMap((d) => d.tasks);
  return { w, plan, tree: laneTree({ courses, batches: plan.batches, tasks }) };
}

// Each row as "<indent><name>[ (ghost)]: <first Step ids of its Tasks, folded ones after a |>".
const describeRows = (rows: LaneRow[], stepOf: (key: string) => string) =>
  rows.map((r) =>
    r.kind === "course"
      ? r.name
      : `${"  ".repeat(r.lane.depth)}${r.lane.name}${r.lane.ghost ? " (ghost)" : ""}: ${r.lane.taskKeys.map(stepOf).join(" ")}${r.folded.length ? ` | ${r.folded.map(stepOf).join(" ")}` : ""}`,
  );

describe("the Gantt lane tree", () => {
  it("AC2: the stock Batch shows under Velouté and under Beurre blanc; the Beurre blanc copy is the ghost; both copies hold the same Task keys", async () => {
    await inRollback(async (tx) => {
      const { w, plan, tree } = await stockPlan(tx);
      const names = Object.fromEntries(Object.entries(w.steps).map(([k, id]) => [id, k]));
      const stepOf = (key: string) => names[key.split(":")[2]!]!;
      const n = w.names;
      expect(describeRows(collapse(tree, []), stepOf)).toEqual([
        "Starter",
        `${n.veloute}: V1 V2 V3`,
        `  ${n.stock}: S1 S2 S3`,
        "Main",
        `${n.duck}: D1 D2 D3 D4`,
        `  ${n.beurre}: B1 B2`,
        `    ${n.stock} (ghost): S1 S2 S3`,
        "Dessert",
        `${n.tarte}: T1 T2 T3`,
      ]);
      const stockLanes = collapse(tree, []).flatMap((r) => (r.kind === "lane" && r.lane.name === n.stock ? [r.lane] : []));
      expect(stockLanes.map((l) => l.ghost)).toEqual([false, true]);
      expect(stockLanes[1]!.taskKeys).toEqual(stockLanes[0]!.taskKeys);
      expect(stockLanes[0]!.batchId).toBe(plan.batches.find((b) => b.subRecipe.id === w.recipes.stock)!.id);
      expect(stockLanes[0]!.label).toBe(plan.batches.find((b) => b.subRecipe.id === w.recipes.stock)!.label);
    });
  });

  it("AC3: collapsing the Velouté folds its Batch lanes' Tasks into its lane, and expanding restores them", async () => {
    await inRollback(async (tx) => {
      const { w, tree } = await stockPlan(tx);
      const names = Object.fromEntries(Object.entries(w.steps).map(([k, id]) => [id, k]));
      const stepOf = (key: string) => names[key.split(":")[2]!]!;
      const n = w.names;
      const expanded = describeRows(collapse(tree, []), stepOf);

      const folded = collapse(tree, [w.dishes.veloute]);
      expect(describeRows(folded, stepOf).slice(0, 3)).toEqual(["Starter", `${n.veloute}: V1 V2 V3 | S1 S2 S3`, "Main"]);
      expect(folded.find((r) => r.kind === "lane" && r.lane.id === w.dishes.veloute)).toMatchObject({ collapsed: true, collapsible: true });
      // The Duck still shows its own copy of the stock.
      expect(describeRows(folded, stepOf)).toContain(`    ${n.stock} (ghost): S1 S2 S3`);

      expect(describeRows(collapse(tree, []), stepOf)).toEqual(expanded);
      // Collapsing the Duck folds its whole branch, nested Batches included.
      expect(describeRows(collapse(tree, [w.dishes.duck]), stepOf)).toContain(`${n.duck}: D1 D2 D3 D4 | B1 B2 S1 S2 S3`);
    });
  });
});
