import { effectiveMakeAhead, readyToPlan } from "@miseflow/shared/src/recipe/planning.ts";
import type {
  RecipeSnapshot,
  SnapshotDependency,
  SnapshotStep,
} from "@miseflow/shared/src/recipe/snapshot.ts";
import type { Recipe } from "../src/api.ts";

type StepInput = Partial<Omit<SnapshotStep, "id" | "body" | "lines">> & {
  id: string;
  text: string;
};

/**
 * A Recipe read for the Planning pass, built the way the server's Recipe route builds it: each
 * Step's effective window and the Ready to plan checklist come from the shared core run on the
 * snapshot. Its Steps carry no Ingredient lines.
 */
export function planningRecipe({
  id = "r-stock",
  makeAhead = null,
  latestRevision = 7,
  steps,
  dependencies = [],
}: {
  id?: string;
  makeAhead?: RecipeSnapshot["makeAhead"];
  latestRevision?: number;
  steps: StepInput[];
  dependencies?: SnapshotDependency[];
}): Recipe {
  const snapshotSteps: SnapshotStep[] = steps.map(({ text, ...step }, index) => ({
    position: `a${index}`,
    body: [{ type: "text", text }],
    lines: [],
    activeMinutes: null,
    passiveMinutes: null,
    makeAhead: null,
    groupWithPrevious: false,
    ...step,
  }));
  const snapshot: RecipeSnapshot = {
    name: "Chicken stock",
    servings: null,
    yield: null,
    makeAhead,
    steps: snapshotSteps,
    dependencies,
  };
  return {
    id,
    name: snapshot.name,
    servings: null,
    yield: null,
    usedBy: [],
    needsYield: false,
    makeAhead,
    latestRevision,
    steps: snapshotSteps.map((step) => ({
      id: step.id,
      position: step.position,
      body: step.body,
      lines: [],
      activeMinutes: step.activeMinutes,
      passiveMinutes: step.passiveMinutes,
      makeAhead: step.makeAhead,
      effectiveMakeAhead: effectiveMakeAhead(step, snapshot),
      groupWithPrevious: step.groupWithPrevious,
    })),
    ingredients: [],
    dependencies,
    readyToPlan: readyToPlan(snapshot, new Map()),
  };
}
