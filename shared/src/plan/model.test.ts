import { describe, expect, it } from "vitest";
import type { RecipeSnapshot } from "../recipe/snapshot.ts";
import { freeIntervals, type PlanRows, toPlanningModel } from "./model.ts";
import { stepKey } from "./progress.ts";

const utc = (iso: string) => Date.parse(iso) / 60_000;
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

describe("freeIntervals", () => {
  it("turns Thu and Fri 18:00–22:00, Sat 09:00–19:00 and an override Fri 19:00–21:00 into Paris intervals across the end of summer time", () => {
    const weekly = [
      { weekday: 4, start: h(18), end: h(22) },
      { weekday: 5, start: h(18), end: h(22) },
      { weekday: 6, start: h(9), end: h(19) },
    ];
    const overrides = [{ date: "2026-10-30", hours: { start: h(19), end: h(21) } }];
    expect(freeIntervals(weekly, overrides, "2026-10-22", "2026-10-31", "Europe/Paris")).toEqual([
      { start: utc("2026-10-22T16:00Z"), end: utc("2026-10-22T20:00Z") }, // Thu, UTC+2
      { start: utc("2026-10-23T16:00Z"), end: utc("2026-10-23T20:00Z") }, // Fri
      { start: utc("2026-10-24T07:00Z"), end: utc("2026-10-24T17:00Z") }, // Sat
      // Sun 25 Oct: summer time ends
      { start: utc("2026-10-29T17:00Z"), end: utc("2026-10-29T21:00Z") }, // Thu, UTC+1
      { start: utc("2026-10-30T18:00Z"), end: utc("2026-10-30T20:00Z") }, // Fri: the override
      { start: utc("2026-10-31T08:00Z"), end: utc("2026-10-31T18:00Z") }, // Sat
    ]);
  });

  it("gives no interval on a date whose override is null (not available)", () => {
    const weekly = [{ weekday: 5, start: h(18), end: h(22) }];
    expect(
      freeIntervals(
        weekly,
        [{ date: "2026-10-30", hours: null }],
        "2026-10-30",
        "2026-10-30",
        "Europe/Paris",
      ),
    ).toEqual([]);
  });

  it("ends an Availability that runs to midnight at the next day's 00:00", () => {
    const weekly = [{ weekday: 6, start: h(18), end: 1440 }];
    expect(freeIntervals(weekly, [], "2026-10-31", "2026-10-31", "Europe/Paris")).toEqual([
      { start: utc("2026-10-31T17:00Z"), end: utc("2026-10-31T23:00Z") },
    ]);
  });
});

// A Recipe snapshot with plain Steps, built in the test.
function recipe(
  steps: {
    id: string;
    active?: number | null;
    passive?: number | null;
    group?: boolean;
    makeAhead?: { beforeDays: number; shelfLifeDays: number } | null;
    subRecipeId?: string;
  }[],
  options: {
    makeAhead?: { beforeDays: number; shelfLifeDays: number } | null;
    links?: [string, string][];
  } = {},
): RecipeSnapshot {
  return {
    name: "R",
    servings: null,
    yield: null,
    makeAhead: options.makeAhead ?? null,
    steps: steps.map((s, i) => ({
      id: s.id,
      position: `a${i}`,
      body: [{ type: "text", text: s.id }],
      lines: s.subRecipeId
        ? [
            {
              id: `${s.id}-line`,
              ingredientId: null,
              subRecipeId: s.subRecipeId,
              quantity: 1,
              quantityMax: null,
              unit: null,
              wording: "stock",
              preparation: null,
              fixedQuantity: false,
              position: "a0",
            },
          ]
        : [],
      activeMinutes: s.active === undefined ? 10 : s.active,
      passiveMinutes: s.passive ?? null,
      makeAhead: s.makeAhead ?? null,
      groupWithPrevious: s.group ?? false,
    })),
    dependencies: (options.links ?? []).map(([beforeStepId, afterStepId], i) => ({
      id: `l${i}`,
      beforeStepId,
      afterStepId,
    })),
  };
}

