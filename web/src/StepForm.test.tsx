import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import { blockingSave, type Inserted, pickerOpensAt, withLink } from "./step-editor.ts";
import { StepFormView, type StepFormViewProps } from "./StepForm.tsx";

// A Step form with nothing pending, nothing unmatched and the picker shut; each test sets what it checks.
function stepForm(props: Partial<StepFormViewProps> = {}) {
  const view: StepFormViewProps = {
    text: "Sweat the shallots",
    pickerAt: null,
    unmatched: [],
    savePending: false,
    saveError: null,
    onEdit: () => {},
    onInsert: () => {},
    onSave: () => {},
    onCancel: () => {},
    picker: () => <p>Ingredient picker</p>,
    linkChoice: (u) => <p>Link {u.name}</p>,
    ...props,
  };
  return <StepFormView {...view} />;
}

const renderStepForm = (props: Partial<StepFormViewProps> = {}) => renderView(stepForm(props));
const save = () => screen.getByRole("button", { name: "Save" });

describe("Step form", () => {
  it("disables Save while a save is pending", () => {
    renderStepForm({ savePending: true });
    expect(save().hasAttribute("disabled")).toBe(true);
  });

  it("disables Save while a name is unmatched, and enables it once the cook links it", () => {
    const text = "Sweat @shallots{2%clove} gently";
    const unlinked = [{ name: "shallots", amount: "2%clove", near: [], nearRecipes: [] }];
    const view = renderStepForm({ text, unmatched: blockingSave(unlinked, new Map(), text) });
    expect(screen.getByText("Link shallots")).toBeTruthy();
    expect(save().hasAttribute("disabled")).toBe(true);

    const links = withLink(new Map(), { wording: "shallots", target: { ingredientId: "i-1" } });
    view.rerender(stepForm({ text, unmatched: blockingSave(unlinked, links, text) }));
    expect(screen.queryByText("Link shallots")).toBeNull();
    expect(save().hasAttribute("disabled")).toBe(false);
  });

  it("shows a failed save as an alert with its message", () => {
    renderStepForm({ saveError: new Error("Could not save the Step (500)") });
    expect(screen.getByRole("alert").textContent).toBe("Could not save the Step (500)");
  });

  it("shows the picker once an @ is typed, and hands the edit and its caret back", () => {
    const onEdit = vi.fn();
    const view = renderStepForm({ text: "Sweat ", onEdit });
    expect(screen.queryByText("Ingredient picker")).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Step text" }), {
      target: { value: "Sweat @" },
    });
    expect(onEdit).toHaveBeenCalledWith("Sweat @", 7);

    view.rerender(stepForm({ text: "Sweat @", pickerAt: pickerOpensAt("Sweat ", "Sweat @", 7) }));
    expect(screen.getByText("Ingredient picker")).toBeTruthy();
  });

  it("puts the caret inside the braces after a pick, so the next key lands there", () => {
    // The hook's text and picker state, as the view sees it.
    function Editing() {
      const [text, setText] = useState("Sweat @ gently");
      const [pickerAt, setPickerAt] = useState<number | null>(6);
      return stepForm({
        text,
        pickerAt,
        onInsert: (inserted: Inserted) => {
          setText(inserted.text);
          setPickerAt(null);
        },
        picker: (choose) => (
          <button
            type="button"
            onClick={() => choose({ ingredient: { id: "i-1", name: "shallots" } })}
          >
            Pick shallots
          </button>
        ),
      });
    }
    renderView(<Editing />);
    fireEvent.click(screen.getByRole("button", { name: "Pick shallots" }));

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Step text" });
    expect(textarea.value).toBe("Sweat @shallots{} gently");
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value.slice(0, textarea.selectionStart)).toBe("Sweat @shallots{");
  });

  it("calls back on Cancel without saving", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    renderStepForm({ onCancel, onSave });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
