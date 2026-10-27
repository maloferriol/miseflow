import { normaliseName } from "@miseflow/shared/src/catalog/match.ts";
import { UNITS_BY_KIND } from "@miseflow/shared/src/catalog/units.ts";
import { parseQuantity } from "@miseflow/shared/src/recipe/quantity.ts";
import { formatStepText, parseStepText, refName } from "@miseflow/shared/src/recipe/tokens.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  type CatalogIngredient,
  fetchIngredients,
  fetchRecipes,
  fetchShoppingCategories,
  mutate,
  type RecipeLine,
  type RecipeListItem,
  type RecipeStep,
} from "./api.ts";
import { IngredientPicker } from "./IngredientPicker.tsx";
import { useIntent } from "./intent.ts";
import { linkChoices, type Ref, saveStep, type Target } from "./step-links.ts";

/** "2", "30 g", "2-3 clove", "a pinch". */
export function amountText(line: Pick<RecipeLine, "quantity" | "quantityMax" | "unit">) {
  const number =
    line.quantity === null
      ? ""
      : `${line.quantity}${line.quantityMax === null ? "" : `-${line.quantityMax}`}`;
  return [number, line.unit].filter(Boolean).join(" ");
}

// Unrecognised units are stored raw (Decision 10) and flagged on the chip.
function unknownUnit(unit: string | null) {
  return unit !== null && parseQuantity(`1%${unit}`).tier === "unknown";
}

