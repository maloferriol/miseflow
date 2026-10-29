import { describe, expect, it } from "vitest";
import type { RecipeSnapshot } from "../recipe/snapshot.ts";
import type { PreviousPlacement } from "../scheduler/types.ts";
import type { PlanRows } from "./model.ts";
import { planReadOf } from "./read.ts";
import type { LoadedRows } from "./replan.ts";

// Pure: no Tx, no Postgres. Rows are built in memory, as `loadPlanRows` would return them.

const utc = (iso: string) => Date.parse(iso) / 60_000;
const timeZone = "Europe/Paris";

// A Recipe with one plain 30-minute Step per id, linked in the given order.
function recipe(name: string, stepIds: string[], links: [string, string][] = []): RecipeSnapshot {
  return {
    name,
    servings: null,
    yield: null,
    makeAhead: null,
    steps: stepIds.map((id, i) => ({
      id,
      position: `a${i}`,
      body: [{ type: "text", text: `Do ${id}` }],
      lines: [],
      activeMinutes: 30,
      passiveMinutes: null,
      makeAhead: null,
      groupWithPrevious: false,
    })),
    dependencies: links.map(([beforeStepId, afterStepId], i) => ({
      id: `l${i}`,
      beforeStepId,
      afterStepId,
    })),
  };
}

const placement = (key: string, start: string): PreviousPlacement => ({
  key,
  start: utc(start),
  cookId: "cook",
  pinned: false,
});

function rows(previous: PreviousPlacement[]): LoadedRows {
  const base: PlanRows = {
    service: { id: "svc", date: "2026-10-31", time: 19 * 60 },
    defaultServiceTime: 19 * 60,
    cookId: "cook",
    weekly: [],
    overrides: [],
    guestCount: 6,
    region: "metric",
    dishes: [
      {
        dishId: "d",
        recipeId: "rd",
        scaleFactor: null,
        recipe: recipe("Duck", ["s1", "s2"], [["s1", "s2"]]),
      },
      {
        dishId: "e",
        recipeId: "re",
        scaleFactor: null,
        recipe: recipe("Eggs", ["e1", "e2"], [["e1", "e2"]]),
      },
      { dishId: "u", recipeId: "ru", scaleFactor: null, recipe: recipe("Unplaced pie", ["u1"]) },
    ],
    subRecipes: new Map(),
    batches: [],
    previous,
    progress: new Map(),
  };
  return { ...base, service: { ...base.service, menuId: "menu", timeIsDefault: false } };
}

describe("planReadOf", () => {
  const read = planReadOf(
    rows([
      placement("dish:e:e2", "2026-10-31T09:00Z"),
      placement("dish:e:e1", "2026-10-31T10:00Z"),
      placement("dish:d:s2", "2026-10-31T08:00Z"),
      placement("dish:d:s1", "2026-10-30T17:00Z"),
    ]),
    timeZone,
    new Date("2026-10-30T18:00:00Z"),
  );

  it("groups placed Tasks into days by local date, sorted by start", () => {
    expect(read.days.map((d) => [d.date, d.tasks.map((t) => t.key)])).toEqual([
      ["2026-10-30", ["dish:d:s1"]],
      ["2026-10-31", ["dish:d:s2", "dish:e:e2", "dish:e:e1"]],
    ]);
  });

  it("names a behind Task and what it holds up", () => {
    const behind = read.days.flatMap((d) => d.tasks).filter((t) => t.behind);
    expect(behind.map((t) => [t.key, t.behind])).toEqual([
      [
        "dish:d:s1",
        {
          dueAt: "18:30",
          dueDate: "2026-10-30",
          holdsUp: [{ key: "dish:d:s2", label: "Duck · Do s2" }],
        },
      ],
    ]);
  });

  it("names an Unplaced Task with its sentence and Dish", () => {
    expect(read.unplaced).toEqual([
      {
        key: "dish:u:u1",
        dish: { id: "u", name: "Unplaced pie" },
        batch: null,
        steps: [{ id: "u1", text: "Do u1" }],
        kind: "NoAvailability",
        sentence: "No Cook has 30 free minutes between Sat 00:00 and Sat 19:00",
        blockingPin: null,
        dishes: [{ id: "u", name: "Unplaced pie" }],
        moreTime: true,
      },
    ]);
  });

  it("describes a conflict", () => {
    expect(read.conflicts).toEqual([
      {
        key: "dish:e:e1",
        kind: "EarliestUseTooLate",
        dish: { id: "e", name: "Eggs" },
        batch: null,
        steps: [{ id: "e1", text: "Do e1" }],
        use: { key: "dish:e:e2", label: "Do e2 (Eggs)" },
        sentence: "Do e1 (Eggs) is ready at Sat 11:30, but Do e2 (Eggs) starts at Sat 10:00",
      },
    ]);
  });
});
