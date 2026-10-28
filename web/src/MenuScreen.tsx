import { formatFactor } from "@miseflow/shared/src/plan/batches.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { fetchAvailability, fetchMenu, fetchMenus, type Menu, mutate } from "./api.ts";
import { useIntent } from "./intent.ts";
import { MenuListView } from "./MenuViews.tsx";
import { minuteOfDay, timeValue } from "./time-of-day.ts";

// The open Menu lives in the URL (?menu=<id>), so a reload finds it again.
function menuIdFromUrl() {
  return new URLSearchParams(window.location.search).get("menu");
}

function formText(event: FormEvent<HTMLFormElement>, name: string) {
  event.preventDefault();
  const form = event.currentTarget;
  const value = String(new FormData(form).get(name) ?? "").trim();
  form.reset();
  return value;
}

export function MenuScreen() {
  const [menuId, setMenuId] = useState(menuIdFromUrl);
  if (menuId) return <MenuView menuId={menuId} />;
  return (
    <>
      <MenuList />
      <NewMenu onCreated={setMenuId} />
    </>
  );
}

/** The saved Menus. Only query hooks: no branches. */
function useMenuList() {
  return { menus: useQuery({ queryKey: ["menus"], queryFn: fetchMenus }) };
}

function MenuList() {
  return <MenuListView {...useMenuList()} />;
}

