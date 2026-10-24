import { describe, expect, it } from "vitest";
import { behindTasks } from "./behind.ts";
import type { TaskInfo } from "./model.ts";
import { stepKey, type StepState } from "./progress.ts";

// One Step per Task unless given; minutes from an arbitrary epoch.
const info = (id: string, steps: { active: number; passive?: number }[] = [{ active: 10 }]): TaskInfo => ({
  key: `dish:${id}:${id}1`,
  owner: { kind: "dish", dishId: id },
  dishId: id,
  batchId: null,
  stepIds: steps.map((_, i) => `${id}${i + 1}`),
  activeMinutes: steps.reduce((n, s) => n + s.active, 0),
  passiveMinutes: steps.reduce((n, s) => n + (s.passive ?? 0), 0),
  trailingPassiveMinutes: steps.at(-1)!.passive ?? 0,
  approximate: false,
});
const done = (task: TaskInfo, ...stepIds: string[]) =>
  new Map<string, StepState>(stepIds.map((id) => [stepKey(task.owner, id), { done: true, doneAt: new Date(0) }]));

describe("behindTasks", () => {
  const x = info("x");
  const y = info("y");
  const z = info("z");
  const tasks = new Map([x, y, z].map((t) => [t.key, t]));
  const links = [
    { before: x.key, after: z.key },
    { before: z.key, after: y.key },
  ];
  const placements = [
    { key: x.key, start: 1000 },
    { key: y.key, start: 1100 },
    { key: z.key, start: 1050 },
  ];

  it("AC3: one minute past due is behind and lists what it holds up; at due it is not", () => {
    const behind = behindTasks({ placements, tasks, links, states: new Map(), now: 1011 });
    expect(behind.get(x.key)).toEqual({ dueAt: 1010, holdsUp: [z.key, y.key] });
    expect(behind.has(y.key)).toBe(false);
    expect(behindTasks({ placements, tasks, links, states: new Map(), now: 1010 }).has(x.key)).toBe(false);
  });

  it("a done Task is never behind; one only partly done past its due time is", () => {
    expect(behindTasks({ placements, tasks, links, states: done(x, "x1"), now: 2000 }).has(x.key)).toBe(false);
    const g = info("g", [{ active: 10 }, { active: 10 }]);
    const behind = behindTasks({ placements: [{ key: g.key, start: 1000 }], tasks: new Map([[g.key, g]]), links: [], states: done(g, "g1"), now: 1021 });
    expect(behind.get(g.key)).toEqual({ dueAt: 1020, holdsUp: [] });
  });

  it("a Task with passive time after its last Step is due when that Step's active time ends", () => {
    const brine = info("b", [{ active: 10, passive: 1440 }]);
    const behind = behindTasks({ placements: [{ key: brine.key, start: 1000 }], tasks: new Map([[brine.key, brine]]), links: [], states: new Map(), now: 1011 });
    expect(behind.get(brine.key)).toEqual({ dueAt: 1010, holdsUp: [] });
  });

  it("a done descendant isn't held up", () => {
    const behind = behindTasks({ placements, tasks, links, states: done(z, "z1"), now: 1011 });
    expect(behind.get(x.key)!.holdsUp).toEqual([y.key]);
  });
});
