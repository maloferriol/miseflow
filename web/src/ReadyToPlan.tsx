import type { Recipe, RecipeStep } from "./api.ts";

/** "Step 2 · Simmer for four hours", cut short for a list. */
export function stepLabel(step: RecipeStep, index: number) {
  const wording = new Map(step.lines.map((l) => [l.id, l.wording ?? ""]));
  const text = step.body
    .map((t) => (t.type === "text" ? t.text : (wording.get(t.lineId) ?? "")))
    .join("")
    .trim()
    .replace(/\s+/g, " ");
  return `Step ${index + 1} · ${text.length > 40 ? `${text.slice(0, 39)}…` : text}`;
}

// What the scheduler still lacks, and likely duplicates, as the server computed them (#85 Q10).
// Each item links to its Step's row in the Planning pass.
export function ReadyToPlan({ recipe }: { recipe: Recipe }) {
  const { steps, readyToPlan } = recipe;
  const index = new Map(steps.map((s, i) => [s.id, i]));
  const lines = new Map(steps.flatMap((s) => s.lines).map((l) => [l.id, l]));
  const label = (stepId: string) => stepLabel(steps[index.get(stepId)!], index.get(stepId)!);
  const items = [
    ...readyToPlan.missingDuration.map((stepId) => ({
      key: `missing-${stepId}`,
      stepId,
      text: `${label(stepId)} has no duration`,
    })),
    ...readyToPlan.duplicates.map(({ stepId, lineId }) => {
      const line = lines.get(lineId);
      const repeated = [line?.wording, line?.preparation].filter(Boolean).join(", ");
      return {
        key: `duplicate-${stepId}-${lineId}`,
        stepId,
        text: `${label(stepId)} may repeat '${repeated}'`,
      };
    }),
  ];

  return (
    <section>
      <h3>Ready to plan</h3>
      <ul aria-label="Ready to plan">
        {items.map((item) => (
          <li key={item.key}>
            <a href={`#plan-step-${item.stepId}`}>{item.text}</a>
          </li>
        ))}
      </ul>
      {items.length === 0 && <p>Every Step has a duration</p>}
    </section>
  );
}
