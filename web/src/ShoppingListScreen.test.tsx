import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderQueryHook, renderWired } from "../test/render-view.tsx";
import { fetchShoppingList, mutate, type ShoppingList, type ShoppingRow } from "./api.ts";
import { ShoppingListScreen, useShoppingList, useShoppingRow } from "./ShoppingListScreen.tsx";

vi.mock("./api.ts", () => ({
  fetchShoppingList: vi.fn(),
  mutate: vi.fn(),
}));

const row = (spec: Partial<ShoppingRow> & Pick<ShoppingRow, "ingredientId" | "name">) => ({
  need: null,
  unit: null,
  approximate: false,
  vague: [],
  unconverted: [],
  got: false,
  ...spec,
});

// Rows as the walkthrough's Shopping list holds them (e2e/shopping.spec.ts).
const butter = row({ ingredientId: "i-butter", name: "butter", need: 300, unit: "g" });
const apple = row({ ingredientId: "i-apple", name: "apple", need: 6, unit: "each", got: true });

const list = (rows: ShoppingRow[] = [butter, apple]): ShoppingList => ({
  service: { id: "s-1", menuId: "m-1" },
  categories: [{ id: "c-1", name: "Produce", rows }],
  missing: [],
});

beforeEach(() => {
  vi.mocked(fetchShoppingList).mockReset().mockResolvedValue(list());
  vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

// Any id: the hook makes them.
const anId: unknown = expect.any(String);
const box = (name: string) => screen.getByRole<HTMLInputElement>("checkbox", { name });
const sent = () => vi.mocked(mutate).mock.calls.map(([, name, args]) => ({ name, args }));

// A save that stays in flight until the test rejects it.
function holdMutate() {
  let fail: (error: Error) => void = () => {};
  vi.mocked(mutate).mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
  return (error: Error) => fail(error);
}

describe("Shopping list screen", () => {
  it("loads the Service's list and shows each row as saved", async () => {
    renderWired(<ShoppingListScreen serviceId="s-1" />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(
      (await screen.findByRole<HTMLInputElement>("checkbox", { name: "butter" })).checked,
    ).toBe(false);
    expect(box("apple").checked).toBe(true);
    expect(fetchShoppingList).toHaveBeenCalledWith("s-1");
  });

  it("shows a failed load as an alert", async () => {
    vi.mocked(fetchShoppingList).mockRejectedValue(
      new Error("Could not load the Shopping list (404)"),
    );
    renderWired(<ShoppingListScreen serviceId="s-1" />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not load the Shopping list (404)",
    );
  });

  it("marks a row Got and reloads the list", async () => {
    renderWired(<ShoppingListScreen serviceId="s-1" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "butter" }));
    await waitFor(() => expect(fetchShoppingList).toHaveBeenCalledTimes(2));
    expect(sent()).toEqual([
      {
        name: "markGot",
        args: { markId: anId, serviceId: "s-1", ingredientId: "i-butter" },
      },
    ]);
  });

  it("un-marks a Got row and reloads the list", async () => {
    renderWired(<ShoppingListScreen serviceId="s-1" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "apple" }));
    await waitFor(() => expect(fetchShoppingList).toHaveBeenCalledTimes(2));
    expect(sent()).toEqual([
      { name: "unmarkGot", args: { serviceId: "s-1", ingredientId: "i-apple" } },
    ]);
  });

  it("shows the tick while it saves, then the saved state and the error when it fails", async () => {
    const fail = holdMutate();
    renderWired(<ShoppingListScreen serviceId="s-1" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "butter" }));
    expect(box("butter").checked).toBe(true);

    act(() => fail(new Error("Could not save (500)")));
    expect((await screen.findByRole("alert")).textContent).toBe(" Could not save (500)");
    expect(box("butter").checked).toBe(false);
    expect(fetchShoppingList).toHaveBeenCalledTimes(1);
  });

  it("replays the same mutation when the cook ticks again after a failure", async () => {
    const fail = holdMutate();
    renderWired(<ShoppingListScreen serviceId="s-1" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "butter" }));
    act(() => fail(new Error("Could not save (500)")));
    await screen.findByRole("alert");

    fireEvent.click(box("butter"));
    await waitFor(() => expect(fetchShoppingList).toHaveBeenCalledTimes(2));
    const [failed, retried] = vi.mocked(mutate).mock.calls;
    expect(retried).toEqual(failed);
  });

  it("prints the list", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderWired(<ShoppingListScreen serviceId="s-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledOnce();
  });
});

describe("Shopping list hook", () => {
  it("returns the Service's list", async () => {
    const hook = renderQueryHook(() => useShoppingList("s-1"));
    await waitFor(() => expect(hook.result.current.list.data).toEqual(list()));
    expect(fetchShoppingList).toHaveBeenCalledWith("s-1");
  });
});

describe("Shopping row hook", () => {
  const key = ["shopping-list", "s-1"];

  function renderRow(r: ShoppingRow) {
    const hook = renderQueryHook(() => useShoppingRow("s-1", r));
    hook.client.setQueryData(key, list());
    return hook;
  }

  it("shows the saved state before any tick", () => {
    expect(renderRow(butter).result.current.checked).toBe(false);
    expect(renderRow(apple).result.current.checked).toBe(true);
  });

  it("sends markGot for a tick and invalidates the Service's list", async () => {
    const hook = renderRow(butter);
    act(() => hook.result.current.onTick(true));
    await waitFor(() => expect(hook.client.getQueryState(key)?.isInvalidated).toBe(true));
    expect(sent()).toEqual([
      {
        name: "markGot",
        args: { markId: anId, serviceId: "s-1", ingredientId: "i-butter" },
      },
    ]);
    expect(hook.result.current.tickError).toBeNull();
  });

  it("sends unmarkGot for an un-tick and invalidates the Service's list", async () => {
    const hook = renderRow(apple);
    act(() => hook.result.current.onTick(false));
    await waitFor(() => expect(hook.client.getQueryState(key)?.isInvalidated).toBe(true));
    expect(sent()).toEqual([
      { name: "unmarkGot", args: { serviceId: "s-1", ingredientId: "i-apple" } },
    ]);
  });

  it("holds the intended state until the save settles, then returns the error", async () => {
    const fail = holdMutate();
    const hook = renderRow(butter);
    act(() => hook.result.current.onTick(true));
    expect(hook.result.current.checked).toBe(true);

    act(() => fail(new Error("Could not save (500)")));
    await waitFor(() =>
      expect(hook.result.current.tickError?.message).toBe("Could not save (500)"),
    );
    expect(hook.result.current.checked).toBe(false);
    expect(hook.client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("starts fresh ids for the next tick once one has saved", async () => {
    const hook = renderRow(butter);
    act(() => hook.result.current.onTick(true));
    await waitFor(() => expect(hook.client.getQueryState(key)?.isInvalidated).toBe(true));
    act(() => hook.result.current.onTick(true));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(mutate).mock.calls;
    expect(second[0]).not.toBe(first[0]);
  });
});
