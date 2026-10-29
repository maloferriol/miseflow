import { describe, expect, it } from "vitest";
import { chickenStockWithYield, tarteTatin, yieldOf24 } from "../test/recipe-fixtures.ts";
import { createIntent } from "./intent.ts";
import {
  extractInput,
  extractOffer,
  extractSave,
  ingredientText,
  liveSelection,
  modeFromSearch,
  recipeInput,
  searchWithMode,
  stepMoves,
  toggleSelection,
  yieldInput,
  yieldSave,
  yieldText,
} from "./recipe-screen.ts";

const stepIds = tarteTatin.steps.map((s) => s.id); // s-rub, s-rest, s-caramelise
const anId: unknown = expect.any(String);

describe("the mode a link opens on", () => {
  it("is Plan for mode=plan", () => {
    expect(modeFromSearch("?view=recipe&recipe=r-tarte&mode=plan")).toBe("plan");
  });

  it("is Write with no mode, or any other mode", () => {
    expect(modeFromSearch("?view=recipe&recipe=r-tarte")).toBe("write");
    expect(modeFromSearch("?view=recipe&recipe=r-tarte&mode=write")).toBe("write");
    expect(modeFromSearch("?mode=PLAN")).toBe("write");
    expect(modeFromSearch("")).toBe("write");
  });

  it("switches in the link, keeping the rest of it", () => {
    expect(searchWithMode("?view=recipe&recipe=r-tarte", "plan")).toBe(
      "?view=recipe&recipe=r-tarte&mode=plan",
    );
    expect(searchWithMode("?view=recipe&mode=plan&recipe=r-tarte", "write")).toBe(
      "?view=recipe&recipe=r-tarte",
    );
    expect(searchWithMode("?view=recipe&recipe=r-tarte&mode=plan", "plan")).toBe(
      "?view=recipe&recipe=r-tarte&mode=plan",
    );
  });
});

describe("the Recipe form's input", () => {
  it("trims the name and reads Servings as a number", () => {
    expect(recipeInput("  Tarte tatin ", " 6 ")).toEqual({ name: "Tarte tatin", servings: 6 });
    expect(recipeInput("Tarte tatin", "0.01")).toEqual({ name: "Tarte tatin", servings: 0.01 });
  });

  it("clears Servings when the field is blank", () => {
    expect(recipeInput("Tarte tatin", "  ")).toEqual({ name: "Tarte tatin", servings: null });
  });

  it("saves nothing for a blank name, whatever Servings holds", () => {
    expect(recipeInput("   ", "6")).toBeNull();
    expect(recipeInput("", "")).toBeNull();
  });
});

describe("moving a Step", () => {
  it("puts it after the Step two above to move it up, and after the Step below to move it down", () => {
    expect(stepMoves(stepIds, 0)).toEqual({
      up: null,
      down: { stepId: "s-rub", afterStepId: "s-rest" },
    });
    expect(stepMoves(stepIds, 1)).toEqual({
      up: { stepId: "s-rest", afterStepId: null },
      down: { stepId: "s-rest", afterStepId: "s-caramelise" },
    });
    expect(stepMoves(stepIds, 2)).toEqual({
      up: { stepId: "s-caramelise", afterStepId: "s-rub" },
      down: null,
    });
  });

  it("can't move a Recipe's only Step", () => {
    expect(stepMoves(["s-rub"], 0)).toEqual({ up: null, down: null });
  });
});

describe("ticking Steps", () => {
  it("adds a ticked Step and drops an unticked one", () => {
    expect(toggleSelection(["s-rub"], "s-rest", true)).toEqual(["s-rub", "s-rest"]);
    expect(toggleSelection(["s-rub", "s-rest"], "s-rub", false)).toEqual(["s-rest"]);
  });

  it("keeps only the ticked Steps the Recipe still has", () => {
    expect(liveSelection(stepIds, ["s-rest", "s-gone", "s-rub"])).toEqual(["s-rest", "s-rub"]);
    expect(liveSelection([], ["s-rub"])).toEqual([]);
  });
});

describe("the ingredient list", () => {
  const lines = new Map(tarteTatin.steps.flatMap((s) => s.lines).map((l) => [l.id, l]));
  const rows = tarteTatin.ingredients.map((item) => ingredientText(item, lines.get(item.lineId)));

  it("shows each line's amount, wording and preparation, naming the Ingredient when it differs", () => {
    expect(rows).toEqual([
      "100 g butter, cold, diced",
      "200 g flour (all-purpose flour)",
      "150 g sugar",
      "6 apples, halved (apple)",
    ]);
  });

  it("shows a range, and a line with no amount or no linked Ingredient as its wording", () => {
    const [butter] = tarteTatin.ingredients;
    expect(ingredientText({ ...butter, quantity: 1, quantityMax: 2, unit: null }, undefined)).toBe(
      "1-2 butter, cold, diced",
    );
    expect(
      ingredientText(
        { ...butter, quantity: null, unit: null, preparation: null, wording: "salt" },
        { ingredient: null },
      ),
    ).toBe("salt");
  });
});

