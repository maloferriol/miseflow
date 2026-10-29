import { formatInstant } from "@miseflow/shared/src/plan/time.ts";
import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import { walkthroughPlan } from "../test/walkthrough-plan.ts";
import { dayHeading, ownerOf, taskTimes } from "./plan-display.ts";
import { PrintedPlan } from "./PrintedPlan.tsx";

// Thursday 17:00 in Paris, as the cook opens the checklist.
const opened = new Date("2026-10-29T16:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(opened);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const printed = () => screen.getByRole("region", { name: "Printed Plan" });

describe("Printed Plan", () => {
  it("says when it was printed, in the Plan's zone", () => {
    const plan = walkthroughPlan();
    renderView(<PrintedPlan plan={plan} />);
    expect(
      within(printed()).getByText(`Printed at ${formatInstant(opened, plan.timeZone)}`),
    ).toBeTruthy();
  });

  it("refreshes when it was printed as the print starts", () => {
    const plan = walkthroughPlan({ timeZone: "America/New_York" });
    renderView(<PrintedPlan plan={plan} />);
    const printing = new Date("2026-10-29T19:45:00Z");
    vi.setSystemTime(printing);
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(
      within(printed()).getByText(`Printed at ${formatInstant(printing, plan.timeZone)}`),
    ).toBeTruthy();
  });

  it("stops listening for a print once it's gone", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderView(<PrintedPlan plan={walkthroughPlan()} />);
    const listener = add.mock.calls.find(([type]) => type === "beforeprint")?.[1];
    unmount();
    expect(remove).toHaveBeenCalledWith("beforeprint", listener);
  });

  it("has a section per day, each Task with its times and owner and an empty box per Step", () => {
    const plan = walkthroughPlan();
    renderView(<PrintedPlan plan={plan} />);
    const sections = within(printed()).getAllByRole("region");
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual(
      plan.days.map((d) => dayHeading(d.date)),
    );
    for (const [i, day] of plan.days.entries()) {
      const section = sections[i];
      expect(within(section).getByRole("heading", { level: 2 }).textContent).toBe(
        dayHeading(day.date),
      );
      const tasks = within(section)
        .getAllByRole("listitem")
        .filter((li) => within(li).queryByRole("list", { name: "Steps" }));
      expect(tasks.map((li) => li.textContent)).toEqual(
        day.tasks.map(
          (t) =>
            `${taskTimes(t, day.date)} · ${ownerOf(t)}${t.steps.map((s) => `☐ ${s.text}`).join("")}`,
        ),
      );
    }
  });

  it("prints a Step's box empty even when the Step is done", () => {
    renderView(<PrintedPlan plan={walkthroughPlan()} />);
    const steps = within(printed()).getAllByRole("list", { name: "Steps" });
    expect(
      steps.flatMap((ul) =>
        within(ul)
          .getAllByRole("listitem")
          .map((li) => li.textContent),
      ),
    ).toContain("☐ Dry-brine the duck");
  });
});
