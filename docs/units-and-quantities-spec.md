# Units and quantities spec

How MiseFlow represents Quantities, recognises their units, converts and scales them for each Dish, and adds them up on the Shopping list so the totals come out right. Assembled from map [#25](https://github.com/maloferriol/miseflow/issues/25), which answers [#5](https://github.com/maloferriol/miseflow/issues/5). Each section links the ticket that decided it. Terms are defined in [CONTEXT.md](../CONTEXT.md), under Quantities and Shopping.

Baseline from map [#1](https://github.com/maloferriol/miseflow/issues/1): scaling is linear from the Recipe's yield, applied recursively, and rounded up to amounts you can buy.

## 1. Units

([#28](https://github.com/maloferriol/miseflow/issues/28))

Every Quantity's unit falls into one of three tiers:

| Tier                | Units                                                                           | Adds up                                              | Converts                  |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------- |
| **Fixed unit**      | g, kg, mg · ml, cl, dl, L · tsp, tbsp, fl oz, cup, pint, quart, gallon · oz, lb | within its kind of measure                           | by a constant             |
| **Ingredient unit** | piece (no unit: "3 eggs"), clove, slice, sprig, head, stick, can, bunch         | with the same unit (1 bunch + 2 bunches = 3 bunches) | only through a Conversion |
| **Vague amount**    | pinch, dash, handful, to taste, no quantity                                     | never                                                | never; listed only        |

- **Unit region.** Each Recipe has one. It defaults to the kitchen's region and is read from Cooklang's `locale` key on import. It's shown in the import preview and can be changed per Recipe. It decides:
  - cup: US 236.6 ml, metric 250 ml (the 240 ml US labelling cup is never assumed)
  - pint: US 473 ml, UK 568 ml
  - fl oz: US 29.6 ml, UK 28.4 ml
  - tbsp: Australia 20 ml, elsewhere 15 ml

  The kitchen's region also chooses between regional Ingredient aliases (§2).

- **Abbreviations.** `oz` is always weight and `fl oz` always volume. Case matters only for single letters: `T` = tbsp and `t` = tsp. Everything else is matched regardless of case and with aliases (`c.`, `Tbsp`, `cups`).
- **Unrecognised units** ("2 knobs ginger") are listed separately and flagged. The cook defines the unit once for the whole kitchen, either as an Ingredient unit for that Ingredient ("1 knob of ginger = 30 g") or as another spelling of a known unit ("tbs" = tbsp).
- **Ranges** ("2–3 cloves") are shown as written and scale at both ends. Shopping list totals use the upper end.

## 2. Ingredients and the catalog

([#27](https://github.com/maloferriol/miseflow/issues/27), [#35](https://github.com/maloferriol/miseflow/issues/35))

- **Totals group by Ingredient, never by text.** Every Ingredient line links to one Ingredient in the kitchen's Ingredient catalog, or to a sub-recipe. The line keeps the author's wording, its preparation ("diced", "packed") and its size ("large").
- **What counts as one Ingredient.** Things bought as different products are different Ingredients: brown sugar vs sugar, heavy vs double cream. Nothing rolls up. Preparation and size don't make a new Ingredient: diced and sliced onions add into one onion total.
- **The catalog** is a shared, read-only **seed** plus each kitchen's own Ingredients, aliases and overrides on top. The two are kept separate, so updating the seed never overwrites a kitchen's edits.
- **The seed** has about 300 Ingredients.
  - Each is keyed by its USDA FoodData Central (SR Legacy) id, the same rows as the reference Conversions (§3).
  - Aliases come from the Open Food Facts ingredients taxonomy and Wikidata, plus cooks' own terms ("AP flour", "scallion").
  - It's drafted at development time with an LLM (a local model or a free OpenRouter model). Nothing is fetched while the app runs.
  - It's published under **ODbL**, crediting Open Food Facts. This applies to the seed file only, not the app's code.
- **Matching** an Ingredient line, on entry and on import:
  1. Split the line into quantity, unit, name, size and preparation. Cooklang lines already keep the name separate. Which parser to use depends on the tech stack ([#35](https://github.com/maloferriol/miseflow/issues/35) compares `ingredient-parser` and `parse-ingredient`).
  2. Normalise the name: case, plurals, size words and preparation words. Look for preparation words ("packed", "chopped") in both the name and the parser's comment.
  3. An exact name or alias match links automatically. Seed aliases can carry a region, and the kitchen's region chooses ("cornflour" is cornstarch in the UK). A kitchen alias always wins.
  4. Otherwise the cook picks from suggestions, and that wording becomes a kitchen alias. New Ingredients are never created automatically. Unmatched lines appear in the import preview ([#18](https://github.com/maloferriol/miseflow/issues/18)). _See the open question in §8._
- **Merging two Ingredients.** One survives, and the other's name becomes an alias of it. Every Ingredient line, alias and override is relinked to the survivor. Where tags, the default Station or Conversion overrides conflict, the cook chooses; allergen tags are combined, never dropped. A merge can be undone until the next Shopping list is built from it.

## 3. Conversions

([#26](https://github.com/maloferriol/miseflow/issues/26), [#31](https://github.com/maloferriol/miseflow/issues/31))

- **Reference values** come from a curated table bundled with the seed, built from USDA FDC SR Legacy, which is public domain (credit USDA):
  - grams per ml, based on the US customary cup of 236.588 ml
  - grams per piece, with a default size (eggs default to large in the US region)

  Each value keeps its FDC id as its source. King Arthur's chart and _The Food Lab_ are used only to cross-check; neither is copied.

- **Every reference value is approximate** (all-purpose flour ranges from 120 to 142 g per cup depending on the source). An Ingredient can override any value for the kitchen, and a value the kitchen entered itself counts as exact.
- **Preparation and size choose the variant.** A line whose preparation matches a reference variant uses it: chopped (160 g/cup) vs sliced (115 g/cup) onion, packed (220 g/cup) vs unpacked brown sugar. Otherwise the Ingredient's default variant is used. A size word picks the per-piece weight; without one, the default size is used.
- **Sub-recipes** can have their own Conversion, entered by the cook. A sub-recipe never has a reference value.
- **Overrides** are made from the ≈ explanation ("Change for this kitchen") or on the Ingredient's page. They apply in every Recipe.

## 4. Main unit

(charting of [#25](https://github.com/maloferriol/miseflow/issues/25), [#31](https://github.com/maloferriol/miseflow/issues/31))

- Each Ingredient has a **preferred kind of measure**: flour, sugar and butter by mass; milk and stock by volume; eggs by count. Seed Ingredients come with one, and kitchen Ingredients pick one when created.
- The kitchen picks the unit for each kind: g or oz for mass, ml or cups for volume. An Ingredient can override the unit (milk in litres).
- A Conversion applies whenever a line's kind of measure differs from its Ingredient's preferred kind. So "2 cups flour" totals as ≈ 250 g.

## 5. Scaling

([#29](https://github.com/maloferriol/miseflow/issues/29), [#30](https://github.com/maloferriol/miseflow/issues/30))

- **Scale factor of a Dish:** by default the Menu's guest count divided by the Recipe's servings (12 guests, a Recipe for 4 → ×3). The cook can override it per Dish, as a portion count ("make 16") or as a factor.
- **Linear only.** Every Quantity is multiplied by the Scale factor, with no curves and no warnings at large factors. A cook who needs less salt at ×10 edits that Dish's line.
- **Fixed quantities** keep their Quantity at any Scale factor. An Ingredient line can be marked fixed, which maps to Cooklang's `=` (`@salt{=1%tsp}`) in both directions. A fixed line shows a marker and counts once per Dish on the Shopping list.
- **Vague amounts** are shown as written followed by the factor ("a pinch (×3)").
- **No rounding in the data.** The Dish keeps the exact scaled amount (1.5 eggs). Only the display (§7) and the Shopping list (§6) round.
- **Sub-recipes.** A Recipe has **servings** (for its Scale factor as a Dish) and an optional **yield** Quantity in any unit tier. A Recipe used as a sub-recipe needs a yield.
  - The sub-recipe's Scale factor is everything its parents use from it, after their own scaling, converted to its yield unit, then divided by its yield. Pavlova ×3 uses 600 g of meringue, meringue yields 500 g, so meringue is made ×1.2. This repeats down the tree.
  - A reference with no unit (`@./pie-crust{2}`) counts yield pieces if the yield is in an Ingredient unit; otherwise it means batches. `%servings` goes through the sub-recipe's servings.
  - **If the scale can't be worked out** (no yield, or units that can't be converted), assume 1 batch, flag the Dish with a fix right there ("add a yield in grams"), and mark the sub-recipe's Ingredients as estimated on the Shopping list. A Missing sub-recipe is still skipped.
  - **Cycles** (A uses B, which uses A) are refused when the line is linked.

## 6. Shopping list

([#31](https://github.com/maloferriol/miseflow/issues/31), [#32](https://github.com/maloferriol/miseflow/issues/32))

- **One row per Ingredient**, totalled across every Dish, and across Services when lists are combined. The total is in the Main unit. Ranges count at their upper end.
- **Approximate totals** are marked **≈** when they include a reference Conversion, a default piece size, or a sub-recipe that couldn't be scaled. Tapping ≈ explains the number: "2 cups × 125 g (USDA) + 300 g".
- **Parts that can't be converted** stay on the same row, flagged: "ginger: 40 g + 2 thumbs ⚠ needs conversion". The fix right there ("1 thumb = 15 g") becomes a kitchen Conversion. Vague amounts are listed on the row and never added.
- **Need and buy.** Each row shows the exact need and what to buy: "cream: need 1.2 L → buy 1 × 1 L + 1 × 250 ml (50 ml spare)". Rounding happens after everything is combined.
  - **Pack sizes** belong to the Ingredient (cream: 250 ml, 500 ml, 1 L; eggs: 6, 12). The seed includes regional defaults only for genuinely standard staples (eggs, butter, flour, sugar, milk); the kitchen sets the rest.
  - **Choosing packs:** the combination with the least left over, then the fewest packs if tied, mixing sizes allowed. Cost isn't considered.
  - **Loose** Ingredients (no pack sizes): counted amounts round up to whole pieces. Weights and volumes aren't rounded for buying.
  - **Trim loss.** Each Ingredient can have one, seeded from USDA's refuse percentage where recorded. Check whether FDC's CSV kept that field when building the seed. Trim loss is added only when a weight need becomes a buy amount, which makes the buy line ≈ (the need stays exact). Counted amounts aren't affected.
- Subtracting stock already on hand, and shopping statuses and categories, belong to [#12](https://github.com/maloferriol/miseflow/issues/12).

## 7. Display

([#33](https://github.com/maloferriol/miseflow/issues/33). Prototype: [`prototype/units-display`](https://github.com/maloferriol/miseflow/blob/prototype/units-display/prototypes/units-display.prototype.html))

- **One switch for every view**, between the Main unit and the Original unit, plus **tap to peek**: tapping one amount shows it in the other unit underneath, for that amount only.
- **Original units are tidied within their own family** once scaled ("9 tbsp" → "½ cup + 1 tbsp", g → kg), never into another system.
- **The Shopping list in Original mode** keeps its totals in the Main unit and lists the parts underneath: "from ⅔ cup (Pavlova), 450 ml (Carrot soup)".
- **Rounding for display only:**

| Amount                    | Shown as                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| g, ml                     | whole numbers; one decimal below 10; kg / L from 1000, up to 2 decimals                        |
| metric volume under 30 ml | tsp / tbsp ("1 tsp", not "4.9 ml")                                                             |
| US cups and spoons        | nearest ⅛ or ⅓; if that's more than 4% off, cup + tbsp. Below 1 tbsp → tsp, below ¼ cup → tbsp |
| oz                        | lb from 16 oz                                                                                  |
| counted amounts           | nearest ¼ or ⅓ ("4½ eggs"); a range shows its unit once ("6–9 cloves")                         |

- **≈** stays on the amount it qualifies.
- Exports always write each line's own wording and Original unit, never the Main unit ([recipe import/export spec](recipe-import-export-spec.md)).

## 8. Open question

- **Unmatched Ingredient names on import.** The [recipe import/export spec](recipe-import-export-spec.md) says an Ingredient line on import that matches no Ingredient or alias is created as a new kitchen Ingredient by default. §2 says new Ingredients are never created automatically. Tracked in [Import: create or pick for an unmatched Ingredient name?](https://github.com/maloferriol/miseflow/issues/39).

## Not in this spec

Recorded on map [#25](https://github.com/maloferriol/miseflow/issues/25) as out of scope:

- Buy instead of make (now fog on [#1](https://github.com/maloferriol/miseflow/issues/1))
- Substitutions and roll-ups
- LLM-assisted matching in the app
- A whole-piece factor helper
- Recipe-specific Conversions
- Scaling other than linear
- Temperatures and timers
- Costing
- Where Ingredient data is stored, which is decided by [#23](https://github.com/maloferriol/miseflow/issues/23)

## Sources

- [Reference conversions research](../.scratch/units/research/reference-conversions.md) ([#26](https://github.com/maloferriol/miseflow/issues/26))
- [Ingredient databases research](../.scratch/units/research/ingredient-databases.md) ([#35](https://github.com/maloferriol/miseflow/issues/35))
