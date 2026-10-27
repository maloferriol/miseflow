import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { z } from "zod";

// A Drizzle transaction (or database). Mutators are server-only for the MVP: ADR 0007 also
// wants them to run optimistically in the browser, which needs a store interface later.
export type Tx = PgDatabase<PgQueryResultHKT>;

export type MutatorContext = {
  /** The signed-in user's id (the token's `sub`), stamped on every row written. */
  ownerId: string;
  /** The kitchen's IANA time zone (KITCHEN_TIME_ZONE), for Service times and Availability. */
  timeZone: string;
  /** The server's clock, injected so no mutator reads the wall clock (#88): stamps Step events. */
  now: () => Date;
};

export type Mutator<Args = unknown> = {
  name: string;
  args: z.ZodType<Args>;
  run(tx: Tx, args: Args, ctx: MutatorContext): Promise<void>;
};

// Any mutator, whatever its Args: what a registry keyed by name holds. Callers parse args with
// the mutator's own schema before `run`. `any`, because `run` takes Args, so an `unknown` or
// `never` Args would reject either the registry's entries or the parsed args.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMutator = Mutator<any>;

// Infers the args type from the schema, so `run` gets the parsed, typed args.
export function defineMutator<Args>(mutator: Mutator<Args>): Mutator<Args> {
  return mutator;
}

/** A referenced row is missing, deleted, or belongs to another owner. */
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** The write would duplicate something the kitchen already has, such as an Ingredient's name. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Args that parse but don't fit the rows they refer to, such as a unit of the wrong kind. */
export class InvalidArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArgsError";
  }
}
