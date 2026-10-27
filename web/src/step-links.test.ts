import { normaliseName } from "@miseflow/shared/src/catalog/match.ts";
import { parseStepText } from "@miseflow/shared/src/recipe/tokens.ts";
import { describe, expect, it } from "vitest";
import { createIntent } from "./intent.ts";
import {
  catalogLookup,
  linkChoiceMutation,
  linkChoices,
  saveStep,
  type Lookup,
  resolveStepLinks,
  type Send,
  sendLinkChoice,
  sendStepSave,
  stepIntentKey,
  stepSaveArgs,
  type Target,
} from "./step-links.ts";

type Ingredient = { id: string; name: string; exact: boolean };
type Recipe = { id: string; name: string };

// A catalog answer per ref name; it records which names were looked up.
function catalog(answers: Record<string, Awaited<ReturnType<Lookup<Ingredient, Recipe>>>>) {
  const asked: string[] = [];
  const lookup: Lookup<Ingredient, Recipe> = (name) => {
    asked.push(name);
    return Promise.resolve(answers[name] ?? { ingredients: [], recipes: [] });
  };
  return { lookup, asked };
}

const butter = { id: "butter-id", name: "butter", exact: true };
const shallot = { id: "shallot-id", name: "shallot", exact: false };
const stock = { id: "stock-recipe", name: "Stock" };

