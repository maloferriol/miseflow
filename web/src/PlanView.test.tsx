import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calmPlan, chickenStockLabel, saturdayMenu, saturdayPlan } from "../test/plan-fixture.ts";
import { renderView } from "../test/render-view.tsx";
import type { Plan } from "./api.ts";
import { ganttCourses } from "./plan-screen.ts";
import { PlanView, type PlanViewProps } from "./PlanView.tsx";
import { quickFixes } from "./quick-fixes.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const loaded = (data: Plan) => ({ status: "success" as const, data });

function renderPlan(props: Partial<PlanViewProps> = {}) {
  const onFix = vi.fn();
  const onPin = vi.fn();
  renderView(
    <PlanView
      serviceId="s-saturday"
      plan={loaded(saturdayPlan)}
      courses={undefined}
      onPin={onPin}
      onFix={onFix}
      fixPending={false}
      fixError={null}
      {...props}
    />,
  );
  return { onFix, onPin };
}

const unplacedList = () => screen.getByRole("list", { name: "Unplaced Tasks" });

describe("Plan view", () => {
  it("shows Loading… while the Plan loads", () => {
    renderPlan({ plan: { status: "pending" } });
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows why the Plan didn't load", () => {
    renderPlan({ plan: { status: "error", error: new Error("Could not load the Plan (500)") } });
    expect(screen.getByRole("alert").textContent).toBe("Could not load the Plan (500)");
  });

  it("heads the Plan with the Service's day and time, and links back to the Menu and to Today", () => {
    renderPlan();
    expect(screen.getByRole("heading", { name: /^Plan for/ }).textContent).toBe(
      "Plan for Saturday 31 October at 19:30",
    );
    expect(screen.getByRole("link", { name: "Back to the Menu" }).getAttribute("href")).toBe(
      "?menu=m-dinner",
    );
    expect(screen.getByRole("link", { name: "Today checklist" }).getAttribute("href")).toBe(
      "?view=today&service=s-saturday",
    );
  });

  it("says when the Service time is the kitchen's default", () => {
    renderPlan({
      plan: loaded({ ...saturdayPlan, service: { ...saturdayPlan.service, timeIsDefault: true } }),
    });
    expect(screen.getByRole("heading", { name: /^Plan for/ }).textContent).toBe(
      "Plan for Saturday 31 October at 19:30 (the kitchen's default)",
    );
  });

  it("counts the Unplaced Tasks and conflicts in the trouble badge", () => {
    renderPlan();
    expect(screen.getByRole("status", { name: "Plan trouble: 2" })).toBeTruthy();
  });

  it("lists each day's Tasks with times, owner, Steps, ≈ and passive time", () => {
    renderPlan();
    const plan = screen.getByRole("region", { name: "Plan" });
    expect(
      within(plan)
        .getAllByRole("heading")
        .map((h) => h.textContent),
    ).toEqual(["Friday 30 October", "Saturday 31 October"]);
    const friday = within(plan).getByRole("list", { name: "Friday 30 October" });
    expect(within(friday).getByRole("listitem").textContent).toBe(
      "17:00–17:10 · Duck breast · Sear the duck ≈",
    );
    expect(within(friday).getByTitle("Approximate: a Step has no duration")).toBeTruthy();
    const saturday = within(plan).getByRole("list", { name: "Saturday 31 October" });
    expect(within(saturday).getByRole("listitem").textContent).toBe(
      "17:40–19:30 · Velouté · Sweat the onions · +1 h 30 min passive",
    );
    expect(screen.getByText("Plan is approximate")).toBeTruthy();
  });

  it("lists each Unplaced Task with its reason and quick fixes", () => {
    renderPlan();
    const item = within(unplacedList()).getByRole("listitem");
    expect(item.textContent).toContain(
      `Tarte tatin · Make the pastry: ${saturdayPlan.unplaced[0].sentence}`,
    );
    expect(
      within(item)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(quickFixes("s-saturday", saturdayPlan.unplaced[0]).map((f) => f.label));
  });

  it("sends a quick fix with no question at once", () => {
    const confirm = vi.spyOn(window, "confirm");
    const { onFix } = renderPlan();
    fireEvent.click(screen.getByRole("button", { name: "Give the Cook more time" }));
    expect(confirm).not.toHaveBeenCalled();
    const [moreTime] = quickFixes("s-saturday", saturdayPlan.unplaced[0], () => "new-id");
    expect(onFix).toHaveBeenCalledExactlyOnceWith({
      name: moreTime.name,
      args: { ...moreTime.args, overrideId: expect.any(String) as unknown },
    });
  });

  it("asks before removing a Dish, and removes it when the cook confirms", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onFix } = renderPlan();
    fireEvent.click(screen.getByRole("button", { name: "Remove Tarte tatin" }));
    expect(confirm).toHaveBeenCalledExactlyOnceWith("Remove Tarte tatin from the Menu?");
    expect(onFix).toHaveBeenCalledExactlyOnceWith({
      name: "removeDish",
      args: { dishId: "d-tarte" },
    });
  });

  it("keeps the Plan and sends nothing when the cook cancels removing a Dish", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onFix } = renderPlan();
    fireEvent.click(screen.getByRole("button", { name: "Remove Tarte tatin" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onFix).not.toHaveBeenCalled();
    expect(within(unplacedList()).getByText(/Tarte tatin · Make the pastry/)).toBeTruthy();
  });

  it("re-plans from scratch without asking", () => {
    const confirm = vi.spyOn(window, "confirm");
    const { onFix } = renderPlan();
    fireEvent.click(screen.getByRole("button", { name: "Re-plan from scratch" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onFix).toHaveBeenCalledExactlyOnceWith({
      name: "replanFromScratch",
      args: { serviceId: "s-saturday" },
    });
  });

  it("disables Re-plan and every quick fix while a fix is pending", () => {
    renderPlan({ fixPending: true });
    for (const name of ["Re-plan from scratch", "Give the Cook more time", "Remove Tarte tatin"])
      expect(screen.getByRole<HTMLButtonElement>("button", { name }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Print the Plan" }).disabled).toBe(
      false,
    );
  });

  it("shows why a fix failed", () => {
    renderPlan({ fixError: new Error("removeDish failed (500)") });
    expect(screen.getByRole("alert").textContent).toBe("removeDish failed (500)");
  });

  it("lists the conflicts and the Batches", () => {
    renderPlan();
    expect(
      within(screen.getByRole("list", { name: "Conflicts" })).getByRole("listitem").textContent,
    ).toBe(saturdayPlan.conflicts[0].sentence);
    expect(
      within(screen.getByRole("list", { name: "Batches" })).getByRole("listitem").textContent,
    ).toBe(chickenStockLabel);
  });

  it("says when every Task is planned, with no conflicts and no Batches", () => {
    renderPlan({ plan: loaded(calmPlan) });
    expect(screen.getByText("Every Task is planned")).toBeTruthy();
    expect(screen.getByText("No conflicts")).toBeTruthy();
    expect(screen.getByText("No Batches")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("list", { name: "Unplaced Tasks" })).toBeNull();
  });

  it("prints the Plan", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderPlan();
    fireEvent.click(screen.getByRole("button", { name: "Print the Plan" }));
    expect(print).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: "Printed Plan" })).toBeTruthy();
  });

  it("shows the Gantt chart only once the Menu's Courses are in", () => {
    renderPlan();
    expect(screen.queryByRole("region", { name: "Gantt chart" })).toBeNull();
  });

  it("shows each placed Task as a bar on the Gantt chart", () => {
    renderPlan({ courses: ganttCourses(saturdayMenu) });
    expect(screen.getByRole("region", { name: "Gantt chart" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Velouté · Sweat the onions · 17:40" })).toBeTruthy();
  });
});
