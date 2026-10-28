// The Step form's view (ADR 0011): props only, so its tests render it without the API.
import { normaliseName } from "@miseflow/shared/src/catalog/match.ts";
import { Fragment, type ReactNode, useRef } from "react";
import { flushSync } from "react-dom";
import type { CatalogIngredient, RecipeListItem } from "./api.ts";
import { type Inserted, insertPick, type PickerChoice } from "./step-editor.ts";
import type { Unlinked } from "./step-links.ts";

/** A ref name the last Save found no single exact match for, with its near matches. */
export type Unmatched = Unlinked<CatalogIngredient, RecipeListItem>;

export type StepFormViewProps = {
  /** The `@name{qty%unit}(prep)` shorthand (Decision 1). */
  text: string;
  /** The "@" the picker replaces, while it is open. */
  pickerAt: number | null;
  /** The names that still block Save (`blockingSave`). */
  unmatched: Unmatched[];
  savePending: boolean;
  saveError: Error | null;
  /** The textarea's new text and its caret. */
  onEdit: (text: string, caret: number) => void;
  /** A pick, or the picker closed: the new text and the link it makes (`insertPick`). */
  onInsert: (inserted: Inserted) => void;
  onSave: () => void;
  onCancel: () => void;
  /** The `@` picker, handed what to call on a pick or a close. */
  renderPicker: (choose: (pick: PickerChoice) => void) => ReactNode;
  /** How the cook links one unmatched name. */
  renderLinkChoice: (unmatched: Unmatched) => ReactNode;
};

/** The Step form: the shorthand's textarea, the `@` picker, a choice per unmatched name, Save. */
export function StepFormView({
  text,
  pickerAt,
  unmatched,
  savePending,
  saveError,
  onEdit,
  onInsert,
  onSave,
  onCancel,
  renderPicker,
  renderLinkChoice,
}: Readonly<StepFormViewProps>) {
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Synchronous, so keys the cook types right after a pick already land in the textarea, at the
  // caret `insertPick` placed.
  function insert(at: number, pick: PickerChoice) {
    const inserted = insertPick(text, at, pick);
    flushSync(() => onInsert(inserted));
    textarea.current?.focus();
    textarea.current?.setSelectionRange(inserted.caret, inserted.caret);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <label>
        Step text{" "}
        <textarea
          ref={textarea}
          aria-label="Step text"
          rows={3}
          cols={60}
          value={text}
          onChange={(event) => onEdit(event.target.value, event.target.selectionStart)}
        />
      </label>
      <p>
        <small>
          Type @ to add an Ingredient or a sub-recipe: @name{"{"}qty%unit{"}"}(preparation); "="
          fixes a quantity.
        </small>
      </p>
      {pickerAt !== null && <Slot render={renderPicker} with={(pick) => insert(pickerAt, pick)} />}
      {unmatched.map((u) => (
        <Fragment key={normaliseName(u.name)}>{renderLinkChoice(u)}</Fragment>
      ))}
      <button type="submit" disabled={savePending || unmatched.length > 0}>
        Save
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      {saveError && <p role="alert">{saveError.message}</p>}
    </form>
  );
}

// Renders a slot as its own component, so `insert` (which moves the caret through the textarea's
// ref) is handed over as a prop for the picker to call later, not called during this render.
function Slot<T>({ render, with: value }: { render: (value: T) => ReactNode; with: T }) {
  return render(value);
}
