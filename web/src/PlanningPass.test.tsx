import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planningRecipe } from "../test/planning-recipe.ts";
import { renderQueryHook, renderWired } from "../test/render-view.tsx";
import { mutate } from "./api.ts";
import { PlanningPass, usePlanningPass } from "./PlanningPass.tsx";

// The network boundary only: the hook's mutations run through a real QueryClient.
vi.mock("./api.ts", () => ({ mutate: vi.fn() }));

// Any made-up id: the hook makes ids with crypto.randomUUID.
const anId: unknown = expect.any(String);

// ADR 0004's chicken stock: "made 3 days ahead and keeps 4".
const stockWindow = { beforeDays: 3, shelfLifeDays: 4 };

const roast = { id: "s-roast", text: "Roast the bones" };
const simmer = { id: "s-simmer", text: "Simmer for four hours" };
const strain = { id: "s-strain", text: "Strain and cool" };
const stock = planningRecipe({
  steps: [roast, simmer, strain],
  dependencies: [{ id: "d-1", beforeStepId: "s-roast", afterStepId: "s-strain" }],
});

beforeEach(() => {
  vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
});

// The calls sent with this mutation name: [mutation id, args].
const sentAll = (name: string) =>
  vi
    .mocked(mutate)
    .mock.calls.filter((call) => call[1] === name)
    .map((call) => ({ id: call[0], args: call[2] }));
const sent = (name: string) => sentAll(name)[0]?.args;

// Saves that stay pending until the test fails or settles them, one per call.
function holdSaves() {
  const held: { fail: (error: Error) => void; done: () => void }[] = [];
  vi.mocked(mutate).mockImplementation(
    () =>
      new Promise<void>((resolve, reject) => {
        held.push({ fail: reject, done: resolve });
      }),
  );
  return held;
}

function renderPass() {
  const hook = renderQueryHook(() => usePlanningPass(stock));
  // A cached Recipe read and another Recipe's, to see what a save invalidates.
  hook.client.setQueryData(["recipe", "r-stock"], stock);
  hook.client.setQueryData(["recipe", "r-other"], {});
  const invalidated = (id: string) => hook.client.getQueryState(["recipe", id])?.isInvalidated;
  return { ...hook, invalidated };
}

