import { describe, expect, it } from "vitest";
import { signInFailureMessage } from "./sign-in.ts";

describe("signInFailureMessage", () => {
  it("names what went wrong when the request fails", () => {
    expect(signInFailureMessage(new TypeError("Failed to fetch"))).toBe(
      "Could not sign in (Failed to fetch)",
    );
  });

  it("reads a rejection that isn't an Error", () => {
    expect(signInFailureMessage("offline")).toBe("Could not sign in (offline)");
  });
});
