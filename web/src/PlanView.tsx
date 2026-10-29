// The Plan screen's view (ADR 0011): props only, so its tests render it without the API.
import type { Plan, PlanTask } from "./api.ts";
import { Gantt } from "./Gantt.tsx";
import type { QueryState } from "./MenuViews.tsx";
import { dayHeading, ownerOf, taskTimes } from "./plan-display.ts";
import {
  confirmedFix,
  type ganttCourses,
  passive,
  type PlanMutation,
  replanFromScratch,
} from "./plan-screen.ts";
import { PrintedPlan } from "./PrintedPlan.tsx";
import { quickFixes, troubleBadge } from "./quick-fixes.ts";

function TaskLine({ task, date }: Readonly<{ task: PlanTask; date: string }>) {
  return (
    <li>
      {taskTimes(task, date)} · {ownerOf(task)} · {task.steps.map((s) => s.text).join(", ")}
      {task.approximate && (
        <>
          {" "}
          <span title="Approximate: a Step has no duration">≈</span>
        </>
      )}
      {task.passiveMinutes > 0 && ` · +${passive(task.passiveMinutes)} passive`}
    </li>
  );
}

export type PlanViewProps = {
  serviceId: string;
  plan: QueryState<Plan>;
  /** The Menu's Courses for the Gantt chart's lanes, or undefined until the Menu has loaded. */
  courses: ReturnType<typeof ganttCourses> | undefined;
  onPin: (task: PlanTask, start: number) => void;
  /** Re-plan from scratch, or a quick fix the cook confirmed. */
  onFix: (mutation: PlanMutation) => void;
  fixPending: boolean;
  fixError: Error | null;
};

// The Plan of one Service, as stored: the Gantt chart, one list per day, then the Unplaced Tasks
// with their reasons.
export function PlanView({
  serviceId,
  plan,
  courses,
  onPin,
  onFix,
  fixPending,
  fixError,
}: Readonly<PlanViewProps>) {
  if (plan.status === "pending") return <p>Loading…</p>;
  if (plan.status === "error") return <p role="alert">{plan.error.message}</p>;
  const { service, days, unplaced, approximate, batches, conflicts } = plan.data;
  const badge = troubleBadge(plan.data);

  return (
    <>
      <div className="screen-only">
        <a href={`?menu=${service.menuId}`}>Back to the Menu</a>
        <a href={`?view=today&service=${service.id}`}>Today checklist</a>
        <button type="button" onClick={() => window.print()}>
          Print the Plan
        </button>
        <h2>
          Plan for {dayHeading(service.date)} at {service.time}
          {service.timeIsDefault && " (the kitchen's default)"}
        </h2>
        {badge && (
          <span role="status" aria-label={badge}>
            {badge}
          </span>
        )}
        <button
          type="button"
          disabled={fixPending}
          onClick={() => onFix(replanFromScratch(serviceId))}
        >
          Re-plan from scratch
        </button>
        {fixError && <p role="alert">{fixError.message}</p>}
        {approximate && <p>Plan is approximate</p>}
        {courses && <Gantt plan={plan.data} courses={courses} onPin={onPin} />}
        <section aria-label="Plan">
          {days.map((day) => {
            const heading = dayHeading(day.date);
            return (
              <div key={day.date}>
                <h3>{heading}</h3>
                <ol aria-label={heading}>
                  {day.tasks.map((task) => (
                    <TaskLine key={task.key} task={task} date={day.date} />
                  ))}
                </ol>
              </div>
            );
          })}
        </section>
        <h3>Unplaced Tasks</h3>
        {unplaced.length ? (
          <ul aria-label="Unplaced Tasks">
            {unplaced.map((task) => (
              <li key={task.key}>
                {ownerOf(task)} · {task.steps.map((s) => s.text).join(", ")}: {task.sentence}
                {quickFixes(serviceId, task).map((f) => (
                  <button
                    key={f.label}
                    type="button"
                    disabled={fixPending}
                    onClick={() => {
                      const fix = confirmedFix(f, (question) => window.confirm(question));
                      if (fix) onFix(fix);
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p>Every Task is planned</p>
        )}
        <h3>Conflicts</h3>
        {conflicts.length ? (
          <ul aria-label="Conflicts">
            {conflicts.map((c) => (
              <li key={`${c.key}:${c.kind}`}>{c.sentence}</li>
            ))}
          </ul>
        ) : (
          <p>No conflicts</p>
        )}
        <h3>Batches</h3>
        {batches.length ? (
          <ul aria-label="Batches">
            {batches.map((b) => (
              <li key={b.subRecipe.id}>{b.label}</li>
            ))}
          </ul>
        ) : (
          <p>No Batches</p>
        )}
      </div>
      <PrintedPlan plan={plan.data} />
    </>
  );
}
