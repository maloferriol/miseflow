// The Today checklist (ADR 0011): its hook, and the screen that renders its view with it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchPlan, mutate, type PlanTask } from "./api.ts";
import { useIntent } from "./intent.ts";
import {
  dayFromLink,
  linkWithDay,
  shownDay,
  type Tick,
  type Ticking,
  tickKey,
  tickSave,
} from "./today-checklist.ts";
import { TodayView } from "./TodayView.tsx";

/**
 * The Plan, the open day and the ticks. Only state, query, mutation and intent hooks: no branches.
 * Behind is measured by the server; the read refreshes every minute so it shows without a reload.
 */
export function useTodayChecklist(serviceId: string) {
  const queryClient = useQueryClient();
  const plan = useQuery({
    queryKey: ["plan", serviceId],
    queryFn: () => fetchPlan(serviceId),
    refetchInterval: 60_000,
  });
  const [chosen, setChosen] = useState(() => dayFromLink(window.location.search));
  const intent = useIntent();
  // A tick shows at once, until the re-read Plan (or a failed save) settles it.
  const [ticking, setTicking] = useState<Ticking | null>(null);
  const tick = useMutation({
    mutationFn: (ticked: Tick) => {
      const { id, name, args } = tickSave(serviceId, ticked, intent);
      return mutate(id, name, args);
    },
    onSuccess: async () => {
      intent.reset();
      await queryClient.invalidateQueries({ queryKey: ["plan", serviceId] });
    },
    onSettled: () => setTicking(null),
  });

  return {
    serviceId,
    plan,
    day: shownDay(plan.data, chosen, new Date()),
    ticking,
    tickError: tick.error,
    onChoose: (date: string) => {
      setChosen(date);
      window.history.replaceState(null, "", linkWithDay(window.location.search, date));
    },
    onTick: (task: PlanTask, stepId: string, done: boolean) => {
      setTicking({ key: tickKey(task, stepId), done });
      tick.mutate({ task, stepId, done });
    },
    onPrint: () => window.print(),
  };
}

export function TodayScreen({ serviceId }: Readonly<{ serviceId: string }>) {
  return <TodayView {...useTodayChecklist(serviceId)} />;
}
