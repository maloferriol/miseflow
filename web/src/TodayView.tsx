import type { Plan, PlanTask } from "./api.ts";
import type { QueryState } from "./MenuViews.tsx";
import { dayHeading, ownerOf, taskTimes } from "./plan-display.ts";
import { PrintedPlan } from "./PrintedPlan.tsx";
import { boxChecked, type PlanDay, type Ticking, tickKey, wasDue } from "./today-checklist.ts";

export type TodayViewProps = {
  serviceId: string;
  plan: QueryState<Plan>;
  /** The day whose tab is open (`shownDay`); undefined when the Plan has no days. */
  day: PlanDay | undefined;
  /** The tick on its way to the server, if any: every box is disabled until it settles. */
  ticking: Ticking | null;
  tickError: Error | null;
  onChoose: (date: string) => void;
  onTick: (task: PlanTask, stepId: string, done: boolean) => void;
  onPrint: () => void;
};

// The Today checklist (ADR 0004, Progress): one tab per prep day, its Tasks in Plan time order, a
// tick per Step. Tabs: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
export function TodayView({
  serviceId,
  plan,
  day,
  ticking,
  tickError,
  onChoose,
  onTick,
  onPrint,
}: Readonly<TodayViewProps>) {
  if (plan.status === "pending") return <p>Loading…</p>;
  if (plan.status === "error") return <p role="alert">{plan.error.message}</p>;
  const { days, unplaced, conflicts } = plan.data;

  return (
    <>
      <div className="screen-only">
        <a href={`?view=plan&service=${serviceId}`}>Back to the Plan</a>
        <h2>Today checklist</h2>
        <button type="button" onClick={onPrint}>
          Print the Plan
        </button>
        <div role="tablist" aria-label="Prep days">
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              role="tab"
              id={`tab-${d.date}`}
              aria-selected={d.date === day?.date}
              aria-controls={`panel-${d.date}`}
              tabIndex={d.date === day?.date ? 0 : -1}
              onClick={() => onChoose(d.date)}
            >
              {dayHeading(d.date)}
            </button>
          ))}
        </div>
        {day && (
          <div role="tabpanel" id={`panel-${day.date}`} aria-labelledby={`tab-${day.date}`}>
            <ol aria-label={dayHeading(day.date)}>
              {day.tasks.map((task) => {
                const flags = conflicts.filter((c) => c.key === task.key);
                return (
                  <li key={task.key} className={task.behind ? "behind" : undefined}>
                    {taskTimes(task, day.date)} · {ownerOf(task)} ·{" "}
                    {task.steps.map((s) => s.text).join(", ")}
                    {task.behind && (
                      <>
                        {" "}
                        · behind · was due {wasDue(task.behind, day.date)}
                        {task.behind.holdsUp.length > 0 && (
                          <p>Holds up: {task.behind.holdsUp.map((h) => h.label).join("; ")}</p>
                        )}
                      </>
                    )}
                    {flags.map((c) => (
                      <p key={c.kind}>{c.sentence}</p>
                    ))}
                    <div>
                      {task.steps.map((step) => (
                        <label key={step.id}>
                          <input
                            type="checkbox"
                            checked={boxChecked(ticking, tickKey(task, step.id), step.done)}
                            disabled={ticking !== null}
                            onChange={(e) => onTick(task, step.id, e.target.checked)}
                          />{" "}
                          {step.text}
                        </label>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        {tickError && <p role="alert">{tickError.message}</p>}
        <h3>Unplaced Tasks</h3>
        {unplaced.length ? (
          <ul aria-label="Unplaced Tasks">
            {unplaced.map((task) => (
              <li key={task.key}>
                {ownerOf(task)} · {task.steps.map((s) => s.text).join(", ")}: {task.sentence}
              </li>
            ))}
          </ul>
        ) : (
          <p>Every Task is planned</p>
        )}
      </div>
      <PrintedPlan plan={plan.data} />
    </>
  );
}
