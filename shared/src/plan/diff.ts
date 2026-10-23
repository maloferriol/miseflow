import type { Minute, Placement, TaskKey } from "../scheduler/types.ts";

// Pure: what a re-plan must write so the stored Plan equals the new one, and nothing more.

/** A `task_placements` row: `live` is false once soft-deleted. */
export type StoredPlacement = { id: string; key: TaskKey; start: Minute; cookId: string; pinned: boolean; live: boolean };

export type PlacementDiff = {
  insert: Placement[];
  /** `revive`: the row was soft-deleted. A Task's row is unique across soft-deleted rows too. */
  update: { id: string; start: Minute; cookId: string; revive: boolean }[];
  /** Soft deletes: the Task is now Unplaced or gone. */
  remove: string[];
};

export function diffPlacements(stored: StoredPlacement[], next: Placement[]): PlacementDiff {
  const byKey = new Map<TaskKey, StoredPlacement>();
  // A live row wins over a soft-deleted one for the same key.
  for (const row of stored) if (row.live || !byKey.has(row.key)) byKey.set(row.key, row);
  const diff: PlacementDiff = { insert: [], update: [], remove: [] };
  const placed = new Set<TaskKey>();
  for (const p of next) {
    placed.add(p.key);
    const row = byKey.get(p.key);
    if (!row) diff.insert.push(p);
    else if (!row.live) diff.update.push({ id: row.id, start: p.start, cookId: p.cookId, revive: true });
    else if (row.start !== p.start || row.cookId !== p.cookId)
      diff.update.push({ id: row.id, start: p.start, cookId: p.cookId, revive: false });
  }
  for (const row of byKey.values()) if (row.live && !placed.has(row.key)) diff.remove.push(row.id);
  return diff;
}
