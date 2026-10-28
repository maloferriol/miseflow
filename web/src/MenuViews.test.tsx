import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import type { Menu } from "./api.ts";
import {
  CourseView,
  type CourseViewProps,
  DishScaleView,
  type DishScaleViewProps,
  MenuListView,
  MenuView,
  type MenuViewProps,
  NewMenuView,
  type NewMenuViewProps,
  ServiceFormView,
  type ServiceFormViewProps,
} from "./MenuViews.tsx";
import { serviceInput } from "./menu-screen.ts";
import { minuteOfDay } from "./time-of-day.ts";

const button = (name: string) => screen.getByRole("button", { name });
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Menu list", () => {
  it("shows Loading… while the Menus load", () => {
    renderView(<MenuListView menus={{ status: "pending" }} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows a failed load as an alert with its message", () => {
    renderView(
      <MenuListView
        menus={{ status: "error", error: new Error("Could not load the Menus (500)") }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Could not load the Menus (500)");
  });

  it("shows no list while there are no Menus", () => {
    renderView(<MenuListView menus={{ status: "success", data: [] }} />);
    expect(screen.queryByRole("navigation", { name: "Your Menus" })).toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("links each Menu to its page", () => {
    renderView(
      <MenuListView
        menus={{ status: "success", data: [{ id: "m-1", name: "Saturday dinner" }] }}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Your Menus" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Saturday dinner" }).getAttribute("href")).toBe(
      "?menu=m-1",
    );
  });
});

describe("New Menu", () => {
  const newMenu = (props: Partial<NewMenuViewProps> = {}) =>
    renderView(
      <NewMenuView createPending={false} createError={null} onCreate={() => {}} {...props} />,
    );

  it("creates a Menu from its name and Guests", () => {
    const onCreate = vi.fn();
    newMenu({ onCreate });
    type("Menu name", "Saturday dinner");
    type("Guests", "6");
    fireEvent.click(button("Create Menu"));
    expect(onCreate).toHaveBeenCalledWith({ name: "Saturday dinner", guestCount: 6 });
  });

  it("keeps the typed name and creates nothing when Guests holds no whole number", () => {
    const onCreate = vi.fn();
    newMenu({ onCreate });
    type("Menu name", "Saturday dinner");
    type("Guests", "2.5");
    // Submitted past the field's own step check, so the view's check is the one under test.
    fireEvent.submit(button("Create Menu"));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Menu name" })).toHaveProperty(
      "value",
      "Saturday dinner",
    );
  });

  it("disables Create Menu while a create is pending", () => {
    newMenu({ createPending: true });
    expect(button("Create Menu").hasAttribute("disabled")).toBe(true);
  });

  it("shows a failed create as an alert with its message", () => {
    newMenu({ createError: new Error("Could not create the Menu (500)") });
    expect(screen.getByRole("alert").textContent).toBe("Could not create the Menu (500)");
  });
});

// ADR 0004's Saturday dinner for 6, before it has a Course, a Service or a Batch.
const saturdayDinner: Menu = {
  id: "m-dinner",
  name: "Saturday dinner",
  guestCount: 6,
  batches: [],
  service: null,
  courses: [],
};

describe("Menu", () => {
  const menuView = (props: Partial<MenuViewProps> = {}) =>
    renderView(
      <MenuView
        menu={{ status: "success", data: saturdayDinner }}
        addCoursePending={false}
        addCourseError={null}
        onAddCourse={() => {}}
        renderServiceForm={() => <p>Service form</p>}
        renderCourse={(course) => <p>Course {course.name}</p>}
        {...props}
      />,
    );

  it("shows Loading… while the Menu loads", () => {
    menuView({ menu: { status: "pending" } });
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows a failed load as an alert with its message", () => {
    menuView({ menu: { status: "error", error: new Error("Could not load the Menu (404)") } });
    expect(screen.getByRole("alert").textContent).toBe("Could not load the Menu (404)");
  });

  it("shows the Menu with its guests, its Service form and no Batches yet", () => {
    menuView();
    expect(screen.getByRole("heading", { name: "Saturday dinner" })).toBeTruthy();
    expect(screen.getByText("6 guests")).toBeTruthy();
    expect(screen.getByText("Service form")).toBeTruthy();
    expect(screen.getByText("No Batches")).toBeTruthy();
  });

  it("adds a Course by its name", () => {
    const onAddCourse = vi.fn();
    menuView({ onAddCourse });
    type("Course name", "Velouté");
    fireEvent.click(button("Add Course"));
    expect(onAddCourse).toHaveBeenCalledWith("Velouté");
  });

  it("disables Add Course while an add is pending", () => {
    menuView({ addCoursePending: true });
    expect(button("Add Course").hasAttribute("disabled")).toBe(true);
  });

  it("shows a failed add as an alert with its message", () => {
    menuView({ addCourseError: new Error("Could not add the Course (500)") });
    expect(screen.getByRole("alert").textContent).toBe("Could not add the Course (500)");
  });
});

