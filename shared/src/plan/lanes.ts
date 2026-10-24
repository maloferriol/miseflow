import type { Owner, TaskKey } from "../scheduler/types.ts";

// Pure: the Gantt chart's lanes (ADR 0009, spec §6.1): each Course, a lane per Dish, and under
// each Dish a lane per Batch it uses, nested as deep as the sub-recipes go. A Batch with several
// parents shows under each one; every copy after the first in lane order is a ghost, and every copy
// holds the same Tasks. Collapsing a Dish folds its Batches' Tasks into its own lane.

/** A Batch as the Plan read lists it; `for` holds a Dish id or, for a parent Batch, its sub-recipe id. */
export type LaneBatch = {
  id: string | null;
  subRecipe: { id: string; name: string };
  label: string;
  for: { kind: "dish" | "batch"; id: string }[];
};

export type LaneCourse = { id: string; name: string; dishes: { id: string; name: string }[] };

export type Lane = {
  /** Unique per copy: the path from its Dish. */
  key: string;
  kind: "dish" | "batch";
  /** The Dish's id, or the Batch's sub-recipe id. */
  id: string;
  /** The Batch's row id, or null (a Dish, or a Batch with no row yet). */
  batchId: string | null;
  name: string;
  /** A Dish's name, a Batch's label ("Chicken stock ×1.5 · for: Velouté, Beurre blanc"). */
  label: string;
  /** 0 for a Dish. */
  depth: number;
  ghost: boolean;
  /** Its Tasks in the order given (Plan time order). */
  taskKeys: TaskKey[];
  children: Lane[];
};

export type CourseLanes = { id: string; name: string; dishes: Lane[] };

export function laneTree(input: {
  courses: LaneCourse[];
  batches: LaneBatch[];
  tasks: { key: TaskKey; owner: Owner }[];
}): CourseLanes[] {
  const keysOf = new Map<string, TaskKey[]>();
  for (const t of input.tasks) {
    const id = t.owner.kind === "dish" ? `dish:${t.owner.dishId}` : `batch:${t.owner.batchId}`;
    keysOf.set(id, [...(keysOf.get(id) ?? []), t.key]);
  }
  const childrenOf = (kind: "dish" | "batch", id: string) => input.batches.filter((b) => b.for.some((p) => p.kind === kind && p.id === id));
  const seen = new Set<string>();
  const batchLane = (b: LaneBatch, path: string, depth: number, ancestors: Set<string>): Lane => {
    const ghost = seen.has(b.subRecipe.id);
    seen.add(b.subRecipe.id);
    const key = `${path}/${b.subRecipe.id}`;
    const inner = new Set(ancestors).add(b.subRecipe.id);
    return {
      key,
      kind: "batch",
      id: b.subRecipe.id,
      batchId: b.id,
      name: b.subRecipe.name,
      label: b.label,
      depth,
      ghost,
      taskKeys: b.id === null ? [] : (keysOf.get(`batch:${b.id}`) ?? []),
      // A cycle can't be linked (#84); the guard only keeps bad input from recursing forever.
      children: childrenOf("batch", b.subRecipe.id)
        .filter((c) => !inner.has(c.subRecipe.id))
        .map((c) => batchLane(c, key, depth + 1, inner)),
    };
  };
  return input.courses.map((course) => ({
    id: course.id,
    name: course.name,
    dishes: course.dishes.map((d) => ({
      key: d.id,
      kind: "dish" as const,
      id: d.id,
      batchId: null,
      name: d.name,
      label: d.name,
      depth: 0,
      ghost: false,
      taskKeys: keysOf.get(`dish:${d.id}`) ?? [],
      children: childrenOf("dish", d.id).map((b) => batchLane(b, d.id, 1, new Set())),
    })),
  }));
}

export type LaneRow =
  | { kind: "course"; id: string; name: string }
  | {
      kind: "lane";
      lane: Lane;
      /** A Dish with Batches can be collapsed. */
      collapsible: boolean;
      collapsed: boolean;
      /** A collapsed Dish's Batch Tasks, folded into its lane: each Task once. */
      folded: TaskKey[];
    };

/** The rows to draw, with the Dishes in `dishIds` collapsed. */
export function collapse(tree: CourseLanes[], dishIds: Iterable<string>): LaneRow[] {
  const closed = new Set(dishIds);
  const rows: LaneRow[] = [];
  const descendants = (lane: Lane): TaskKey[] => lane.children.flatMap((c) => [...c.taskKeys, ...descendants(c)]);
  const add = (lane: Lane) => {
    const collapsed = lane.kind === "dish" && closed.has(lane.id) && lane.children.length > 0;
    const folded = collapsed ? [...new Set(descendants(lane))] : [];
    rows.push({ kind: "lane", lane, collapsible: lane.kind === "dish" && lane.children.length > 0, collapsed, folded });
    if (!collapsed) for (const c of lane.children) add(c);
  };
  for (const course of tree) {
    rows.push({ kind: "course", id: course.id, name: course.name });
    for (const d of course.dishes) add(d);
  }
  return rows;
}
