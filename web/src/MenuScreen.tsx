import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { fetchAvailability, fetchMenu, fetchMenus, type Menu, minuteOfDay, mutate, timeValue } from "./api.ts";
import { useIntent } from "./intent.ts";

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

// The start screen: every saved Menu, each a link that opens it (?menu=<id>).
function MenuList() {
  const menus = useQuery({ queryKey: ["menus"], queryFn: fetchMenus });

  if (menus.isPending) return <p>Loading…</p>;
  if (menus.isError) return <p role="alert">{menus.error.message}</p>;
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
      <ServiceForm key={JSON.stringify(menu.data.service)} menuId={menuId} service={menu.data.service} />
      {menu.data.courses.map((course) => (
        <CourseView key={course.id} course={course} onChanged={onSuccess} />
      ))}
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
            <a href={`?${new URLSearchParams({ menu: menuIdFromUrl() ?? "", view: "recipe", recipe: dish.recipe.id })}`}>
              {dish.recipe.name}
            </a>
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

// The Menu's one Service: a date and an optional time (empty: the kitchen's default). Saving it
// re-plans on the server; Open Plan shows the result.
function ServiceForm({ menuId, service }: { menuId: string; service: Menu["service"] }) {
  const queryClient = useQueryClient();
  const intent = useIntent();
  const availability = useQuery({ queryKey: ["availability"], queryFn: fetchAvailability });
  const save = useMutation({
    mutationFn: async (args: { date: string; time: number | null }) => {
      const key = JSON.stringify([service?.id ?? null, args]);
      if (service) await mutate(intent.id(key, "mutation"), "setServiceTime", { serviceId: service.id, ...args });
      else await mutate(intent.id(key, "mutation"), "createService", { serviceId: intent.id(key, "service"), menuId, ...args });
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

  const defaultTime = availability.data ? timeValue(availability.data.defaultServiceTime) : undefined;
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
      {service && <a href={`?${new URLSearchParams({ menu: menuId, view: "plan", service: service.id })}`}>Open Plan</a>}
      {save.error && <p role="alert">{save.error.message}</p>}
    </form>
  );
}
