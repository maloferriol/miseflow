import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { fetchRecipe, mutate } from "./api.ts";
import { amountText, StepEditor } from "./StepEditor.tsx";

// One Recipe: its name and servings, its Steps, and the ingredient list derived from them.
export function RecipeScreen({ recipeId }: { recipeId: string }) {
  const queryClient = useQueryClient();
  const recipe = useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: () => fetchRecipe(recipeId),
  });
  const [adding, setAdding] = useState(false);
  const changed = async () => {
    await queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
    await queryClient.invalidateQueries({ queryKey: ["recipes"] });
  };

  const editRecipe = useMutation({
    mutationFn: async (args: { name: string; servings: number | null }) =>
      mutate(crypto.randomUUID(), "editRecipe", {
        recipeId,
        revisionId: crypto.randomUUID(),
        ...args,
      }),
    onSuccess: changed,
  });
  const moveStep = useMutation({
    mutationFn: async (args: { stepId: string; afterStepId: string | null }) =>
      mutate(crypto.randomUUID(), "moveStep", {
        revisionId: crypto.randomUUID(),
        ...args,
      }),
    onSuccess: changed,
  });
  const removeStep = useMutation({
    mutationFn: async (stepId: string) =>
      mutate(crypto.randomUUID(), "removeStep", {
        stepId,
        revisionId: crypto.randomUUID(),
      }),
    onSuccess: changed,
  });

  if (recipe.isPending) return <p>Loading…</p>;
  if (recipe.isError) return <p role="alert">{recipe.error.message}</p>;
  const { steps, ingredients } = recipe.data;
  const lines = new Map(steps.flatMap((s) => s.lines).map((l) => [l.id, l]));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const servings = String(data.get("servings") ?? "").trim();
    if (name)
      editRecipe.mutate({ name, servings: servings ? Number(servings) : null });
  }

  return (
    <section>
      <h2>{recipe.data.name}</h2>
      {/* Keyed on the Revision, so the fields show the saved values after each edit. */}
      <form key={recipe.data.latestRevision} onSubmit={onSubmit}>
        <label>
          Recipe name{" "}
          <input
            name="name"
            defaultValue={recipe.data.name}
            maxLength={200}
            required
          />
        </label>
        <label>
          Servings{" "}
          <input
            name="servings"
            type="number"
            min={0}
            step="any"
            defaultValue={recipe.data.servings ?? ""}
          />
        </label>
        <button type="submit" disabled={editRecipe.isPending}>
          Save Recipe
        </button>
        {editRecipe.error && <p role="alert">{editRecipe.error.message}</p>}
      </form>

      <h3>Steps</h3>
      <ol aria-label="Steps">
        {steps.map((step, index) => (
          <li key={step.id}>
            <StepEditor recipeId={recipeId} step={step} />
            <button
              type="button"
              disabled={index === 0 || moveStep.isPending}
              onClick={() =>
                moveStep.mutate({
                  stepId: step.id,
                  afterStepId: steps[index - 2]?.id ?? null,
                })
              }
            >
              Move up
            </button>
            <button
              type="button"
              disabled={index === steps.length - 1 || moveStep.isPending}
              onClick={() =>
                moveStep.mutate({
                  stepId: step.id,
                  afterStepId: steps[index + 1]!.id,
                })
              }
            >
              Move down
            </button>
            <button
              type="button"
              disabled={removeStep.isPending}
              onClick={() => removeStep.mutate(step.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
      {adding ? (
        <StepEditor recipeId={recipeId} onClose={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          Add Step
        </button>
      )}
      {(moveStep.error ?? removeStep.error) && (
        <p role="alert">{(moveStep.error ?? removeStep.error)!.message}</p>
      )}

      <h3>Ingredients</h3>
      <ul aria-label="Ingredients">
        {ingredients.map((item) => {
          const line = lines.get(item.lineId);
          return (
            <li key={item.lineId}>
              {[amountText(item), item.wording].filter(Boolean).join(" ")}
              {item.preparation && `, ${item.preparation}`}
              {line?.ingredient &&
                line.ingredient.name !== item.wording &&
                ` (${line.ingredient.name})`}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
