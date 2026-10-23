import type { RecipeSnapshot } from "./snapshot.ts";

export type DerivedIngredient = {
  lineId: string;
  stepId: string;
  ingredientId: string | null;
  subRecipeId: string | null;
  wording: string | null;
  quantity: number | null;
  quantityMax: number | null;
  unit: string | null;
  preparation: string | null;
  fixedQuantity: boolean;
};

/** The Recipe's ingredient list: one item per live line, in Step then line order, not summed. */
export function deriveIngredientList(snapshot: RecipeSnapshot): DerivedIngredient[] {
  return snapshot.steps.flatMap((step) =>
    step.lines.map((line) => ({
      lineId: line.id,
      stepId: step.id,
      ingredientId: line.ingredientId,
      subRecipeId: line.subRecipeId,
      wording: line.wording,
      quantity: line.quantity,
      quantityMax: line.quantityMax,
      unit: line.unit,
      preparation: line.preparation,
      fixedQuantity: line.fixedQuantity,
    })),
  );
}
