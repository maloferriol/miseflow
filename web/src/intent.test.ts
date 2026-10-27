import { describe, expect, it } from "vitest";
import { createIntent } from "./intent.ts";

describe("createIntent", () => {
  it("gives a retry with the same key the same ids, one per name", () => {
    const intent = createIntent();
    const first = [intent.id("save A", "mutation"), intent.id("save A", "revision")];

    expect([intent.id("save A", "mutation"), intent.id("save A", "revision")]).toEqual(first);
    expect(first[0]).not.toBe(first[1]);
  });

  it("starts fresh ids for a different key, and after reset", () => {
    const intent = createIntent();
    const first = intent.id("save A", "mutation");

    const other = intent.id("save B", "mutation");
    expect(other).not.toBe(first);
    intent.reset();
    expect(intent.id("save B", "mutation")).not.toBe(other);
  });
});
