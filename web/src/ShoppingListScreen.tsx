import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchShoppingList, mutate, type ShoppingRow } from "./api.ts";
import { useIntent } from "./intent.ts";
import { needText } from "./need.ts";

// One row: a tick box labelled with the Ingredient's name, then its need. Ticking is markGot,
// un-ticking unmarkGot; the box shows the intended state until the list has reloaded. That state
// is set in the change handler itself, so React never puts the box back in between.
function Row({ serviceId, row }: { serviceId: string; row: ShoppingRow }) {
  const queryClient = useQueryClient();
  const intent = useIntent();
  const [intended, setIntended] = useState<boolean | null>(null);
  const tick = useMutation({
    mutationFn: async (got: boolean) => {
      const key = JSON.stringify([row.ingredientId, got]);
      if (got) await mutate(intent.id(key, "mutation"), "markGot", { markId: intent.id(key, "mark"), serviceId, ingredientId: row.ingredientId });
      else await mutate(intent.id(key, "mutation"), "unmarkGot", { serviceId, ingredientId: row.ingredientId });
    },
    onSuccess: async () => {
      intent.reset();
      await queryClient.invalidateQueries({ queryKey: ["shopping-list", serviceId] });
    },
  });
  function onChange(got: boolean) {
    setIntended(got);
    tick.mutate(got, { onSettled: () => setIntended(null) });
  }
  return (
    <li>
      <label>
        <input type="checkbox" checked={intended ?? row.got} onChange={(event) => onChange(event.currentTarget.checked)} /> {row.name}
      </label>{" "}
      {needText(row)}
      {tick.error && <span role="alert"> {tick.error.message}</span>}
    </li>
  );
}

// One Service's Shopping list: a section per Shopping category in the kitchen's order, the
// Missing sub-recipes on top, and a Print button. print.css drops the app chrome on paper.
export function ShoppingListScreen({ serviceId }: { serviceId: string }) {
  const list = useQuery({ queryKey: ["shopping-list", serviceId], queryFn: () => fetchShoppingList(serviceId) });

  if (list.isPending) return <p>Loading…</p>;
  if (list.isError) return <p role="alert">{list.error.message}</p>;
  const { service, categories, missing } = list.data;

  return (
    <>
      <a className="no-print" href={`?menu=${service.menuId}`}>
        Back to the Menu
      </a>
      <h2>Shopping list</h2>
      <button type="button" className="no-print" onClick={() => window.print()}>
        Print
      </button>
      {missing.length > 0 && (
        <ul aria-label="Missing sub-recipes">
          {missing.map((m) => (
            <li key={m.lineId}>
              {m.recipeName}: {m.wording ?? "a sub-recipe"} is a Missing sub-recipe and adds nothing to this list
            </li>
          ))}
        </ul>
      )}
      {categories.length ? (
        categories.map((category) => (
          <section key={category.id ?? "none"}>
            <h3>{category.name}</h3>
            <ul aria-label={category.name}>
              {category.rows.map((row) => (
                <Row key={row.ingredientId} serviceId={serviceId} row={row} />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p>Nothing to buy</p>
      )}
    </>
  );
}
