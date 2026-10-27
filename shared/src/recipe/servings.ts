/**
 * The servings a Recipe can have. Inclusive, so the editRecipe check and the Recipe screen's
 * number input share one min and max (an input can't say "above 0").
 */
export const SERVINGS = { min: 0.01, max: 10_000 };
