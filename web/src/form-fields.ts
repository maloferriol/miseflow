// Reading what the cook typed into a form: pure, so the views and cores share one reading.

/** A form field's text, or "" when the field is missing or holds a file. */
export function fieldText(form: Pick<FormData, "get">, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** A text field's text, trimmed, or null when it is blank. */
export function trimmedOrNull(text: string): string | null {
  return text.trim() || null;
}
