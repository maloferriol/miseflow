# Accepted reference Conversions

Answers ticket #26 ("Which accepted reference Conversions can MiseFlow use?", map #25). Researched 2026-10-12 against the sources below. Vocabulary follows `/CONTEXT.md`: a **Conversion** turns a Quantity of one Ingredient into a different kind of measure (cups of flour to grams, one onion to grams).

| Source                                                                                                                                                              | What was read                                                                                                                                                                                                                                                                                                    | Access                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| USDA FoodData Central (FDC): https://fdc.nal.usda.gov/download-datasets, https://fdc.nal.usda.gov/api-guide                                                         | Download page, API guide and licence text (via search index; `fdc.nal.usda.gov` did not resolve from this machine on 2026-10-12)                                                                                                                                                                                 | live text not fetched directly                    |
| FDC data: SR Legacy 2018-04 + Foundation Foods 2025-12-18, `food.csv`, `food_portion.csv`, `measure_unit.csv`                                                       | Analysed locally (8,229 foods, 14,636 portion rows). Taken from a public-domain mirror, `github.com/chpayton/BI-Files/Data/USDA Nutrition` (accessed 2026-07-16 by its author), because the USDA host was unreachable. Spot values (e.g. FDC 168894 flour, 1 cup = 125 g) match third-party sites that cite FDC. | re-check against the official zip before bundling |
| 21 CFR 101.9(b)(5)(viii) (FDA nutrition labelling): https://www.law.cornell.edu/cfr/text/21/101.9                                                                   | live 2026-10-12                                                                                                                                                                                                                                                                                                  |                                                   |
| NIST: Handbook 44 Appendix C; SP 1038; "Metric Kitchen" page https://www.nist.gov/pml/owm/metric-si/metric-kitchen/metric-kitchen-cooking-measurement-equivalencies | Metric Kitchen page live; HB 44 / SP 1038 PDFs could not be text-extracted here, quoted via search index                                                                                                                                                                                                         |                                                   |
| King Arthur Baking ingredient weight chart: https://www.kingarthurbaking.com/learn/ingredient-weight-chart                                                          | live 2026-10-12                                                                                                                                                                                                                                                                                                  |                                                   |
| Open Food Facts data page: https://world.openfoodfacts.org/data                                                                                                     | live 2026-10-12                                                                                                                                                                                                                                                                                                  |                                                   |
| Serious Eats / J. Kenji López-Alt, _The Food Lab_ (2015)                                                                                                            | The book's table was **not** available to me; only Serious Eats' published house convention for flour was checked (seriouseats.com blocks automated fetches; read via a syndicated copy)                                                                                                                         | cross-check only                                  |

## TL;DR