describe("Planning pass hook", () => {
  it("opens with nothing pending and no error", () => {
    const { result } = renderPass();
    expect(result.current).toMatchObject({ windowPending: false, error: null });
  });

  it("sets a Step's times, then refetches this Recipe only", async () => {
    const { result, invalidated } = renderPass();
    act(() => result.current.onStepTimes("s-roast", { activeMinutes: 20, passiveMinutes: null }));
    await waitFor(() => expect(invalidated("r-stock")).toBe(true));
    expect(sentAll("setStepTimes")).toEqual([
      {
        id: anId,
        args: { revisionId: anId, stepId: "s-roast", activeMinutes: 20, passiveMinutes: null },
      },
    ]);
    expect(invalidated("r-other")).toBe(false);
  });

  it("sets and clears the Recipe's window, then refetches the Recipe", async () => {
    const { result, invalidated } = renderPass();
    act(() => result.current.onRecipeWindow(stockWindow));
    await waitFor(() => expect(invalidated("r-stock")).toBe(true));
    act(() => result.current.onRecipeWindow(null));
    await waitFor(() => expect(sentAll("setMakeAhead")).toHaveLength(2));
    expect(sentAll("setMakeAhead").map((s) => s.args)).toEqual([
      { revisionId: anId, target: { kind: "recipe", recipeId: "r-stock" }, window: stockWindow },
      { revisionId: anId, target: { kind: "recipe", recipeId: "r-stock" }, window: null },
    ]);
  });

  it("sets and clears a Step's own window, then refetches the Recipe", async () => {
    const { result, invalidated } = renderPass();
    act(() => result.current.onStepWindow("s-roast", stockWindow));
    await waitFor(() => expect(invalidated("r-stock")).toBe(true));
    act(() => result.current.onStepWindow("s-roast", null));
    await waitFor(() => expect(sentAll("setMakeAhead")).toHaveLength(2));
    expect(sentAll("setMakeAhead").map((s) => s.args)).toEqual([
      { revisionId: anId, target: { kind: "step", stepId: "s-roast" }, window: stockWindow },
      { revisionId: anId, target: { kind: "step", stepId: "s-roast" }, window: null },
    ]);
  });

  it("groups a Step with the previous one, then refetches the Recipe", async () => {
    const { result, invalidated } = renderPass();
    act(() => result.current.onGroup("s-simmer", true));
    await waitFor(() => expect(invalidated("r-stock")).toBe(true));
    expect(sent("setGroupWithPrevious")).toEqual({
      revisionId: anId,
      stepId: "s-simmer",
      value: true,
    });
  });

  it("makes a Step wait for another, then refetches the Recipe", async () => {
    const { result, invalidated } = renderPass();
    act(() => result.current.onAddLink("s-strain", "s-simmer"));
    await waitFor(() => expect(invalidated("r-stock")).toBe(true));
    expect(sent("addStepDependency")).toEqual({
      revisionId: anId,
      dependencyId: anId,
      beforeStepId: "s-simmer",
      afterStepId: "s-strain",
    });
  });

  it("removes a link by its id, then refetches the Recipe", async () => {
    const { result, invalidated } = renderPass();
    act(() => result.current.onRemoveLink("d-1"));
    await waitFor(() => expect(invalidated("r-stock")).toBe(true));
    expect(sent("removeStepDependency")).toEqual({ revisionId: anId, dependencyId: "d-1" });
  });

  it("returns a window save as pending, from the Recipe or a Step", async () => {
    const held = holdSaves();
    const { result } = renderPass();
    act(() => result.current.onStepWindow("s-roast", stockWindow));
    await waitFor(() => expect(result.current.windowPending).toBe(true));
    act(() => held[0].done());
    await waitFor(() => expect(result.current.windowPending).toBe(false));

    act(() => result.current.onRecipeWindow(stockWindow));
    await waitFor(() => expect(result.current.windowPending).toBe(true));
  });

  it("doesn't return a times save as a pending window", async () => {
    holdSaves();
    const { result } = renderPass();
    act(() => result.current.onStepTimes("s-roast", { activeMinutes: 20, passiveMinutes: 60 }));
    await waitFor(() => expect(vi.mocked(mutate)).toHaveBeenCalledOnce());
    expect(result.current.windowPending).toBe(false);
  });

  it("returns a failed save's error, without refetching the Recipe", async () => {
    const held = holdSaves();
    const { result, invalidated } = renderPass();
    act(() => result.current.onRemoveLink("d-1"));
    await waitFor(() => expect(held).toHaveLength(1));
    act(() => held[0].fail(new Error("Could not save (409)")));
    await waitFor(() => expect(result.current.error).toEqual(new Error("Could not save (409)")));
    expect(invalidated("r-stock")).toBe(false);
  });

  it("returns the times save's error before a later mutation's", async () => {
    const held = holdSaves();
    const { result } = renderPass();
    act(() => result.current.onGroup("s-simmer", true));
    act(() => result.current.onStepTimes("s-roast", { activeMinutes: 20, passiveMinutes: 60 }));
    await waitFor(() => expect(held).toHaveLength(2));
    act(() => held[0].fail(new Error("Could not group (500)")));
    await waitFor(() => expect(result.current.error).toEqual(new Error("Could not group (500)")));
    act(() => held[1].fail(new Error("Could not set times (500)")));
    await waitFor(() =>
      expect(result.current.error).toEqual(new Error("Could not set times (500)")),
    );
  });

  it("retries a failed save with the same ids, and starts new ids once it succeeds", async () => {
    vi.mocked(mutate).mockRejectedValueOnce(new Error("Network error"));
    const { result } = renderPass();
    const times = { activeMinutes: 20, passiveMinutes: 60 };
    act(() => result.current.onStepTimes("s-roast", times));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    act(() => result.current.onStepTimes("s-roast", times));
    await waitFor(() => expect(result.current.error).toBeNull());
    act(() => result.current.onStepTimes("s-roast", times));
    await waitFor(() => expect(sentAll("setStepTimes")).toHaveLength(3));

    const [failed, retry, again] = sentAll("setStepTimes");
    expect(retry).toEqual(failed);
    expect(again.id).not.toBe(failed.id);
    expect(again.args.revisionId).not.toBe(failed.args.revisionId);
  });
});

// The Planning pass's rows, not the links listed inside them.
const rows = () => {
  const list = screen.getByRole("list", { name: "Planning" });
  return within(list)
    .getAllByRole("listitem")
    .filter((item) => item.parentElement === list);
};
const row = (index: number) => within(rows()[index]);

