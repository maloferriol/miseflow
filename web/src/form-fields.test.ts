import { describe, expect, it } from "vitest";
import { fieldText, trimmedOrNull } from "./form-fields.ts";

describe("fieldText", () => {
  it("is the field's text", () => {
    const form = new FormData();
    form.set("name", " Velouté ");
    expect(fieldText(form, "name")).toBe(" Velouté ");
  });

  it("is empty when the field is missing or holds a file", () => {
    const form = new FormData();
    form.set("photo", new File(["x"], "photo.jpg"));
    expect(fieldText(form, "name")).toBe("");
    expect(fieldText(form, "photo")).toBe("");
  });
});

describe("trimmedOrNull", () => {
  it("trims what the cook typed", () => {
    expect(trimmedOrNull(" shallot  ")).toBe("shallot");
    expect(trimmedOrNull("  1.5 L ")).toBe("1.5 L");
  });

  it("is null for blank text", () => {
    expect(trimmedOrNull("")).toBeNull();
    expect(trimmedOrNull(" \t ")).toBeNull();
  });
});
