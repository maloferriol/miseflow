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
