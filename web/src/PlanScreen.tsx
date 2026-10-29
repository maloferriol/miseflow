import { applyPlacements, withPin } from "@miseflow/shared/src/plan/pin.ts";
import { schedule } from "@miseflow/shared/src/scheduler/schedule.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMenu, fetchPlan, mutate, type Plan, type PlanTask } from "./api.ts";
import { ganttCourses, type PlanMutation, pinTask } from "./plan-screen.ts";
import { PlanView } from "./PlanView.tsx";

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
    mutationFn: ({ task, start }: { task: PlanTask; start: number }) => {
      const { name, args } = pinTask(serviceId, task, start);
      return mutate(crypto.randomUUID(), name, args);
    },
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
    mutationFn: ({ name, args }: PlanMutation) => mutate(crypto.randomUUID(), name, args),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["plan", serviceId] }),
        queryClient.invalidateQueries({ queryKey: ["menu", menuId] }),
      ]),
  });
}

/**
 * The Plan screen's hook (ADR 0011): the stored Plan, the Menu's Courses for the Gantt chart, and
 * the pin and fix mutations.
 */
export function usePlanScreen(serviceId: string) {
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
  return {
    serviceId,
    plan,
    courses: menu.data && ganttCourses(menu.data),
    onPin: (task: PlanTask, start: number) => pin.mutate({ task, start }),
    onFix: (mutation: PlanMutation) => fix.mutate(mutation),
    fixPending: fix.isPending,
    fixError: fix.error,
  };
}

// The Plan of one Service, as stored (the view says what it shows).
export function PlanScreen({ serviceId }: Readonly<{ serviceId: string }>) {
  return <PlanView {...usePlanScreen(serviceId)} />;
}
