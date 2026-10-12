# Existing ingredient databases for the Ingredient catalog

Answers ticket #35 ("Which existing ingredient databases could seed the Ingredient catalog, and how hard is the data to manage?", map #25). Researched 2026-10-12. Vocabulary follows `/CONTEXT.md`: an **Ingredient** is a purchasable item in the kitchen's catalog, an **Ingredient line** is one use of it in a Recipe (Quantity, the author's wording, preparation), and a **Conversion** turns a Quantity into a different kind of measure. Builds on `reference-conversions.md` (#26), which recommends a curated Conversion table from USDA FDC SR Legacy keyed by FDC id.

| Source                                                                                                                               | What was read                                                                                                                                              | Access                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Open Food Facts ingredients taxonomy: `taxonomies/food/ingredients.txt` in https://github.com/openfoodfacts/openfoodfacts-server     | Downloaded and analysed (3.07 MB, `main`, last commit 2026-10-12). Repo licence via GitHub API. Data licence from https://world.openfoodfacts.org/data     | live 2026-10-12                   |
| FoodOn: https://github.com/FoodOntology/foodon                                                                                       | Downloaded `foodon.owl` (40.8 MB, versionIRI `releases/2026-09-20`) and `foodon-synonyms.tsv` (10.1 MB, 109,437 rows). Licence and releases via GitHub API | live 2026-10-12                   |
| Wikidata: https://query.wikidata.org/sparql                                                                                          | SPARQL queries for food ID properties and sample items                                                                                                     | live 2026-10-12                   |
| LanguaL: https://www.langual.org/                                                                                                    | Home page; downloads page terms via search index (the download page URL I tried returned 404)                                                              | partly via search index           |
| USDA FDC SR Legacy `food.csv`                                                                                                        | Same public-domain mirror as #26 (`fdc.nal.usda.gov` still does not resolve from this machine)                                                             | re-check against the official zip |
| Cooklang: `seed/config/aisle.conf` in https://github.com/cooklang/cookcli, `src/aisle.rs` in https://github.com/cooklang/cooklang-rs | Downloaded and read                                                                                                                                        | live 2026-10-12                   |
| Spoonacular terms: https://spoonacular.com/food-api/terms                                                                            | Read                                                                                                                                                       | live 2026-10-12                   |
| Edamam: https://developer.edamam.com/food-database-api                                                                               | Read. https://www.edamam.com/terms/ renders client-side and returned no text, so the full Terms of Use were **not** read                                   | partly                            |
| `ingredient-parser-nlp` 2.9.0 (PyPI, https://github.com/strangetom/ingredient-parser)                                                | Installed in a scratch venv and run on test lines                                                                                                          | live 2026-10-12                   |
| NYT `ingredient-phrase-tagger`, `parse-ingredient` (npm)                                                                             | GitHub repo metadata, README and licence only; not run                                                                                                     | live 2026-10-12                   |

## TL;DR

- **No existing database can be adopted as the catalog as-is.** Each one models something other than "a thing a cook buys": Open Food Facts models what's printed on product labels, FoodOn models food science (plant vs food product vs raw food as separate classes), Wikidata mixes species with foods, LanguaL is a facet code system, and FDC names are nutrient-database descriptions ("Onions, spring or scallions (includes tops and bulb), raw"). A **curated MiseFlow seed of a few hundred Ingredients** is the right shape, and it can be the same rows as #26's Conversion table.
- **The Open Food Facts (OFF) ingredients taxonomy is the best source of names, aliases and FDC links.** It has 5,730 entries, English names for 4,846, and up to 192 languages. It has good synonym lists ("spring onion, green onion, scallions, spring onions, green onions"; "chickpea … garbanzo beans"; "aubergine, eggplant") and a parent hierarchy. **691 entries carry a `usda_fdc_code`, and all 691 resolve to the FDC data used in #26 (667 SR Legacy, 24 Foundation).** It also links 1,273 entries to Wikidata and 924 to CIQUAL.
- **OFF's licence is ambiguous.** The data is ODbL (attribution plus share-alike for derived databases), but the taxonomy file lives in an AGPL-3.0 code repo and states no licence of its own. Safest use: a **build-time reference**, with attribution. Any seed file that copies OFF synonym lists wholesale should be treated as an ODbL derivative (share-alike applies to that data file, not to MiseFlow's code). Or ask reuse@openfoodfacts.org.
- **Wikidata is CC0 and can be copied freely**, but its food coverage is thin: 129 items with a FoodData Central ID (P12917), and those point at a mix of SR Legacy, Foundation and survey foods. It has 1,470 with a USDA NDB number (P1978), 1,201 with an OFF ingredient ID (P5930) and 314 with a FoodOn ID (P6767). It's useful for cross-checking aliases, not as a seed.
- **FoodOn (CC BY 4.0) has effectively no FDC ids** (one FDC cross-reference in the whole file) and splits one cook's Ingredient into many classes ("scallion", "scallion (raw)", "scallion food product", "scallion plant", "welsh onion" all carry "spring onion"/"scallion" synonyms). Too fine-grained and noisy for a catalog. **LanguaL** has been frozen since 2017, has no clear open licence, and its FoodOn successor already covers it. **Edamam and Spoonacular** forbid storing or building a copy of their data. Neither can seed anything.
- **Cooklang's `aisle.conf`** (MIT) is a tiny British-English shopping-aisle list (~190 names, 17 with `|` synonyms, e.g. `flour | plain flour`). It's a useful export format for aisles and aliases, not a seed.
- **Parser: `ingredient-parser` (MIT, Python, released 2026-10-11) handles all four test lines correctly**, and returns `size` and `preparation` as separate fields, which matches #27's model. "Packed" lands in `comment`, not `preparation`. Its built-in FDC matching mixes datasets and missed "AP flour" and "scallions", so it shouldn't link Ingredients. MiseFlow's own alias table should do that.
- **Effort:** about 2–4 days of curation for a seed of ~300 Ingredients, done once by a script that proposes candidates (OFF names + synonyms joined to the #26 FDC rows) plus a human review. Ongoing upstream work is near zero: SR Legacy is frozen, and nothing is pulled at runtime. The real ongoing work is **in the app**: matching lines on entry and import, kitchen aliases, and merging.

## 1. Candidates

### Open Food Facts ingredients taxonomy

- **What it is.** A plain-text DAG used to parse ingredient lists on product labels. Each entry has a canonical name per language with comma-separated synonyms, `<` parent links and properties. Excerpt (spring onion entry, other languages and properties trimmed):

  ```
  < en: onion
  en: spring onion, green onion, scallions, spring onions, green onions
  de: Frühlingszwiebel, Frühlingszwiebeln, Lauchzwiebel
  ciqual_food_code:en: 11003
  usda_fdc_code:en: 170005
  usda_ndb_name:en: Onions, spring or scallions (includes tops and bulb), raw
  ```

- **Size and format.** 3.07 MB of text, 5,730 entries. A JSON export is published at https://static.openfoodfacts.org/data/taxonomies/ingredients.json (3.66 MB, last modified 2026-10-09). An editor exists at https://github.com/openfoodfacts/taxonomy-editor.
- **Languages.** 192 language codes. Most common: en 4,846 entries, fr 4,033, it 3,829, hr 3,417, de 3,163.
- **Links.** `usda_fdc_code` on 691 entries. I joined all 691 against the FDC `food.csv` from #26: 667 are SR Legacy and 24 are Foundation, and none failed to resolve. Also `wikidata` on 1,273 entries, `ciqual_food_code` on 924, and `usda_ndb_code` on 674.
- **Coverage (my check on 60 everyday names, the #26 list plus regional variants).** 56/60 matched an English name or synonym exactly, and 21 of those carry an FDC code (onion 170000, carrot, potato, lemon, shallot, brown sugar 168833, honey, salt 173468, cornstarch 169698…). Gaps and quirks:
  - **"all-purpose flour", "bread flour" and "AP flour" are missing.** Flours are keyed by label wording ("wheat flour", "Wheat flour type 55", "wheat flour type 00"). These are European label types, not the cook's names.
  - **"scallion" (singular) misses.** Only "scallions" is listed. Synonyms are exact strings, so MiseFlow must normalise plurals itself.
  - **"baking soda" isn't an ingredient.** It's in the additives taxonomy, as E500(ii).
  - **"cornflour" means maize flour, not cornstarch.** In British recipes "cornflour" is cornstarch. OFF follows label usage, so regional meanings need a human.
  - **Separate entries where a cook would see one product:** "heavy cream" and "double cream" are both children of "cream". That's arguably right under #27's rule that things you buy as different products are different Ingredients.
  - **Many entries are irrelevant to cooking:** flavourings ("onion flavouring"), preparations, numbered flour types.
- **Hierarchy.** It has `<` parents (spring onion < onion; wheat flour < cereal flour, wheat), but #27 rules out roll-ups, so the hierarchy is useful only for search and categorising.
- **Allergen/dietary tags.** `allergens:en` is set on 76 entries (e.g. `en:gluten`, meant to be inherited down the hierarchy), and `vegan` / `vegetarian` on a few hundred. A possible starting point for the allergen tags an Ingredient carries (CONTEXT.md), but out of scope here.
- **Maintenance.** Very active. The file had several commits on 2026-10-11 and 2026-10-12 alone.
- **Licence.**
  - The OFF data page says the database is under the **ODbL** and individual contents under the **DbCL**. Public use requires attribution ("Contains data from Open Food Facts, available under the Open Database License"), and adapted databases that are made public are share-alike.
  - The taxonomy file itself sits in `openfoodfacts-server`, whose repository licence is **AGPL-3.0** and which states no separate licence for `taxonomies/`.
  - **I found no primary source that settles which licence applies to the taxonomy.** OFF's API docs point reuse questions to reuse@openfoodfacts.org.

### FoodOn

- **Licence:** CC BY 4.0 (GitHub licence API). It can be bundled with attribution.
- **Format:** OWL. `foodon.owl` is 40.8 MB with 29,255 `FOODON_` classes. `foodon-synonyms.tsv` is 10.1 MB, with 34,509 labels plus about 32,000 synonyms and alternative labels (exact 11,687, plain 11,191, narrow 4,726, broad 2,750, alternative 1,887).
- **Languages:** overwhelmingly English (48,116 `@en` strings; the next language is Spanish with 39).
- **Maintenance:** active. The `master` versionIRI is `releases/2026-09-20`, and the last GitHub release is v2025-07-31.
- **FDC links:** effectively none. `foodon.owl` has exactly one FDC cross-reference (to FDC 173711). Its xrefs are to PLANTS, ITIS, Codex, Mansfeld and LanguaL. It does have "USDA SR … (0100)" category classes, but no food-level FDC ids.
- **Fit:** poor for a catalog. One kitchen Ingredient maps to several classes, and the same synonym is attached to several of them: "spring onion" is an exact synonym of both "scallion food product" (FOODON_00002695) and "welsh onion" (FOODON_00003172), and "scallion (raw)" (FOODON_03311340) has "scallion", "green onion" and "spring onion" too. "All-purpose flour" is absent; flours are "white wheat flour (unbleached, enriched)" and similar.

### Wikidata

- **Licence:** CC0 for structured data, so copying needs no attribution.
- **Food-ID properties found** (counts of items, SPARQL 2026-10-12):

  | Property                              | Items |
  | ------------------------------------- | ----- |
  | FoodData Central ID (P12917)          | 129   |
  | USDA NDB number (P1978)               | 1,470 |
  | Open Food Facts ingredient ID (P5930) | 1,201 |
  | FoodOn ID (P6767)                     | 314   |

- **The FDC ids are mixed datasets.** Butter → 2710154, almond → 2346393 (Foundation/newer ranges), apple → 168204 (SR Legacy), banana → 1105314 and 1105073 (survey/FNDDS). They can't be joined to #26's table without review.
- **Ambiguity between species and food.** Onion (Q23485) is the plant _Allium cepa_, with plant aliases. The food item is a separate entity. Garlic as a food (Q21546392, aliases "bulb of garlic", "head of garlic") carries the OFF id `en:garlic`.
- **Fit:** an alias and translation cross-check, and a CC0 way to get multilingual names later. Not a seed.

### LanguaL

- A faceted food-description thesaurus, administered by the European LanguaL Technical Committee and hosted by Danish Food Informatics.
- Latest thesaurus: **LanguaL 2017**, with 12,605 descriptors (langual.org home page, updated 2025-11-05). The page says SR28 is fully LanguaL-indexed and that FoodOn is its successor.
- Licence: the downloads page (via search index) says the thesaurus is free of charge but protected by EU copyright law. I found **no open licence**.
- Its codes describe facets (part of plant, treatment, preservation), not the names a cook types. Not useful for MiseFlow.

### USDA FDC food names

- Public domain (#26). The descriptions are in nutrient-database word order and mix in the state of the food: "Onions, raw", "Sugars, brown", "Flour, wheat, all-purpose, unenriched, unbleached". They aren't usable as display names or aliases without rewriting, but they are the **join key** for Conversions.
- The original SR28 release had a common-name field. I couldn't confirm whether FDC's CSV keeps it (`food_attribute.csv`): the mirror I have doesn't include that table, and the FDC host was unreachable. **Not verified.**

### Cooklang `aisle.conf`

- **Format:** `[aisle]` headers, then one Ingredient per line, with `|`-separated names where the first is the common name. `cooklang-rs` parses it (`src/aisle.rs`, MIT).
- **The seed file `cookcli/seed/config/aisle.conf`** (MIT) is 199 lines in 8 aisles. Only 17 lines have synonyms (`onion | onions`, `flour | plain flour`). It's British-leaning ("tinned goods", "plain flour", "spring onions").
- **Fit:** too small to seed from. Worth noting as an **export format** for MiseFlow's Ingredient names and aisles when writing Recipe files (ADR 0001, Cooklang export), and for #12's shopping categories.

### Commercial APIs

- **Spoonacular** (terms page): it prohibits "copying or storing" API data, "including derived, hashed, or transformed data". Caching needs written permission and lasts 1 hour at most. You may store only recipe ID, title and image URL, and must delete all data when you stop using the API. It also has a no-compete clause.
- **Edamam Food Database API** (developer page): it does "not permit data caching unless explicitly permitted". Paid plans may cache only four macro nutrients plus food id, label and image, inside the end user's account. The terms do "not allow API subscribers to build a copy of the Edamam data". "Powered by Edamam" attribution is required. The full Terms of Use page didn't render for me.
- **Neither can seed or back a catalog.** Both are runtime-only and paid.

## 2. Parsers (free-text line → Quantity, unit, name, size, preparation)

`ingredient-parser-nlp` 2.9.0 (MIT; a CRF model plus rules; Python ≥3.10; about 4.8 MB installed with `nltk`, `pint` and `numpy`; released 2026-10-11, repo pushed 2026-10-12). It downloads an NLTK tagger to `~/nltk_data` on first run. Results:

| Line                             | name             | amount           | size  | preparation   | comment  |
| -------------------------------- | ---------------- | ---------------- | ----- | ------------- | -------- |
| `2 large onions, diced`          | onions           | 2                | large | diced         |          |
| `1 c. AP flour`                  | AP flour         | 1 cup            |       |               |          |
| `a pinch of salt`                | salt             | 1 pinch          |       |               |          |
| `3 cloves garlic, minced`        | garlic           | 3 cloves         |       | minced        |          |
| `1 cup packed brown sugar`       | brown sugar      | 1 cup            |       |               | packed   |
| `2 scallions, thinly sliced`     | scallions        | 2                |       | thinly sliced |          |
| `1 (14 oz) can chopped tomatoes` | chopped tomatoes | 1 can + 14 ounce |       |               |          |
| `salt and pepper to taste`       | salt; pepper     | none             |       |               | to taste |
| `250 g plain flour, sifted`      | plain flour      | 250 gram         |       | sifted        |          |

- **All four test lines parse correctly.** "a pinch" becomes a unit called `pinch`, which #25 says is listed but not totalled.
- **Size and preparation come out separately,** which is exactly what #27 needs: size picks the per-piece Conversion, and preparation stays on the line.
- **Mistakes to handle:** "packed" goes to `comment` (but #26/#31 need it to choose the 220 g vs 145 g Conversion), and "chopped" stays in the name for "chopped tomatoes". MiseFlow should look for preparation words in both `preparation` and `comment`.
- **Its `foundation_foods=True` option** links names to a bundled FDC list of 11,105 foods (SR Legacy 6,798, FNDDS 3,912, Foundation 395). It got onion → 170000 (SR) and brown sugar → 168833 (SR), but salt → 746775 and garlic → 1104647 (Foundation), and returned nothing for "AP flour" or "scallions". It mixes datasets and has gaps, so it shouldn't decide which Ingredient a line links to.
- **Other parsers:**
  - **NYT `ingredient-phrase-tagger`**: Apache-2.0, a CRF++ model. The repo is **archived, last pushed 2018-07-19**. It's the ancestor of this approach, but not maintained.
  - **`parse-ingredient`** (JavaScript, MIT, pushed 2026-09-16): rule-based. Relevant if MiseFlow's stack isn't Python (the repo has no stack decision yet). Not tested here.
  - **Cooklang Recipe files** need no NL parser. `@onion{2}` already separates name and Quantity, so importing a Recipe file is a pure name → Ingredient matching problem.

## 3. Managing the data

**Seeding.**

1. Start from #26's curated FDC rows (a few hundred).
2. A dev-time script joins them to OFF taxonomy entries via `usda_fdc_code` (667 SR Legacy links are ready), and adds OFF's English synonyms and Wikidata aliases as **candidates**.
3. A human picks the canonical name (the cook's name: "all-purpose flour", not "Flour, wheat, all-purpose…" or "wheat flour") and accepts or rejects aliases. They add missing cook's terms ("AP flour", "scallion", "plain flour" as a regional alias, "baking soda" / "bicarbonate of soda") and fix regional clashes ("cornflour").
4. Commit the result as a reviewed JSON or SQLite file with source columns (`fdc:170005`, `off:en:spring-onion`, `wd:Q…`).

Estimate: about 2–4 days for ~300 Ingredients. Most of that time is alias and regional review, not code.

**Keeping the curated subset small.** Seed only what has a reviewed Conversion or is very common. Don't import OFF wholesale: about 5,700 entries, many of them label-only (flavourings, flour types, additives). The seed is a starting catalog, not a reference to search.

**Cook-added Ingredients and aliases.** Each kitchen's catalog holds the seed Ingredients plus its own. Aliases are per kitchen and sit on top of seed aliases. When a cook picks an Ingredient for an unmatched line, that wording becomes a kitchen alias, so the next import matches. Matching needs normalisation that the sources don't provide:

- case and diacritics
- plural → singular (OFF lists "scallions" but not "scallion")
- strip size words (they go to the line), preparation and leading quantity

Then do an exact alias lookup, then fuzzy suggestions. **Never silently create an Ingredient on import.** Unmatched lines go to a review step.

**Merging.** Give Ingredients stable ids. A merge repoints Ingredient lines, moves aliases and overrides, and leaves a redirect from the old id. Conflicting Conversion overrides need a choice.

**Upstream updates.** SR Legacy is frozen. OFF changes daily, but MiseFlow only reads it at dev time, so updates are an optional periodic diff of the OFF entries the seed cites, plus re-review. No runtime dependency on any external service. **Seed rows and kitchen rows must be distinguishable**, so a seed update never overwrites a kitchen's edits.

## Recommendation

Seed the Ingredient catalog from a **small, hand-reviewed MiseFlow file (~300 Ingredients)**, built at development time from the same USDA FDC SR Legacy rows as #26.

- **FDC join:** every seed Ingredient carries its FDC id, so it joins #26's reference Conversions directly.
- **Names and aliases:** take candidates from the **Open Food Facts ingredients taxonomy**, whose 691 `usda_fdc_code` links (667 SR Legacy) make the join mostly mechanical. Cross-check them with **Wikidata** (CC0). Then add cook's terms by hand ("AP flour", "scallion"). Credit OFF. If OFF synonym lists are copied wholesale, publish the seed file under ODbL (only that file), or confirm with reuse@openfoodfacts.org first.
- **Not used:** FoodOn, LanguaL, Edamam and Spoonacular, each for the reasons above.
- **Alias strategy:** seed aliases plus per-kitchen aliases learned from the cook's choices, matched after normalisation (case, plurals, size and preparation removed). Unmatched lines are reviewed, never auto-created.
- **Parser:** use `ingredient-parser` (MIT) for free-text lines if the backend can run Python (otherwise evaluate `parse-ingredient`). Use only its quantity, unit, name, size and preparation/comment fields, not its FDC matching. Cooklang imports need name matching only.
- **Effort:** the work is a few days of one-off curation plus the matching, alias and merge features in the app. Upstream upkeep is negligible.
