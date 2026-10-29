// The app shell's decisions (ADR 0011): which screen the link and the session open, and the link
// that opening another view writes. Pure functions the hook and the view pass through.

export type View =
  "menu" | "catalog" | "recipes" | "recipe" | "availability" | "plan" | "today" | "shopping";
const VIEWS: View[] = [
  "menu",
  "catalog",
  "recipes",
  "recipe",
  "availability",
  "plan",
  "today",
  "shopping",
];

/**
 * The view a link's query string names: the Menu when it names none, or lacks the id it needs.
 * The open view lives in the URL (?view=catalog, ?view=recipe&recipe=<id>,
 * ?view=plan&service=<id>, ?view=today&service=<id>&day=<date>, ?view=shopping&service=<id>)
 * next to ?menu=, so a reload keeps them.
 */
export function viewFromSearch(search: string): View {
  const params = new URLSearchParams(search);
  const view = VIEWS.find((v) => v === params.get("view")) ?? "menu";
  if (view === "recipe" && !params.get("recipe")) return "recipes";
  if ((view === "plan" || view === "today" || view === "shopping") && !params.get("service"))
    return "menu";
  return view;
}

/** What the shell shows under its header. */
export type Screen =
  | { name: "checking" }
  | { name: "signIn" }
  | { name: "menu" | "catalog" | "availability" | "recipes" }
  | { name: "recipe"; recipeId: string }
  | { name: "plan" | "today" | "shopping"; serviceId: string };

/**
 * The screen for the open view: nothing while the session is still being read, sign-in when the
 * cook is signed out, else the view's screen, or the Menu when the view lacks its id.
 */
export function screenFor({
  view,
  session,
  recipeId,
  serviceId,
}: {
  view: View;
  session: object | null | undefined;
  recipeId: string | null;
  serviceId: string | null;
}): Screen {
  if (session === undefined) return { name: "checking" };
  if (!session) return { name: "signIn" };
  if (view === "catalog" || view === "availability" || view === "recipes") return { name: view };
  if ((view === "today" || view === "plan" || view === "shopping") && serviceId)
    return { name: view, serviceId };
  if (view === "recipe" && recipeId) return { name: view, recipeId };
  return { name: "menu" };
}

/** The header's nav: each button's label, the view it opens, and the views it shows as pressed. */
export const NAV: { label: string; view: View; pressedFor: View[] }[] = [
  { label: "Menu", view: "menu", pressedFor: ["menu"] },
  { label: "Recipes", view: "recipes", pressedFor: ["recipes", "recipe"] },
  { label: "Catalog", view: "catalog", pressedFor: ["catalog"] },
  { label: "Availability", view: "availability", pressedFor: ["availability"] },
];

/**
 * The link after opening a view: it names the view (the Menu names none) and the Recipe, drops
 * the Service and day, and keeps everything else, such as ?menu=. An empty query leaves the path.
 */
export function openedUrl(
  location: { search: string; pathname: string },
  next: View,
  recipeId?: string,
): string {
  const params = new URLSearchParams(location.search);
  if (next === "menu") params.delete("view");
  else params.set("view", next);
  if (recipeId) params.set("recipe", recipeId);
  else params.delete("recipe");
  params.delete("service");
  params.delete("day");
  const search = params.toString();
  return search ? `?${search}` : location.pathname;
}
