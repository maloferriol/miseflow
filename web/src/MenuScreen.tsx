// The Menu screen (ADR 0011): each part's hook, and the part that renders its view with it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAvailability, fetchMenu, fetchMenus, type Menu, mutate } from "./api.ts";
import { useIntent } from "./intent.ts";
import { type DishScale, dishScaleSave, type ServiceInput, serviceSave } from "./menu-screen.ts";
import {
  CourseView,
  DishScaleView,
  MenuListView,
  MenuView,
  NewMenuView,
  ServiceFormView,
} from "./MenuViews.tsx";

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
export function useMenuList() {
  return { menus: useQuery({ queryKey: ["menus"], queryFn: fetchMenus }) };
}

function MenuList() {
  return <MenuListView {...useMenuList()} />;
}

/** Creates a Menu and opens it. Only a mutation hook: no branches. */
export function useNewMenu(onCreated: (menuId: string) => void) {
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
export function useMenu(menuId: string) {
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
export function useCourse(course: Menu["courses"][number], onChanged: () => Promise<void>) {
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
export function useDishScale(dishId: string, onChanged: () => Promise<void>) {
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

/** Saves the Menu's one Service. Only query, query-client, intent and mutation hooks: no branches. */
export function useServiceForm(menuId: string, service: Menu["service"]) {
  const queryClient = useQueryClient();
  const intent = useIntent();
  const availability = useQuery({ queryKey: ["availability"], queryFn: fetchAvailability });
  const save = useMutation({
    mutationFn: async (input: ServiceInput) => {
      const call = serviceSave(menuId, service, input, intent);
      await mutate(call.id, call.name, call.args);
    },
    onSuccess: async () => {
      intent.reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["menu", menuId] }),
        queryClient.invalidateQueries({ queryKey: ["plan"] }),
      ]);
    },
  });
  return {
    availability: availability.data,
    savePending: save.isPending,
    saveError: save.error,
    onSave: (input: ServiceInput) => save.mutate(input),
  };
}

function ServiceForm({ menuId, service }: { menuId: string; service: Menu["service"] }) {
  return <ServiceFormView {...useServiceForm(menuId, service)} menuId={menuId} service={service} />;
}
