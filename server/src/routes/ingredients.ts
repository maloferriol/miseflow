import { loadCatalog, searchCatalog } from "@miseflow/shared";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import type { AuthEnv } from "../auth.ts";
import type { Db } from "../db.ts";
import { errorBody } from "../errors.ts";

const searchQuery = z.object({
  q: z.string().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// GET /ingredients?q=&limit=: the caller's catalog (seed plus their own rows, their overrides
// merged in), searched by name or alias. Matching is the shared, pure `searchCatalog` run over
// the whole visible catalog, which is small (ADR 0002, #82 Decision 1).
// The query validator types `q` and `limit` for hc<AppType>.
// Sources: https://hono.dev/docs/guides/validation, https://hono.dev/docs/guides/rpc
export function ingredientsRoute(db: Db) {
  return new Hono<AuthEnv>().get(
    "/",
    validator("query", (value, c) => {
      const parsed = searchQuery.safeParse(value);
      if (!parsed.success) {
        return c.json(
          errorBody(
            "INVALID_QUERY",
            "Expected q (up to 200 characters) and limit (1 to 50)",
          ),
          400,
        );
      }
      return parsed.data;
    }),
    async (c) => {
      const { q, limit } = c.req.valid("query");
      const catalog = await loadCatalog(db, c.get("ownerId"));
      const results = searchCatalog(catalog, q, limit);
      return c.json(
        {
          ingredients: results.map(({ entry, matchedBy, exact }) => ({
            id: entry.id,
            name: entry.name,
            source: entry.source,
            preferredKind: entry.preferredKind,
            mainUnit: entry.mainUnit,
            shoppingCategory: entry.shoppingCategory,
            aliases: entry.aliases.map((alias) => alias.name).sort(),
            matchedBy,
            exact,
            overridden: entry.overridden,
            overrideId: entry.overrideId,
          })),
        },
        200,
      );
    },
  );
}
