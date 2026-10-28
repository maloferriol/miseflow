// The Menu screen's views (ADR 0011): props only, so their tests render them without the API.
import { type FormEvent, Fragment, type ReactNode } from "react";
import type { fetchMenus, Menu } from "./api.ts";
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

export type MenuViewProps = {
  menu: QueryState<Menu>;
  addCoursePending: boolean;
  addCourseError: Error | null;
  onAddCourse: (name: string) => void;
  /** The form for the Menu's one Service, remade when the saved Service changes. */
  serviceForm: (service: Menu["service"]) => ReactNode;
  course: (course: Menu["courses"][number]) => ReactNode;
};

/** One Menu: its guests, its Service, its Courses and their Batches, and a form to add a Course. */
export function MenuView({
  menu,
  addCoursePending,
  addCourseError,
  onAddCourse,
  serviceForm,
  course,
}: MenuViewProps) {
  if (menu.status === "pending") return <p>Loading…</p>;
  if (menu.status === "error") return <p role="alert">{menu.error.message}</p>;

  return (
    <section>
      <a href="/">All Menus</a>
      <h2>{menu.data.name}</h2>
      <p>{menu.data.guestCount} guests</p>
      <Fragment key={JSON.stringify(menu.data.service)}>{serviceForm(menu.data.service)}</Fragment>
      {menu.data.courses.map((c) => (
        <Fragment key={c.id}>{course(c)}</Fragment>
      ))}
      <h3>Batches</h3>
      {menu.data.batches.length ? (
        <ul aria-label="Batches">
          {menu.data.batches.map((batch) => (
            <li key={batch.subRecipe.id}>{batch.label}</li>
          ))}
        </ul>
      ) : (
        <p>No Batches</p>
      )}
      <form
        onSubmit={(event) => {
          const name = formText(event, "name");
          if (name) onAddCourse(name);
        }}
      >
        <label>
          Course name <input name="name" required />
        </label>
        <button type="submit" disabled={addCoursePending}>
          Add Course
        </button>
        {addCourseError && <p role="alert">{addCourseError.message}</p>}
      </form>
    </section>
  );
}
