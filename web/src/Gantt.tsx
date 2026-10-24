import { barParts, buildAxis, firstDate, fromAxis, snap5, toAxis, type Axis } from "@miseflow/shared/src/plan/axis.ts";
import { collapse, laneTree, type Lane, type LaneCourse } from "@miseflow/shared/src/plan/lanes.ts";
import { formatMinuteOfDay, localParts } from "@miseflow/shared/src/plan/time.ts";
import { useMemo, useState, type PointerEvent } from "react";
import type { Plan, PlanTask } from "./api.ts";
import "./gantt.css";

// The Plan's Gantt chart (#89, ADR 0009), our own DOM component after variant C of the lanes
// prototype: Course › Dish › Batch lanes, a shared Batch under each parent (later copies greyed),
// collapsible Dishes, active time solid and passive time hatched across days with the nights removed.
// Dragging a bar on the 5-minute grid pins it there. Pointer Events with pointer capture:
// https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture

/** Pixels per axis unit (one minute inside a day). */
const PX = 1;
const COLORS = ["#2563eb", "#a16207", "#7c3aed", "#be123c", "#0d9488", "#c2410c", "#4d7c0f", "#9333ea"];

const ownerKey = (owner: PlanTask["owner"]) => (owner.kind === "dish" ? `dish:${owner.dishId}` : `batch:${owner.batchId}`);
const ownerLabel = (task: PlanTask) => task.batch?.label ?? task.dish?.name ?? "";
const clock = (minute: number, timeZone: string) => formatMinuteOfDay(localParts(minute, timeZone).minuteOfDay);
const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

type Drag = { copy: string; x0: number; dx: number };

