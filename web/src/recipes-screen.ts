// The Recipes list's decisions (ADR 0011): pure functions the hook and the view pass through.

/** The New Recipe form's name, trimmed, or null when it is blank. */
export function recipeName(text: string): string | null {
  return text.trim() || null;
}
