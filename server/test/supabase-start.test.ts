import { describe, expect, it } from "vitest";
import { supabaseStartArgs } from "../scripts/supabase-start.ts";

// `npm run setup:local` starts the stack with these arguments. CI sets SUPABASE_START_EXCLUDE (#158).
describe("supabaseStartArgs", () => {
  it("starts every service when SUPABASE_START_EXCLUDE is unset or empty", () => {
    expect(supabaseStartArgs(undefined)).toEqual(["start"]);
    expect(supabaseStartArgs("")).toEqual(["start"]);
  });

  it("passes the listed services to -x", () => {
    expect(supabaseStartArgs("studio,realtime , mailpit")).toEqual([
      "start",
      "-x",
      "studio,realtime,mailpit",
    ]);
  });
});
