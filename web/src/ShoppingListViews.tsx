// The Shopping list's views (ADR 0011): props only, so their tests render them without the API.
import { Fragment, type ReactNode } from "react";
import type { ShoppingList, ShoppingRow } from "./api.ts";
import type { QueryState } from "./MenuViews.tsx";
import { needText } from "./need.ts";
import { missingText } from "./shopping-list.ts";

export type ShoppingListViewProps = {
  list: QueryState<ShoppingList>;
  renderRow: (row: ShoppingRow) => ReactNode;
};

// One Service's Shopping list: a section per Shopping category in the kitchen's order, the
// Missing sub-recipes on top, and a Print button. print.css drops the app chrome on paper.
export function ShoppingListView({ list, renderRow }: Readonly<ShoppingListViewProps>) {
  if (list.status === "pending") return <p>Loading…</p>;
  if (list.status === "error") return <p role="alert">{list.error.message}</p>;
  const { service, categories, missing } = list.data;

  return (
    <>
      <a className="screen-only" href={`?menu=${service.menuId}`}>
        Back to the Menu
      </a>
      <h2>Shopping list</h2>
      <button type="button" className="screen-only" onClick={() => window.print()}>
        Print
      </button>
      {missing.length > 0 && (
        <ul aria-label="Missing sub-recipes">
          {missing.map((m) => (
            <li key={m.lineId}>{missingText(m)}</li>
          ))}
        </ul>
      )}
      {categories.length ? (
        categories.map((category) => (
          <section key={category.id ?? "none"}>
            <h3>{category.name}</h3>
            <ul aria-label={category.name}>
              {category.rows.map((row) => (
                <Fragment key={row.ingredientId}>{renderRow(row)}</Fragment>
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

export type ShoppingRowViewProps = {
  row: ShoppingRow;
  checked: boolean;
  tickError: Error | null;
  onTick: (got: boolean) => void;
};

// One row: a tick box labelled with the Ingredient's name, then its need.
export function ShoppingRowView({
  row,
  checked,
  tickError,
  onTick,
}: Readonly<ShoppingRowViewProps>) {
  return (
    <li>
      <label>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onTick(event.currentTarget.checked)}
        />{" "}
        {row.name}
      </label>{" "}
      {needText(row)}
      {tickError && <span role="alert"> {tickError.message}</span>}
    </li>
  );
}
