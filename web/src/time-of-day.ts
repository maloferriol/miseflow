// Minutes of day as <input type="time"> values: pure, so views and their tests can use them.

/** A minute of day as an <input type="time"> value ("18:00"); 1440 reads as "00:00". */
export function timeValue(minuteOfDay: number) {
  const m = minuteOfDay % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** An <input type="time"> value as a minute of day, or null when empty. */
export function minuteOfDay(value: FormDataEntryValue | null): number | null {
  const text = typeof value === "string" ? value : "";
  if (!/^\d{2}:\d{2}/.test(text)) return null;
  return Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
}
