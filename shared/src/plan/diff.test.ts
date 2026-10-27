import { describe, expect, it } from "vitest";
import type { Placement } from "../scheduler/types.ts";
import { diffPlacements, type StoredPlacement } from "./diff.ts";

const stored = (key: string, start: number, live = true): StoredPlacement => ({
  id: `id-${key}`,
  key,
  start,
  cookId: "cook",
  pinned: false,
  live,
});
const next = (key: string, start: number): Placement => ({
  key,
  start,
  end: start + 10,
  cookId: "cook",
  pinned: false,
  approximate: false,
});

describe("diffPlacements", () => {
  it("writes nothing when nothing moved", () => {
    expect(diffPlacements([stored("a", 100)], [next("a", 100)])).toEqual({
      insert: [],
      update: [],
      remove: [],
    });
  });

  it("updates a placement whose start moved", () => {
    expect(diffPlacements([stored("a", 100)], [next("a", 95)]).update).toEqual([
      { id: "id-a", start: 95, cookId: "cook", revive: false },
    ]);
  });

  it("revives a Task's soft-deleted row instead of inserting another", () => {
    expect(diffPlacements([stored("a", 100, false)], [next("a", 80)])).toEqual({
      insert: [],
      update: [{ id: "id-a", start: 80, cookId: "cook", revive: true }],
      remove: [],
    });
  });

  it("inserts a new Task's placement", () => {
    expect(diffPlacements([], [next("a", 100)]).insert).toEqual([next("a", 100)]);
  });

  it("removes the placement of a Task that is Unplaced or gone", () => {
    expect(diffPlacements([stored("a", 100), stored("b", 50, false)], [])).toEqual({
      insert: [],
      update: [],
      remove: ["id-a"],
    });
  });
});
