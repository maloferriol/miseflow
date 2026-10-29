// Extract to sub-recipe (ADR 0011): its hook, and the part that renders its view with it.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { mutate } from "./api.ts";
import { useIntent } from "./intent.ts";
import { type ExtractArgs, extractSave } from "./recipe-screen.ts";
import { ExtractToSubRecipeView } from "./RecipeViews.tsx";

/**
 * The typed name and amount, and the extract that moves the ticked Steps into a new sub-recipe.
 * Only state, query-client, intent and mutation hooks: no branches.
 */
export function useExtractToSubRecipe(recipeId: string, onDone: () => void) {
  const queryClient = useQueryClient();
  const intent = useIntent();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("1");
  const extract = useMutation({
    mutationFn: async (args: ExtractArgs) => {
      const call = extractSave(recipeId, args, intent);
      await mutate(call.id, call.name, call.args);
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
  return {
    name,
    amount,
    onName: setName,
    onAmount: setAmount,
    extractPending: extract.isPending,
    extractError: extract.error,
    onExtract: (args: ExtractArgs) => extract.mutate(args),
  };
}

// Moves the selected Steps into a new sub-recipe, leaving one line using it (#84 Q3). Offered
// only for consecutive Steps, which the server checks again.
export function ExtractToSubRecipe({
  recipeId,
  stepIds,
  selected,
  onDone,
}: Readonly<{
  recipeId: string;
  /** The Recipe's live Steps, in order. */
  stepIds: string[];
  selected: string[];
  onDone: () => void;
}>) {
  return (
    <ExtractToSubRecipeView
      {...useExtractToSubRecipe(recipeId, onDone)}
      stepIds={stepIds}
      selected={selected}
    />
  );
}