function rows(
  dishes: { dishId: string; recipe: RecipeSnapshot; recipeId?: string }[],
  service: Partial<PlanRows["service"]> = {},
  scale: {
    subRecipes?: [string, RecipeSnapshot][];
    batches?: { batchId: string; subRecipeId: string }[];
  } = {},
): PlanRows {
  return {
    service: { id: "svc", date: "2026-10-31", time: h(19, 30), ...service },
    defaultServiceTime: h(19),
    cookId: "cook",
    weekly: [],
    overrides: [],
    guestCount: 6,
    region: "metric",
    dishes: dishes.map((d) => ({
      dishId: d.dishId,
      recipeId: d.recipeId ?? `r-${d.dishId}`,
      scaleFactor: null,
      recipe: d.recipe,
    })),
    subRecipes: new Map(scale.subRecipes ?? []),
    batches: scale.batches ?? [],
    previous: [],
    progress: new Map(),
  };
}

const paris = "Europe/Paris";

describe("toPlanningModel", () => {
  it("makes one Task per Step group, keyed by the Dish and the group's first Step", () => {
    const { model, tasks } = toPlanningModel(
      rows([
        { dishId: "d", recipe: recipe([{ id: "s1" }, { id: "s2", group: true }, { id: "s3" }]) },
      ]),
      paris,
    );
    expect(model.tasks.map((t) => t.steps.map((s) => s.stepId))).toEqual([["s1", "s2"], ["s3"]]);
    expect([...tasks.keys()]).toEqual(["dish:d:s1", "dish:d:s3"]);
    expect(tasks.get("dish:d:s1")).toMatchObject({
      dishId: "d",
      stepIds: ["s1", "s2"],
      activeMinutes: 20,
      passiveMinutes: 0,
    });
  });

  it("passes a Step with no duration through as null and marks its Task approximate", () => {
    const { model, tasks } = toPlanningModel(
      rows([{ dishId: "d", recipe: recipe([{ id: "s1", active: null }]) }]),
      paris,
    );
    expect(model.tasks[0]!.steps[0]).toEqual({
      stepId: "s1",
      activeMinutes: null,
      passiveMinutes: null,
    });
    expect(tasks.get("dish:d:s1")).toMatchObject({ approximate: true, activeMinutes: 10 });
  });

  it("sets each Task's earliest start from its make-ahead window, the most restrictive Step's for a group", () => {
    const window = (beforeDays: number) => ({ beforeDays, shelfLifeDays: 4 });
    const { model } = toPlanningModel(
      rows([
        { dishId: "a", recipe: recipe([{ id: "none" }]) },
        { dishId: "b", recipe: recipe([{ id: "two" }], { makeAhead: window(2) }) },
        {
          dishId: "c",
          recipe: recipe([
            { id: "three", makeAhead: window(3) },
            { id: "one", group: true, makeAhead: window(1) },
          ]),
        },
        {
          dishId: "e",
          recipe: recipe([
            { id: "ahead", makeAhead: window(3) },
            { id: "last", group: true, makeAhead: window(0) },
          ]),
        },
      ]),
      paris,
    );
    expect(model.tasks.map((t) => t.earliestStart)).toEqual([
      null,
      utc("2026-10-28T23:00Z"),
      utc("2026-10-29T23:00Z"),
      null,
    ]);
  });

  it("maps links onto Task keys and drops a link inside one Task", () => {
    const { model } = toPlanningModel(
      rows([
        {
          dishId: "d",
          recipe: recipe([{ id: "s1" }, { id: "s2", group: true }, { id: "s3" }], {
            links: [
              ["s1", "s2"],
              ["s1", "s3"],
              ["s2", "s3"],
            ],
          }),
        },
      ]),
      paris,
    );
    expect(model.links).toEqual([{ before: "dish:d:s1", after: "dish:d:s3" }]);
  });

  it("puts the Service at its time, else at the kitchen's default", () => {
    const one = [{ dishId: "d", recipe: recipe([{ id: "s1" }]) }];
    expect(toPlanningModel(rows(one), paris).model.service).toEqual({
      dayStart: utc("2026-10-30T23:00Z"),
      at: utc("2026-10-31T18:30Z"),
    });
    expect(toPlanningModel(rows(one, { time: null }), paris).model.service.at).toBe(
      utc("2026-10-31T18:00Z"),
    );
  });

  it("adds no Task for a sub-recipe line", () => {
    const { model } = toPlanningModel(
      rows([{ dishId: "d", recipe: recipe([{ id: "s1", subRecipeId: "stock" }]) }]),
      paris,
    );
    expect(model.tasks).toHaveLength(1);
  });
});

