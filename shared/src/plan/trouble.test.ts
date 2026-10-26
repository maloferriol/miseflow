import { describe, expect, it } from "vitest";
import { planTrouble } from "./trouble.ts";

// Only the list lengths count (AC5), so the items are stand-ins.
const items = (n: number, key = (i: number) => `dish:d:${i}`) => Array.from({ length: n }, (_, i) => ({ key: key(i) }));

describe("planTrouble", () => {
  it("is 0 with no Unplaced Tasks and no conflicts", () => {
    expect(planTrouble({ unplaced: [], conflicts: [] })).toBe(0);
  });

  it("counts the Unplaced Tasks plus the conflicts", () => {
    expect(planTrouble({ unplaced: items(1), conflicts: [] })).toBe(1);
    expect(planTrouble({ unplaced: [], conflicts: items(1) })).toBe(1);
    expect(planTrouble({ unplaced: items(2), conflicts: items(3) })).toBe(5);
  });

  it("counts each conflict row as the Conflicts list shows it, two on one Task included", () => {
    expect(planTrouble({ unplaced: [], conflicts: items(2, () => "dish:d:s1") })).toBe(2);
  });
});
