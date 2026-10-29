// The Recipe screen's views (ADR 0011), with its yield field and Extract to sub-recipe: props
// only, so their tests render them without the API.
import { SERVINGS } from "@miseflow/shared/src/recipe/servings.ts";
import type { FormEvent, ReactNode } from "react";
import type { Recipe, RecipeStep } from "./api.ts";
import { fieldText, trimmedOrNull } from "./form-fields.ts";
import type { QueryState } from "./MenuViews.tsx";
import {
  type ExtractArgs,
  extractInput,
  extractOffer,
  ingredientText,
  type Mode,
  type MoveArgs,
  recipeInput,
  stepMoves,
  yieldText,
} from "./recipe-screen.ts";

/** What Extract to sub-recipe needs from the Recipe screen. */
export type ExtractSlot = { stepIds: string[]; selected: string[]; onDone: () => void };

export type RecipeScreenViewProps = {
  recipe: QueryState<Recipe>;
  mode: Mode;
  onMode: (mode: Mode) => void;
  /** The ticked Steps, for Extract to sub-recipe. */
  selected: string[];
  onSelect: (stepId: string, checked: boolean) => void;
  onClearSelection: () => void;
  adding: boolean;
  onAdding: (adding: boolean) => void;
  editPending: boolean;
  editError: Error | null;
  onEdit: (args: { name: string; servings: number | null }) => void;
  movePending: boolean;
  moveError: Error | null;
  onMove: (args: MoveArgs) => void;
  removePending: boolean;
  removeError: Error | null;
  onRemove: (stepId: string) => void;
  renderYield: (recipe: Recipe) => ReactNode;
  renderPlanningPass: (recipe: Recipe) => ReactNode;
  /** A saved Step's editor. */
  renderStep: (step: RecipeStep) => ReactNode;
  /** A new Step's editor, which calls `onClose` when it closes. */
  renderNewStep: (onClose: () => void) => ReactNode;
  renderExtract: (extract: ExtractSlot) => ReactNode;
};

// One Recipe: its name and servings, its Steps, and the ingredient list derived from them.
export function RecipeScreenView(props: Readonly<RecipeScreenViewProps>) {
  const { recipe } = props;
  if (recipe.status === "pending") return <p>Loading…</p>;
  if (recipe.status === "error") return <p role="alert">{recipe.error.message}</p>;
  const { steps, ingredients } = recipe.data;
  const lines = new Map(steps.flatMap((s) => s.lines).map((l) => [l.id, l]));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = recipeInput(fieldText(form, "name"), fieldText(form, "servings"));
    if (input) props.onEdit(input);
  }

  return (
    <section>
      <h2>{recipe.data.name}</h2>
      {/* Keyed on the Revision, so the fields show the saved values after each edit. */}
      <form key={recipe.data.latestRevision} onSubmit={onSubmit}>
        <label>
          Recipe name <input name="name" defaultValue={recipe.data.name} maxLength={200} required />
        </label>
        <label>
          Servings{" "}
          <input
            name="servings"
            type="number"
            min={SERVINGS.min}
            max={SERVINGS.max}
            step="any"
            defaultValue={recipe.data.servings ?? ""}
          />
        </label>
        <button type="submit" disabled={props.editPending}>
          Save Recipe
        </button>
        {props.editError && <p role="alert">{props.editError.message}</p>}
      </form>
      {props.renderYield(recipe.data)}

      <div role="group" aria-label="Mode">
        <button
          type="button"
          aria-pressed={props.mode === "write"}
          onClick={() => props.onMode("write")}
        >
          Write
        </button>
        <button
          type="button"
          aria-pressed={props.mode === "plan"}
          onClick={() => props.onMode("plan")}
        >
          Plan
        </button>
      </div>

      {props.mode === "plan" ? (
        props.renderPlanningPass(recipe.data)
      ) : (
        <WriteMode {...props} steps={steps} />
      )}

      <h3>Ingredients</h3>
      <ul aria-label="Ingredients">
        {ingredients.map((item) => (
          <li key={item.lineId}>{ingredientText(item, lines.get(item.lineId))}</li>
        ))}
      </ul>
    </section>
  );
}

