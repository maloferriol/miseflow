import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderQueryHook, renderWired } from "../test/render-view.tsx";
import {
  type Availability,
  fetchAvailability,
  fetchMenu,
  fetchMenus,
  type Menu,
  mutate,
} from "./api.ts";
import {
  MenuScreen,
  useCourse,
  useDishScale,
  useMenu,
  useMenuList,
  useNewMenu,
  useServiceForm,
} from "./MenuScreen.tsx";
import { minuteOfDay } from "./time-of-day.ts";

// The network boundary only: the hooks' queries and mutations run through a real QueryClient.
vi.mock("./api.ts", () => ({
  fetchAvailability: vi.fn(),
  fetchMenu: vi.fn(),
  fetchMenus: vi.fn(),
  mutate: vi.fn(),
}));

// Any made-up id: the hooks make ids with crypto.randomUUID.
const anId: unknown = expect.any(String);

type Course = Menu["courses"][number];
type Dish = Course["dishes"][number];

// ADR 0004's Saturday dinner for 6, before it has a Course, a Service or a Batch.
const saturdayDinner: Menu = {
  id: "m-dinner",
  name: "Saturday dinner",
  guestCount: 6,
  batches: [],
  service: null,
  courses: [],
};

// ADR 0004's Service: Saturday at 19:30.
const saturday = { id: "s-saturday", date: "2026-10-31", time: minuteOfDay("19:30") };

// A Dish before the Menu has a scale for it: the server's assumed factor of 1.
const velouté: Dish = {
  id: "d-veloute",
  position: "a0",
  recipe: { id: "r-veloute", name: "Velouté" },
  scale: { factor: 1, source: "assumed" },
  fixes: [],
};
const starter: Course = { id: "c-starter", name: "Starter", position: "a0", dishes: [velouté] };

const availability: Availability = {
  timeZone: "Europe/Paris",
  defaultServiceTime: 19 * 60,
  defaultServiceTimeIsBuiltIn: true,
  weekly: [],
  overrides: [],
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.mocked(fetchMenus).mockReset().mockResolvedValue([]);
  vi.mocked(fetchMenu).mockReset().mockResolvedValue(saturdayDinner);
  vi.mocked(fetchAvailability).mockReset().mockResolvedValue(availability);
  vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
});

// The args of the mutation sent with this name.
const sent = (name: string) => vi.mocked(mutate).mock.calls.find((call) => call[1] === name)?.[2];

// A save that stays pending until the test fails it.
function failLater() {
  let fail: (error: Error) => void = () => {};
  vi.mocked(mutate).mockReturnValue(new Promise((_, reject) => (fail = reject)));
  return (error: Error) => act(() => fail(error));
}

// The saved Menus: Saturday dinner alone.
const menus = [{ id: "m-dinner", name: "Saturday dinner", guestCount: 6 }];

describe("Menu list hook", () => {
  it("returns the saved Menus it fetched", async () => {
    vi.mocked(fetchMenus).mockResolvedValue(menus);
    const { result } = renderQueryHook(() => useMenuList());
    await waitFor(() => expect(result.current.menus.data).toEqual(menus));
  });
});

