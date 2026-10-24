import { formatInstant } from "@miseflow/shared/src/plan/time.ts";
import { useEffect, useState } from "react";
import type { Plan, PlanTask } from "./api.ts";
import { dayHeading, ownerOf, taskTimes } from "./TodayScreen.tsx";

// The Plan as printed (ADR 0004, Printing): one section per day, each Task with an empty tick box
// per Step (#88 owner decision 3), and when it was printed. Shown only in print (print.css).
export function PrintedPlan({ plan }: { plan: Plan }) {
  const [printedAt, setPrintedAt] = useState(() => new Date());
  // Refreshed as the print starts. Source: https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeprint_event
  useEffect(() => {
    const refresh = () => setPrintedAt(new Date());
    window.addEventListener("beforeprint", refresh);
    return () => window.removeEventListener("beforeprint", refresh);
  }, []);

  return (
    <section aria-label="Printed Plan" className="print-only">
      <p>Printed at {formatInstant(printedAt, plan.timeZone)}</p>
      {plan.days.map((day) => {
        const heading = dayHeading(day.date);
        return (
          <section key={day.date} className="printed-day" aria-label={heading}>
            <h2>{heading}</h2>
            <ol>
              {day.tasks.map((task: PlanTask) => (
                <li key={task.key}>
                  {taskTimes(task, day.date)} · {ownerOf(task)}
                  <ul aria-label="Steps">
                    {task.steps.map((step) => (
                      <li key={step.id}>☐ {step.text}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </section>
  );
}