- **USDA FDC SR Legacy is the source to bundle.** It is public domain (CC0 1.0), and its `food_portion.csv` gives gram weights for household measures (cup, tbsp, tsp, fl oz) and for pieces (1 large egg, 1 medium onion, 1 garlic clove) for **7,533 of 7,793 foods**. Of 49 everyday Ingredients I checked, every one had a usable entry: 30/30 pantry staples have a cup/tbsp/tsp (or fl oz) weight, and 17 of 19 produce/count items have a per-piece weight (shallot and ginger don't).
- **SR Legacy is frozen** (final release April 2018). **Foundation Foods** is the maintained successor, but only 116 of its 436 foods have any portion, and it has none for flour, butter or rice. Where it does have portions, they are new lab measurements that **disagree with SR Legacy** (granulated sugar 188 g/cup vs 200 g; whole milk 229 g and 249 g/cup vs 244 g). **FNDDS** is built for dietary surveys (as-eaten foods, mixed dishes) and is a poor fit as a primary source.
- **SR Legacy's "cup" is the US customary cup** (8 US fl oz ≈ 236.6 ml), not the 240 ml labelling cup or the 250 ml metric cup. Evidence in the data: tap water "8 fl oz = 237 g"; whole milk "1 fl oz = 30.5 g" and "1 cup = 244 g" (= 8 × 30.5).
- **Extraction is easy but needs curation.** The CSV is small (about 0.5 MB for portions). But the measure is free text in `modifier` (`cup`, `cup, chopped`, `cup packed`, `cup unsifted`, `tbsp`, `large`, `clove`), so MiseFlow needs a hand-curated mapping from its Ingredients to one FDC food and one portion row each, rather than an automatic import.
- **Sources disagree most on flour**: 1 cup of all-purpose flour is 120 g (King Arthur), 125 g (USDA SR Legacy) or about 142 g (Serious Eats' and America's Test Kitchen's "5 oz" convention). The spread (±10%) comes from how the cup is filled (spooned vs scooped). Sugar (198–200 g), butter (227 g) and a large egg (50 g) agree closely.
- **King Arthur's chart** (about 390 entries, baking-focused) is "All rights reserved", so it is a cross-check only, like _The Food Lab_. **Open Food Facts** (ODbL) is a database of packaged products with per-product serving sizes, not reference Conversions for generic Ingredients.

## 1. USDA FoodData Central

### Licence

- FDC states that its data "are in the public domain and they are not copyrighted", are published under **CC0 1.0 Universal**, and that no permission is needed. USDA _requests_ that you cite FoodData Central as the source and, when possible, tell them which product uses the data (FDC API guide and site footer, via search index; https://fdc.nal.usda.gov/api-guide).
- **It can be bundled** into MiseFlow (shipped as a JSON or SQLite table). Add a source credit in the app's About/credits and in the data file.

### Datasets and formats

From the FDC download page (https://fdc.nal.usda.gov/download-datasets):

| Dataset              | Latest release                                      | Status                                                        | Portions for kitchen use                                                                                        |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **SR Legacy**        | April 2018                                          | "the final release of this data type and will not be updated" | **Best**: 7,533 foods with portions; 3,297 with a cup/tbsp/tsp/fl oz portion                                    |
| **Foundation Foods** | December 2025 (CSV 3.4 MB zipped, JSON 467 KB)      | Maintained, about twice a year                                | Sparse: 116 of 436 foods have any portion, 53 with a volume portion. No flour, butter or rice portions          |
| **FNDDS**            | October 2024 (FNDDS 2021–2023; CSV 1.6 GB unzipped) | Tied to the NHANES two-year cycle                             | Portions describe foods _as eaten_ in surveys (mixed dishes, cooked foods). Not a reference for raw Ingredients |
| Branded Foods        | December 2025                                       | Monthly                                                       | Manufacturer serving sizes per UPC, not generic Ingredients                                                     |

- Each dataset is offered as **CSV and JSON** zips. The relevant CSV tables are `food.csv` (id, description), `food_portion.csv` (`fdc_id`, `amount`, `measure_unit_id`, `portion_description`, `modifier`, `gram_weight`) and `measure_unit.csv`.
- There is also a **REST API** (`/v1/food/{fdcId}` returns `foodPortions`). It needs a free data.gov API key and is limited to 1,000 requests per hour per IP (API guide). For MiseFlow, a **one-off build-time extract** of a few hundred rows is simpler than calling the API at runtime.

### How the portions are shaped (SR Legacy)

Counts below are from my analysis of the 2018-04 SR Legacy CSV.

- **The unit is mostly free text.** In SR Legacy, 14,449 portion rows have `measure_unit_id` = "undetermined", and the real measure is in `modifier`. The most common modifiers are `oz` (3,166), `cup` (1,691), `tbsp` (548), `fl oz` (492), `tsp` (171), plus variants like `cup, chopped`, `cup (8 fl oz)`, `cup (1 NLEA serving)`, `medium`, `large`, `small`, `piece`, `slice`.
- **Volume weights depend on preparation, which the modifier encodes:** onions "1 cup, chopped" 160 g vs "1 cup, sliced" 115 g; brown sugar "1 cup packed" 220 g vs "1 cup unpacked" 145 g; powdered sugar "1 cup unsifted" 120 g vs "1 cup sifted" 100 g. A Conversion for "1 cup onion" therefore has to pick one row, or be told which preparation the Recipe means.
- **Count units come in sizes:** egg small 38 g, medium 44 g, large 50 g, extra large 56 g, jumbo 63 g; onion small 70 g, medium 110 g, large 150 g; garlic "1 clove" 3 g. A Recipe that says "1 onion" needs a default size (medium is the natural choice).
- **Weights are for the edible portion** (no shell, peel or core), the convention for SR data. That matters for buying: one medium onion as bought weighs more than 110 g.

### Coverage check (49 everyday Ingredients)

I matched 49 common Ingredients to one SR Legacy food each (script in session scratchpad, not committed):

- **Pantry, by volume (30):** all-purpose, bread and whole-wheat flour; granulated, brown and powdered sugar; butter; olive and canola oil; whole milk; heavy cream; yogurt; honey; table salt; baking soda and baking powder; cocoa; long-grain rice; rolled oats; cornstarch; black pepper; cinnamon; cumin; vanilla; soy sauce; vinegar; grated parmesan; lentils; dried chickpeas; water. **All 30** have a cup, tbsp or tsp weight (water only has fl oz and 8 fl oz).
- **Produce and count items (19):** egg, onion, garlic, carrot, potato, tomato, lemon, lime, apple, banana, celery (stalk), bell pepper, avocado, cucumber, zucchini, parsley (sprigs), basil (leaves), shallot, ginger. **17 of 19** have a per-piece weight. Shallot has only "1 tbsp chopped" and ginger only "1 tsp" or slices, so "1 shallot" or "a thumb of ginger" has no reference value.
- The foods missing a reference value are mostly things that are vague anyway ("a bunch", "a knob"). Those fall to #31's "needs conversion" path.

## 2. Cup and spoon definitions

| Cup                          | Volume                                                | Where it's defined / used                                                                                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **US customary cup**         | 8 US fl oz = **236.588 ml** (1 US fl oz = 29.5735 ml) | NIST Handbook 44, Appendix C (cup = 8 fl oz exactly; via search index). This is the cup used by SR Legacy (see TL;DR evidence) and by US cookbooks.                                                                                                                                                      |
| **US legal (labelling) cup** | **240 ml**                                            | 21 CFR 101.9(b)(5)(viii): "For nutrition labeling purposes, a teaspoon means 5 milliliters (mL), a tablespoon means 15 mL, a cup means 240 mL", "1 fl oz means 30 mL". NIST's "Metric Kitchen" page also gives 1 cup ≈ 240 ml, 1 tbsp ≈ 15 ml, 1 tsp ≈ 5 ml as approximate equivalents for home cooking. |
| **Metric cup**               | **250 ml**                                            | Used in Australia, New Zealand and Canada (tbsp 15 ml, though the Australian tablespoon is conventionally 20 ml; not checked against a primary source). NIST SP 1038 notes 250/15/5 ml as practical metric equivalents (via search index). I did not reach a national standards body's primary text for the Australian/Canadian definitions.                                  |
| Imperial cup (historic UK)   | about 284 ml (½ imperial pint)                        | Rare in modern UK recipes, which use grams.                                                                                                                                                                                                                                                              |

- Between the US customary and metric cups the difference is **5.7%**, and between the customary and labelling cups it is 1.4%. That is smaller than the spread between sources for flour (§3), but it adds up across a Shopping list.
- **Implication:** store reference Conversions as **grams per millilitre** (or grams per US cup with the cup defined as 236.588 ml), not as "grams per cup". Then a Recipe in metric cups (250 ml) converts correctly. Which cup a written "cup" means is #28's question.

## 3. Where sources disagree on staples

All values are grams for **1 cup** unless noted.

| Ingredient                 | USDA SR Legacy             | USDA Foundation            | King Arthur       | Serious Eats / ATK       |
| -------------------------- | -------------------------- | -------------------------- | ----------------- | ------------------------ |
| All-purpose flour          | 125 (FDC 168894)           | no portion                 | 120               | ≈142 ("5 oz"; see below) |
| Granulated sugar           | 200 (tsp 4.2) (FDC 169655) | 188 (tsp 4.0) (FDC 746784) | 198               | 198 (ATK, "7 oz")        |
| Butter                     | 227 (tbsp 14.2, stick 113) | no portion                 | 227 (½ cup = 113) | 227                      |
| Long-grain white rice, raw | 185 (FDC 168877)           | no portion                 | 198 (½ cup = 99)  | n/a                      |
| Egg, large, whole          | 50                         | 50.3                       | 50                | n/a                      |

- **Flour is the real problem.** A cup weighs 120–142 g depending on the source, and the difference comes from the filling method. Serious Eats says it historically used "a five-ounce cup of all-purpose flour" as an average, and that a cup can weigh anywhere from four to six ounces depending on how it is filled (Stella Parks, "Do You Scoop or Spoon Your Flour?", Serious Eats, syndicated copy). America's Test Kitchen uses "1 cup = 5 ounces" for all-purpose flour in its recipes (americastestkitchen.com, "How to weigh flour"). That article doesn't say whether Kenji López-Alt's recipes use the same convention. I could not check the table in _The Food Lab_ itself, so its values are **not verified here**.
- **Sugar, butter and eggs agree** within about 1%, except that Foundation's 188 g sugar is about 6% below the rest.
- **Rice** differs by about 7% (185 vs 198 g).
- **Takeaway:** any single source is "accepted" only to within ±5–10% for flours and other powders. The Conversion should be marked approximate (#31), and an Ingredient override (CONTEXT.md) is the right fix for a kitchen that scoops its flour.

## 4. Other sources

- **King Arthur Baking ingredient weight chart.** Roughly 380–400 baking Ingredients, each with volume, ounces and grams. The page says "Copyright © 2026 King Arthur Baking Company, Inc. All rights reserved." It can't be bundled, but it's useful as a cross-check for baking Ingredients that SR Legacy lacks (specialty flours, mix-ins). Like any table of facts, individual values aren't copyrightable, but copying the compiled chart would be.
- **Open Food Facts.** The database is under ODbL, individual contents under DbCL and images under CC BY-SA (https://world.openfoodfacts.org/data). Exports are CSV (about 0.9 GB compressed), JSONL, Parquet and MongoDB. It describes **packaged products** by barcode, with a `serving_size` per product. It has no household-measure Conversions for generic Ingredients, so it doesn't fit this question. Bundling it would also bring in ODbL share-alike obligations.
- **J. Kenji López-Alt, _The Food Lab_.** Cross-check only, as the ticket says. Its values are facts, but the table as a whole is a copyrighted compilation. Not reproduced here.
- **FNDDS** (also USDA, public domain) has many "1 cup" portions, but for foods as eaten in surveys. It could fill gaps in cooked staples (cooked rice, cooked beans), but SR Legacy already has many of those (e.g. cooked long-grain rice 158 g/cup).

## Implications for the decision

1. **Bundle a curated MiseFlow reference table built from SR Legacy.** Each row maps a MiseFlow Ingredient to one FDC id and stores grams per ml (from the cup, tbsp or tsp row) and/or grams per piece, with the default size (medium) and the source (`fdc:168894`). Expect a few hundred rows. Build it once at development time, review it, and commit it. Don't ship the raw 14,636-row table.
2. **Normalise every volume to millilitres** with the US customary cup (236.588 ml), because that's what SR Legacy measured. A cup the app reads as metric (250 ml) then gets the right weight.
3. **Take Foundation Foods values only where a row exists and is reviewed**, since they disagree with SR Legacy and cover very little.
4. **Treat every reference Conversion as approximate** (±10% for flours and powders) and let the Ingredient override it (CONTEXT.md, #31).
5. **Count units need a default size and an edible-vs-as-bought note.** Some items (shallot, ginger, "a bunch") have no reference and need the "needs conversion" path (#31).
