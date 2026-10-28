import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchIngredients, fetchRecipes, mutate, type RecipeStep } from "./api.ts";
import { IngredientPicker } from "./IngredientPicker.tsx";
import { useIntent } from "./intent.ts";
import { LinkChoice } from "./LinkChoice.tsx";
import {
  blockingSave,
  chipText,
  type Inserted,
  pickerOpensAt,
  settleStepSave,
  stepFormText,
  withLink,
} from "./step-editor.ts";
import { saveStep, type Target } from "./step-links.ts";
import { StepFormView, type Unmatched } from "./StepForm.tsx";

/** One Step: chips in read mode; the `@name{qty%unit}(prep)` shorthand in edit mode (Decision 1). */
export function StepEditor({
  recipeId,
  step,
  onClose,
}: {
  recipeId: string;
  /** Undefined for a new Step, which `addStep` saves on the first Save. */
  step?: RecipeStep;
  onClose?: () => void;
}) {
  const [editing, setEditing] = useState(!step);
  if (step && !editing) {
    const lines = new Map(step.lines.map((l) => [l.id, l]));
    return (
      <div>
        <p>
          {step.body.map((token, i) => {
            if (token.type === "text") return <span key={i}>{token.text}</span>;
            const line = lines.get(token.lineId);
            return line ? (
              <button key={i} type="button" className="chip" onClick={() => setEditing(true)}>
                {chipText(line)}
              </button>
            ) : null;
          })}
        </p>
        <button type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    );
  }
  return (
    <StepForm
      recipeId={recipeId}
      step={step}
      onDone={() => {
        setEditing(false);
        onClose?.();
      }}
    />
  );
}

/** The Step form's state and its Save. Only state, query, mutation and intent hooks: no branches. */
export function useStepForm(recipeId: string, step: RecipeStep | undefined, onDone: () => void) {
  const queryClient = useQueryClient();
  // The Step as the form opened it. A failed save refetches the Recipe, but a line that save
  // made must not count as kept here, or a re-pick for its wording would replay it (#127 A).
  const [opened] = useState(step);
  const [stepId] = useState(() => step?.id ?? crypto.randomUUID());
  const [text, setText] = useState(() => stepFormText(step));
  const [pickerAt, setPickerAt] = useState<number | null>(null);
  // Targets by normalised ref name: picked, matched exactly, aliased or created. So one wording
  // links to one target per Step: a second ref with the same wording shares it (owner decision).
  const [links, setLinks] = useState(() => new Map<string, Target>());
  // Ref names that found no single exact match on the last Save, with their near matches.
  const [unlinked, setUnlinked] = useState<Unmatched[]>([]);

  // One set of ids per intended save, so a retry replays it (see useIntent).
  const intent = useIntent();
  const save = useMutation({
    mutationFn: () =>
      settleStepSave(
        () =>
          saveStep({
            recipeId,
            stepId,
            opened,
            text,
            links,
            loadRecipes: () => queryClient.query({ queryKey: ["recipes"], queryFn: fetchRecipes }),
            findIngredients: fetchIngredients,
            intent,
            send: mutate,
            onResolved: (found, missing) => {
              setLinks(found);
              setUnlinked(missing);
            },
          }),
        async () => {
          await queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
          await queryClient.invalidateQueries({ queryKey: ["recipes"] });
        },
        onDone,
      ),
  });

  return {
    text,
    pickerAt,
    unmatched: blockingSave(unlinked, links, text),
    savePending: save.isPending,
    saveError: save.error,
    onEdit: (next: string, caret: number) => {
      setPickerAt((open) => pickerOpensAt(text, next, caret) ?? open);
      setText(next);
    },
    onInsert: (inserted: Inserted) => {
      setText(inserted.text);
      setPickerAt(null);
      setLinks((prev) => withLink(prev, inserted.link));
    },
    onSave: () => save.mutate(),
    onCancel: onDone,
    link: (wording: string, target: Target) =>
      setLinks((prev) => withLink(prev, { wording, target })),
  };
}

/** One Step in edit mode; `step` is undefined for a new Step, which `addStep` saves. */
function StepForm({
  recipeId,
  step,
  onDone,
}: {
  recipeId: string;
  step?: RecipeStep;
  onDone: () => void;
}) {
  const { link, ...form } = useStepForm(recipeId, step, onDone);
  return (
    <StepFormView
      {...form}
      picker={(choose) => (
        <IngredientPicker
          recipeId={recipeId}
          onPick={(ingredient) => choose({ ingredient })}
          onPickRecipe={(recipe) => choose({ recipe })}
          onClose={(typed) => choose({ typed })}
        />
      )}
      linkChoice={(u) => <LinkChoice {...u} onLinked={(target) => link(u.name, target)} />}
    />
  );
}
