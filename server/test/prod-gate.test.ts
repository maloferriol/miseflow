import { describe, expect, it } from "vitest";
import { prodStartupRefusal } from "../src/prod-gate.ts";

const url = () => "postgres://user:secret@db.example.com:5432/postgres";

describe("prodStartupRefusal", () => {
  it("lets any non-prod environment start without reading anything", async () => {
    const check = () => Promise.reject(new Error("must not be called"));
    expect(await prodStartupRefusal(undefined, url, check)).toBeUndefined();
    expect(await prodStartupRefusal("dev", url, check)).toBeUndefined();
  });

  it("lets prod start when nothing is pending", async () => {
    expect(await prodStartupRefusal("prod", url, () => Promise.resolve(undefined))).toBeUndefined();
  });

  it("refuses prod with the pending-migrations message", async () => {
    const message = "Prod has 1 migration(s) waiting: 0001_b. Run `npm run db:migrate:prod`.";
    expect(await prodStartupRefusal("prod", url, () => Promise.resolve(message))).toBe(message);
  });

  it("refuses with the error message when the read fails", async () => {
    const check = () =>
      Promise.reject(new Error("Could not read the applied migrations from prod."));
    expect(await prodStartupRefusal("prod", url, check)).toBe(
      "Could not read the applied migrations from prod.",
    );
  });

  it("refuses with a generic message when something other than an Error is thrown", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the non-Error case
    const check = () => Promise.reject("boom");
    expect(await prodStartupRefusal("prod", url, check)).toBe("Could not check prod's migrations.");
  });

  it("refuses when DATABASE_URL is missing", async () => {
    const missing = () => {
      throw new Error("DATABASE_URL is not set");
    };
    expect(await prodStartupRefusal("prod", missing, () => Promise.resolve(undefined))).toBe(
      "DATABASE_URL is not set",
    );
  });

  it("by default reads the real migrations and never prints the connection string", async () => {
    const message = await prodStartupRefusal("prod", () => "postgres://u:secret@127.0.0.1:1/db");
    expect(message).toContain("127.0.0.1:1");
    expect(message).not.toContain("secret");
  });
});
