import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { fetchAvailability, fetchMenu, fetchMenus, type Menu, mutate } from "./api.ts";
import { useIntent } from "./intent.ts";
import { type DishScale, dishScaleSave } from "./menu-screen.ts";
import { CourseView, DishScaleView, MenuListView, MenuView, NewMenuView } from "./MenuViews.tsx";
import { minuteOfDay, timeValue } from "./time-of-day.ts";

// The open Menu lives in the URL (?menu=<id>), so a reload finds it again.
function menuIdFromUrl() {
  return new URLSearchParams(window.location.search).get("menu");
}

export function MenuScreen() {
  const [menuId, setMenuId] = useState(menuIdFromUrl);
  if (menuId) return <OpenMenu menuId={menuId} />;
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

/** Creates a Menu and opens it. Only a mutation hook: no branches. */
function useNewMenu(onCreated: (menuId: string) => void) {
  const createMenu = useMutation({
    mutationFn: async (args: { menuId: string; name: string; guestCount: number }) =>
      mutate(crypto.randomUUID(), "createMenu", args),
    onSuccess: (_, { menuId }) => {
      window.history.replaceState(null, "", `?menu=${menuId}`);
      onCreated(menuId);
    },
  });
  return {
    createPending: createMenu.isPending,
    createError: createMenu.error,
    onCreate: (menu: { name: string; guestCount: number }) =>
      createMenu.mutate({ menuId: crypto.randomUUID(), ...menu }),
  };
}

function NewMenu({ onCreated }: { onCreated: (menuId: string) => void }) {
  return <NewMenuView {...useNewMenu(onCreated)} />;
}

/** One Menu and its Add Course. Only query, mutation and query-client hooks: no branches. */
function useMenu(menuId: string) {
  const queryClient = useQueryClient();
  const menu = useQuery({ queryKey: ["menu", menuId], queryFn: () => fetchMenu(menuId) });
  const onChanged = () => queryClient.invalidateQueries({ queryKey: ["menu", menuId] });
  const addCourse = useMutation({
    mutationFn: async (name: string) =>
      mutate(crypto.randomUUID(), "addCourse", { courseId: crypto.randomUUID(), menuId, name }),
    onSuccess: onChanged,
  });
  return {
    menu,
    addCoursePending: addCourse.isPending,
    addCourseError: addCourse.error,
    onAddCourse: (name: string) => addCourse.mutate(name),
    onChanged,
  };
}

function OpenMenu({ menuId }: { menuId: string }) {
  const { onChanged, ...menu } = useMenu(menuId);
  return (
    <MenuView
      {...menu}
      serviceForm={(service) => <ServiceForm menuId={menuId} service={service} />}
      course={(course) => <Course menuId={menuId} course={course} onChanged={onChanged} />}
    />
  );
}

/** Adds a Dish: a new Recipe placed in this Course. Only a mutation hook: no branches. */
function useCourse(course: Menu["courses"][number], onChanged: () => Promise<void>) {
  // Two mutations, each with its own id.
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
  return {
    addDishPending: addDish.isPending,
    addDishError: addDish.error,
    onAddDish: (name: string) => addDish.mutate(name),
  };
}

function Course({
  menuId,
  course,
  onChanged,
}: {
  menuId: string;
  course: Menu["courses"][number];
  onChanged: () => Promise<void>;
}) {
  return (
    <CourseView
      {...useCourse(course, onChanged)}
      menuId={menuId}
      course={course}
      dishScale={(dish) => <DishScaleForm dish={dish} onChanged={onChanged} />}
    />
  );
}

/** Sets one Dish's scale. Only query-client, intent and mutation hooks: no branches. */
function useDishScale(dishId: string, onChanged: () => Promise<void>) {
  const queryClient = useQueryClient();
  const intent = useIntent();
  const save = useMutation({
    mutationFn: async (scale: DishScale) => {
      const call = dishScaleSave(dishId, scale, intent);
      await mutate(call.id, call.name, call.args);
    },
    onSuccess: async () => {
      intent.reset();
      await Promise.all([onChanged(), queryClient.invalidateQueries({ queryKey: ["plan"] })]);
    },
  });
  return {
    savePending: save.isPending,
    saveError: save.error,
    onSave: (scale: DishScale) => save.mutate(scale),
  };
}

function DishScaleForm({
  dish,
  onChanged,
}: {
  dish: Menu["courses"][number]["dishes"][number];
  onChanged: () => Promise<void>;
}) {
  return <DishScaleView {...useDishScale(dish.id, onChanged)} dish={dish} />;
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