describe("resolveStepLinks", () => {
  it("keeps an earlier line with the same wording first: its id and its link", async () => {
    const { lookup, asked } = catalog({ butter: { ingredients: [butter], recipes: [] } });
    const kept = [{ id: "line-1", wording: "Butter", ingredient: { id: "other-butter" } }];

    const result = await resolveStepLinks(
      parseStepText("Melt @butter{30%g}"),
      kept,
      new Map([["butter", { ingredientId: "picked-butter" }]]),
      lookup,
    );

    expect(result.refs.map((r) => [r.keptLineId, r.target])).toEqual([
      ["line-1", { ingredientId: "other-butter" }],
    ]);
    expect(result.missing).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("then links one exact Ingredient, or one exact Recipe, on its own", async () => {
    const { lookup } = catalog({
      butter: { ingredients: [butter], recipes: [] },
      stock: { ingredients: [], recipes: [{ entry: stock, exact: true }] },
    });

    const result = await resolveStepLinks(
      parseStepText("Melt @butter{30%g} in @stock{1%l}"),
      [],
      new Map(),
      lookup,
    );

    expect(result.refs.map((r) => [r.keptLineId, r.target])).toEqual([
      [undefined, { ingredientId: "butter-id" }],
      [undefined, { subRecipeId: "stock-recipe" }],
    ]);
    expect(result.links).toEqual(
      new Map([
        ["butter", { ingredientId: "butter-id" }],
        ["stock", { subRecipeId: "stock-recipe" }],
      ]),
    );
    expect(result.missing).toEqual([]);
  });

  it("then waits for the cook's link choice, offering the near matches", async () => {
    const { lookup } = catalog({
      shallo: { ingredients: [shallot], recipes: [{ entry: stock, exact: false }] },
    });

    const result = await resolveStepLinks(parseStepText("Sweat @shallo{2}"), [], new Map(), lookup);

    expect(result.refs.map((r) => r.target)).toEqual([undefined]);
    expect(result.missing).toEqual([
      { name: "shallo", amount: "2", near: [shallot], nearRecipes: [stock] },
    ]);
  });

  it("offers every exact match when an Ingredient and a Recipe both match exactly", async () => {
    const { lookup } = catalog({
      stock: {
        ingredients: [{ id: "stock-id", name: "stock", exact: true }],
        recipes: [{ entry: stock, exact: true }],
      },
    });

    const result = await resolveStepLinks(parseStepText("Add @stock{}"), [], new Map(), lookup);

    expect(result.missing).toEqual([
      {
        name: "stock",
        amount: "",
        near: [{ id: "stock-id", name: "stock", exact: true }],
        nearRecipes: [stock],
      },
    ]);
  });

  it("uses the cook's link choice once made, without asking the catalog again", async () => {
    const { lookup, asked } = catalog({});

    const result = await resolveStepLinks(
      parseStepText("Sweat @shallo{2}"),
      [],
      new Map([["shallo", { ingredientId: "shallot-id" }]]),
      lookup,
    );

    expect(result.refs.map((r) => r.target)).toEqual([{ ingredientId: "shallot-id" }]);
    expect(result.missing).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("links one wording to one target per Step: both refs share it, looked up once", async () => {
    const { lookup, asked } = catalog({ butter: { ingredients: [butter], recipes: [] } });

    const result = await resolveStepLinks(
      parseStepText("Melt @butter{30%g}, then brown @Butter{10%g}"),
      [],
      new Map(),
      lookup,
    );

    expect(result.refs.map((r) => r.target)).toEqual([
      { ingredientId: "butter-id" },
      { ingredientId: "butter-id" },
    ]);
    expect(asked).toEqual(["butter"]);
  });
});

describe("stepIntentKey", () => {
  const text = "Melt @butte{30%g}";
  const resolve = (links: ReadonlyMap<string, Target>) =>
    resolveStepLinks(parseStepText(text), [], links, catalog({}).lookup);

  it("stays the same for a plain retry of the same text and links", async () => {
    const links = new Map([["butte", { ingredientId: "butter-id" }]]);
    const first = await resolve(links);
    // A retry resolves again from the links the first Save stored.
    const retry = await resolve(first.links);

    expect(stepIntentKey(text, retry.refs)).toBe(stepIntentKey(text, first.refs));
  });

  it("changes when a line's resolved target changes and the text does not", async () => {
    const before = await resolve(new Map([["butte", { ingredientId: "butter-id" }]]));
    const after = await resolve(new Map([["butte", { ingredientId: "other-butter" }]]));

    expect(stepIntentKey(text, after.refs)).not.toBe(stepIntentKey(text, before.refs));
  });
});

describe("linkChoiceMutation", () => {
  const alias = { action: "addAlias", wording: "shallo", ingredientId: "shallot-id" } as const;
  const create = {
    action: "createIngredient",
    wording: "zest",
    name: "zest",
    preferredKind: "mass",
    shoppingCategoryId: "other-id",
  } as const;

  it("reuses the mutation id and row ids when the same choice is retried", () => {
    const intent = createIntent();
    for (const choice of [
      alias,
      create,
      { action: "createSubRecipe", wording: "stock", name: "Stock" } as const,
    ]) {
      expect(linkChoiceMutation(intent, choice)).toEqual(linkChoiceMutation(intent, choice));
    }
  });

  it("uses new ids for a different choice of the same wording", () => {
    const intent = createIntent();
    const first = linkChoiceMutation(intent, create);
    const other = linkChoiceMutation(intent, { ...create, preferredKind: "volume" });

    expect(other.id).not.toBe(first.id);
    expect(other.args.ingredientId).not.toBe(first.args.ingredientId);
    expect(other.target).toEqual({ ingredientId: other.args.ingredientId });
  });

  it("sends each choice's args and returns the target to link", () => {
    const intent = createIntent();

    expect(linkChoiceMutation(intent, alias)).toMatchObject({
      name: "addAlias",
      args: { ingredientId: "shallot-id", name: "shallo" },
      target: { ingredientId: "shallot-id" },
    });
    const sub = linkChoiceMutation(intent, {
      action: "createSubRecipe",
      wording: "stock",
      name: "Stock",
    });
    expect(sub).toMatchObject({ name: "createSubRecipe", args: { name: "Stock" } });
    expect(sub.target).toEqual({ subRecipeId: sub.args.recipeId });
  });
});

describe("stepSaveArgs", () => {
  it("keeps a kept line's id, gives a new line its id, and points the body at them in order", async () => {
    const parts = parseStepText("Sweat @shallots{2}(brunoise) in @butter{30%g}");
    const { refs } = await resolveStepLinks(
      parts,
      [{ id: "line-1", wording: "butter", ingredient: { id: "butter-id" } }],
      new Map([[normaliseName("shallots"), { ingredientId: "shallot-id" }]]),
      catalog({}).lookup,
    );

    expect(stepSaveArgs(parts, refs, (name) => `new ${name}`)).toEqual({
      body: [
        { type: "text", text: "Sweat " },
        { type: "line", lineId: "new line 0" },
        { type: "text", text: " in " },
        { type: "line", lineId: "line-1" },
      ],
      lines: [
        {
          lineId: "new line 0",
          ingredientId: "shallot-id",
          amount: "2",
          wording: "shallots",
          preparation: "brunoise",
        },
        {
          lineId: "line-1",
          ingredientId: "butter-id",
          amount: "30%g",
          wording: "butter",
          preparation: null,
        },
      ],
    });
  });
});

// A /mutate that records what was sent, and can lose the response after "applying" it.
function server() {
  const sent: { id: string; name: string; args: Record<string, unknown> }[] = [];
  let lose = false;
  const send: Send = (id, name, args) => {
    sent.push({ id, name, args });
    if (lose) {
      lose = false;
      return Promise.reject(new Error("Failed to fetch"));
    }
    return Promise.resolve();
  };
  return { send, sent, loseNext: () => (lose = true) };
}

describe("sendStepSave", () => {
  const text = "Melt @butte{30%g}";
  const parts = parseStepText(text);
  const resolve = async (target: Target) =>
    (await resolveStepLinks(parts, [], new Map([["butte", target]]), catalog({}).lookup)).refs;
  const save = { recipeId: "recipe-1", stepId: "step-1", text, parts };

  it("replays a retry after a lost response with the same mutation and row ids", async () => {
    const { send, sent, loseNext } = server();
    const intent = createIntent();
    const refs = await resolve({ ingredientId: "butter-id" });

    loseNext();
    await expect(sendStepSave({ ...save, refs, intent, send })).rejects.toThrow();
    await sendStepSave({ ...save, refs, intent, send });

    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toMatchObject({
      name: "addStep",
      args: { recipeId: "recipe-1", stepId: "step-1", lines: [{ ingredientId: "butter-id" }] },
    });
  });

  it("sends a new mutation when the cook re-links the wording after a lost response", async () => {
    const { send, sent, loseNext } = server();
    const intent = createIntent();

    loseNext();
    await expect(
      sendStepSave({ ...save, refs: await resolve({ ingredientId: "butter-id" }), intent, send }),
    ).rejects.toThrow();
    await sendStepSave({ ...save, refs: await resolve({ ingredientId: "other" }), intent, send });

    expect(sent[1].id).not.toBe(sent[0].id);
    expect(sent[1].args.revisionId).not.toBe(sent[0].args.revisionId);
    expect(sent[1].args).toMatchObject({ lines: [{ ingredientId: "other" }] });
  });

  it("edits an opened Step, and starts fresh ids once a save has gone through", async () => {
    const { send, sent } = server();
    const intent = createIntent();
    const refs = await resolve({ ingredientId: "butter-id" });

    await sendStepSave({ ...save, editing: true, refs, intent, send });
    await sendStepSave({ ...save, editing: true, refs, intent, send });

    expect(sent.map((m) => m.name)).toEqual(["editStep", "editStep"]);
    expect(sent[0].args).not.toHaveProperty("recipeId");
    expect(sent[1].id).not.toBe(sent[0].id);
  });
});

describe("sendLinkChoice", () => {
  const choice = { action: "addAlias", wording: "shallo", ingredientId: "shallot-id" } as const;

  it("replays the same choice after a lost response, and returns its target", async () => {
    const { send, sent, loseNext } = server();
    const intent = createIntent();

    loseNext();
    await expect(sendLinkChoice(intent, choice, send)).rejects.toThrow();
    const target = await sendLinkChoice(intent, choice, send);

    expect(sent[1]).toEqual(sent[0]);
    expect(target).toEqual({ ingredientId: "shallot-id" });
  });

  it("starts fresh ids once the choice has gone through", async () => {
    const { send, sent } = server();
    const intent = createIntent();

    await sendLinkChoice(intent, choice, send);
    await sendLinkChoice(intent, choice, send);

    expect(sent[1].id).not.toBe(sent[0].id);
  });
});

describe("catalogLookup", () => {
  it("searches Ingredients by name and the kitchen's other Recipes, loading them once for parallel lookups", async () => {
    let loads = 0;
    const lookup = catalogLookup(
      "this-recipe",
      () => {
        loads += 1;
        return Promise.resolve([
          { id: "this-recipe", name: "Stock" },
          { id: "stock-recipe", name: "Stock" },
          { id: "sauce-recipe", name: "Sauce" },
        ]);
      },
      (name) => Promise.resolve([{ id: `${name}-id`, name, exact: true }]),
    );

    const [first] = await Promise.all([lookup("stock"), lookup("sauce")]);

    expect(first.ingredients).toEqual([{ id: "stock-id", name: "stock", exact: true }]);
    expect(first.recipes.map((h) => [h.entry.id, h.exact])).toEqual([["stock-recipe", true]]);
    expect(loads).toBe(1);
  });
});

describe("linkChoices", () => {
  it("links an exact match offered beside a Recipe without teaching an alias", async () => {
    const { send, sent } = server();

    const target = await linkChoices("stock", send).useNearMatch({ id: "stock-id", exact: true });

    expect(target).toEqual({ ingredientId: "stock-id" });
    expect(sent).toEqual([]);
  });

  it("gives each action its own retry intent: one going through keeps another's ids", async () => {
    const { send, sent, loseNext } = server();
    const choices = linkChoices("zest", send);
    const create = { name: "zest", preferredKind: "mass", shoppingCategoryId: "other-id" };

    loseNext();
    await expect(choices.createIngredient(create)).rejects.toThrow();
    await choices.useNearMatch({ id: "lemon-id", exact: false });
    await choices.createSubRecipe("Zest");
    const target = await choices.createIngredient(create);

    expect(sent.map((m) => m.name)).toEqual([
      "createIngredient",
      "addAlias",
      "createSubRecipe",
      "createIngredient",
    ]);
    expect(sent[3]).toEqual(sent[0]);
    expect(target).toEqual({ ingredientId: sent[0].args.ingredientId });
    expect(sent[1].args).toMatchObject({ ingredientId: "lemon-id", name: "zest" });
  });
});

describe("saveStep", () => {
  const catalogOf = (ingredients: Ingredient[]) => ({
    loadRecipes: () => Promise.resolve([] as Recipe[]),
    findIngredients: () => Promise.resolve(ingredients),
  });

  it("hands back the links and missing names, and sends nothing while a name waits", async () => {
    const { send, sent } = server();
    const resolved: unknown[] = [];

    const saved = await saveStep({
      recipeId: "recipe-1",
      stepId: "step-1",
      text: "Sweat @shallo{2}",
      links: new Map(),
      ...catalogOf([shallot]),
      intent: createIntent(),
      send,
      onResolved: (links, missing) => resolved.push(links, missing),
    });

    expect(saved).toBe(false);
    expect(sent).toEqual([]);
    expect(resolved).toEqual([
      new Map(),
      [{ name: "shallo", amount: "2", near: [shallot], nearRecipes: [] }],
    ]);
  });

  it("keeps the opened Step's lines and sends editStep once every ref is linked", async () => {
    const { send, sent } = server();

    const saved = await saveStep({
      recipeId: "recipe-1",
      stepId: "step-1",
      opened: { lines: [{ id: "line-1", wording: "butter", ingredient: { id: "butter-id" } }] },
      text: "Melt @butter{40%g}",
      links: new Map(),
      ...catalogOf([]),
      intent: createIntent(),
      send,
      onResolved: () => {},
    });

    expect(saved).toBe(true);
    expect(sent).toMatchObject([
      {
        name: "editStep",
        args: { stepId: "step-1", lines: [{ lineId: "line-1", amount: "40%g" }] },
      },
    ]);
  });
});
