import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { mutate, type Recipe, type RecipeStep } from "./api.ts";
import { useIntent } from "./intent.ts";
import { ReadyToPlan, stepLabel } from "./ReadyToPlan.tsx";

type Window = { beforeDays: number; shelfLifeDays: number };
type Target = { kind: "recipe"; recipeId: string } | { kind: "step"; stepId: string };

// An empty field is "not set"; anything else goes to the server as typed, which validates it.
const numberOrNull = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
};

const windowText = (w: Window) => `${w.beforeDays} days ahead · keeps ${w.shelfLifeDays} days`;

// The Planning pass (spec §2): the times, make-ahead windows, groups and links the scheduler
// needs. Every control is one named mutation that appends one Revision.
export function PlanningPass({ recipe }: { recipe: Recipe }) {
  const queryClient = useQueryClient();
  // One set of ids per intended save, so a retry after a lost response replays it (useIntent).
  const intent = useIntent();
  const ids = (name: string, args: object) => {
    const key = JSON.stringify([name, args]);
    return {
      mutationId: intent.id(key, "mutation"),
      revisionId: intent.id(key, "revision"),
      dependencyId: intent.id(key, "dependency"),
    };
  };
  const onSuccess = async () => {
    intent.reset();
    await queryClient.invalidateQueries({ queryKey: ["recipe", recipe.id] });
  };

  const setStepTimes = useMutation({
    mutationFn: async (args: {
      stepId: string;
      activeMinutes: number | null;
      passiveMinutes: number | null;
    }) => {
      const { mutationId, revisionId } = ids("setStepTimes", args);
      await mutate(mutationId, "setStepTimes", { revisionId, ...args });
    },
    onSuccess,
  });
  const setMakeAhead = useMutation({
    mutationFn: async (args: { target: Target; window: Window | null }) => {
      const { mutationId, revisionId } = ids("setMakeAhead", args);
      await mutate(mutationId, "setMakeAhead", { revisionId, ...args });
    },
    onSuccess,
  });
  const setGroupWithPrevious = useMutation({
    mutationFn: async (args: { stepId: string; value: boolean }) => {
      const { mutationId, revisionId } = ids("setGroupWithPrevious", args);
      await mutate(mutationId, "setGroupWithPrevious", { revisionId, ...args });
    },
    onSuccess,
  });
  const addStepDependency = useMutation({
    mutationFn: async (args: { beforeStepId: string; afterStepId: string }) => {
      const { mutationId, revisionId, dependencyId } = ids("addStepDependency", args);
      await mutate(mutationId, "addStepDependency", {
        revisionId,
        dependencyId,
        ...args,
      });
    },
    onSuccess,
  });
  // A re-added pair keeps its old id, so links are removed by the id the read returns.
  const removeStepDependency = useMutation({
    mutationFn: async (dependencyId: string) => {
      const { mutationId, revisionId } = ids("removeStepDependency", {
        dependencyId,
      });
      await mutate(mutationId, "removeStepDependency", {
        revisionId,
        dependencyId,
      });
    },
    onSuccess,
  });
  const error = [
    setStepTimes,
    setMakeAhead,
    setGroupWithPrevious,
    addStepDependency,
    removeStepDependency,
  ].find((m) => m.error)?.error;

  function onRecipeWindow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setMakeAhead.mutate({
      target: { kind: "recipe", recipeId: recipe.id },
      window: {
        beforeDays: Number(data.get("beforeDays")),
        shelfLifeDays: Number(data.get("shelfLifeDays")),
      },
    });
  }

  return (
    <section>
      <ReadyToPlan recipe={recipe} />
      <h3>Make-ahead window</h3>
      {/* Keyed on the Revision, so the fields show the saved values after each edit. */}
      <form key={recipe.latestRevision} onSubmit={onRecipeWindow}>
        <WindowFields window={recipe.makeAhead} />
        <button type="submit" disabled={setMakeAhead.isPending}>
          Save window
        </button>
        <button
          type="button"
          disabled={setMakeAhead.isPending || recipe.makeAhead === null}
          onClick={() =>
            setMakeAhead.mutate({
              target: { kind: "recipe", recipeId: recipe.id },
              window: null,
            })
          }
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
            onTimes={(times) => setStepTimes.mutate({ stepId: step.id, ...times })}
            onWindow={(window) =>
              setMakeAhead.mutate({
                target: { kind: "step", stepId: step.id },
                window,
              })
            }
            onGroup={(value) => setGroupWithPrevious.mutate({ stepId: step.id, value })}
            onAddLink={(beforeStepId) =>
              addStepDependency.mutate({ beforeStepId, afterStepId: step.id })
            }
            onRemoveLink={(dependencyId) => removeStepDependency.mutate(dependencyId)}
          />
        ))}
      </ol>
    </section>
  );
}

function WindowFields({ window }: { window: Window | null }) {
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
}: {
  recipe: Recipe;
  step: RecipeStep;
  index: number;
  onTimes: (times: { activeMinutes: number | null; passiveMinutes: number | null }) => void;
  onWindow: (window: Window | null) => void;
  onGroup: (value: boolean) => void;
  onAddLink: (beforeStepId: string) => void;
  onRemoveLink: (dependencyId: string) => void;
}) {
  const [ownWindow, setOwnWindow] = useState(step.makeAhead !== null);
  const label = (id: string) => {
    const at = recipe.steps.findIndex((s) => s.id === id);
    return stepLabel(recipe.steps[at]!, at);
  };
  const waitsFor = recipe.dependencies.filter((d) => d.afterStepId === step.id);
  const others = recipe.steps.filter((s) => s.id !== step.id);

  function onTimesSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onTimes({
      activeMinutes: numberOrNull(data.get("activeMinutes")),
      passiveMinutes: numberOrNull(data.get("passiveMinutes")),
    });
  }
  function onWindowSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onWindow({
      beforeDays: Number(data.get("beforeDays")),
      shelfLifeDays: Number(data.get("shelfLifeDays")),
    });
  }
  function onLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const before = String(new FormData(event.currentTarget).get("beforeStepId") ?? "");
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
            // Unticking a saved window makes the Step inherit its Recipe's again.
            if (!event.target.checked && step.makeAhead) onWindow(null);
          }}
        />{" "}
        Own make-ahead window
      </label>
      {ownWindow ? (
        <form onSubmit={onWindowSubmit}>
          <WindowFields window={step.makeAhead} />
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>
          {step.effectiveMakeAhead
            ? `Inherits ${windowText(step.effectiveMakeAhead)}`
            : "Last-minute"}
        </p>
      )}

      <label>
        <input
          type="checkbox"
          checked={step.groupWithPrevious && index > 0}
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
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {label(other.id)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Add</button>
      </form>
      {waitsFor.length > 0 && (
        <ul aria-label="Waits for">
          {waitsFor.map((d) => (
            <li key={d.id}>
              {label(d.beforeStepId)}{" "}
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
