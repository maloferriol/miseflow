// The Menu screen (ADR 0011): each part's hook, and the part that renders its view with it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toAction } from "./action.ts";
import { fetchAvailability, fetchMenu, fetchMenus, type Menu, mutate } from "./api.ts";
import { useIntent } from "./intent.ts";
import {
  type Course,
  type Dish,
  type DishScale,
  dishScaleSave,
  type ServiceInput,
  serviceSave,
} from "./menu-screen.ts";
import {
  CourseView,
  DishScaleView,
  MenuListView,
  MenuView,
  NewMenuView,
  ServiceFormView,
} from "./MenuViews.tsx";
import { useIntentSave } from "./use-intent-save.ts";

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
    mutationFn: async (menu: { name: string; guestCount: number }) => {
      const menuId = crypto.randomUUID();
      await mutate({ id: crypto.randomUUID(), name: "createMenu", args: { menuId, ...menu } });
      return menuId;
    },
    onSuccess: (menuId) => {
      window.history.replaceState(null, "", `?menu=${menuId}`);
      onCreated(menuId);
    },
  });
  return { create: toAction(createMenu) };
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
      mutate({
        id: crypto.randomUUID(),
        name: "addCourse",
        args: { courseId: crypto.randomUUID(), menuId, name },
      }),
    onSuccess: onChanged,
  });
  return {
    menu,
    addCourse: toAction(addCourse),
    onChanged,
  };
}

function OpenMenu({ menuId }: Readonly<{ menuId: string }>) {
  const { onChanged, ...menu } = useMenu(menuId);
  return (
    <MenuView
      {...menu}
      renderServiceForm={(service) => <ServiceForm menuId={menuId} service={service} />}
      renderCourse={(course) => (
        <OpenCourse menuId={menuId} course={course} onChanged={onChanged} />
      )}
    />
  );
}

/** Adds a Dish: a new Recipe placed in this Course. Only a mutation hook: no branches. */
export function useCourse(course: Course, onChanged: () => Promise<void>) {
  // Two mutations, each with its own id.
  const addDish = useMutation({
    mutationFn: async (name: string) => {
      const recipeId = crypto.randomUUID();
      await mutate({
        id: crypto.randomUUID(),
        name: "createRecipe",
        args: { recipeId, revisionId: crypto.randomUUID(), name },
      });
      await mutate({
        id: crypto.randomUUID(),
        name: "addDish",
        args: { dishId: crypto.randomUUID(), courseId: course.id, recipeId },
      });
    },
    onSuccess: onChanged,
  });
  return { addDish: toAction(addDish) };
}

function OpenCourse({
  menuId,
  course,
  onChanged,
}: Readonly<{
  menuId: string;
  course: Course;
  onChanged: () => Promise<void>;
}>) {
  return (
    <CourseView
      {...useCourse(course, onChanged)}
      menuId={menuId}
      course={course}
      renderDishScale={(dish) => <DishScaleForm dish={dish} onChanged={onChanged} />}
    />
  );
}

/** Sets one Dish's scale. Only query-client, intent and mutation hooks: no branches. */
export function useDishScale(dishId: string, onChanged: () => Promise<void>) {
  const queryClient = useQueryClient();
  const intent = useIntent();
  const save = useIntentSave(
    intent,
    (scale: DishScale, i) => dishScaleSave(dishId, scale, i),
    () => Promise.all([onChanged(), queryClient.invalidateQueries({ queryKey: ["plan"] })]),
  );
  return { save: toAction(save) };
}

function DishScaleForm({
  dish,
  onChanged,
}: Readonly<{
  dish: Dish;
  onChanged: () => Promise<void>;
}>) {
  return <DishScaleView {...useDishScale(dish.id, onChanged)} dish={dish} />;
}

/** Saves the Menu's one Service. Only query, query-client, intent and mutation hooks: no branches. */
export function useServiceForm(menuId: string, service: Menu["service"]) {
  const queryClient = useQueryClient();
  const intent = useIntent();
  const availability = useQuery({ queryKey: ["availability"], queryFn: fetchAvailability });
  const save = useIntentSave(
    intent,
    (input: ServiceInput, i) => serviceSave(menuId, service, input, i),
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["menu", menuId] }),
        queryClient.invalidateQueries({ queryKey: ["plan"] }),
      ]),
  );
  return {
    availability: availability.data,
    save: toAction(save),
  };
}

function ServiceForm({ menuId, service }: { menuId: string; service: Menu["service"] }) {
  return <ServiceFormView {...useServiceForm(menuId, service)} menuId={menuId} service={service} />;
}
