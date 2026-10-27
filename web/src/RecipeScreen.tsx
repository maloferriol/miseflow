import { SERVINGS } from "@miseflow/shared/src/recipe/servings.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { fetchRecipe, mutate } from "./api.ts";
import { ExtractToSubRecipe } from "./ExtractToSubRecipe.tsx";
import { PlanningPass } from "./PlanningPass.tsx";
import { recipeEdits } from "./recipe-edits.ts";
import { amountText, StepEditor } from "./StepEditor.tsx";
import { YieldField } from "./YieldField.tsx";

type Mode = "write" | "plan";

// Write or Plan, kept in the URL (&mode=plan) so a reload stays in it.
function modeFromUrl(): Mode {
  return new URLSearchParams(window.location.search).get("mode") === "plan" ? "plan" : "write";
}

// One Recipe: its name and servings, its Steps, and the ingredient list derived from them.
export function RecipeScreen({ recipeId }: { recipeId: string }) {
  const queryClient = useQueryClient();
  const recipe = useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: () => fetchRecipe(recipeId),
  });
  const [adding, setAdding] = useState(false);
  // Steps ticked for Extract to sub-recipe.
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState(modeFromUrl);
  const switchMode = (next: Mode) => {
    const params = new URLSearchParams(window.location.search);
    if (next === "plan") params.set("mode", "plan");
    else params.delete("mode");
    window.history.replaceState(null, "", `?${params}`);
    setMode(next);
  };
  // Each edit replays on a retry after a lost response, with its own ids (recipe-edits.ts).
  const edits = useMemo(() => recipeEdits(recipeId, mutate), [recipeId]);
  // After a failure too: the server may hold the edit though the response was lost (#127 B).
  const refetch = async () => {
    await queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
    await queryClient.invalidateQueries({ queryKey: ["recipes"] });
  };

  const editRecipe = useMutation({
    mutationFn: edits.editRecipe,
    onSettled: refetch,
  });
  const moveStep = useMutation({
    mutationFn: edits.moveStep,
    onSettled: refetch,
  });
  const removeStep = useMutation({
    mutationFn: edits.removeStep,
    onSettled: refetch,
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
    if (name) editRecipe.mutate({ name, servings: servings ? Number(servings) : null });
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
        <button type="submit" disabled={editRecipe.isPending}>
          Save Recipe
        </button>
        {editRecipe.error && <p role="alert">{editRecipe.error.message}</p>}
      </form>
      <YieldField recipe={recipe.data} />

      <div role="group" aria-label="Mode">
        <button type="button" aria-pressed={mode === "write"} onClick={() => switchMode("write")}>
          Write
        </button>
        <button type="button" aria-pressed={mode === "plan"} onClick={() => switchMode("plan")}>
          Plan
        </button>
      </div>

      {mode === "plan" ? (
        <PlanningPass recipe={recipe.data} />
      ) : (
        <>
          <h3>Steps</h3>
          <ol aria-label="Steps">
            {steps.map((step, index) => (
              <li key={step.id}>
                <input
                  type="checkbox"
                  aria-label={`Select Step ${index + 1}`}
                  checked={selected.includes(step.id)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, step.id] : prev.filter((id) => id !== step.id),
                    )
                  }
                />
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
                      afterStepId: steps[index + 1].id,
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
          <ExtractToSubRecipe
            recipeId={recipeId}
            stepIds={steps.map((s) => s.id)}
            selected={selected.filter((id) => steps.some((s) => s.id === id))}
            onDone={() => setSelected([])}
          />
          {(moveStep.error ?? removeStep.error) && (
            <p role="alert">{(moveStep.error ?? removeStep.error)!.message}</p>
          )}
        </>
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