describe("Planning pass", () => {
  function renderScreen(recipe = stock) {
    const wired = renderWired(<PlanningPass recipe={recipe} />);
    wired.client.setQueryData(["recipe", recipe.id], recipe);
    const invalidated = () => wired.client.getQueryState(["recipe", recipe.id])?.isInvalidated;
    return { ...wired, invalidated };
  }

  it("saves a Step's times typed in its row, then refetches the Recipe", async () => {
    const { invalidated } = renderScreen();
    fireEvent.change(row(1).getByLabelText("Active minutes"), { target: { value: "5" } });
    fireEvent.change(row(1).getByLabelText("Passive minutes"), { target: { value: "240" } });
    fireEvent.click(row(1).getByRole("button", { name: "Save times" }));
    await waitFor(() => expect(invalidated()).toBe(true));
    expect(sent("setStepTimes")).toEqual({
      revisionId: anId,
      stepId: "s-simmer",
      activeMinutes: 5,
      passiveMinutes: 240,
    });
  });

  it("saves the Recipe's window, and turns its buttons off while it saves", async () => {
    const held = holdSaves();
    renderScreen();
    fireEvent.change(screen.getAllByLabelText("Days ahead")[0], { target: { value: "3" } });
    fireEvent.change(screen.getAllByLabelText("Shelf life (days)")[0], { target: { value: "4" } });
    const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save window" });
    fireEvent.click(save);
    await waitFor(() => expect(save.disabled).toBe(true));
    expect(sent("setMakeAhead")).toEqual({
      revisionId: anId,
      target: { kind: "recipe", recipeId: "r-stock" },
      window: stockWindow,
    });
    act(() => held[0].done());
    await waitFor(() => expect(save.disabled).toBe(false));
  });

  it("clears the Recipe's window", async () => {
    const { invalidated } = renderScreen(
      planningRecipe({ makeAhead: stockWindow, steps: [roast] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(invalidated()).toBe(true));
    expect(sent("setMakeAhead")).toEqual({
      revisionId: anId,
      target: { kind: "recipe", recipeId: "r-stock" },
      window: null,
    });
  });

  it("saves a Step's own window, turning the Recipe's Save window off while it saves", async () => {
    holdSaves();
    renderScreen();
    fireEvent.click(row(0).getByRole("checkbox", { name: "Own make-ahead window" }));
    fireEvent.change(row(0).getByLabelText("Days ahead"), { target: { value: "3" } });
    fireEvent.change(row(0).getByLabelText("Shelf life (days)"), { target: { value: "4" } });
    fireEvent.click(row(0).getByRole("button", { name: "Save" }));
    const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save window" });
    await waitFor(() => expect(save.disabled).toBe(true));
    expect(sent("setMakeAhead")).toEqual({
      revisionId: anId,
      target: { kind: "step", stepId: "s-roast" },
      window: stockWindow,
    });
  });

  it("clears a Step's saved window when it is unticked", async () => {
    const { invalidated } = renderScreen(
      planningRecipe({
        makeAhead: stockWindow,
        steps: [{ ...roast, makeAhead: { beforeDays: 1, shelfLifeDays: 2 } }],
      }),
    );
    fireEvent.click(row(0).getByRole("checkbox", { name: "Own make-ahead window" }));
    await waitFor(() => expect(invalidated()).toBe(true));
    expect(sent("setMakeAhead")).toEqual({
      revisionId: anId,
      target: { kind: "step", stepId: "s-roast" },
      window: null,
    });
  });

  it("groups a Step with the previous one", async () => {
    const { invalidated } = renderScreen();
    fireEvent.click(row(2).getByRole("checkbox", { name: "Group with previous Step" }));
    await waitFor(() => expect(invalidated()).toBe(true));
    expect(sent("setGroupWithPrevious")).toEqual({
      revisionId: anId,
      stepId: "s-strain",
      value: true,
    });
  });

  it("adds the link chosen in a Step's row", async () => {
    const { invalidated } = renderScreen();
    fireEvent.change(row(1).getByRole("combobox", { name: "Waits for" }), {
      target: { value: "s-roast" },
    });
    fireEvent.click(row(1).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(invalidated()).toBe(true));
    expect(sent("addStepDependency")).toEqual({
      revisionId: anId,
      dependencyId: anId,
      beforeStepId: "s-roast",
      afterStepId: "s-simmer",
    });
  });

  it("removes a link, and shows the error when the save fails", async () => {
    vi.mocked(mutate).mockRejectedValue(new Error("Could not remove the link (409)"));
    renderScreen();
    const waits = within(row(2).getByRole("list", { name: "Waits for" }));
    fireEvent.click(waits.getByRole("button", { name: "Remove" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not remove the link (409)");
    expect(sent("removeStepDependency")).toEqual({ revisionId: anId, dependencyId: "d-1" });
  });
});
