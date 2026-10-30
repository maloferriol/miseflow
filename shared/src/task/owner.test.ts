import { describe, expect, it } from "vitest";
import { ownerSchema } from "./owner.ts";

const id = "6f1c2a4e-3b8d-4c7a-9e21-5d0f8a7b6c43";

describe("ownerSchema", () => {
  it("accepts a Dish owner and a Batch owner", () => {
    expect(ownerSchema.parse({ kind: "dish", dishId: id })).toEqual({ kind: "dish", dishId: id });
    expect(ownerSchema.parse({ kind: "batch", batchId: id })).toEqual({
      kind: "batch",
      batchId: id,
    });
  });

  it("rejects an id that isn't a UUID", () => {
    expect(ownerSchema.safeParse({ kind: "dish", dishId: "d1" }).success).toBe(false);
    expect(ownerSchema.safeParse({ kind: "batch", batchId: "b1" }).success).toBe(false);
  });

  it("rejects an extra key", () => {
    expect(ownerSchema.safeParse({ kind: "dish", dishId: id, extra: 1 }).success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(ownerSchema.safeParse({ kind: "service", serviceId: id }).success).toBe(false);
  });

  it("rejects a Dish owner carrying a batchId", () => {
    expect(ownerSchema.safeParse({ kind: "dish", batchId: id }).success).toBe(false);
    expect(ownerSchema.safeParse({ kind: "dish", dishId: id, batchId: id }).success).toBe(false);
  });
});