/** The Steps with their move, remove and select controls, Add Step, and Extract to sub-recipe. */
function WriteMode({ steps, ...props }: Readonly<RecipeScreenViewProps & { steps: RecipeStep[] }>) {
  const stepIds = steps.map((s) => s.id);
  const listError = props.moveError ?? props.removeError;
  return (
    <>
      <h3>Steps</h3>
      <ol aria-label="Steps">
        {steps.map((step, index) => {
          const { up, down } = stepMoves(stepIds, index);
          return (
            <li key={step.id}>
              <input
                type="checkbox"
                aria-label={`Select Step ${index + 1}`}
                checked={props.selected.includes(step.id)}
                onChange={(e) => props.onSelect(step.id, e.target.checked)}
              />
              {props.renderStep(step)}
              <button
                type="button"
                disabled={!up || props.movePending}
                onClick={() => up && props.onMove(up)}
              >
                Move up
              </button>
              <button
                type="button"
                disabled={!down || props.movePending}
                onClick={() => down && props.onMove(down)}
              >
                Move down
              </button>
              <button
                type="button"
                disabled={props.removePending}
                onClick={() => props.onRemove(step.id)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ol>
      {props.adding ? (
        props.renderNewStep(() => props.onAdding(false))
      ) : (
        <button type="button" onClick={() => props.onAdding(true)}>
          Add Step
        </button>
      )}
      {props.renderExtract({
        stepIds,
        selected: props.selected,
        onDone: props.onClearSelection,
      })}
      {listError && <p role="alert">{listError.message}</p>}
    </>
  );
}

export type YieldFieldViewProps = {
  recipe: Pick<Recipe, "latestRevision" | "yield" | "needsYield" | "usedBy">;
  savePending: boolean;
  saveError: Error | null;
  onSave: (value: string | null) => void;
};

// The Quantity the Recipe makes (#84). A Recipe used as a sub-recipe needs one (units spec §5).
export function YieldFieldView({
  recipe,
  savePending,
  saveError,
  onSave,
}: Readonly<YieldFieldViewProps>) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A blank field clears the yield.
    onSave(trimmedOrNull(fieldText(new FormData(event.currentTarget), "yield")));
  }

  return (
    // Keyed on the Revision, so the field shows the saved value after each edit.
    <form key={recipe.latestRevision} onSubmit={onSubmit}>
      <label>
        Yield{" "}
        <input
          name="yield"
          maxLength={100}
          placeholder="1.5 L, 500 g, 24"
          defaultValue={yieldText(recipe.yield)}
        />
      </label>
      <button type="submit" disabled={savePending}>
        Save yield
      </button>
      {recipe.needsYield && (
        <p>
          <strong>needs a yield</strong>: used as a sub-recipe by{" "}
          {recipe.usedBy.map((r) => r.name).join(", ")}
        </p>
      )}
      {saveError && <p role="alert">{saveError.message}</p>}
    </form>
  );
}

export type ExtractToSubRecipeViewProps = {
  /** The Recipe's live Steps, in order. */
  stepIds: string[];
  selected: string[];
  name: string;
  amount: string;
  onName: (name: string) => void;
  onAmount: (amount: string) => void;
  extractPending: boolean;
  extractError: Error | null;
  onExtract: (args: ExtractArgs) => void;
};

// Moves the selected Steps into a new sub-recipe, leaving one line using it (#84 Q3). Offered
// only for consecutive Steps, which the server checks again.
export function ExtractToSubRecipeView(props: Readonly<ExtractToSubRecipeViewProps>) {
  const { showHint } = extractOffer(props.stepIds, props.selected);
  const input = extractInput(props.stepIds, props.selected, props.name, props.amount);
  return (
    <fieldset>
      <legend>Extract to sub-recipe</legend>
      <label>
        Name for the sub-recipe{" "}
        <input value={props.name} maxLength={200} onChange={(e) => props.onName(e.target.value)} />
      </label>
      <label>
        Amount used{" "}
        <input
          value={props.amount}
          maxLength={100}
          onChange={(e) => props.onAmount(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={!input || props.extractPending}
        onClick={() => input && props.onExtract(input)}
      >
        Extract to sub-recipe
      </button>
      {showHint && <p>Select Steps that follow one another.</p>}
      {props.extractError && <p role="alert">{props.extractError.message}</p>}
    </fieldset>
  );
}
