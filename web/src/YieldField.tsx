import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { mutate, type Recipe } from "./api.ts";
import { useIntent } from "./intent.ts";

// "1.5 L", "24"
const yieldText = (value: Recipe["yield"]) =>
  value === null ? "" : [value.quantity, value.unit].filter((p) => p !== null).join(" ");

// The Quantity the Recipe makes (#84). A Recipe used as a sub-recipe needs one (units spec §5).
export function YieldField({ recipe }: { recipe: Recipe }) {
  const queryClient = useQueryClient();
  // One set of ids per intended save, so a retry after a lost response replays it (useIntent).
  const intent = useIntent();
  const setYield = useMutation({
    mutationFn: async (value: string | null) => {
      const key = JSON.stringify(["setYield", value]);
      await mutate(intent.id(key, "mutation"), "setYield", {
        recipeId: recipe.id,
        revisionId: intent.id(key, "revision"),
        yield: value,
      });
    },
    onSuccess: async () => {
      intent.reset();
      await queryClient.invalidateQueries({ queryKey: ["recipe", recipe.id] });
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("yield") ?? "").trim();
    setYield.mutate(value || null);
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
      <button type="submit" disabled={setYield.isPending}>
        Save yield
      </button>
      {recipe.needsYield && (
        <p>
          <strong>needs a yield</strong>: used as a sub-recipe by{" "}
          {recipe.usedBy.map((r) => r.name).join(", ")}
        </p>
      )}
      {setYield.error && <p role="alert">{setYield.error.message}</p>}
    </form>
  );
}
