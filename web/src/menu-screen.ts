// The Menu screen's decisions (ADR 0011): pure functions the hooks and the views pass through.

/** The Guests field as a guest count, or null when it holds no whole number above zero. */
export function parseGuests(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const guests = Number(text);
  return guests > 0 ? guests : null;
}
