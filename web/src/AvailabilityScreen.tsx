// The Availability screen (ADR 0011): its hook, and the screen that renders its view with it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAvailability } from "./api.ts";
import {
  availabilityOverrideSave,
  kitchenSettingsSave,
  type OverrideInput,
  removeOverride,
  weeklyAvailabilitySave,
  type WeeklyHours,
} from "./availability-screen.ts";
import { AvailabilityView } from "./AvailabilityView.tsx";
import { useIntent } from "./intent.ts";
import { useIntentSave } from "./use-intent-save.ts";

/**
 * The kitchen's default Service time and the Cook's Availability. Every save is one named
 * mutation and re-plans the Services on the server. Only query, query-client, intent and
 * mutation hooks: no branches.
 */
export function useAvailabilityScreen() {
  const queryClient = useQueryClient();
  const availability = useQuery({ queryKey: ["availability"], queryFn: fetchAvailability });
  // One set of ids per intended save, so a retry after a lost response replays it (useIntent).
  const intent = useIntent();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["availability"] }),
      queryClient.invalidateQueries({ queryKey: ["plan"] }),
    ]);

  const setDefault = useIntentSave(intent, kitchenSettingsSave, invalidate);
  const setWeek = useIntentSave(intent, weeklyAvailabilitySave, invalidate);
  const setOverride = useIntentSave(intent, availabilityOverrideSave, invalidate);

  return {
    availability,
    defaultPending: setDefault.isPending,
    weekPending: setWeek.isPending,
    overridePending: setOverride.isPending,
    error: setDefault.error ?? setWeek.error ?? setOverride.error,
    onSaveDefault: (defaultServiceTime: number) => setDefault.mutate(defaultServiceTime),
    onSaveWeek: (hours: WeeklyHours[]) => setWeek.mutate(hours),
    onSaveOverride: (input: OverrideInput) => setOverride.mutate(input),
    onRemoveOverride: (date: string) => setOverride.mutate(removeOverride(date)),
  };
}

export function AvailabilityScreen() {
  return <AvailabilityView {...useAvailabilityScreen()} />;
}