function chipText(line: RecipeLine) {
  // A line whose sub-recipe MiseFlow can't find still shows, and editing it treats it as unlinked.
  if (line.missingSubRecipe) return `Missing sub-recipe: ${line.wording ?? ""}`;
  return [
    `${line.wording ?? ""} ${amountText(line)}`.trim(),
    line.preparation,
    line.fixedQuantity && "fixed",
    unknownUnit(line.unit) && "unknown unit",
    line.subRecipe && "sub-recipe",
    line.subRecipe && line.subRecipe.yield === null && "needs a yield",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One Step: chips in read mode; the `@name{qty%unit}(prep)` shorthand in edit mode (Decision 1). */
export function StepEditor({
  recipeId,
  step,
  onClose,
}: {
  recipeId: string;
  /** Undefined for a new Step, which `addStep` saves on the first Save. */
  step?: RecipeStep;
  onClose?: () => void;
}) {
  const [editing, setEditing] = useState(!step);
  if (step && !editing) {
    const lines = new Map(step.lines.map((l) => [l.id, l]));
    return (
      <div>
        <p>
          {step.body.map((token, i) => {
            if (token.type === "text") return <span key={i}>{token.text}</span>;
            const line = lines.get(token.lineId);
            return line ? (
              <button key={i} type="button" className="chip" onClick={() => setEditing(true)}>
                {chipText(line)}
              </button>
            ) : null;
          })}
        </p>
        <button type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    );
  }
  return (
    <StepForm
      recipeId={recipeId}
      step={step}
      onDone={() => {
        setEditing(false);
        onClose?.();
      }}
    />
  );
}

function StepForm({
  recipeId,
  step,
  onDone,
}: {
  recipeId: string;
  step?: RecipeStep;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const textarea = useRef<HTMLTextAreaElement>(null);
  // The Step as the form opened it. A failed save refetches the Recipe, but a line that save
  // made must not count as kept here, or a re-pick for its wording would replay it (#127 A).
  const [opened] = useState(step);
  const [stepId] = useState(() => step?.id ?? crypto.randomUUID());
  const [text, setText] = useState(() =>
    step ? formatStepText(step.body, new Map(step.lines.map((l) => [l.id, l]))) : "",
  );
  // The "@" the picker replaces, while it is open.
  const [pickerAt, setPickerAt] = useState<number | null>(null);
  // Targets by normalised ref name: picked, matched exactly, aliased or created. So one wording
  // links to one target per Step: a second ref with the same wording shares it (owner decision).
  const [links, setLinks] = useState(() => new Map<string, Target>());
  // Ref names that found no single exact match on the last Save, with their near matches.
  const [unlinked, setUnlinked] = useState<
    {
      name: string;
      amount: string;
      near: CatalogIngredient[];
      nearRecipes: RecipeListItem[];
    }[]
  >([]);
  const refs = parseStepText(text).filter((p): p is Ref => p.type === "ref");
  const pending = unlinked.filter(
    (u) =>
      !links.has(normaliseName(u.name)) &&
      refs.some((r) => normaliseName(r.name) === normaliseName(u.name)),
  );
  const link = (name: string, target: Target) =>
    setLinks((prev) => new Map(prev).set(normaliseName(name), target));

  // One set of ids per intended save, so a retry replays it (see useIntent).
  const intent = useIntent();
  const save = useMutation({
    mutationFn: () =>
      saveStep({
        recipeId,
        stepId,
        opened,
        text,
        links,
        loadRecipes: () => queryClient.query({ queryKey: ["recipes"], queryFn: fetchRecipes }),
        findIngredients: fetchIngredients,
        intent,
        send: mutate,
        onResolved: (found, missing) => {
          setLinks(found);
          setUnlinked(missing);
        },
      }),
    // A failed save refetches too: the server may hold it though the response was lost, and the
    // next Save or Add Step must see that (#127 B). `saved` is false only when links are missing.
    onSettled: async (saved) => {
      if (saved === false) return;
      await queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      if (saved) onDone();
    },
  });

  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    const caret = event.target.selectionStart;
    // Typing one "@" at the start or after a non-word character opens the picker.
    if (
      next.length === text.length + 1 &&
      next[caret - 1] === "@" &&
      !/[\p{L}\p{N}_]/u.test(next[caret - 2] ?? "")
    ) {
      setPickerAt(caret - 1);
    }
    setText(next);
  }

  // Replaces the "@" with `@<inserted>` and puts the caret `back` characters before its end.
  // Synchronous, so keys the cook types next already land in the textarea.
  function backToText(inserted: string, back: number) {
    if (pickerAt === null) return;
    flushSync(() => {
      setText((prev) => prev.slice(0, pickerAt) + "@" + inserted + prev.slice(pickerAt + 1));
      setPickerAt(null);
    });
    const caret = pickerAt + 1 + inserted.length - back;
    textarea.current?.focus();
    textarea.current?.setSelectionRange(caret, caret);
  }

  function onPick(ingredient: CatalogIngredient) {
    // A kitchen's own name may hold characters the shorthand can't ("Pepper (black)").
    const wording = refName(ingredient.name) || "ingredient";
    link(wording, { ingredientId: ingredient.id });
    backToText(`${wording}{}`, 1);
  }

  // A Recipe with a yield prefills its unit, the caret before the "%" (Q4).
  function onPickRecipe(recipe: RecipeListItem) {
    const wording = refName(recipe.name) || "sub-recipe";
    link(wording, { subRecipeId: recipe.id });
    const unit = recipe.yield?.unit;
    if (unit) backToText(`${wording}{%${unit}}`, unit.length + 2);
    else backToText(`${wording}{}`, 1);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
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
          onChange={onChange}
        />
      </label>
      <p>
        <small>
          Type @ to add an Ingredient or a sub-recipe: @name{"{"}qty%unit{"}"}(preparation); "="
          fixes a quantity.
        </small>
      </p>
      {pickerAt !== null && (
        <IngredientPicker
          recipeId={recipeId}
          onPick={onPick}
          onPickRecipe={onPickRecipe}
          onClose={(typed) => backToText(typed, 0)}
        />
      )}
      {pending.map((u) => (
        <LinkChoice
          key={normaliseName(u.name)}
          {...u}
          onLinked={(target) => link(u.name, target)}
        />
      ))}
      <button type="submit" disabled={save.isPending || pending.length > 0}>
        Save
      </button>
      <button type="button" onClick={onDone}>
        Cancel
      </button>
      {save.error && <p role="alert">{save.error.message}</p>}
    </form>
  );
}

// Decision 7: the kind of measure comes from the line's unit; vague or unknown → mass.
function kindFor(amount: string) {
  const q = parseQuantity(amount);
  if (q.tier === "ingredient") return "count";
  if (q.tier === "fixed")
    return (UNITS_BY_KIND.volume as readonly string[]).includes(q.unit!) ? "volume" : "mass";
  return "mass";
}

// "Name" as a new Recipe's name: "chicken stock" → "Chicken stock".
const capitalised = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

// "Link 'X'": pick a near match, which teaches X as its alias, use one of the kitchen's Recipes,
// or create X as an Ingredient or as a sub-recipe. Each is its own mutation, sent before the Step
// save (Decision 5, #84 Q1).
function LinkChoice({
  name,
  amount,
  near,
  nearRecipes,
  onLinked,
}: {
  name: string;
  amount: string;
  near: CatalogIngredient[];
  nearRecipes: RecipeListItem[];
  onLinked: (target: Target) => void;
}) {
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: ["shopping-categories"],
    queryFn: fetchShoppingCategories,
  });
  // Each action replays on a retry after a lost response, with its own ids (#127 D).
  const [choices] = useState(() => linkChoices(name, mutate));
  const addAlias = useMutation({
    mutationFn: choices.useNearMatch,
    onSuccess: async (target) => {
      await queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      onLinked(target);
    },
  });
  const createIngredient = useMutation({
    mutationFn: choices.createIngredient,
    onSuccess: async (target) => {
      await queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      onLinked(target);
    },
  });
  const createSubRecipe = useMutation({
    mutationFn: choices.createSubRecipe,
    onSuccess: async (target) => {
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      onLinked(target);
    },
  });

  // Inside the Step's form, so these are plain fields rather than a nested <form>.
  const [newName, setNewName] = useState(name);
  const [subRecipeName, setSubRecipeName] = useState(() => capitalised(name));
  const [kind, setKind] = useState(() => kindFor(amount));
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const chosenCategory = categoryId ?? categories.data?.find((c) => c.name === "Other")?.id;

  return (
    <fieldset>
      <legend>Link ‘{name}’</legend>
      {near.length > 0 && (
        <ul aria-label={`Near matches for ${name}`}>
          {near.map((ingredient) => (
            <li key={ingredient.id}>
              <button
                type="button"
                disabled={addAlias.isPending}
                onClick={() => addAlias.mutate(ingredient)}
              >
                Use {ingredient.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {nearRecipes.length > 0 && (
        <ul aria-label={`Recipes matching ${name}`}>
          {nearRecipes.map((recipe) => (
            <li key={recipe.id}>
              <button type="button" onClick={() => onLinked({ subRecipeId: recipe.id })}>
                Use Recipe {recipe.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        New Ingredient name{" "}
        <input value={newName} maxLength={200} onChange={(e) => setNewName(e.target.value)} />
      </label>
      <label>
        Kind of measure{" "}
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="mass">mass</option>
          <option value="volume">volume</option>
          <option value="count">count</option>
        </select>
      </label>
      {categories.data && (
        <label>
          Shopping category{" "}
          <select value={chosenCategory} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.data.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        disabled={createIngredient.isPending || !chosenCategory}
        onClick={() =>
          createIngredient.mutate({
            name: newName.trim() || name,
            preferredKind: kind,
            shoppingCategoryId: chosenCategory!,
          })
        }
      >
        Create Ingredient
      </button>
      <label>
        Name for the sub-recipe{" "}
        <input
          value={subRecipeName}
          maxLength={200}
          onChange={(e) => setSubRecipeName(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={createSubRecipe.isPending}
        onClick={() => createSubRecipe.mutate(subRecipeName.trim() || capitalised(name))}
      >
        Create sub-recipe
      </button>
      {addAlias.error && <p role="alert">{addAlias.error.message}</p>}
      {createIngredient.error && <p role="alert">{createIngredient.error.message}</p>}
      {createSubRecipe.error && <p role="alert">{createSubRecipe.error.message}</p>}
    </fieldset>
  );
}
