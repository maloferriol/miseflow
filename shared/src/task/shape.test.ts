import { describe, expect, it } from "vitest";
import {
  ceilToGrid,
  dueOffset,
  floorToGrid,
  GRID,
  nearestOnGrid,
  roundUpToGrid,
  taskShape,
} from "./shape.ts";

describe("taskShape", () => {
  it("a Step with only active time is one stretch from the start", () => {
    expect(taskShape([{ activeMinutes: 15, passiveMinutes: null }])).toEqual({
      duration: 15,
      stretches: [{ offset: 0, minutes: 15 }],
      steps: [{ activeMinutes: 15, passiveMinutes: 0 }],
      activeMinutes: 15,
      passiveMinutes: 0,
      trailingPassiveMinutes: 0,
      approximate: false,
      dueOffset: 15,
    });
  });

  it("a passive-only Step has no active stretch and is due at its start", () => {
    expect(taskShape([{ activeMinutes: null, passiveMinutes: 30 }])).toEqual({
      duration: 30,
      stretches: [],
      steps: [{ activeMinutes: 0, passiveMinutes: 30 }],
      activeMinutes: 0,
      passiveMinutes: 30,
      trailingPassiveMinutes: 30,
      approximate: false,
      dueOffset: 0,
    });
  });

  it("an unknown Step counts 10 active minutes and makes the Task approximate", () => {
    expect(taskShape([{ activeMinutes: null, passiveMinutes: null }])).toEqual({
      duration: 10,
      stretches: [{ offset: 0, minutes: 10 }],
      steps: [{ activeMinutes: 10, passiveMinutes: 0 }],
      activeMinutes: 10,
      passiveMinutes: 0,
      trailingPassiveMinutes: 0,
      approximate: true,
      dueOffset: 10,
    });
  });

  it("counts a Step with no active time and 0 passive minutes as unknown", () => {
    const shape = taskShape([{ activeMinutes: null, passiveMinutes: 0 }]);
    expect(shape.stretches).toEqual([{ offset: 0, minutes: 10 }]);
    expect(shape.approximate).toBe(true);
  });

  it("rounds both parts of a Step up to the grid", () => {
    expect(taskShape([{ activeMinutes: 7, passiveMinutes: 11 }])).toEqual({
      duration: 25,
      stretches: [{ offset: 0, minutes: 10 }],
      steps: [{ activeMinutes: 10, passiveMinutes: 15 }],
      activeMinutes: 10,
      passiveMinutes: 15,
      trailingPassiveMinutes: 15,
      approximate: false,
      dueOffset: 10,
    });
  });

  it("runs several Steps back to back, each active then passive", () => {
    const shape = taskShape([
      { activeMinutes: 5, passiveMinutes: 20 },
      { activeMinutes: null, passiveMinutes: 60 },
      { activeMinutes: null, passiveMinutes: null },
      { activeMinutes: 12, passiveMinutes: 3 },
    ]);
    expect(shape.stretches).toEqual([
      { offset: 0, minutes: 5 },
      { offset: 85, minutes: 10 },
      { offset: 95, minutes: 15 },
    ]);
    expect(shape.duration).toBe(115);
    expect(shape.activeMinutes).toBe(30);
    expect(shape.passiveMinutes).toBe(85);
    expect(shape.trailingPassiveMinutes).toBe(5);
    expect(shape.approximate).toBe(true);
    expect(shape.dueOffset).toBe(110);
  });
});

describe("dueOffset", () => {
  it("is when the last active time ends", () => {
    expect(dueOffset({ activeMinutes: 30, passiveMinutes: 85, trailingPassiveMinutes: 5 })).toBe(
      110,
    );
  });
});

describe("grid helpers", () => {
  it("use a 5-minute grid", () => {
    expect(GRID).toBe(5);
    expect(roundUpToGrid(1)).toBe(5);
    expect(roundUpToGrid(10)).toBe(10);
    expect(floorToGrid(14)).toBe(10);
    expect(ceilToGrid(11)).toBe(15);
    expect(nearestOnGrid(12.4)).toBe(10);
    expect(nearestOnGrid(12.5)).toBe(15);
    expect(nearestOnGrid(-7)).toBe(-5);
  });
});
