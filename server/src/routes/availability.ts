import { addDays, loadAvailability, loadDefaultServiceTime, localParts } from "@miseflow/shared";
import { Hono } from "hono";
import type { AuthEnv } from "../auth.ts";
import type { Db } from "../db.ts";

// GET /availability: the kitchen's time zone and default Service time, and the implicit Cook's
// weekly hours and date overrides from 7 days ago on. Times are minutes of day.
export function availabilityRoute(db: Db, timeZone: string) {
  return new Hono<AuthEnv>().get("/", async (c) => {
    const ownerId = c.get("ownerId");
    const today = localParts(Math.floor(Date.now() / 60_000), timeZone).date;
    const defaultTime = await loadDefaultServiceTime(db, ownerId);
    const { weekly, overrides } = await loadAvailability(db, ownerId, addDays(today, -7));
    return c.json(
      {
        timeZone,
        defaultServiceTime: defaultTime.minuteOfDay,
        defaultServiceTimeIsBuiltIn: defaultTime.builtIn,
        weekly,
        overrides,
      },
      200,
    );
  });
}
