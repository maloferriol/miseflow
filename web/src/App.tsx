import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { CatalogScreen } from "./CatalogScreen.tsx";
import { MenuScreen } from "./MenuScreen.tsx";
import { SignIn } from "./SignIn.tsx";
import { supabase } from "./supabase.ts";

type View = "menu" | "catalog";

// The open view lives in the URL (?view=catalog) next to ?menu=, so a reload keeps both.
function viewFromUrl(): View {
  return new URLSearchParams(window.location.search).get("view") === "catalog" ? "catalog" : "menu";
}

export function App() {
  const [view, setView] = useState(viewFromUrl);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  function open(next: View) {
    const params = new URLSearchParams(window.location.search);
    if (next === "catalog") params.set("view", "catalog");
    else params.delete("view");
    const search = params.toString();
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
    setView(next);
  }

  return (
    <main>
      <h1>MiseFlow</h1>
      {session === undefined ? null : session ? (
        <>
          <button type="button" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
          <nav>
            <button type="button" aria-pressed={view === "menu"} onClick={() => open("menu")}>
              Menu
            </button>
            <button type="button" aria-pressed={view === "catalog"} onClick={() => open("catalog")}>
              Catalog
            </button>
          </nav>
          {view === "catalog" ? <CatalogScreen /> : <MenuScreen />}
        </>
      ) : (
        <SignIn />
      )}
    </main>
  );
}