describe("toPlanningModel with Batches", () => {
  const stock = (
    steps: Parameters<typeof recipe>[0],
    options: Parameters<typeof recipe>[1] = {},
  ) => ({
    ...recipe(steps, options),
    name: "Chicken stock",
    yield: { quantity: 2, unit: "L" },
  });

  it("makes each of a stored Batch's Step groups a batch Task, linked before every Task of its parent", () => {
    const { model, tasks } = toPlanningModel(
      rows(
        [{ dishId: "d", recipe: recipe([{ id: "v1" }, { id: "v2", subRecipeId: "stock" }]) }],
        {},
        {
          subRecipes: [
            [
              "stock",
              stock([{ id: "k1" }, { id: "k2", group: true }, { id: "k3" }], {
                links: [["k1", "k3"]],
              }),
            ],
          ],
          batches: [{ batchId: "b", subRecipeId: "stock" }],
        },
      ),
      paris,
    );
    expect(model.tasks.map((t) => t.owner)).toEqual([
      { kind: "dish", dishId: "d" },
      { kind: "dish", dishId: "d" },
      { kind: "batch", batchId: "b" },
      { kind: "batch", batchId: "b" },
    ]);
    expect(tasks.get("batch:b:k1")).toMatchObject({
      dishId: null,
      batchId: "b",
      stepIds: ["k1", "k2"],
    });
    expect(model.links).toEqual([
      { before: "batch:b:k1", after: "batch:b:k3" },
      { before: "batch:b:k1", after: "dish:d:v1" },
      { before: "batch:b:k1", after: "dish:d:v2" },
      { before: "batch:b:k3", after: "dish:d:v1" },
      { before: "batch:b:k3", after: "dish:d:v2" },
    ]);
  });

  it("links a Batch used twice by one parent to each parent Task once", () => {
    const { model } = toPlanningModel(
      rows(
        [
          {
            dishId: "d",
            recipe: recipe([
              { id: "v1", subRecipeId: "stock" },
              { id: "v2", subRecipeId: "stock" },
            ]),
          },
        ],
        {},
        {
          subRecipes: [["stock", stock([{ id: "k1" }])]],
          batches: [{ batchId: "b", subRecipeId: "stock" }],
        },
      ),
      paris,
    );
    expect(model.links).toEqual([
      { before: "batch:b:k1", after: "dish:d:v1" },
      { before: "batch:b:k1", after: "dish:d:v2" },
    ]);
  });

  it("links a nested Batch before its parent Batch's Tasks", () => {
    const { model } = toPlanningModel(
      rows(
        [{ dishId: "d", recipe: recipe([{ id: "d1", subRecipeId: "beurre" }]) }],
        {},
        {
          subRecipes: [
            [
              "beurre",
              {
                ...recipe([{ id: "bb1", subRecipeId: "stock" }]),
                name: "Beurre blanc",
                yield: { quantity: 300, unit: null },
              },
            ],
            ["stock", stock([{ id: "k1" }])],
          ],
          batches: [
            { batchId: "bb", subRecipeId: "beurre" },
            { batchId: "b", subRecipeId: "stock" },
          ],
        },
      ),
      paris,
    );
    expect(model.links).toEqual([
      { before: "batch:bb:bb1", after: "dish:d:d1" },
      { before: "batch:b:k1", after: "batch:bb:bb1" },
    ]);
  });

  it("keeps a prep-ahead Task for its shortest shelf life, and a last-minute Task for ever", () => {
    const { model } = toPlanningModel(
      rows(
        [{ dishId: "d", recipe: recipe([{ id: "v1", subRecipeId: "stock" }]) }],
        {},
        {
          subRecipes: [
            [
              "stock",
              stock(
                [
                  { id: "k1" },
                  { id: "k2", group: true, makeAhead: { beforeDays: 3, shelfLifeDays: 2 } },
                  { id: "k3" },
                  { id: "k4", makeAhead: { beforeDays: 0, shelfLifeDays: 0 } },
                ],
                { makeAhead: { beforeDays: 3, shelfLifeDays: 4 } },
              ),
            ],
          ],
          batches: [{ batchId: "b", subRecipeId: "stock" }],
        },
      ),
      paris,
    );
    const keeps = new Map(model.tasks.map((t) => [t.steps[0]!.stepId, t.keepsMinutes]));
    expect(keeps.get("k1")).toBe(2 * 1440);
    expect(keeps.get("k3")).toBe(4 * 1440);
    expect(keeps.get("k4")).toBeNull();
    expect(keeps.get("v1")).toBeNull();
  });

  it("adds no Task for a derived Batch with no stored row", () => {
    const { model, scale } = toPlanningModel(
      rows(
        [{ dishId: "d", recipe: recipe([{ id: "v1", subRecipeId: "stock" }]) }],
        {},
        { subRecipes: [["stock", stock([{ id: "k1" }])]] },
      ),
      paris,
    );
    expect(model.tasks).toHaveLength(1);
    expect(scale.batches.map((b) => b.subRecipeId)).toEqual(["stock"]);
  });

  it("opens the Cook's free time as far back as a Batch's window", () => {
    const { model } = toPlanningModel(
      {
        ...rows(
          [{ dishId: "d", recipe: recipe([{ id: "v1", subRecipeId: "stock" }]) }],
          {},
          {
            subRecipes: [
              ["stock", stock([{ id: "k1" }], { makeAhead: { beforeDays: 3, shelfLifeDays: 4 } })],
            ],
            batches: [{ batchId: "b", subRecipeId: "stock" }],
          },
        ),
        weekly: [{ weekday: 3, start: h(18), end: h(22) }],
      },
      paris,
    );
    expect(model.cooks[0]!.free).toEqual([
      { start: utc("2026-10-28T17:00Z"), end: utc("2026-10-28T21:00Z") },
    ]);
  });
});

