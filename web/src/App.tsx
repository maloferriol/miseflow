import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { AvailabilityScreen } from "./AvailabilityScreen.tsx";
import { CatalogScreen } from "./CatalogScreen.tsx";
import { MenuScreen } from "./MenuScreen.tsx";
import { PlanScreen } from "./PlanScreen.tsx";
import { RecipeScreen } from "./RecipeScreen.tsx";
import { RecipesScreen } from "./RecipesScreen.tsx";
import { ShoppingListScreen } from "./ShoppingListScreen.tsx";
import { SignIn } from "./SignIn.tsx";
import { TodayScreen } from "./TodayScreen.tsx";
import { supabase } from "./supabase.ts";

type View = "menu" | "catalog" | "recipes" | "recipe" | "availability" | "plan" | "today" | "shopping";
const VIEWS: View[] = ["menu", "catalog", "recipes", "recipe", "availability", "plan", "today", "shopping"];

// The open view lives in the URL (?view=catalog, ?view=recipe&recipe=<id>,
// ?view=plan&service=<id>, ?view=today&service=<id>&day=<date>,
// ?view=shopping&service=<id>) next to ?menu=, so a reload keeps them.
function viewFromUrl(): View {
  const params = new URLSearchParams(window.location.search);
  const view = VIEWS.find((v) => v === params.get("view")) ?? "menu";
  if (view === "recipe" && !params.get("recipe")) return "recipes";
  if ((view === "plan" || view === "today" || view === "shopping") && !params.get("service")) return "menu";
  return view;
}

export function App() {
  const [view, setView] = useState(viewFromUrl);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const [recipeId, setRecipeId] = useState(() => new URLSearchParams(window.location.search).get("recipe"));
  const serviceId = new URLSearchParams(window.location.search).get("service");

  function open(next: View, nextRecipeId?: string) {
    const params = new URLSearchParams(window.location.search);
    if (next === "menu") params.delete("view");
    else params.set("view", next);
    if (nextRecipeId) params.set("recipe", nextRecipeId);
    else params.delete("recipe");
    params.delete("service");
    params.delete("day");
    setRecipeId(nextRecipeId ?? null);
    const search = params.toString();
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
    setView(next);
  }

  return (
    <main>
      <header className="screen-only">
        <h1>MiseFlow</h1>
        {session && (
          <>
            <button type="button" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
            <nav>
              <button type="button" aria-pressed={view === "menu"} onClick={() => open("menu")}>
                Menu
              </button>
              <button type="button" aria-pressed={view === "recipes" || view === "recipe"} onClick={() => open("recipes")}>
                Recipes
              </button>
              <button type="button" aria-pressed={view === "catalog"} onClick={() => open("catalog")}>
                Catalog
              </button>
              <button type="button" aria-pressed={view === "availability"} onClick={() => open("availability")}>
                Availability
              </button>
            </nav>
          </>
        )}
      </header>
      {session === undefined ? null : session ? (
        <>
          {view === "catalog" ? (
            <CatalogScreen />
          ) : view === "availability" ? (
            <AvailabilityScreen />
          ) : view === "today" && serviceId ? (
            <TodayScreen key={serviceId} serviceId={serviceId} />
          ) : view === "plan" && serviceId ? (
            <PlanScreen key={serviceId} serviceId={serviceId} />
          ) : view === "shopping" && serviceId ? (
            <ShoppingListScreen key={serviceId} serviceId={serviceId} />
          ) : view === "recipes" ? (
            <RecipesScreen onOpen={(id) => open("recipe", id)} />
          ) : view === "recipe" && recipeId ? (
            <RecipeScreen key={recipeId} recipeId={recipeId} />
          ) : (
            <MenuScreen />
          )}
        </>
      ) : (
        <SignIn />
      )}
    </main>
  );
}
