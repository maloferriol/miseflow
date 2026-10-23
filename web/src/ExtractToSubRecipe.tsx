import { areConsecutive } from "@miseflow/shared/src/recipe/subrecipes.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { mutate } from "./api.ts";
import { useIntent } from "./intent.ts";

// Moves the selected Steps into a new sub-recipe, leaving one line using it (#84 Q3). Offered
// only for consecutive Steps, which the server checks again.
export function ExtractToSubRecipe({
  recipeId,
  stepIds,
  selected,
  onDone,
}: {
  recipeId: string;
  /** The Recipe's live Steps, in order. */
  stepIds: string[];
  selected: string[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const intent = useIntent();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("1");
  const extract = useMutation({
    mutationFn: async (args: { stepIds: string[]; name: string; amount: string }) => {
      const key = JSON.stringify(["extractToSubRecipe", args]);
      const id = (what: string) => intent.id(key, what);
      await mutate(id("mutation"), "extractToSubRecipe", {
        recipeId,
        revisionId: id("revision"),
        subRecipeId: id("subRecipe"),
        subRecipeRevisionId: id("subRecipeRevision"),
        stepId: id("step"),
        lineId: id("line"),
        ...args,
      });
    },
    onSuccess: async () => {
      intent.reset();
      setName("");
      setAmount("1");
      await queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      onDone();
    },
  });
  const consecutive = areConsecutive(stepIds, selected);

  return (
    <fieldset>
      <legend>Extract to sub-recipe</legend>
      <label>
        Name for the sub-recipe{" "}
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Amount used{" "}
        <input value={amount} maxLength={100} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <button
        type="button"
        disabled={!consecutive || !name.trim() || extract.isPending}
        onClick={() =>
          extract.mutate({
            // In Step order, so a retry of the same selection is the same intent.
            stepIds: stepIds.filter((id) => selected.includes(id)),
            name: name.trim(),
            amount: amount.trim() || "1",
          })
        }
      >
        Extract to sub-recipe
      </button>
      {selected.length > 0 && !consecutive && (
        <p>Select Steps that follow one another.</p>
      )}
      {extract.error && <p role="alert">{extract.error.message}</p>}
    </fieldset>
  );
}
