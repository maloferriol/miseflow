// The Availability screen's view (ADR 0011): props only, so its tests render it without the API.
import type { SubmitEvent } from "react";
import type { Availability } from "./api.ts";
import {
  defaultServiceTimeInput,
  type OverrideInput,
  overrideHours,
  overrideInput,
  WEEKDAYS,
  weekdayHours,
  weekHours,
  type WeeklyHours,
} from "./availability-screen.ts";
import type { QueryState } from "./MenuViews.tsx";
import { timeValue } from "./time-of-day.ts";

/** A submit handler that reads the form's fields with `send`. */
function onFields(send: (form: FormData) => void) {
  return (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    send(new FormData(event.currentTarget));
  };
}

export type AvailabilityViewProps = {
  availability: QueryState<Availability>;
  defaultPending: boolean;
  weekPending: boolean;
  overridePending: boolean;
  error: Error | null;
  onSaveDefault: (defaultServiceTime: number) => void;
  onSaveWeek: (hours: WeeklyHours[]) => void;
  onSaveOverride: (input: OverrideInput) => void;
  onRemoveOverride: (date: string) => void;
};

// The kitchen's default Service time and the Cook's Availability: weekly hours and date overrides.
export function AvailabilityView({
  availability,
  defaultPending,
  weekPending,
  overridePending,
  error,
  onSaveDefault,
  onSaveWeek,
  onSaveOverride,
  onRemoveOverride,
}: Readonly<AvailabilityViewProps>) {
  if (availability.status === "pending") return <p>Loading…</p>;
  if (availability.status === "error") return <p role="alert">{availability.error.message}</p>;
  const data = availability.data;

  const saveDefault = onFields((form) => {
    const time = defaultServiceTimeInput(form);
    if (time !== null) onSaveDefault(time);
  });
  const saveOverride = onFields((form) => {
    const input = overrideInput(form);
    if (input) onSaveOverride(input);
  });

  return (
    <section>
      <h2>Availability</h2>
      <p>Times are in the kitchen's time zone, {data.timeZone}.</p>
      <form onSubmit={saveDefault}>
        <label>
          Default Service time{" "}
          <input
            name="defaultServiceTime"
            type="time"
            step={300}
            defaultValue={timeValue(data.defaultServiceTime)}
            required
          />
        </label>
        <button type="submit" disabled={defaultPending}>
          Save default
        </button>
      </form>

      <h3>Every week</h3>
      <WeekForm
        key={JSON.stringify(data.weekly)}
        weekly={data.weekly}
        onSubmit={onFields((form) => onSaveWeek(weekHours(form)))}
        pending={weekPending}
      />

      <h3>Date overrides</h3>
      <form onSubmit={saveOverride}>
        <label>
          Date <input name="date" type="date" required />
        </label>
        <label>
          From <input name="from" type="time" step={300} />
        </label>
        <label>
          To <input name="to" type="time" step={300} />
        </label>
        <label>
          <input name="off" type="checkbox" /> Not available
        </label>
        <button type="submit" disabled={overridePending}>
          Save override
        </button>
      </form>
      <ul aria-label="Date overrides">
        {data.overrides.map((o) => (
          <li key={o.id}>
            {o.date}: {overrideHours(o)}{" "}
            <button type="button" onClick={() => onRemoveOverride(o.date)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error.message}</p>}
    </section>
  );
}

function WeekForm({
  weekly,
  onSubmit,
  pending,
}: Readonly<{
  weekly: Availability["weekly"];
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  pending: boolean;
}>) {
  return (
    <form onSubmit={onSubmit}>
      {WEEKDAYS.map((name, weekday) => {
        const hours = weekdayHours(weekly, weekday);
        return (
          <fieldset key={name}>
            <legend>{name}</legend>
            <label>
              <input name={`available-${weekday}`} type="checkbox" defaultChecked={!!hours} />{" "}
              Available
            </label>
            <label>
              From{" "}
              <input
                name={`from-${weekday}`}
                type="time"
                step={300}
                defaultValue={hours ? timeValue(hours.start) : ""}
              />
            </label>
            <label>
              To{" "}
              <input
                name={`to-${weekday}`}
                type="time"
                step={300}
                defaultValue={hours ? timeValue(hours.end) : ""}
              />
            </label>
          </fieldset>
        );
      })}
      <button type="submit" disabled={pending}>
        Save week
      </button>
    </form>
  );
}
