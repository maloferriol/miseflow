import { describe, expect, it } from "vitest";
import { quickFixes, troubleBadge, type UnplacedItem } from "./quick-fixes.ts";

const tarte = { id: "dish-tarte", name: "Tarte tatin" };
const item = (spec: Partial<UnplacedItem>): UnplacedItem => ({
  dish: tarte,
  batch: null,
  steps: [{ id: "step-t1", text: "Make the pastry" }],
  kind: "NoAvailability",
  blockingPin: null,
  dishes: [tarte],
  moreTime: true,
  ...spec,
});

describe("quickFixes", () => {
  it("offers more time (a new override id each time) and removing the Dish for a NoAvailability Task", () => {
    expect(quickFixes("svc", item({}), () => "new-id")).toEqual([
      {
        label: "Give the Cook more time",
        name: "giveCookMoreTime",
        args: {
          serviceId: "svc",
          owner: { kind: "dish", dishId: "dish-tarte" },
          firstStepId: "step-t1",
          overrideId: "new-id",
        },
        confirm: null,
      },
      {
        label: "Remove Tarte tatin",
        name: "removeDish",
        args: { dishId: "dish-tarte" },
        confirm: "Remove Tarte tatin from the Menu?",
      },
    ]);
  });

  it("adds Unpin <label> for a BlockedByPin Task, after more time", () => {
    const pin = {
      owner: { kind: "dish" as const, dishId: "dish-tarte" },
      firstStepId: "step-t2",
      label: "Chill the pastry (Tarte tatin)",
    };
    expect(
      quickFixes("svc", item({ kind: "BlockedByPin", blockingPin: pin }), () => "new-id").map(
        (f) => [f.label, f.name, f.args],
      ),
    ).toEqual([
      [
        "Give the Cook more time",
        "giveCookMoreTime",
        {
          serviceId: "svc",
          owner: { kind: "dish", dishId: "dish-tarte" },
          firstStepId: "step-t1",
          overrideId: "new-id",
        },
      ],
      [
        "Unpin Chill the pastry (Tarte tatin)",
        "unpinTask",
        { serviceId: "svc", owner: pin.owner, firstStepId: "step-t2" },
      ],
      ["Remove Tarte tatin", "removeDish", { dishId: "dish-tarte" }],
    ]);
  });

  it("hides more time for a WindowTooTight Task (owner decision 3)", () => {
    expect(
      quickFixes("svc", item({ kind: "WindowTooTight", moreTime: false })).map((f) => f.label),
    ).toEqual(["Remove Tarte tatin"]);
  });

  it("gives a Batch's Task its own owner and one Remove per Dish the Batch feeds (owner decision 4)", () => {
    const veloute = { id: "dish-veloute", name: "Velouté" };
    const duck = { id: "dish-duck", name: "Duck breast" };
    const fixes = quickFixes(
      "svc",
      item({
        dish: null,
        batch: { id: "batch-stock", label: "Chicken stock ×1.5" },
        steps: [{ id: "s1", text: "Roast the bones" }],
        dishes: [veloute, duck],
      }),
      () => "new-id",
    );
    expect(fixes.map((f) => [f.label, f.args])).toEqual([
      [
        "Give the Cook more time",
        {
          serviceId: "svc",
          owner: { kind: "batch", batchId: "batch-stock" },
          firstStepId: "s1",
          overrideId: "new-id",
        },
      ],
      ["Remove Velouté", { dishId: "dish-veloute" }],
      ["Remove Duck breast", { dishId: "dish-duck" }],
    ]);
  });
});

describe("troubleBadge", () => {
  it("reads Plan trouble: N, and is hidden at 0", () => {
    expect(troubleBadge({ unplaced: [], conflicts: [] })).toBeNull();
    expect(troubleBadge({ unplaced: [{}], conflicts: [] })).toBe("Plan trouble: 1");
    expect(troubleBadge({ unplaced: [{}], conflicts: [{}, {}] })).toBe("Plan trouble: 3");
  });
});