type Course = Menu["courses"][number];
type Dish = Course["dishes"][number];

// A Dish before the Menu has a scale for it: the server's assumed factor of 1.
const velouté: Dish = {
  id: "d-veloute",
  position: "a0",
  recipe: { id: "r-veloute", name: "Velouté" },
  scale: { factor: 1, source: "assumed" },
  fixes: [],
};
const starter: Course = { id: "c-starter", name: "Starter", position: "a0", dishes: [velouté] };

describe("Course", () => {
  const courseView = (props: Partial<CourseViewProps> = {}) =>
    renderView(
      <CourseView
        menuId="m-dinner"
        course={starter}
        addDishPending={false}
        addDishError={null}
        onAddDish={() => {}}
        renderDishScale={(dish) => <p>Scale for {dish.recipe.name}</p>}
        {...props}
      />,
    );

  it("links each Dish to its Recipe, keeping the way back to the Menu", () => {
    courseView();
    expect(screen.getByRole("link", { name: "Velouté" }).getAttribute("href")).toBe(
      "?menu=m-dinner&view=recipe&recipe=r-veloute",
    );
    expect(screen.getByText("Scale for Velouté")).toBeTruthy();
  });

  it("adds a Dish by its Recipe's name", () => {
    const onAddDish = vi.fn();
    courseView({ onAddDish });
    type("Recipe name", "Duck breast");
    fireEvent.click(button("Add Dish"));
    expect(onAddDish).toHaveBeenCalledWith("Duck breast");
  });

  it("disables Add Dish while an add is pending", () => {
    courseView({ addDishPending: true });
    expect(button("Add Dish").hasAttribute("disabled")).toBe(true);
  });

  it("shows a failed add as an alert with its message", () => {
    courseView({ addDishError: new Error("Could not add the Dish (500)") });
    expect(screen.getByRole("alert").textContent).toBe("Could not add the Dish (500)");
  });
});

describe("Dish scale", () => {
  const dishScale = (props: Partial<DishScaleViewProps> = {}) =>
    renderView(
      <DishScaleView
        dish={velouté}
        savePending={false}
        saveError={null}
        onSave={() => {}}
        {...props}
      />,
    );

  it("saves a portion count", () => {
    const onSave = vi.fn();
    dishScale({ onSave });
    fireEvent.change(screen.getByRole("combobox", { name: "Scale for Velouté" }), {
      target: { value: "portions" },
    });
    type("Portions of Velouté", "8");
    fireEvent.click(button("Save scale"));
    expect(onSave).toHaveBeenCalledWith({ kind: "portions", portions: 8 });
  });

  it("opens on the factor the cook set", () => {
    dishScale({ dish: { ...velouté, scale: { factor: 1.5, source: "set" } } });
    expect(screen.getByLabelText<HTMLInputElement>("Factor for Velouté").value).toBe("1.5");
  });

  it("disables Save scale while a save is pending", () => {
    dishScale({ savePending: true });
    expect(button("Save scale").hasAttribute("disabled")).toBe(true);
  });

  it("shows a failed save as an alert with its message", () => {
    dishScale({ saveError: new Error("Could not save the scale (500)") });
    expect(screen.getByRole("alert").textContent).toBe("Could not save the scale (500)");
  });
});

describe("Service form", () => {
  // ADR 0004's Service: Saturday at 19:30.
  const saturday = { id: "s-saturday", date: "2026-10-31", time: minuteOfDay("19:30") };
  const serviceForm = (props: Partial<ServiceFormViewProps> = {}) =>
    renderView(
      <ServiceFormView
        menuId="m-dinner"
        service={null}
        availability={undefined}
        savePending={false}
        saveError={null}
        onSave={() => {}}
        {...props}
      />,
    );

  it("adds the Service from its date and time", () => {
    const onSave = vi.fn();
    serviceForm({ onSave });
    type("Service date", "2026-10-31");
    type("Service time (optional)", "19:30");
    fireEvent.click(button("Add Service"));
    expect(onSave).toHaveBeenCalledWith(serviceInput("2026-10-31", "19:30"));
  });

  it("shows the saved Service, with its Plan and Shopping list", () => {
    serviceForm({ service: saturday });
    expect(screen.getByLabelText<HTMLInputElement>("Service time (optional)").value).toBe("19:30");
    expect(screen.getByRole("link", { name: "Open Plan" }).getAttribute("href")).toBe(
      "?menu=m-dinner&view=plan&service=s-saturday",
    );
    expect(screen.getByRole("link", { name: "Open Shopping list" })).toBeTruthy();
  });

  it("disables the save while one is pending", () => {
    serviceForm({ service: saturday, savePending: true });
    expect(button("Save Service").hasAttribute("disabled")).toBe(true);
  });

  it("shows a failed save as an alert with its message", () => {
    serviceForm({ saveError: new Error("Could not save the Service (500)") });
    expect(screen.getByRole("alert").textContent).toBe("Could not save the Service (500)");
  });
});
