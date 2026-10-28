// The Menu screen's views (ADR 0011): props only, so their tests render them without the API.
import { formatFactor } from "@miseflow/shared/src/plan/batches.ts";
import { Fragment, type ReactNode, type SubmitEvent, useState } from "react";
import type { Availability, fetchMenus, Menu } from "./api.ts";
import {
  type DishScale,
  dishScale,
  newMenuInput,
  openingScaleKind,
  type ScaleKind,
  type ServiceInput,
  serviceInput,
} from "./menu-screen.ts";
import { timeValue } from "./time-of-day.ts";

/** A form field's text, or "" when the field is missing or holds a file. */
function fieldText(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** A form field's trimmed text; the form is cleared for the next entry. */
function formText(event: SubmitEvent<HTMLFormElement>, name: string) {
  event.preventDefault();
  const form = event.currentTarget;
  const value = fieldText(new FormData(form), name).trim();
  form.reset();
  return value;
}

/** A query as a view sees it: loading, failed, or loaded. A `useQuery` result is one. */
export type QueryState<T> =
  { status: "pending" } | { status: "error"; error: Error } | { status: "success"; data: T };

export type MenuListItem = Pick<Awaited<ReturnType<typeof fetchMenus>>[number], "id" | "name">;

/** The start screen: every saved Menu, each a link that opens it (?menu=<id>). */
export function MenuListView({ menus }: Readonly<{ menus: QueryState<MenuListItem[]> }>) {
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

export function NewMenuView({ createPending, createError, onCreate }: Readonly<NewMenuViewProps>) {
  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    const guests = fieldText(new FormData(event.currentTarget), "guestCount");
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
  renderServiceForm: (service: Menu["service"]) => ReactNode;
  renderCourse: (course: Menu["courses"][number]) => ReactNode;
};

/** One Menu: its guests, its Service, its Courses and their Batches, and a form to add a Course. */
export function MenuView({
  menu,
  addCoursePending,
  addCourseError,
  onAddCourse,
  renderServiceForm,
  renderCourse,
}: Readonly<MenuViewProps>) {
  if (menu.status === "pending") return <p>Loading…</p>;
  if (menu.status === "error") return <p role="alert">{menu.error.message}</p>;

  return (
    <section>
      <a href="/">All Menus</a>
      <h2>{menu.data.name}</h2>
      <p>{menu.data.guestCount} guests</p>
      <Fragment key={JSON.stringify(menu.data.service)}>
        {renderServiceForm(menu.data.service)}
      </Fragment>
      {menu.data.courses.map((c) => (
        <Fragment key={c.id}>{renderCourse(c)}</Fragment>
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

type Course = Menu["courses"][number];
type Dish = Course["dishes"][number];

export type CourseViewProps = {
  menuId: string;
  course: Course;
  addDishPending: boolean;
  addDishError: Error | null;
  onAddDish: (name: string) => void;
  /** The form that sets one Dish's scale. */
  renderDishScale: (dish: Dish) => ReactNode;
};

/** One Course: its Dishes, each with its scale and quick fixes, and a form to add a Dish. */
export function CourseView({
  menuId,
  course,
  addDishPending,
  addDishError,
  onAddDish,
  renderDishScale,
}: Readonly<CourseViewProps>) {
  // A full load: App reads the view from the URL. ?menu= stays for the way back.
  const recipeHref = (recipeId: string) =>
    `?${new URLSearchParams({ menu: menuId, view: "recipe", recipe: recipeId })}`;
  return (
    <article>
      <h3>{course.name}</h3>
      <ul>
        {course.dishes.map((dish) => (
          <li key={dish.id}>
            <a href={recipeHref(dish.recipe.id)}>{dish.recipe.name}</a>{" "}
            {formatFactor(dish.scale.factor)}
            {/* Paragraphs, not a list, so each Dish stays one list item. */}
            {dish.fixes.map((fix) => (
              <p key={`${fix.subRecipe?.id ?? ""}:${fix.text}`}>
                {fix.subRecipe ? (
                  <a href={recipeHref(fix.subRecipe.id)}>
                    {fix.subRecipe.name}: {fix.text}
                  </a>
                ) : (
                  `${dish.recipe.name}: ${fix.text}`
                )}
              </p>
            ))}
            {renderDishScale(dish)}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          const name = formText(event, "name");
          if (name) onAddDish(name);
        }}
      >
        <label>
          Recipe name <input name="name" required />
        </label>
        <button type="submit" disabled={addDishPending}>
          Add Dish
        </button>
        {addDishError && <p role="alert">{addDishError.message}</p>}
      </form>
    </article>
  );
}

export type DishScaleViewProps = {
  dish: Pick<Dish, "recipe" | "scale">;
  savePending: boolean;
  saveError: Error | null;
  onSave: (scale: DishScale) => void;
};

/** A Dish's Scale factor: the guest count over servings, a portion count, or a factor (units spec §5). */
export function DishScaleView({
  dish,
  savePending,
  saveError,
  onSave,
}: Readonly<DishScaleViewProps>) {
  // What the cook picked, opening on the Dish's saved scale.
  const [kind, setKind] = useState(() => openingScaleKind(dish.scale));

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(dishScale(kind, fieldText(new FormData(event.currentTarget), "value")));
  }

  return (
    <form onSubmit={onSubmit}>
      <select
        aria-label={`Scale for ${dish.recipe.name}`}
        value={kind}
        onChange={(e) => setKind(e.target.value as ScaleKind)}
      >
        <option value="guests">Guests</option>
        <option value="portions">Portions</option>
        <option value="factor">Factor</option>
      </select>
      {kind !== "guests" && (
        <input
          name="value"
          type="number"
          aria-label={
            kind === "portions"
              ? `Portions of ${dish.recipe.name}`
              : `Factor for ${dish.recipe.name}`
          }
          min={kind === "portions" ? 1 : 0.01}
          max={kind === "portions" ? 10_000 : 1000}
          step={kind === "portions" ? 1 : "any"}
          defaultValue={kind === "factor" ? dish.scale.factor : undefined}
          required
        />
      )}
      <button type="submit" disabled={savePending}>
        Save scale
      </button>
      {saveError && <p role="alert">{saveError.message}</p>}
    </form>
  );
}

export type ServiceFormViewProps = {
  menuId: string;
  service: Menu["service"];
  /** The kitchen's default Service time, once loaded. */
  availability: Pick<Availability, "defaultServiceTime"> | undefined;
  savePending: boolean;
  saveError: Error | null;
  onSave: (input: ServiceInput) => void;
};

/**
 * The Menu's one Service: a date and an optional time (empty: the kitchen's default). Saving it
 * re-plans on the server; Open Plan shows the result, Open Shopping list what to buy.
 */
export function ServiceFormView({
  menuId,
  service,
  availability,
  savePending,
  saveError,
  onSave,
}: Readonly<ServiceFormViewProps>) {
  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = serviceInput(fieldText(form, "date"), fieldText(form, "time"));
    if (input) onSave(input);
  }

  const defaultTime = availability && timeValue(availability.defaultServiceTime);
  return (
    <form onSubmit={onSubmit}>
      <label>
        Service date <input name="date" type="date" defaultValue={service?.date ?? ""} required />
      </label>
      <label>
        Service time (optional){" "}
        <input
          name="time"
          type="time"
          step={300}
          defaultValue={service?.time == null ? "" : timeValue(service.time)}
          placeholder={defaultTime}
          title={defaultTime && `Empty: the kitchen's default, ${defaultTime}`}
        />
      </label>
      <button type="submit" disabled={savePending}>
        {service ? "Save Service" : "Add Service"}
      </button>
      {service && (
        <a href={`?${new URLSearchParams({ menu: menuId, view: "plan", service: service.id })}`}>
          Open Plan
        </a>
      )}
      {service && (
        <a
          href={`?${new URLSearchParams({ menu: menuId, view: "shopping", service: service.id })}`}
        >
          Open Shopping list
        </a>
      )}
      {saveError && <p role="alert">{saveError.message}</p>}
    </form>
  );
}
