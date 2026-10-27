import { applyPlacements, withPin } from "@miseflow/shared/src/plan/pin.ts";
import { schedule } from "@miseflow/shared/src/scheduler/schedule.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMenu, fetchPlan, mutate, type Plan, type PlanTask } from "./api.ts";
import { Gantt } from "./Gantt.tsx";
import { PrintedPlan } from "./PrintedPlan.tsx";
import { quickFixes, troubleBadge } from "./quick-fixes.ts";

// "Thursday 29 October", from a kitchen-zone date. Formatted in UTC, so the browser's own zone
// can't move it to another day.
function dayHeading(date: string) {
  const at = new Date(`${date}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    at.toLocaleDateString("en-GB", { timeZone: "UTC", ...options });
  return `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "long" })}`;
}

const shortDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" });

function passive(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

// A Dish's name, or a Batch's label ("Chicken stock ×1.5 · for: Velouté, Beurre blanc").
const ownerOf = (task: { dish: { name: string } | null; batch: { label: string } | null }) =>
  task.batch?.label ?? task.dish?.name;

function TaskLine({ task, date }: { task: PlanTask; date: string }) {
  const end = task.endDate === date ? task.end : `${task.end} (${shortDay(task.endDate)})`;
  return (
    <li>
      {task.start}–{end} · {ownerOf(task)} · {task.steps.map((s) => s.text).join(", ")}
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

/**
 * Dragging a bar on the Gantt chart (#89): `pinTask`, with the browser running the same scheduler
 * over the read's model so the rest re-fits at once (ADR 0007, 0010). Pins of one Service run one
 * after another (`scope`), and each lays its optimistic Plan over the one before. The Plan is read
 * again only when the last of them settles, so an earlier answer never shows over a later drag; the
 * stored Plan then wins, on success or error. Sources:
 * https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates,
 * https://tanstack.com/query/v5/docs/framework/react/reference/useMutation (scope)
 */
function usePinTask(serviceId: string) {
  const queryClient = useQueryClient();
  const queryKey = ["plan", serviceId];
  const mutationKey = ["pinTask", serviceId];
  return useMutation({
    mutationKey,
    scope: { id: serviceId },
    mutationFn: ({ task, start }: { task: PlanTask; start: number }) =>
      mutate(crypto.randomUUID(), "pinTask", {
        serviceId,
        owner: task.owner,
        firstStepId: task.steps[0]!.id,
        start,
      }),
    onMutate: async ({ task, start }) => {
      await queryClient.cancelQueries({ queryKey });
      const read = queryClient.getQueryData<Plan>(queryKey);
      if (read)
        queryClient.setQueryData<Plan>(
          queryKey,
          applyPlacements(read, schedule(withPin(read.model, task.key, start))),
        );
    },
    // Still counted here, so 1 means no other pin is pending.
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey }) === 1)
        return queryClient.invalidateQueries({ queryKey });
    },
  });
}

/**
 * The quick fixes and Re-plan from scratch (#90): server-only mutations, so the screen waits for
 * the answer and then reads the Plan (and the Menu, which removeDish changes) again; nothing is
 * shown optimistically (Plan §4, ADR 0007).
 */
function usePlanFix(serviceId: string, menuId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, args }: { name: string; args: Record<string, unknown> }) =>
      mutate(crypto.randomUUID(), name, args),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["plan", serviceId] }),
        queryClient.invalidateQueries({ queryKey: ["menu", menuId] }),
      ]),
  });
}

// The Plan of one Service, as stored: the Gantt chart, one list per day, then the Unplaced Tasks
// with their reasons.
export function PlanScreen({ serviceId }: { serviceId: string }) {
  const queryClient = useQueryClient();
  // No refetch on focus or reconnect while a pin is pending: it would show an earlier pin's answer
  // over a later drag. The last pin to settle re-reads the Plan.
  const noPinPending = () => queryClient.isMutating({ mutationKey: ["pinTask", serviceId] }) === 0;
  const plan = useQuery({
    queryKey: ["plan", serviceId],
    queryFn: () => fetchPlan(serviceId),
    refetchOnWindowFocus: noPinPending,
    refetchOnReconnect: noPinPending,
  });
  const menuId = plan.data?.service.menuId;
  // The Courses and Dishes for the Gantt chart's lanes.
  const menu = useQuery({
    queryKey: ["menu", menuId],
    queryFn: () => fetchMenu(menuId!),
    enabled: Boolean(menuId),
  });
  const pin = usePinTask(serviceId);
  const fix = usePlanFix(serviceId, menuId);

  if (plan.isPending) return <p>Loading…</p>;
  if (plan.isError) return <p role="alert">{plan.error.message}</p>;
  const { service, days, unplaced, approximate, batches, conflicts } = plan.data;
  const badge = troubleBadge(plan.data);
  const courses = menu.data?.courses.map((c) => ({
    id: c.id,
    name: c.name,
    dishes: c.dishes.map((d) => ({ id: d.id, name: d.recipe.name })),
  }));

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
          disabled={fix.isPending}
          onClick={() => fix.mutate({ name: "replanFromScratch", args: { serviceId } })}
        >
          Re-plan from scratch
        </button>
        {fix.isError && <p role="alert">{fix.error.message}</p>}
        {approximate && <p>Plan is approximate</p>}
        {courses && (
          <Gantt
            plan={plan.data}
            courses={courses}
            onPin={(task, start) => pin.mutate({ task, start })}
          />
        )}
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
                    disabled={fix.isPending}
                    onClick={() => {
                      if (f.confirm === null || window.confirm(f.confirm))
                        fix.mutate({ name: f.name, args: f.args });
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
