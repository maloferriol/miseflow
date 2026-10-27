import {
  appliedMutations,
  ConflictError,
  getMutator,
  InvalidArgsError,
  type Mutator,
  NotFoundError,
} from "@miseflow/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AuthEnv } from "../auth.ts";
import type { Db } from "../db.ts";
import { errorBody } from "../errors.ts";

const mutationBody = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  args: z.record(z.string(), z.unknown()),
});

type Outcome = "applied" | "replayed" | "conflict";

// POST /mutate: one named mutation {id, name, args}, applied in one transaction, once per id
// (ADR 0007). The id is claimed in `applied_mutations` inside the same transaction, so a
// mutator that throws also releases its claim and a retry can apply it.
export function mutateRoute(
  db: Db,
  registry: Record<string, Mutator<any>>,
  timeZone: string,
  now: () => Date,
) {
  return new Hono<AuthEnv>().post("/", bodyLimit({ maxSize: 64 * 1024 }), async (c) => {
    const body = mutationBody.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) {
      return c.json(errorBody("INVALID_BODY", "Expected {id: uuid, name, args: object}"), 400);
    }
    const { id, name, args } = body.data;

    const mutator = getMutator(name, registry);
    if (!mutator) return c.json(errorBody("UNKNOWN_MUTATION", `Unknown mutation: ${name}`), 400);

    const parsedArgs = mutator.args.safeParse(args);
    if (!parsedArgs.success) {
      return c.json(errorBody("INVALID_ARGS", z.prettifyError(parsedArgs.error)), 400);
    }

    const ownerId = c.get("ownerId");
    let outcome: Outcome;
    try {
      outcome = await db.transaction(async (tx): Promise<Outcome> => {
        const claimed = await tx
          .insert(appliedMutations)
          .values({ id, ownerId, name })
          .onConflictDoNothing({ target: appliedMutations.id })
          .returning({ id: appliedMutations.id });
        if (claimed.length === 0) {
          const [existing] = await tx
            .select({ ownerId: appliedMutations.ownerId })
            .from(appliedMutations)
            .where(eq(appliedMutations.id, id));
          return existing?.ownerId === ownerId ? "replayed" : "conflict";
        }
        await mutator.run(tx, parsedArgs.data, { ownerId, timeZone, now });
        return "applied";
      });
    } catch (error) {
      if (error instanceof NotFoundError) return c.json(errorBody("NOT_FOUND", error.message), 404);
      if (error instanceof ConflictError) return c.json(errorBody("CONFLICT", error.message), 409);
      if (error instanceof InvalidArgsError) {
        return c.json(errorBody("INVALID_ARGS", error.message), 400);
      }
      if (isUniqueViolation(error)) {
        return c.json(errorBody("CONFLICT", "A row with one of these ids already exists"), 409);
      }
      throw error;
    }

    if (outcome === "conflict") {
      return c.json(errorBody("CONFLICT", "This mutation id was already used"), 409);
    }
    return c.json({ ok: true as const, id }, 200);
  });
}

// Postgres unique_violation, e.g. a browser-made row id that is already taken. Drizzle wraps
// the driver's error, so the code sits on the error or on its `cause`.
// Source: https://www.postgresql.org/docs/current/errcodes-appendix.html
function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) => (e as { code?: unknown } | null)?.code;
  return code(error) === "23505" || code((error as { cause?: unknown } | null)?.cause) === "23505";
}
