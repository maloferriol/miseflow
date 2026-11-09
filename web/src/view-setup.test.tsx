import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// The view project's setup file unmounts each test's render (web/test/setup-view.ts); this file
// imports no shared helper, so only that setup can do it.
describe("view test setup", () => {
  it("renders into the document", () => {
    render(<p>Left over</p>);
    expect(screen.getByText("Left over")).toBeTruthy();
  });

  it("starts the next test with nothing rendered", () => {
    expect(screen.queryByText("Left over")).toBeNull();
  });
});
