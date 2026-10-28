import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import type { Menu } from "./api.ts";
import {
  CourseView,
  type CourseViewProps,
  MenuListView,
  MenuView,
  type MenuViewProps,
  NewMenuView,
  type NewMenuViewProps,
} from "./MenuViews.tsx";

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
        serviceForm={() => <p>Service form</p>}
        course={(course) => <p>Course {course.name}</p>}
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
        dishScale={(dish) => <p>Scale for {dish.recipe.name}</p>}
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
