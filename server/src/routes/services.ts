import { NotFoundError, readPlan } from "@miseflow/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../auth.ts";
import type { Db } from "../db.ts";
import { errorBody } from "../errors.ts";

const serviceIdParam = z.uuid();

// GET /services/:serviceId/plan: the caller's Plan for one live Service, as stored (ADR 0010):
// placed Tasks by day in the kitchen's zone, and Unplaced Tasks with their reasons, derived on read.
// Chained, so the web app's hc<AppType> client gets the response type (Hono RPC).
// Source: https://hono.dev/docs/guides/rpc
export function servicesRoute(db: Db, timeZone: string) {
  return new Hono<AuthEnv>().get("/:serviceId/plan", async (c) => {
    const serviceId = serviceIdParam.safeParse(c.req.param("serviceId"));
    if (!serviceId.success) return c.json(errorBody("NOT_FOUND", "Service not found"), 404);
    try {
      const plan = await readPlan(db, c.get("ownerId"), serviceId.data, timeZone);
      return c.json({ plan }, 200);
    } catch (error) {
      if (error instanceof NotFoundError) return c.json(errorBody("NOT_FOUND", error.message), 404);
      throw error;
    }
  });
}
