import { describe, expect, it, vi } from "vitest";
import { toAction } from "./action.ts";

describe("toAction", () => {
  it("passes a mutation's pending state and error through", () => {
    const error = new Error("Could not save (500)");
    const action = toAction({ isPending: true, error, mutate: vi.fn() });
    expect(action.pending).toBe(true);
    expect(action.error).toBe(error);
  });

  it("runs the mutation with the args it is given", () => {
    const mutate = vi.fn();
    toAction<string>({ isPending: false, error: null, mutate }).run("Velouté");
    expect(mutate).toHaveBeenCalledExactlyOnceWith("Velouté");
  });
});
