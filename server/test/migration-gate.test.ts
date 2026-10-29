import { describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  pendingMigrations,
  projectRef,
  prodMigrationDecision,
  prodStartupProblem,
  readAppliedMigrations,
  readAvailableMigrations,
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
