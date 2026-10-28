// The Menu screen's views (ADR 0011): props only, so their tests render them without the API.
import type { FormEvent } from "react";
import type { fetchMenus } from "./api.ts";
import { newMenuInput } from "./menu-screen.ts";

/** A form field's trimmed text; the form is cleared for the next entry. */
function formText(event: FormEvent<HTMLFormElement>, name: string) {
  event.preventDefault();
  const form = event.currentTarget;
  const value = String(new FormData(form).get(name) ?? "").trim();
  form.reset();
  return value;
}

/** A query as a view sees it: loading, failed, or loaded. A `useQuery` result is one. */
export type QueryState<T> =
  { status: "pending" } | { status: "error"; error: Error } | { status: "success"; data: T };

export type MenuListItem = Pick<Awaited<ReturnType<typeof fetchMenus>>[number], "id" | "name">;

/** The start screen: every saved Menu, each a link that opens it (?menu=<id>). */
export function MenuListView({ menus }: { menus: QueryState<MenuListItem[]> }) {
  if (menus.status === "pending") return <p>Loading…</p>;
  if (menus.status === "error") return <p role="alert">{menus.error.message}</p>;
  if (!menus.data.length) return null;

  return (
    <nav aria-label="Your Menus">
      <h2>Your Menus</h2>
      <ul>
        {menus.data.map((menu) => (
          <li key={menu.id}>
            <a href={`?menu=${menu.id}`}>{menu.name}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export type NewMenuViewProps = {
  createPending: boolean;
  createError: Error | null;
  onCreate: (menu: { name: string; guestCount: number }) => void;
};

export function NewMenuView({ createPending, createError, onCreate }: NewMenuViewProps) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const guests = String(new FormData(event.currentTarget).get("guestCount") ?? "");
    const menu = newMenuInput(formText(event, "name"), guests);
    if (menu) onCreate(menu);
  }

  return (
    <form onSubmit={onSubmit}>
      <h2>New Menu</h2>
      <label>
        Menu name <input name="name" required />
      </label>
      <label>
        Guests <input name="guestCount" type="number" min={1} step={1} defaultValue={2} required />
      </label>
      <button type="submit" disabled={createPending}>
        Create Menu
      </button>
      {createError && <p role="alert">{createError.message}</p>}
    </form>
  );
}
