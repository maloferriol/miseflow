// The app shell (ADR 0011): its hook, and the App that renders its view with each screen.
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { openedUrl, type Screen, screenFor, type View, viewFromSearch } from "./app-shell.ts";
import { AppView } from "./AppView.tsx";
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

/**
 * The open view and the session: the session as Supabase last reported it (undefined until the
 * first read), and opening a view rewrites the link.
 */
export function useAppShell() {
  const [view, setView] = useState(() => viewFromSearch(window.location.search));
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const [recipeId, setRecipeId] = useState(() =>
    new URLSearchParams(window.location.search).get("recipe"),
  );
  const serviceId = new URLSearchParams(window.location.search).get("service");

  function open(next: View, nextRecipeId?: string) {
    setRecipeId(nextRecipeId ?? null);
    window.history.replaceState(null, "", openedUrl(window.location, next, nextRecipeId));
    setView(next);
  }

  return {
    signedIn: Boolean(session),
    view,
    screen: screenFor({ view, session, recipeId, serviceId }),
    onOpen: open,
    onSignOut: () => void supabase.auth.signOut(),
  };
}

export function App() {
  const shell = useAppShell();

  function renderScreen(screen: Screen) {
    switch (screen.name) {
      case "checking":
        return null;
      case "signIn":
        return <SignIn />;
      case "catalog":
        return <CatalogScreen />;
      case "availability":
        return <AvailabilityScreen />;
      case "today":
        return <TodayScreen key={screen.serviceId} serviceId={screen.serviceId} />;
      case "plan":
        return <PlanScreen key={screen.serviceId} serviceId={screen.serviceId} />;
      case "shopping":
        return <ShoppingListScreen key={screen.serviceId} serviceId={screen.serviceId} />;
      case "recipes":
        return <RecipesScreen onOpen={(id) => shell.onOpen("recipe", id)} />;
      case "recipe":
        return <RecipeScreen key={screen.recipeId} recipeId={screen.recipeId} />;
      case "menu":
        return <MenuScreen />;
    }
  }

  return <AppView {...shell} renderScreen={renderScreen} />;
}
