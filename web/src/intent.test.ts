import { describe, expect, it } from "vitest";
import { createIntent, retryable } from "./intent.ts";

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

describe("retryable", () => {
  it("reuses the ids for a retry of the same args, and starts fresh after a success", async () => {
    const sent: string[] = [];
    let lose = true;
    const edit = retryable(createIntent(), (args: { name: string }, id) => {
      sent.push(`${id("mutation")} ${args.name}`);
      if (!lose) return Promise.resolve();
      lose = false;
      return Promise.reject(new Error("Failed to fetch"));
    });

    await expect(edit({ name: "Sauce" })).rejects.toThrow();
    await edit({ name: "Sauce" });
    await edit({ name: "Sauce" });

    expect(sent[1]).toBe(sent[0]);
    expect(sent[2]).not.toBe(sent[1]);
  });

  it("gives different args different ids", async () => {
    const ids: string[] = [];
    const edit = retryable(createIntent(), (_: { name: string }, id) => {
      ids.push(id("mutation"));
      return Promise.reject(new Error("Failed to fetch"));
    });

    await expect(edit({ name: "Sauce" })).rejects.toThrow();
    await expect(edit({ name: "Gravy" })).rejects.toThrow();

    expect(ids[1]).not.toBe(ids[0]);
  });
});
