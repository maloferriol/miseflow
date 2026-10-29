// The Shopping list (ADR 0011): each part's hook, and the part that renders its view with it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchShoppingList, mutate, type ShoppingRow } from "./api.ts";
import { useIntent } from "./intent.ts";
import { gotSave, rowChecked } from "./shopping-list.ts";
import { ShoppingListView, ShoppingRowView } from "./ShoppingListViews.tsx";

/** One Service's Shopping list. Only a query hook: no branches. */
export function useShoppingList(serviceId: string) {
  return {
    list: useQuery({
      queryKey: ["shopping-list", serviceId],
      queryFn: () => fetchShoppingList(serviceId),
    }),
  };
}

export function ShoppingListScreen({ serviceId }: Readonly<{ serviceId: string }>) {
  return (
    <ShoppingListView
      {...useShoppingList(serviceId)}
      renderRow={(row) => <Row serviceId={serviceId} row={row} />}
    />
  );
}

/**
 * Ticks one row: markGot, or unmarkGot when un-ticked. The box shows the intended state until the
 * list has reloaded. That state is set in the change handler itself, so React never puts the box
 * back in between. Only query-client, intent, state and mutation hooks: no branches.
 */
export function useShoppingRow(serviceId: string, row: ShoppingRow) {
  const queryClient = useQueryClient();
  const intent = useIntent();
  const [intended, setIntended] = useState<boolean | null>(null);
  const tick = useMutation({
    mutationFn: async (got: boolean) => {
      const call = gotSave(serviceId, row.ingredientId, got, intent);
      await mutate(call.id, call.name, call.args);
    },
    onSuccess: async () => {
      intent.reset();
      await queryClient.invalidateQueries({ queryKey: ["shopping-list", serviceId] });
    },
  });
  return {
    checked: rowChecked(intended, row.got),
    tickError: tick.error,
    onTick: (got: boolean) => {
      setIntended(got);
      tick.mutate(got, { onSettled: () => setIntended(null) });
    },
  };
}

function Row({ serviceId, row }: Readonly<{ serviceId: string; row: ShoppingRow }>) {
  return <ShoppingRowView {...useShoppingRow(serviceId, row)} row={row} />;
}
