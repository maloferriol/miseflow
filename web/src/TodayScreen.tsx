import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchPlan, mutate, type PlanTask } from "./api.ts";
import { useIntent } from "./intent.ts";
import { PrintedPlan } from "./PrintedPlan.tsx";

// "Thursday 29 October", from a kitchen-zone date. Formatted in UTC, so the browser's own zone
// can't move it to another day.
export function dayHeading(date: string) {
  const at = new Date(`${date}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) => at.toLocaleDateString("en-GB", { timeZone: "UTC", ...options });
  return `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "long" })}`;
}

const shortDay = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" });

// A Dish's name, or a Batch's label ("Chicken stock ×1.5 · for: Velouté, Beurre blanc").
export const ownerOf = (task: { dish: { name: string } | null; batch: { label: string } | null }) => task.batch?.label ?? task.dish?.name;

/** "18:20–18:40", with the end's day when it's another day ("21:50–22:00 (Fri)"). */
export const taskTimes = (task: PlanTask, date: string) =>
  `${task.start}–${task.endDate === date ? task.end : `${task.end} (${shortDay(task.endDate)})`}`;

// Today's date in the kitchen's zone ("2026-10-29"); en-CA formats as YYYY-MM-DD.
const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

type Tick = { task: PlanTask; stepId: string; done: boolean };

// The Today checklist (ADR 0004, Progress): one tab per prep day, its Tasks in Plan time order, a
// tick per Step. Behind is measured by the server; the read refreshes every minute so it shows
// without a reload. Tabs: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
export function TodayScreen({ serviceId }: { serviceId: string }) {
  const queryClient = useQueryClient();
  const plan = useQuery({ queryKey: ["plan", serviceId], queryFn: () => fetchPlan(serviceId), refetchInterval: 60_000 });
  const [chosen, setChosen] = useState(() => new URLSearchParams(window.location.search).get("day"));
  const intent = useIntent();
  // A tick shows at once, until the re-read Plan (or a failed save) settles it.
  const [ticking, setTicking] = useState<{ key: string; done: boolean } | null>(null);
  const tick = useMutation({
    mutationFn: ({ task, stepId, done }: Tick) => {
      const key = `${task.key}:${stepId}:${done}`;
      return mutate(intent.id(key, "mutation"), done ? "tickStep" : "untickStep", {
        eventId: intent.id(key, "event"),
        serviceId,
        owner: task.owner,
        stepId,
      });
    },
    onSuccess: async () => {
      intent.reset();
      await queryClient.invalidateQueries({ queryKey: ["plan", serviceId] });
    },
    onSettled: () => setTicking(null),
  });

  if (plan.isPending) return <p>Loading…</p>;
  if (plan.isError) return <p role="alert">{plan.error.message}</p>;
  const { days, unplaced, conflicts, timeZone } = plan.data;

  // The chosen day, else the earliest day with a behind Task, else today if it has Tasks, else the first.
  const today = todayIn(timeZone);
  const day =
    days.find((d) => d.date === chosen) ??
    days.find((d) => d.tasks.some((t) => t.behind)) ??
    days.find((d) => d.date === today) ??
    days[0];

  function choose(date: string) {
    setChosen(date);
    const params = new URLSearchParams(window.location.search);
    params.set("day", date);
    window.history.replaceState(null, "", `?${params}`);
  }

  return (
    <>
      <div className="screen-only">
        <a href={`?view=plan&service=${serviceId}`}>Back to the Plan</a>
        <h2>Today checklist</h2>
        <button type="button" onClick={() => window.print()}>
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
              onClick={() => choose(d.date)}
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
                    {taskTimes(task, day.date)} · {ownerOf(task)} · {task.steps.map((s) => s.text).join(", ")}
                    {task.behind && (
                      <>
                        {" "}
                        · behind · was due{" "}
                        {task.behind.dueDate === day.date ? task.behind.dueAt : `${shortDay(task.behind.dueDate)} ${task.behind.dueAt}`}
                        {task.behind.holdsUp.length > 0 && <p>Holds up: {task.behind.holdsUp.map((h) => h.label).join("; ")}</p>}
                      </>
                    )}
                    {flags.map((c) => (
                      <p key={c.kind}>{c.sentence}</p>
                    ))}
                    <div>
                      {task.steps.map((step) => {
                        const key = `${task.key}:${step.id}`;
                        return (
                          <label key={step.id}>
                            <input
                              type="checkbox"
                              checked={ticking?.key === key ? ticking.done : step.done}
                              disabled={ticking !== null}
                              onChange={(e) => {
                                setTicking({ key, done: e.target.checked });
                                tick.mutate({ task, stepId: step.id, done: e.target.checked });
                              }}
                            />{" "}
                            {step.text}
                          </label>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        {tick.isError && <p role="alert">{tick.error.message}</p>}
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
