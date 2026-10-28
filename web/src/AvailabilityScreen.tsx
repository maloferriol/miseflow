import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { type Availability, fetchAvailability, mutate } from "./api.ts";
import { minuteOfDay, timeValue } from "./time-of-day.ts";
import { useIntent } from "./intent.ts";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "To 00:00" means until midnight.
const endOfDay = (value: FormDataEntryValue | null) => {
  const m = minuteOfDay(value);
  return m === 0 ? 1440 : m;
};

// The kitchen's default Service time and the Cook's Availability: weekly hours and date overrides.
// Every save is one named mutation and re-plans the Services on the server.
export function AvailabilityScreen() {
  const queryClient = useQueryClient();
  const availability = useQuery({ queryKey: ["availability"], queryFn: fetchAvailability });
  // One set of ids per intended save, so a retry after a lost response replays it (useIntent).
  const intent = useIntent();
  const onSuccess = async () => {
    intent.reset();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["availability"] }),
      queryClient.invalidateQueries({ queryKey: ["plan"] }),
    ]);
  };

  const setDefault = useMutation({
    mutationFn: async (defaultServiceTime: number) => {
      const key = JSON.stringify(["setKitchenSettings", defaultServiceTime]);
      await mutate(intent.id(key, "mutation"), "setKitchenSettings", { defaultServiceTime });
    },
    onSuccess,
  });
  const setWeek = useMutation({
    mutationFn: async (hours: { weekday: number; start: number; end: number }[]) => {
      const key = JSON.stringify(["setWeeklyAvailability", hours]);
      await mutate(intent.id(key, "mutation"), "setWeeklyAvailability", {
        hours: hours.map((h) => ({ availabilityId: intent.id(key, `row-${h.weekday}`), ...h })),
      });
    },
    onSuccess,
  });
  const setOverride = useMutation({
    mutationFn: async (args: {
      date: string;
      availability:
        { kind: "hours"; start: number; end: number } | { kind: "off" } | { kind: "weekly" };
    }) => {
      const key = JSON.stringify(["setAvailabilityOverride", args]);
      await mutate(intent.id(key, "mutation"), "setAvailabilityOverride", {
        overrideId: intent.id(key, "override"),
        ...args,
      });
    },
    onSuccess,
  });

  if (availability.isPending) return <p>Loading…</p>;
  if (availability.isError) return <p role="alert">{availability.error.message}</p>;
  const data = availability.data;
  const error = setDefault.error ?? setWeek.error ?? setOverride.error;

  function saveDefault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const time = minuteOfDay(new FormData(event.currentTarget).get("defaultServiceTime"));
    if (time !== null) setDefault.mutate(time);
  }

  function saveWeek(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const hours = WEEKDAYS.flatMap((_, weekday) => {
      if (!form.get(`available-${weekday}`)) return [];
      const start = minuteOfDay(form.get(`from-${weekday}`));
      const end = endOfDay(form.get(`to-${weekday}`));
      return start === null || end === null ? [] : [{ weekday, start, end }];
    });
    setWeek.mutate(hours);
  }

  function saveOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get("date") ?? "");
    if (!date) return;
    if (form.get("off")) return setOverride.mutate({ date, availability: { kind: "off" } });
    const start = minuteOfDay(form.get("from"));
    const end = endOfDay(form.get("to"));
    if (start !== null && end !== null)
      setOverride.mutate({ date, availability: { kind: "hours", start, end } });
  }

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
        <button type="submit" disabled={setDefault.isPending}>
          Save default
        </button>
      </form>

      <h3>Every week</h3>
      <WeekForm
        key={JSON.stringify(data.weekly)}
        weekly={data.weekly}
        onSubmit={saveWeek}
        pending={setWeek.isPending}
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
        <button type="submit" disabled={setOverride.isPending}>
          Save override
        </button>
      </form>
      <ul aria-label="Date overrides">
        {data.overrides.map((o) => (
          <li key={o.id}>
            {o.date}:{" "}
            {o.hours ? `${timeValue(o.hours.start)}–${timeValue(o.hours.end)}` : "not available"}{" "}
            <button
              type="button"
              onClick={() => setOverride.mutate({ date: o.date, availability: { kind: "weekly" } })}
            >
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
}: {
  weekly: Availability["weekly"];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
}) {
  return (
    <form onSubmit={onSubmit}>
      {WEEKDAYS.map((name, weekday) => {
        const hours = weekly.find((w) => w.weekday === weekday);
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
