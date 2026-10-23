import { describe, expect, it } from "vitest";
import { positionAfter, positionBetween } from "./position.ts";

describe("positionAfter", () => {
  it("keeps appending in byte order, across a carry into a longer key", () => {
    const keys = [positionAfter(null)];
    for (let i = 0; i < 70; i++) keys.push(positionAfter(keys.at(-1)!));

    expect(keys[0]).toBe("a0");
    expect(keys).toContain("b00");
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("positionBetween", () => {
  it("makes a key before the first, between two, and after the last, in byte order", () => {
    const first = positionBetween(null, "a0");
    const middle = positionBetween("a0", "a1");
    const last = positionBetween("a1", null);

    expect([first, "a0", middle, "a1", last]).toEqual([first, "a0", middle, "a1", last].sort());
    expect(new Set([first, middle, last, "a0", "a1"]).size).toBe(5);
  });
});
