import { createClient } from "@supabase/supabase-js";

// Only the auth module is used; data goes through the Hono API (ADR 0006, ADR 0008).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
