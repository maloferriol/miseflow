import { describe, expect, it } from "vitest";
import { generatedService } from "./fixtures.ts";
import { schedule } from "./index.ts";

describe("schedule performance", () => {
  it("AC8: 500-Task Service plans in under 2 s", () => {
    const input = generatedService(500);
    const t0 = performance.now();
    const plan = schedule(input);
    const ms = performance.now() - t0;
    console.log(
      `500 Tasks: ${ms.toFixed(1)} ms (${plan.placements.length} placed, ${plan.unplaced.length} unplaced)`,
    );

    expect(plan.placements.length + plan.unplaced.length).toBe(500);
    expect(ms).toBeLessThan(2000);
  });
});
