import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { fetchRecipe, mutate } from "./api.ts";
import { ExtractToSubRecipe } from "./ExtractToSubRecipe.tsx";
import { useIntent } from "./intent.ts";
import { PlanningPass } from "./PlanningPass.tsx";
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
  // One set of ids per intended edit, so a retry after a lost response replays it (useIntent).
  const intent = useIntent();
  const ids = (name: string, args: object) => {
    const key = JSON.stringify([name, args]);
    return { mutationId: intent.id(key, "mutation"), revisionId: intent.id(key, "revision") };
  };
  const changed = async () => {
    intent.reset();
    await queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
    await queryClient.invalidateQueries({ queryKey: ["recipes"] });
  };

  const editRecipe = useMutation({
    mutationFn: async (args: { name: string; servings: number | null }) => {
      const { mutationId, revisionId } = ids("editRecipe", args);
      await mutate(mutationId, "editRecipe", { recipeId, revisionId, ...args });
    },
    onSuccess: changed,
  });
  const moveStep = useMutation({
    mutationFn: async (args: { stepId: string; afterStepId: string | null }) => {
      const { mutationId, revisionId } = ids("moveStep", args);
      await mutate(mutationId, "moveStep", { revisionId, ...args });
    },
    onSuccess: changed,
  });
  const removeStep = useMutation({
    mutationFn: async (stepId: string) => {
      const { mutationId, revisionId } = ids("removeStep", { stepId });
      await mutate(mutationId, "removeStep", { stepId, revisionId });
    },
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
