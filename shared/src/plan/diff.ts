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

// Placement ids are a UUID v5 of the Service and the Task key (owner decision 3), so the browser's
// optimistic re-plan (ADR 0010) makes the same ids. Flagged against ADR 0004 ("Ids are UUIDs
// created in the browser"); a revived row keeps its old id. RFC 9562 §5.5:
// https://www.rfc-editor.org/rfc/rfc9562#section-5.5
const PLACEMENT_NAMESPACE = "6d1f3a52-0c9e-4b8a-9f4e-2b7d5c8e1a90";

export async function placementId(serviceId: string, key: TaskKey): Promise<string> {
  const ns = PLACEMENT_NAMESPACE.replace(/-/g, "");
  const name = new TextEncoder().encode(`${serviceId}:${key}`);
  const data = new Uint8Array(16 + name.length);
  for (let i = 0; i < 16; i++) data[i] = parseInt(ns.slice(i * 2, i * 2 + 2), 16);
  data.set(name, 16);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
