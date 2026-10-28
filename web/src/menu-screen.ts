// The Menu screen's decisions (ADR 0011): pure functions the hooks and the views pass through.
import type { Intent } from "./intent.ts";
import { minuteOfDay, timeValue } from "./time-of-day.ts";

/** The Guests field as a guest count, or null when it holds no whole number above zero. */
export function parseGuests(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const guests = Number(text);
  return guests > 0 ? guests : null;
}

/** The New Menu form's name and Guests, or null when either is missing. */
export function newMenuInput(
  name: string,
  guests: string,
): { name: string; guestCount: number } | null {
  const guestCount = parseGuests(guests);
  return name.trim() && guestCount ? { name: name.trim(), guestCount } : null;
}

/** A Service's date and time of day: a minute of day, or null for the kitchen's default. */
export type ServiceInput = { date: string; time: number | null };

/**
 * The Service form's fields as what to save, or null when there is nothing to save: no date,
 * or a time that isn't a time of day.
 */
export function serviceInput(date: string, time: string): ServiceInput | null {
  if (!date) return null;
  if (!time) return { date, time: null };
  const minute = minuteOfDay(time);
  // A time of day writes back as itself; "24:00" or "19:60" don't.
  return minute !== null && timeValue(minute) === time.slice(0, 5) ? { date, time: minute } : null;
}

/** How a Dish is scaled: by the guest count, to a portion count, or by a factor (units spec §5). */
export type ScaleKind = "guests" | "portions" | "factor";

export type DishScale =
  { kind: "guests" } | { kind: "portions"; portions: number } | { kind: "factor"; factor: number };

/** The scale the Dish's form opens on: Factor when the cook set one, else Guests. */
export function openingScaleKind(scale: { source: "guests" | "set" | "assumed" }): ScaleKind {
  return scale.source === "set" ? "factor" : "guests";
}

/** The scale the form saves, from its kind and its number field. */
export function dishScale(kind: ScaleKind, value: string): DishScale {
  if (kind === "guests") return { kind };
  return kind === "portions" ? { kind, portions: Number(value) } : { kind, factor: Number(value) };
}

/** One named mutation (ADR 0007) and the id that makes a retry of it replay. */
export type MutationCall = { id: string; name: string; args: Record<string, unknown> };

/** Sets a Dish's scale, with one mutation id per intended scale. */
export function dishScaleSave(
  dishId: string,
  scale: DishScale,
  intent: Pick<Intent, "id">,
): MutationCall {
  const key = JSON.stringify([dishId, scale]);
  return { id: intent.id(key, "mutation"), name: "setDishScale", args: { dishId, scale } };
}

/**
 * Saves the Menu's one Service: creates it when the Menu has none, else sets its date and time.
 * A retry of the same save keeps its ids, the new Service's id included.
 */
export function serviceSave(
  menuId: string,
  service: { id: string } | null,
  input: ServiceInput,
  intent: Pick<Intent, "id">,
): MutationCall {
  const key = JSON.stringify([service?.id ?? null, input]);
  const id = intent.id(key, "mutation");
  return service
    ? { id, name: "setServiceTime", args: { serviceId: service.id, ...input } }
    : {
        id,
        name: "createService",
        args: { serviceId: intent.id(key, "service"), menuId, ...input },
      };
}
