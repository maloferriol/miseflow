import { describe, expect, it } from "vitest";
import { parseGuests } from "./menu-screen.ts";

describe("parseGuests", () => {
  it("reads a whole number of guests", () => {
    expect(parseGuests("6")).toBe(6);
  });

  it.each(["", "0", "-2", "2.5", "six"])("reads no guest count from %j", (text) => {
    expect(parseGuests(text)).toBeNull();
  });
});