describe("the yield", () => {
  it("shows as its quantity and unit, or blank when there is none", () => {
    expect(yieldText(chickenStockWithYield.yield)).toBe("1.5 L");
    expect(yieldText(yieldOf24)).toBe("24");
    expect(yieldText(null)).toBe("");
  });

  it("saves the trimmed text, or clears it when blank", () => {
    expect(yieldInput("  1.5 L ")).toBe("1.5 L");
    expect(yieldInput("   ")).toBeNull();
  });

  it("is saved with setYield, and a retry of the same yield keeps its ids", () => {
    const intent = createIntent();
    const first = yieldSave("r-stock", "1.5 L", intent);
    expect(first).toEqual({
      id: anId,
      name: "setYield",
      args: { recipeId: "r-stock", revisionId: anId, yield: "1.5 L" },
    });
    expect(yieldSave("r-stock", "1.5 L", intent)).toEqual(first);

    const cleared = yieldSave("r-stock", null, intent);
    expect(cleared.args).toMatchObject({ yield: null });
    expect(cleared.id).not.toBe(first.id);
    expect(cleared.args.revisionId).not.toBe(first.args.revisionId);
  });
});

describe("Extract to sub-recipe", () => {
  it("is offered for Steps that follow one another", () => {
    expect(extractOffer(stepIds, ["s-rub", "s-rest"])).toEqual({
      consecutive: true,
      showHint: false,
    });
    expect(extractOffer(stepIds, ["s-caramelise"])).toEqual({
      consecutive: true,
      showHint: false,
    });
  });

  it("asks for Steps that follow one another once a gap is ticked", () => {
    expect(extractOffer(stepIds, ["s-rub", "s-caramelise"])).toEqual({
      consecutive: false,
      showHint: true,
    });
  });

  it("isn't offered, and says nothing, before a Step is ticked", () => {
    expect(extractOffer(stepIds, [])).toEqual({ consecutive: false, showHint: false });
  });

  it("isn't offered for a Step the Recipe doesn't have", () => {
    expect(extractOffer(stepIds, ["s-rest", "s-gone"])).toEqual({
      consecutive: false,
      showHint: true,
    });
  });

  it("saves the Steps in Step order, with the trimmed name and amount", () => {
    expect(extractInput(stepIds, ["s-rest", "s-rub"], "  Pastry ", " 500%g ")).toEqual({
      stepIds: ["s-rub", "s-rest"],
      name: "Pastry",
      amount: "500%g",
    });
  });

  it("uses an amount of 1 when the amount is blank", () => {
    expect(extractInput(stepIds, ["s-rub", "s-rest"], "Pastry", "  ")).toEqual({
      stepIds: ["s-rub", "s-rest"],
      name: "Pastry",
      amount: "1",
    });
  });

  it("can't go without a name, or for Steps with a gap, or with nothing ticked", () => {
    expect(extractInput(stepIds, ["s-rub", "s-rest"], "   ", "1")).toBeNull();
    expect(extractInput(stepIds, ["s-rub", "s-caramelise"], "Pastry", "1")).toBeNull();
    expect(extractInput(stepIds, ["s-rub", "s-caramelise"], "", "1")).toBeNull();
    expect(extractInput(stepIds, [], "Pastry", "1")).toBeNull();
  });

  it("is saved with extractToSubRecipe, and a retry of the same extract keeps its ids", () => {
    const intent = createIntent();
    const args = { stepIds: ["s-rub", "s-rest"], name: "Pastry", amount: "1" };
    const first = extractSave("r-tarte", args, intent);
    expect(first).toEqual({
      id: anId,
      name: "extractToSubRecipe",
      args: {
        recipeId: "r-tarte",
        revisionId: anId,
        subRecipeId: anId,
        subRecipeRevisionId: anId,
        stepId: anId,
        lineId: anId,
        stepIds: ["s-rub", "s-rest"],
        name: "Pastry",
        amount: "1",
      },
    });
    const made = [
      first.id,
      first.args.revisionId,
      first.args.subRecipeId,
      first.args.subRecipeRevisionId,
      first.args.stepId,
      first.args.lineId,
    ];
    expect(new Set(made).size).toBe(6);
    expect(extractSave("r-tarte", args, intent)).toEqual(first);
    expect(extractSave("r-tarte", { ...args, name: "Pâte brisée" }, intent).id).not.toBe(first.id);
  });
});
