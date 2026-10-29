// The Planning pass's view (ADR 0011): props only, no fetching.
import { type FormEvent, useState } from "react";
import type { Recipe, RecipeStep } from "./api.ts";
import {
  clearsOwnWindow,
  groupsWithPrevious,
  inheritedWindowText,
  linkChoices,
  opensOwnWindow,
  type StepTimes,
  waitsFor,
  type Window,
  windowInput,
  stepTimesInput,
} from "./planning-pass.ts";
import { ReadyToPlan, stepLabel } from "./ReadyToPlan.tsx";

const field = (data: FormData, name: string) => String(data.get(name) ?? "");

function windowFrom(event: FormEvent<HTMLFormElement>): Window {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  return windowInput(field(data, "beforeDays"), field(data, "shelfLifeDays"));
}

export type PlanningPassViewProps = {
  recipe: Recipe;
  /** A make-ahead window save is in flight, on the Recipe or any Step. */
  windowPending: boolean;
  /** The first failed save's error, of any of the pass's mutations. */
  error: Error | null;
  onRecipeWindow: (window: Window | null) => void;
  onStepTimes: (stepId: string, times: StepTimes) => void;
  onStepWindow: (stepId: string, window: Window | null) => void;
  onGroup: (stepId: string, value: boolean) => void;
  onAddLink: (stepId: string, beforeStepId: string) => void;
  onRemoveLink: (dependencyId: string) => void;
};

// The Planning pass (spec §2): the times, make-ahead windows, groups and links the scheduler
// needs. Every control is one named mutation that appends one Revision.
export function PlanningPassView({
  recipe,
  windowPending,
  error,
  onRecipeWindow,
  onStepTimes,
  onStepWindow,
  onGroup,
  onAddLink,
  onRemoveLink,
}: Readonly<PlanningPassViewProps>) {
  return (
    <section>
      <ReadyToPlan recipe={recipe} />
      <h3>Make-ahead window</h3>
      {/* Keyed on the Revision, so the fields show the saved values after each edit. */}
      <form key={recipe.latestRevision} onSubmit={(event) => onRecipeWindow(windowFrom(event))}>
        <WindowFields window={recipe.makeAhead} />
        <button type="submit" disabled={windowPending}>
          Save window
        </button>
        <button
          type="button"
          disabled={windowPending || recipe.makeAhead === null}
          onClick={() => onRecipeWindow(null)}
        >
          Clear
        </button>
      </form>
      {error && <p role="alert">{error.message}</p>}

      <h3>Steps</h3>
      <ol aria-label="Planning">
        {recipe.steps.map((step, index) => (
          <PlanningRow
            key={`${step.id}-${recipe.latestRevision}`}
            recipe={recipe}
            step={step}
            index={index}
            onTimes={(times) => onStepTimes(step.id, times)}
            onWindow={(window) => onStepWindow(step.id, window)}
            onGroup={(value) => onGroup(step.id, value)}
            onAddLink={(beforeStepId) => onAddLink(step.id, beforeStepId)}
            onRemoveLink={onRemoveLink}
          />
        ))}
      </ol>
    </section>
  );
}

function WindowFields({ window }: Readonly<{ window: Window | null }>) {
  return (
    <>
      <label>
        Days ahead{" "}
        <input
          name="beforeDays"
          required
          type="number"
          min={0}
          max={30}
          step={1}
          defaultValue={window?.beforeDays ?? ""}
        />
      </label>
      <label>
        Shelf life (days){" "}
        <input
          name="shelfLifeDays"
          required
          type="number"
          min={0}
          max={365}
          step={1}
          defaultValue={window?.shelfLifeDays ?? ""}
        />
      </label>
    </>
  );
}

function PlanningRow({
  recipe,
  step,
  index,
  onTimes,
  onWindow,
  onGroup,
  onAddLink,
  onRemoveLink,
}: Readonly<{
  recipe: Recipe;
  step: RecipeStep;
  index: number;
  onTimes: (times: StepTimes) => void;
  onWindow: (window: Window | null) => void;
  onGroup: (value: boolean) => void;
  onAddLink: (beforeStepId: string) => void;
  onRemoveLink: (dependencyId: string) => void;
}>) {
  // Set once when the row opens (it is keyed on the Revision), then by the checkbox.
  const [ownWindow, setOwnWindow] = useState(() => opensOwnWindow(step));
  const waits = waitsFor(recipe, step.id);

  function onTimesSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onTimes(stepTimesInput(field(data, "activeMinutes"), field(data, "passiveMinutes")));
  }
  function onLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const before = field(new FormData(event.currentTarget), "beforeStepId");
    if (before) onAddLink(before);
  }

  return (
    <li id={`plan-step-${step.id}`}>
      <p>{stepLabel(step, index)}</p>
      <form onSubmit={onTimesSubmit}>
        <label>
          Active minutes{" "}
          <input
            name="activeMinutes"
            type="number"
            min={0}
            max={10080}
            step={1}
            defaultValue={step.activeMinutes ?? ""}
          />
        </label>
        <label>
          Passive minutes{" "}
          <input
            name="passiveMinutes"
            type="number"
            min={0}
            max={10080}
            step={1}
            defaultValue={step.passiveMinutes ?? ""}
          />
        </label>
        <button type="submit">Save times</button>
      </form>

      <label>
        <input
          type="checkbox"
          checked={ownWindow}
          onChange={(event) => {
            setOwnWindow(event.target.checked);
            if (clearsOwnWindow(event.target.checked, step)) onWindow(null);
          }}
        />{" "}
        Own make-ahead window
      </label>
      {ownWindow ? (
        <form onSubmit={(event) => onWindow(windowFrom(event))}>
          <WindowFields window={step.makeAhead} />
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>{inheritedWindowText(step.effectiveMakeAhead)}</p>
      )}

      <label>
        <input
          type="checkbox"
          checked={groupsWithPrevious(step, index)}
          disabled={index === 0}
          onChange={(event) => onGroup(event.target.checked)}
        />{" "}
        Group with previous Step
      </label>

      <form onSubmit={onLinkSubmit}>
        <label>
          Waits for{" "}
          <select name="beforeStepId" defaultValue="">
            <option value="">Choose a Step</option>
            {linkChoices(recipe, step.id).map((other) => (
              <option key={other.id} value={other.id}>
                {other.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Add</button>
      </form>
      {waits.length > 0 && (
        <ul aria-label="Waits for">
          {waits.map((d) => (
            <li key={d.id}>
              {d.label}{" "}
              <button type="button" onClick={() => onRemoveLink(d.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
