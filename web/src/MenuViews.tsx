// The Menu screen's views (ADR 0011): props only, so their tests render them without the API.
import type { fetchMenus } from "./api.ts";

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
