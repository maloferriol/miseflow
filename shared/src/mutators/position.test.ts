import { describe, expect, it } from "vitest";
import { positionAfter } from "./position.ts";

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
