import { useQuery } from "@tanstack/react-query";
import { fetchPlan, type PlanTask } from "./api.ts";

// "Thursday 29 October", from a kitchen-zone date. Formatted in UTC, so the browser's own zone
// can't move it to another day.
function dayHeading(date: string) {
  const at = new Date(`${date}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) => at.toLocaleDateString("en-GB", { timeZone: "UTC", ...options });
  return `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "long" })}`;
}

const shortDay = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" });

function passive(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

function TaskLine({ task, date }: { task: PlanTask; date: string }) {
  const end = task.endDate === date ? task.end : `${task.end} (${shortDay(task.endDate)})`;
  return (
    <li>
      {task.start}–{end} · {task.dish.name} · {task.steps.map((s) => s.text).join(", ")}
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

// The Plan of one Service, as stored: one list per day, then the Unplaced Tasks with their reasons.
export function PlanScreen({ serviceId }: { serviceId: string }) {
  const plan = useQuery({ queryKey: ["plan", serviceId], queryFn: () => fetchPlan(serviceId) });

  if (plan.isPending) return <p>Loading…</p>;
  if (plan.isError) return <p role="alert">{plan.error.message}</p>;
  const { service, days, unplaced, approximate } = plan.data;

  return (
    <>
      <a href={`?menu=${service.menuId}`}>Back to the Menu</a>
      <h2>
        Plan for {dayHeading(service.date)} at {service.time}
        {service.timeIsDefault && " (the kitchen's default)"}
      </h2>
      {approximate && <p>Plan is approximate</p>}
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
              {task.dish.name} · {task.steps.map((s) => s.text).join(", ")}: {task.sentence}
            </li>
          ))}
        </ul>
      ) : (
        <p>Every Task is planned</p>
      )}
    </>
  );
}
