import type { AppType } from "@miseflow/server";
import { hc } from "hono/client";
import { supabase } from "./supabase.ts";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

// Typed reads through Hono RPC. Source: https://hono.dev/docs/guides/rpc
export const api = hc<AppType>("/api", { headers: authHeaders });

export async function fetchMenus() {
  const res = await api.menus.$get();
  if (!res.ok) throw new Error(`Could not load the Menus (${res.status})`);
  return (await res.json()).menus;
}

export async function fetchMenu(menuId: string) {
  const res = await api.menus[":menuId"].$get({ param: { menuId } });
  if (!res.ok) throw new Error(`Could not load the Menu (${res.status})`);
  return (await res.json()).menu;
}

export type Menu = Awaited<ReturnType<typeof fetchMenu>>;

/**
 * Posts one named mutation (ADR 0007). The caller makes `id` once per user intent, so a
 * retry of the same intent is applied only once.
 */
export async function mutate(id: string, name: string, args: Record<string, unknown>) {
  const res = await fetch("/api/mutate", {
    method: "POST",
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    body: JSON.stringify({ id, name, args }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new Error(body?.error?.message ?? `${name} failed (${res.status})`);
  }
}

export async function fetchIngredients(q: string) {
  const res = await api.ingredients.$get({ query: { q, limit: "20" } });
  if (!res.ok) throw new Error(`Could not search the catalog (${res.status})`);
  return (await res.json()).ingredients;
}

export type CatalogIngredient = Awaited<ReturnType<typeof fetchIngredients>>[number];

export async function fetchShoppingCategories() {
  const res = await api["shopping-categories"].$get();
  if (!res.ok) throw new Error(`Could not load the Shopping categories (${res.status})`);
  return (await res.json()).shoppingCategories;
}

export async function fetchRecipes() {
  const res = await api.recipes.$get();
  if (!res.ok) throw new Error(`Could not load the Recipes (${res.status})`);
  return (await res.json()).recipes;
}

export type RecipeListItem = Awaited<ReturnType<typeof fetchRecipes>>[number];

export async function fetchRecipe(recipeId: string) {
  const res = await api.recipes[":recipeId"].$get({ param: { recipeId } });
  if (!res.ok) throw new Error(`Could not load the Recipe (${res.status})`);
  return (await res.json()).recipe;
}

export type Recipe = Awaited<ReturnType<typeof fetchRecipe>>;
export type RecipeStep = Recipe["steps"][number];
export type RecipeLine = RecipeStep["lines"][number];

export async function fetchPlan(serviceId: string) {
  const res = await api.services[":serviceId"].plan.$get({ param: { serviceId } });
  if (!res.ok) throw new Error(`Could not load the Plan (${res.status})`);
  return (await res.json()).plan;
}

export type Plan = Awaited<ReturnType<typeof fetchPlan>>;
export type PlanTask = Plan["days"][number]["tasks"][number];

export async function fetchAvailability() {
  const res = await api.availability.$get();
  if (!res.ok) throw new Error(`Could not load the Availability (${res.status})`);
  return await res.json();
}

export type Availability = Awaited<ReturnType<typeof fetchAvailability>>;

/** A minute of day as an <input type="time"> value ("18:00"); 1440 reads as "00:00". */
export function timeValue(minuteOfDay: number) {
  const m = minuteOfDay % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** An <input type="time"> value as a minute of day, or null when empty. */
export function minuteOfDay(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "");
  if (!/^\d{2}:\d{2}/.test(text)) return null;
  return Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
}