function NewMenu({ onCreated }: { onCreated: (menuId: string) => void }) {
  const createMenu = useMutation({
    mutationFn: async (args: { menuId: string; name: string; guestCount: number }) =>
      mutate(crypto.randomUUID(), "createMenu", args),
    onSuccess: (_, { menuId }) => {
      window.history.replaceState(null, "", `?menu=${menuId}`);
      onCreated(menuId);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const guestCount = Number(new FormData(event.currentTarget).get("guestCount"));
    const name = formText(event, "name");
    if (name) createMenu.mutate({ menuId: crypto.randomUUID(), name, guestCount });
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
      <button type="submit" disabled={createMenu.isPending}>
        Create Menu
      </button>
      {createMenu.error && <p role="alert">{createMenu.error.message}</p>}
    </form>
  );
}

function MenuView({ menuId }: { menuId: string }) {
  const queryClient = useQueryClient();
  const menu = useQuery({ queryKey: ["menu", menuId], queryFn: () => fetchMenu(menuId) });
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ["menu", menuId] });

  const addCourse = useMutation({
    mutationFn: async (name: string) =>
      mutate(crypto.randomUUID(), "addCourse", { courseId: crypto.randomUUID(), menuId, name }),
    onSuccess,
  });

  if (menu.isPending) return <p>Loading…</p>;
  if (menu.isError) return <p role="alert">{menu.error.message}</p>;

  return (
    <section>
      <a href="/">All Menus</a>
      <h2>{menu.data.name}</h2>
      <p>{menu.data.guestCount} guests</p>
      <ServiceForm
        key={JSON.stringify(menu.data.service)}
        menuId={menuId}
        service={menu.data.service}
      />
      {menu.data.courses.map((course) => (
        <CourseView key={course.id} course={course} onChanged={onSuccess} />
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
          if (name) addCourse.mutate(name);
        }}
      >
        <label>
          Course name <input name="name" required />
        </label>
        <button type="submit" disabled={addCourse.isPending}>
          Add Course
        </button>
        {addCourse.error && <p role="alert">{addCourse.error.message}</p>}
      </form>
    </section>
  );
}

function CourseView({
  course,
  onChanged,
}: {
  course: Menu["courses"][number];
  onChanged: () => Promise<void>;
}) {
  // A new Dish is a new Recipe placed in this Course: two mutations, each with its own id.
  const addDish = useMutation({
    mutationFn: async (name: string) => {
      const recipeId = crypto.randomUUID();
      await mutate(crypto.randomUUID(), "createRecipe", {
        recipeId,
        revisionId: crypto.randomUUID(),
        name,
      });
      await mutate(crypto.randomUUID(), "addDish", {
        dishId: crypto.randomUUID(),
        courseId: course.id,
        recipeId,
      });
    },
    onSuccess: onChanged,
  });

  return (
    <article>
      <h3>{course.name}</h3>
      <ul>
        {course.dishes.map((dish) => (
          <li key={dish.id}>
            {/* A full load: App reads the view from the URL. ?menu= stays for the way back. */}
            <a
              href={`?${new URLSearchParams({ menu: menuIdFromUrl() ?? "", view: "recipe", recipe: dish.recipe.id })}`}
            >
              {dish.recipe.name}
            </a>{" "}
            {formatFactor(dish.scale.factor)}
            {/* Paragraphs, not a list, so each Dish stays one list item. */}
            {dish.fixes.map((fix) => (
              <p key={`${fix.subRecipe?.id ?? ""}:${fix.text}`}>
                {fix.subRecipe ? (
                  <a
                    href={`?${new URLSearchParams({ menu: menuIdFromUrl() ?? "", view: "recipe", recipe: fix.subRecipe.id })}`}
                  >
                    {fix.subRecipe.name}: {fix.text}
                  </a>
                ) : (
                  `${dish.recipe.name}: ${fix.text}`
                )}
              </p>
            ))}
            <DishScale dish={dish} onChanged={onChanged} />
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          const name = formText(event, "name");
          if (name) addDish.mutate(name);
        }}
      >
        <label>
          Recipe name <input name="name" required />
        </label>
        <button type="submit" disabled={addDish.isPending}>
          Add Dish
        </button>
        {addDish.error && <p role="alert">{addDish.error.message}</p>}
      </form>
    </article>
  );
}

type ScaleKind = "guests" | "portions" | "factor";

// A Dish's Scale factor: the guest count over servings, a portion count, or a factor (units spec §5).
function DishScale({
  dish,
  onChanged,
}: {
  dish: Menu["courses"][number]["dishes"][number];
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const intent = useIntent();
  const [kind, setKind] = useState<ScaleKind>(dish.scale.source === "set" ? "factor" : "guests");
  const save = useMutation({
    mutationFn: async (
      scale:
        | { kind: "guests" }
        | { kind: "portions"; portions: number }
        | { kind: "factor"; factor: number },
    ) =>
      mutate(intent.id(JSON.stringify([dish.id, scale]), "mutation"), "setDishScale", {
        dishId: dish.id,
        scale,
      }),
    onSuccess: async () => {
      intent.reset();
      await Promise.all([onChanged(), queryClient.invalidateQueries({ queryKey: ["plan"] })]);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(new FormData(event.currentTarget).get("value"));
    if (kind === "guests") save.mutate({ kind });
    else if (kind === "portions") save.mutate({ kind, portions: value });
    else save.mutate({ kind, factor: value });
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
      <button type="submit" disabled={save.isPending}>
        Save scale
      </button>
      {save.error && <p role="alert">{save.error.message}</p>}
    </form>
  );
}

// The Menu's one Service: a date and an optional time (empty: the kitchen's default). Saving it
// re-plans on the server; Open Plan shows the result, Open Shopping list what to buy.
function ServiceForm({ menuId, service }: { menuId: string; service: Menu["service"] }) {
  const queryClient = useQueryClient();
  const intent = useIntent();
  const availability = useQuery({ queryKey: ["availability"], queryFn: fetchAvailability });
  const save = useMutation({
    mutationFn: async (args: { date: string; time: number | null }) => {
      const key = JSON.stringify([service?.id ?? null, args]);
      if (service)
        await mutate(intent.id(key, "mutation"), "setServiceTime", {
          serviceId: service.id,
          ...args,
        });
      else
        await mutate(intent.id(key, "mutation"), "createService", {
          serviceId: intent.id(key, "service"),
          menuId,
          ...args,
        });
    },
    onSuccess: async () => {
      intent.reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["menu", menuId] }),
        queryClient.invalidateQueries({ queryKey: ["plan"] }),
      ]);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get("date") ?? "");
    if (date) save.mutate({ date, time: minuteOfDay(form.get("time")) });
  }

  const defaultTime = availability.data
    ? timeValue(availability.data.defaultServiceTime)
    : undefined;
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
      <button type="submit" disabled={save.isPending}>
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
      {save.error && <p role="alert">{save.error.message}</p>}
    </form>
  );
}