describe("New Menu hook", () => {
  it("creates the Menu, then puts it in the URL and opens it", async () => {
    const onCreated = vi.fn();
    const { result } = renderQueryHook(() => useNewMenu(onCreated));

    act(() => result.current.onCreate({ name: "Saturday dinner", guestCount: 6 }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    const args = sent("createMenu");
    expect(args).toEqual({ menuId: anId, name: "Saturday dinner", guestCount: 6 });
    expect(onCreated).toHaveBeenCalledWith(args?.menuId);
    expect(window.location.search).toBe(`?menu=${String(args?.menuId)}`);
  });

  it("returns the create as pending, then its error, without opening a Menu", async () => {
    const fail = failLater();
    const onCreated = vi.fn();
    const { result } = renderQueryHook(() => useNewMenu(onCreated));

    act(() => result.current.onCreate({ name: "Saturday dinner", guestCount: 6 }));
    await waitFor(() => expect(result.current.createPending).toBe(true));
    fail(new Error("Could not create the Menu (500)"));
    await waitFor(() =>
      expect(result.current.createError).toEqual(new Error("Could not create the Menu (500)")),
    );
    expect(result.current.createPending).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });
});

describe("Menu hook", () => {
  const renderMenu = () => renderQueryHook(() => useMenu("m-dinner"));

  it("returns the Menu it fetched by its id", async () => {
    const { result } = renderMenu();
    await waitFor(() => expect(result.current.menu.data).toEqual(saturdayDinner));
    expect(fetchMenu).toHaveBeenCalledWith("m-dinner");
    expect(result.current).toMatchObject({ addCoursePending: false, addCourseError: null });
  });

  it("adds a Course to this Menu, then refetches the Menu", async () => {
    const { result } = renderMenu();
    await waitFor(() => expect(result.current.menu.status).toBe("success"));

    // The Menu is on screen, so invalidating it refetches it at once.
    act(() => result.current.onAddCourse("Starter"));
    await waitFor(() => expect(fetchMenu).toHaveBeenCalledTimes(2));
    expect(sent("addCourse")).toEqual({ courseId: anId, menuId: "m-dinner", name: "Starter" });
  });

  it("refetches the Menu when a part of it changed", async () => {
    const { result } = renderMenu();
    await waitFor(() => expect(result.current.menu.status).toBe("success"));

    act(() => void result.current.onChanged());
    await waitFor(() => expect(fetchMenu).toHaveBeenCalledTimes(2));
  });

  it("returns an add as pending, then its error", async () => {
    const fail = failLater();
    const { result } = renderMenu();

    act(() => result.current.onAddCourse("Starter"));
    await waitFor(() => expect(result.current.addCoursePending).toBe(true));
    fail(new Error("Could not add the Course (500)"));
    await waitFor(() =>
      expect(result.current.addCourseError).toEqual(new Error("Could not add the Course (500)")),
    );
    expect(result.current.addCoursePending).toBe(false);
  });
});

describe("Course hook", () => {
  it("adds a Dish as a new Recipe placed in this Course, then reports the change", async () => {
    const onChanged = vi.fn(() => Promise.resolve());
    const { result } = renderQueryHook(() => useCourse(starter, onChanged));

    act(() => result.current.onAddDish("Velouté"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    const recipe = sent("createRecipe");
    expect(recipe).toEqual({ recipeId: anId, revisionId: anId, name: "Velouté" });
    expect(sent("addDish")).toEqual({
      dishId: anId,
      courseId: "c-starter",
      recipeId: recipe?.recipeId,
    });
    expect(vi.mocked(mutate).mock.calls.map((call) => call[1])).toEqual([
      "createRecipe",
      "addDish",
    ]);
  });

  it("returns an add as pending, then its error, without reporting a change", async () => {
    const fail = failLater();
    const onChanged = vi.fn(() => Promise.resolve());
    const { result } = renderQueryHook(() => useCourse(starter, onChanged));

    act(() => result.current.onAddDish("Velouté"));
    await waitFor(() => expect(result.current.addDishPending).toBe(true));
    fail(new Error("Could not add the Dish (500)"));
    await waitFor(() =>
      expect(result.current.addDishError).toEqual(new Error("Could not add the Dish (500)")),
    );
    expect(result.current.addDishPending).toBe(false);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("Dish scale hook", () => {
  function renderDishScale() {
    const onChanged = vi.fn(() => Promise.resolve());
    const hook = renderQueryHook(() => useDishScale("d-veloute", onChanged));
    // A cached Plan, to see what a save invalidates.
    hook.client.setQueryData(["plan", "s-saturday"], {});
    return { onChanged, ...hook };
  }

  it("sets the Dish's scale, then reports the change and refetches the Plan", async () => {
    const { result, client, onChanged } = renderDishScale();

    act(() => result.current.onSave({ kind: "portions", portions: 8 }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(sent("setDishScale")).toEqual({
      dishId: "d-veloute",
      scale: { kind: "portions", portions: 8 },
    });
    expect(client.getQueryState(["plan", "s-saturday"])?.isInvalidated).toBe(true);
  });

  it("retries a failed save with the same mutation id, and a later save with a fresh one", async () => {
    vi.mocked(mutate).mockRejectedValueOnce(new Error("Could not set the scale (500)"));
    const { result, onChanged } = renderDishScale();
    const save = () => act(() => result.current.onSave({ kind: "factor", factor: 1.5 }));

    save();
    await waitFor(() =>
      expect(result.current.saveError).toEqual(new Error("Could not set the scale (500)")),
    );
    save();
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    save();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    const [failed, retried, later] = vi.mocked(mutate).mock.calls.map((call) => call[0]);
    expect(retried).toBe(failed);
    expect(later).not.toBe(failed);
  });

  it("returns the save as pending, then its error", async () => {
    const fail = failLater();
    const { result, onChanged } = renderDishScale();

    act(() => result.current.onSave({ kind: "guests" }));
    await waitFor(() => expect(result.current.savePending).toBe(true));
    fail(new Error("Could not set the scale (500)"));
    await waitFor(() =>
      expect(result.current.saveError).toEqual(new Error("Could not set the scale (500)")),
    );
    expect(result.current.savePending).toBe(false);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("Service form hook", () => {
  function renderServiceForm(service: Menu["service"]) {
    const hook = renderQueryHook(() => useServiceForm("m-dinner", service));
    // A cached Menu and Plan, to see what a save invalidates.
    hook.client.setQueryData(["menu", "m-dinner"], saturdayDinner);
    hook.client.setQueryData(["plan", "s-saturday"], {});
    return hook;
  }
  const invalidated = (hook: ReturnType<typeof renderServiceForm>, key: string[]) =>
    hook.client.getQueryState(key)?.isInvalidated;

  it("returns the kitchen's Availability it fetched", async () => {
    const { result } = renderServiceForm(null);
    await waitFor(() => expect(result.current.availability).toEqual(availability));
    expect(result.current).toMatchObject({ savePending: false, saveError: null });
  });

  it("creates the Menu's Service, then refetches the Menu and the Plan", async () => {
    const hook = renderServiceForm(null);

    act(() => hook.result.current.onSave({ date: "2026-10-31", time: saturday.time }));
    await waitFor(() => expect(invalidated(hook, ["plan", "s-saturday"])).toBe(true));
    expect(sent("createService")).toEqual({
      serviceId: anId,
      menuId: "m-dinner",
      date: "2026-10-31",
      time: saturday.time,
    });
    expect(invalidated(hook, ["menu", "m-dinner"])).toBe(true);
  });

  it("sets a saved Service's date and time, then refetches the Menu and the Plan", async () => {
    const hook = renderServiceForm(saturday);

    act(() => hook.result.current.onSave({ date: "2026-11-01", time: null }));
    await waitFor(() => expect(invalidated(hook, ["plan", "s-saturday"])).toBe(true));
    expect(sent("setServiceTime")).toEqual({
      serviceId: "s-saturday",
      date: "2026-11-01",
      time: null,
    });
    expect(invalidated(hook, ["menu", "m-dinner"])).toBe(true);
  });

  it("returns the save as pending, then its error", async () => {
    const fail = failLater();
    const hook = renderServiceForm(null);

    act(() => hook.result.current.onSave({ date: "2026-10-31", time: null }));
    await waitFor(() => expect(hook.result.current.savePending).toBe(true));
    fail(new Error("Could not save the Service (500)"));
    await waitFor(() =>
      expect(hook.result.current.saveError).toEqual(new Error("Could not save the Service (500)")),
    );
    expect(hook.result.current.savePending).toBe(false);
  });
});

describe("Menu screen", () => {
  const button = (name: string) => screen.getByRole("button", { name });
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("shows the saved Menus and the New Menu form when the URL opens no Menu", async () => {
    vi.mocked(fetchMenus).mockResolvedValue(menus);
    renderWired(<MenuScreen />);

    expect(await screen.findByRole("link", { name: "Saturday dinner" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New Menu" })).toBeTruthy();
    expect(fetchMenu).not.toHaveBeenCalled();
  });

  it("opens the Menu it creates", async () => {
    renderWired(<MenuScreen />);

    type("Menu name", "Saturday dinner");
    type("Guests", "6");
    fireEvent.click(button("Create Menu"));
    expect(await screen.findByRole("heading", { name: "Saturday dinner" })).toBeTruthy();
    expect(fetchMenu).toHaveBeenCalledWith(sent("createMenu")?.menuId);
    expect(screen.queryByRole("heading", { name: "New Menu" })).toBeNull();
  });

  it("opens the Menu in ?menu=, wiring its Add Course", async () => {
    window.history.replaceState(null, "", "?menu=m-dinner");
    renderWired(<MenuScreen />);

    expect(await screen.findByRole("heading", { name: "Saturday dinner" })).toBeTruthy();
    expect(fetchMenu).toHaveBeenCalledWith("m-dinner");
    expect(fetchMenus).not.toHaveBeenCalled();
    type("Course name", "Starter");
    fireEvent.click(button("Add Course"));
    await waitFor(() => expect(sent("addCourse")).toMatchObject({ menuId: "m-dinner" }));
  });

  it("wires the open Menu's Service form, Courses and Dish scales to their hooks", async () => {
    vi.mocked(fetchMenu).mockResolvedValue({
      ...saturdayDinner,
      service: saturday,
      courses: [starter],
    });
    window.history.replaceState(null, "", "?menu=m-dinner");
    renderWired(<MenuScreen />);

    fireEvent.click(await screen.findByRole("button", { name: "Save Service" }));
    await waitFor(() =>
      expect(sent("setServiceTime")).toEqual({
        serviceId: "s-saturday",
        date: "2026-10-31",
        time: saturday.time,
      }),
    );

    type("Recipe name", "Velouté");
    fireEvent.click(button("Add Dish"));
    await waitFor(() => expect(sent("addDish")).toMatchObject({ courseId: "c-starter" }));

    fireEvent.click(button("Save scale"));
    await waitFor(() =>
      expect(sent("setDishScale")).toEqual({ dishId: "d-veloute", scale: { kind: "guests" } }),
    );
  });
});