describe("toPlanningModel with Step progress", () => {
  it("gives a done Step its tick time in minutes, on a Dish Task and on a Batch Task, and a Step not done none", () => {
    const input = rows(
      [{ dishId: "d", recipe: recipe([{ id: "v1" }, { id: "v2", subRecipeId: "stock" }]) }],
      {},
      {
        subRecipes: [["stock", { ...recipe([{ id: "k1" }]), yield: { quantity: 2, unit: "L" } }]],
        batches: [{ batchId: "b", subRecipeId: "stock" }],
      },
    );
    const tick = new Date("2026-10-31T16:20:30Z");
    input.progress = new Map([
      [stepKey({ kind: "dish", dishId: "d" }, "v1"), { done: true, doneAt: tick }],
      [stepKey({ kind: "dish", dishId: "d" }, "v2"), { done: false, doneAt: null }],
      [stepKey({ kind: "batch", batchId: "b" }, "k1"), { done: true, doneAt: tick }],
    ]);
    const { model } = toPlanningModel(input, paris);
    const doneAt = Object.fromEntries(
      model.tasks.flatMap((t) => t.steps.map((s) => [s.stepId, s.doneAt ?? null])),
    );
    expect(doneAt).toEqual({
      v1: utc("2026-10-31T16:21Z"),
      v2: null,
      k1: utc("2026-10-31T16:21Z"),
    });
  });
});
