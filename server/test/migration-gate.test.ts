import { describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  pendingMigrations,
  projectRef,
  prodMigrationDecision,
  prodStartupCheck,
  prodStartupProblem,
  readAppliedMigrations,
  readAvailableMigrations,
  withMigrationSql,
} from "../../scripts/migration-gate.ts";

const available = [
  { tag: "0000_a", when: 100 },
  { tag: "0001_b", when: 200 },
  { tag: "0002_c", when: 300 },
];

// `npm run db:migrate:prod` and the prod server start decide with these; the scripts only gather facts.
describe("pendingMigrations", () => {
  it("lists the names of migrations newer than the last applied one", () => {
    expect(pendingMigrations(available, [100, 200])).toEqual(["0002_c"]);
    expect(pendingMigrations(available, [])).toEqual(["0000_a", "0001_b", "0002_c"]);
  });

  it("reports nothing when every migration is applied", () => {
    expect(pendingMigrations(available, [100, 200, 300])).toEqual([]);
  });
});

describe("projectRef", () => {
  it("is the first label of the Supabase host, without credentials or path", () => {
    expect(projectRef("https://abcdefgh.supabase.co/auth/v1")).toBe("abcdefgh");
  });

  it("falls back to the host for a URL that is not a Supabase project", () => {
    expect(projectRef("http://127.0.0.1:54321")).toBe("127.0.0.1");
  });

  it("names a URL that does not parse without echoing it", () => {
    expect(projectRef("not a url")).toBe("an unparseable URL");
  });
});

describe("prodMigrationDecision", () => {
  const base = { ref: "abcdefgh", pending: ["0003_d", "0004_e"] };

  it("does nothing when nothing is pending, even if a ref was typed", () => {
    expect(prodMigrationDecision({ ref: base.ref, pending: [], typed: "abcdefgh" })).toEqual({
      action: "nothing-to-do",
    });
  });

  it("needs confirmation when migrations wait and nothing was typed", () => {
    expect(prodMigrationDecision(base)).toEqual({ action: "confirm" });
  });

  it("is confirmed when the typed ref matches (surrounding whitespace ignored)", () => {
    expect(prodMigrationDecision({ ...base, typed: " abcdefgh\n" })).toEqual({
      action: "confirmed",
    });
  });

  it("is refused when the typed ref does not match", () => {
    expect(prodMigrationDecision({ ...base, typed: "yes" })).toEqual({ action: "refused" });
  });
});

describe("prodStartupProblem", () => {
  it("is undefined when nothing is pending", () => {
    expect(prodStartupProblem([])).toBeUndefined();
  });

  it("names the pending migrations and the fix", () => {
    expect(prodStartupProblem(["0003_d"])).toMatch(/0003_d.*npm run db:migrate:prod/);
  });
});

describe("readAvailableMigrations", () => {
  it("reads the drizzle journal of the repo", () => {
    const migrations = readAvailableMigrations();
    expect(migrations[0]).toEqual({
      tag: expect.stringMatching(/^0000_/),
      when: expect.any(Number),
    });
  });
});

describe("against the local stack", () => {
  it("reports nothing pending for a fully migrated database", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      const applied = await readAppliedMigrations(sql);
      expect(pendingMigrations(readAvailableMigrations(), applied)).toEqual([]);
    } finally {
      await sql.end();
    }
  });
});

describe("prodStartupCheck", () => {
  const sqlWith = (createdAt: number[]) => () =>
    Promise.resolve(createdAt.map((n) => ({ created_at: n })));

  it("refuses while a migration is waiting, naming the fix", async () => {
    const problem = await prodStartupCheck(sqlWith([100]), available);
    expect(problem).toMatch(/0001_b, 0002_c.*npm run db:migrate:prod/);
  });

  it("allows the start when every migration is applied", async () => {
    expect(await prodStartupCheck(sqlWith([100, 200, 300]), available)).toBeUndefined();
  });

  it("does not echo a database password from a failed query", async () => {
    const failing = () => Promise.reject(new Error("connect postgres://u:secretpw@host/db failed"));
    const error = await prodStartupCheck(failing, available).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/Could not read/);
    expect((error as Error).message).not.toContain("secretpw");
  });
});

describe("withMigrationSql", () => {
  const url = "postgres://postgres:secretpw@db.abcdefgh.supabase.co:5432/postgres";

  it("hands the work a client and returns its result", async () => {
    // Nothing connects until a query runs, so a reachable server is not needed.
    expect(await withMigrationSql(url, () => Promise.resolve(42))).toBe(42);
  });

  it("names only the host when the work fails, never the driver message or password", async () => {
    const failing = () => Promise.reject(new Error(`connect ${url} failed: password secretpw`));
    const error = await withMigrationSql(url, failing).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const message = error.message;
    expect(message).toContain("db.abcdefgh.supabase.co");
    expect(message).not.toContain("secretpw");
    expect(message).not.toContain("postgres://");
  });

  it("does not echo an unparseable URL", async () => {
    const error = await withMigrationSql("not a url secretpw", () => Promise.resolve(1)).catch(
      (e: Error) => e,
    );
    // Either it works lazily or it fails safely; a failure must not carry the text.
    if (error instanceof Error) expect(error.message).not.toContain("secretpw");
  });
});