export function Gantt({
  plan,
  courses,
  onPin,
}: {
  plan: Plan;
  courses: LaneCourse[];
  onPin: (task: PlanTask, start: number) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const { timeZone, model } = plan;
  const tasks = useMemo(() => plan.days.flatMap((d) => d.tasks), [plan]);
  const byKey = useMemo(() => new Map(tasks.map((t) => [t.key, t])), [tasks]);

  const axis = useMemo(() => {
    const placed = tasks.map((t) => ({ start: t.startMinute, end: t.startMinute + t.activeMinutes }));
    placed.push({ start: model.service.at, end: model.service.at });
    return buildAxis({
      from: firstDate(model, tasks.map((t) => t.startMinute), timeZone),
      to: plan.service.date,
      free: model.cooks[0]?.free ?? [],
      placed,
      timeZone,
    });
  }, [tasks, model, timeZone, plan.service.date]);
  const tree = useMemo(() => laneTree({ courses, batches: plan.batches, tasks }), [courses, plan.batches, tasks]);
  const rows = collapse(tree, collapsed);
  const colors = useMemo(() => {
    const out = new Map<string, string>();
    for (const t of tasks) if (!out.has(ownerKey(t.owner))) out.set(ownerKey(t.owner), COLORS[out.size % COLORS.length]!);
    return out;
  }, [tasks]);
  const width = axis.width * PX + 16;

  const toggle = (dishId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dishId)) next.delete(dishId);
      else next.add(dishId);
      return next;
    });

  function bar(task: PlanTask, copy: string, kind: "own" | "ghost" | "folded") {
    const { active, passive } = barParts(axis, { start: task.startMinute, activeMinutes: task.activeMinutes, passiveMinutes: task.passiveMinutes });
    const left = (active ?? passive)!.from;
    const right = (passive ?? active)!.to;
    const color = colors.get(ownerKey(task.owner))!;
    const dragging = drag?.copy === copy;
    const steps = task.steps.map((s) => s.text).join(", ");
    const end = (part: { from: number; to: number } | null) => (part ? Math.max(0, part.to - part.from) * PX : 0);
    return (
      <div
        key={copy}
        role="button"
        tabIndex={0}
        aria-label={`${ownerLabel(task)} · ${steps} · ${task.start}${task.pinned ? " · pinned" : ""}`}
        title={`${ownerLabel(task)}\n${steps}\n${task.start}–${task.end}${task.pinned ? "\npinned" : ""}`}
        className={`gantt-bar ${kind === "ghost" ? "ghost" : ""} ${kind === "folded" ? "folded" : ""} ${dragging ? "dragging" : ""}`}
        data-key={task.key}
        data-start={task.startMinute}
        data-pinned={String(task.pinned)}
        data-ghost={String(kind === "ghost")}
        data-folded={String(kind === "folded")}
        style={{
          left: left * PX,
          width: Math.max(4, (right - left) * PX),
          transform: dragging ? `translateX(${drag.dx}px)` : undefined,
        }}
        onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ copy, x0: e.clientX, dx: 0 });
        }}
        onPointerMove={(e) => {
          if (drag?.copy !== copy) return;
          setDrag({ ...drag, dx: e.clientX - drag.x0 });
        }}
        onPointerUp={(e) => {
          if (drag?.copy !== copy) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDrag(null);
          const start = snap5(fromAxis(axis, toAxis(axis, task.startMinute) + (e.clientX - drag.x0) / PX));
          if (start !== task.startMinute) onPin(task, start);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        {active && <div className="part" style={{ width: end(active), background: color }} />}
        {passive && (
          <div className="part" style={{ width: end(passive), background: `repeating-linear-gradient(45deg, ${color} 0 4px, ${color}33 4px 9px)` }} />
        )}
        <span className="text">
          {task.pinned ? "📌 " : ""}
          {steps}
        </span>
      </div>
    );
  }

  const laneName = (lane: Lane) => (lane.ghost ? `${lane.name} (also shown above)` : lane.name);

  return (
    <section className="gantt" aria-label="Gantt chart">
      <div className="gantt-legend">
        <span>
          <i className="gantt-swatch active" />
          active (needs the Cook)
        </span>
        <span>
          <i className="gantt-swatch passive" />
          passive (no Cook)
        </span>
        <span>📌 pinned · drag a bar to move and pin it</span>
      </div>
      <div className="gantt-chart">
        <div className="gantt-row gantt-axis">
          <div className="gantt-label">
            <small>Nights removed</small>
          </div>
          <div className="gantt-track" style={{ width }}>
            <Background axis={axis} serviceAt={model.service.at} />
            {axis.segments.map((s) => (
              <div
                key={s.date}
                className="gantt-band"
                data-band
                data-date={s.date}
                data-from={s.start}
                data-to={s.end}
                style={{ left: s.offset * PX, width: (s.end - s.start) * PX }}
              >
                <span className="gantt-day">
                  {dayLabel(s.date)} {!s.available && <small>not available</small>}
                </span>
                {hours(s).map((m) => (
                  <span key={m} className="gantt-tick" style={{ left: (m - s.start) * PX }}>
                    {clock(m, timeZone)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
        {rows.map((row) =>
          row.kind === "course" ? (
            <div key={`course:${row.id}`} className="gantt-row course">
              <div className="gantt-label">{row.name}</div>
              <div className="gantt-track" style={{ width }} />
            </div>
          ) : (
            <div key={row.lane.key} className="gantt-row" role="group" aria-label={laneName(row.lane)}>
              <div className={`gantt-label ${row.lane.ghost ? "ghost" : ""}`} style={{ paddingLeft: 8 + row.lane.depth * 16 }}>
                {row.collapsible && (
                  <button
                    type="button"
                    className="gantt-twisty"
                    aria-expanded={!row.collapsed}
                    aria-label={`${row.collapsed ? "Expand" : "Collapse"} ${row.lane.name}`}
                    onClick={() => toggle(row.lane.id)}
                  >
                    {row.collapsed ? "▸" : "▾"}
                  </button>
                )}
                <span title={row.lane.label}>
                  {row.lane.kind === "batch" ? "└ " : ""}
                  {row.lane.kind === "batch" ? row.lane.label.split(" · ")[0] : row.lane.name}
                </span>
              </div>
              <div className="gantt-track" style={{ width }}>
                <Background axis={axis} serviceAt={model.service.at} />
                {row.lane.taskKeys.flatMap((key) => {
                  const task = byKey.get(key);
                  return task ? [bar(task, `${row.lane.key}|${key}`, row.lane.ghost ? "ghost" : "own")] : [];
                })}
                {row.folded.flatMap((key) => {
                  const task = byKey.get(key);
                  return task ? [bar(task, `${row.lane.key}|folded|${key}`, "folded")] : [];
                })}
              </div>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

// Whole hours inside a segment.
function hours(s: Axis["segments"][number]) {
  const out: number[] = [];
  for (let m = Math.ceil(s.start / 60) * 60; m <= s.end; m += 60) out.push(m);
  return out;
}

// Availability (green), not-available dates (shaded), night seams and the Service line.
function Background({ axis, serviceAt }: { axis: Axis; serviceAt: number }) {
  return (
    <>
      {axis.segments.map((s, i) => {
        const next = axis.segments[i + 1];
        return (
          <span key={s.date}>
            {!s.available && <div className="gantt-band away" style={{ left: s.offset * PX, width: (s.end - s.start) * PX }} />}
            {s.free.map((f) => (
              <div
                key={f.start}
                className="gantt-free"
                style={{ left: toAxis(axis, f.start) * PX, width: (toAxis(axis, f.end) - toAxis(axis, f.start)) * PX }}
              />
            ))}
            {next && <div className="gantt-seam" style={{ left: (s.offset + s.end - s.start) * PX, width: axis.seam * PX }} />}
          </span>
        );
      })}
      <div className="gantt-service" style={{ left: toAxis(axis, serviceAt) * PX }} />
    </>
  );
}
