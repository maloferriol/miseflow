import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { MenuScreen } from "./MenuScreen.tsx";
import { SignIn } from "./SignIn.tsx";
import { supabase } from "./supabase.ts";

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <main>
      <h1>MiseFlow</h1>
      {session === undefined ? null : session ? (
        <>
          <button type="button" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
          <MenuScreen />
        </>
      ) : (
        <SignIn />
      )}
    </main>
  );
}
