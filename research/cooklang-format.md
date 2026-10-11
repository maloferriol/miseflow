# Research: Cooklang `.cook` / `.menu` as MiseFlow's recipe and menu format

Ticket: [#2](https://github.com/maloferriol/miseflow/issues/2) (map: [#1](https://github.com/maloferriol/miseflow/issues/1)).
Researched 2026-10-11 against primary sources: the Cooklang spec repo, the cooklang.org meal-planning guide, and source code and docs of `cooklang-rs`, `cookcli` and `cooklang-find`. Versions at time of reading: cooklang-rs **v0.19.0** (2026-09-30), `@cooklang/cooklang` (npm) **0.19.0**, CookCLI **v0.38.1** (2026-10-09), cooklang-find **v0.10.0** (2026-10-06).

This file states facts and their implications. It does not decide whether the DB or the files are canonical; a later grilling ticket does that.

Terms follow [CONTEXT.md](../CONTEXT.md).

## Short answer

- **Recipe content fits.** Ingredients with quantities and units, steps, sections (components such as dough and filling), notes, cookware, timers, sub-recipe references with scaling, optional ingredients, fixed (non-scaling) quantities, and free-form YAML front matter all exist in the spec today.
- **Steps have no stable identity.** A Step is "each paragraph". The parser gives it only a positional `number`, which restarts at 1 in each section. There are no step IDs, labels, step-level metadata or step-level attributes, and comments are thrown away by the parser. Anything MiseFlow attaches to a Step (make-ahead window, Task grouping, progress) needs an identity that MiseFlow provides itself.
- **A Service date has a home.** By convention a `.menu` section header holds a `YYYY-MM-DD` date (`== Saturday (2026-03-07) ==`), and a meal heading can hold a time (`Dinner (19:00):`). Both are conventions in CookCLI and cooklang-find, not core spec. Front matter can also hold any custom key.
- **The web parser is the official WASM build of cooklang-rs** (`@cooklang/cooklang` on npm). It is maintained in the same repo and versioned with the Rust core (0.x). The pure TypeScript parser is deprecated and archived. The WASM API covers parsing, scaling by factor and ingredient grouping. It does not expose unit-system conversion, aisle, pantry, shopping list or reference checking.
- **Units:** linear scaling of ingredient quantities only, with `=` to lock a quantity. After scaling, a value is "fitted" to the best unit in the same system. Conversion works within volume, mass, length, temperature and time. There is no volume↔mass conversion, no count/pack-size concept and no rounding up to purchasable units.
- **`aisle.conf` and `pantry.conf` are reusable as formats**, with limits. The aisle file is ordered categories with `|` synonyms. The pantry file is TOML with storage-location sections and quantity, low, bought and expire per item. Pantry subtraction only works when the unit string matches exactly, and its dates are unparsed strings.
- **References are file paths.** Renaming breaks them unless a tool rewrites them. CookCLI's server has a rename endpoint that rewrites exact references across the collection. `cook doctor validate` reports missing references. The parser itself only checks references when the host supplies a callback.

---

## 1. Stable identity for Steps

### What a Step is in the spec

- "Each paragraph in your recipe file is a cooking step. Separate steps with an empty line." A trailing `\` forces a line break inside the same step. ([spec README, Steps](https://github.com/cooklang/spec/blob/main/README.md#steps))
- Sections (`= Dough`, `== Filling ==`) group steps into components. "The section name and the `=` symbols after it are optional." ([spec README, Sections](https://github.com/cooklang/spec/blob/main/README.md#sections))
- Notes (`> text`) are separate text blocks, not steps. ([spec README, Notes](https://github.com/cooklang/spec/blob/main/README.md#notes))
- Comments: `-- line` and `[- block -]`. ([spec README, Comments](https://github.com/cooklang/spec/blob/main/README.md#comments))
- Metadata exists only at recipe level, as YAML front matter. ([spec README, Metadata](https://github.com/cooklang/spec/blob/main/README.md#metadata)) The spec has no syntax for metadata or attributes on an individual step.

### What the canonical parser (cooklang-rs) gives a Step

- `Step { items: Vec<Item>, number: u32 }`. The doc comment reads "The step numbers start at 1 in each section and increase with non text step." `Section { name: Option<String>, content: Vec<Content> }`. `Content` is `Step` or `Text` (notes and text paragraphs). ([src/model.rs](https://github.com/cooklang/cooklang-rs/blob/main/src/model.rs))
- The final `Recipe` model keeps no source spans for steps. The lower-level AST and pull-parser events keep source locations for items: "offers location information of each element back to the source file". ([src/ast.rs](https://github.com/cooklang/cooklang-rs/blob/main/src/ast.rs)) The WASM package exposes `parse_ast` and `parse_events`. ([typescript/src/lib.rs](https://github.com/cooklang/cooklang-rs/blob/main/typescript/src/lib.rs))
- **Comments are dropped.** The parser treats line and block comments as empty tokens (`is_empty_token`), and the `Event` enum has no comment variant. ([src/parser/mod.rs](https://github.com/cooklang/cooklang-rs/blob/main/src/parser/mod.rs)) So a `-- id: …` marker would stay in the file but never reach the parsed model.
- Old-style `>> key: value` metadata lines are deprecated since 0.14 in favour of YAML front matter. Either way they are recipe-level, not step-level. ([CHANGELOG 0.14.0](https://github.com/cooklang/cooklang-rs/blob/main/CHANGELOG.md))

### Step numbering is positional and has changed before

- CookCLI changed from numbering steps across the whole recipe to restarting at 1 in each section (between 0.20 and 0.24). The maintainer confirmed it was intentional. The change broke users' step-picture names. ([cookcli#277](https://github.com/cooklang/cookcli/issues/277))
- Step pictures are positional: `Recipe.N.jpg` ([spec conventions, Adding Pictures](https://github.com/cooklang/spec/blob/main/conventions.md#adding-pictures)), and also `stem.S.N.jpg` (section + step) in cooklang-find / CookCLI ([cookcli src/server/rename.rs](https://github.com/cooklang/cookcli/blob/main/src/server/rename.rs)). The ecosystem's own attach-to-a-step mechanism is therefore positional, and it breaks when steps are inserted or reordered.

### cooklang-rs extensions that touch steps ([extensions.md](https://github.com/cooklang/cooklang-rs/blob/main/extensions.md))

- **Intermediate preparations:** `@&(~1)dough{}` (1 step back), `@&(2)thing{}` (step 2), `@&(=2)thing{}` (section 2), `@&(=~2)thing{}`. These refer to earlier steps _by position_ within the current section. They are useful as a dependency signal between steps, but they are not identity.
- **Component alias** (`@white wine|wine{}`), **modifiers** (`@@`, `&`, `-`, `?`, `+`), **modes** (`>> [mode]: …`, `>> [duplicate]: ref`), **advanced units**, **range values** (`@eggs{2-4}`), **inline quantities/temperature**, **timer requires time**. None of these adds a step label or ID.

### Options available inside the format (facts about each, not a recommendation)

| Mechanism                                                             | Survives in parsed model?                                              | Visible to cooks in other Cooklang apps? | Notes                                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Positional `(section, number)`                                        | Yes                                                                    | n/a                                      | Breaks on insert, delete or reorder. Numbering scheme has changed before (cookcli#277). |
| Section name per component (`== Make-ahead: Dough ==`)                | Yes (`Section.name`)                                                   | Yes, rendered as a heading               | Granularity is a section, not a step.                                                   |
| `-- comment` marker on/near a step                                    | **No** (dropped by parser)                                             | No                                       | Would need MiseFlow's own source scan or the AST spans.                                 |
| `> note` block before a step                                          | Yes, as `Content::Text`                                                | **Yes**, shown as text                   | Pollutes the recipe for other apps.                                                     |
| Custom front-matter key mapping step positions/content hashes to data | Yes (custom keys preserved: `custom: Record<any, any>` in WASM output) | Ignored by apps                          | Recipe-level map. Still needs a positional or content key to match steps.               |
| Identity held outside the file (DB), matched by content hash or diff  | n/a                                                                    | n/a                                      | Not a Cooklang feature. MiseFlow would own the matching.                                |

---

## 2. Where a Service date (and time) can live in a `.menu` file

### What the conventions say

- A `.menu` file "is a valid Cooklang file that uses sections for days and recipe references to compose a plan." ([spec conventions, Menu Files](https://github.com/cooklang/spec/blob/main/conventions.md#menu-files))
- "Sections can include dates in `YYYY-MM-DD` format. Applications recognise these dates and can surface a shortcut link to the relevant day's plan." Example: `== Day 1 (2026-03-07) ==`. (same source)
- The meal-planning guide says each day is a `==Name==` section with an optional date in parentheses (ISO examples). Meals go under `Breakfast: \` style labels with `-` bullets and `\` line continuations. The front matter `servings:` sets how many people the plan feeds, and references scale to match. ([cooklang.org/guides/meal-planning](https://cooklang.org/guides/meal-planning/))

### What tools actually parse

- **cooklang-find `Menu` model** (Rust, with Swift/Kotlin bindings): `MenuSection { name, date: Option<String> /* first YYYY-MM-DD in the header, as written */, meals }`, and `MenuMeal { meal_type, time: Option<String> /* H:MM or HH:MM from a heading like "Breakfast (08:30):" */, items }`. Items are `RecipeReference`, `Ingredient`, `Text`, `Note` (`-- comment`) and `LineBreak`. It also provides `dates()`, a date range, and `list_menus_for_date`. ([src/menu/model.rs](https://github.com/cooklang/cooklang-find/blob/main/src/menu/model.rs), [src/menu/parse.rs](https://github.com/cooklang/cooklang-find/blob/main/src/menu/parse.rs)) Date regex: `(?:^|\D)(\d{4}-\d{2}-\d{2})(?:\D|$)`, so the date can sit anywhere in the header. Dates are plain strings with no timezone.
- **CookCLI**: `extract_time` parses `Breakfast (08:30):` ([src/web/menus.rs](https://github.com/cooklang/cookcli/blob/main/src/web/menus.rs)). The web UI shows "today's menu" by matching the section date ([design doc](https://github.com/cooklang/cookcli/blob/main/docs/superpowers/specs/2026-06-24-menus-for-date-integration-design.md)). `cook shopping-list Plan.menu --from/--to <date|today>` keeps only dated sections in range, and undated sections such as `== Day 1 ==` are "not days" ([docs/shopping-list.md](https://github.com/cooklang/cookcli/blob/main/docs/shopping-list.md)).
- Front matter in `.menu` is free YAML. cooklang-find exposes it as `Menu.metadata`, and `title` becomes the menu name. ([model.rs](https://github.com/cooklang/cooklang-find/blob/main/src/menu/model.rs))
- Menus can nest: a meal can reference another menu (`- @./Brunches/Sunday.menu{}`), and `{4%servings}` scales it against that menu's `servings`. ([docs/shopping-list.md](https://github.com/cooklang/cookcli/blob/main/docs/shopping-list.md))

### Mapping notes for MiseFlow's model

- In the ecosystem a `.menu` is a **multi-day meal plan**. Each section is a day, so one file can hold many dates. A MiseFlow Menu is served at **one Service** with **ordered Courses** and a guest count. Two shapes the format can express:
  - one dated section = one Service, with Courses as meal-style headings (`Starter:`, `Main:`, `Dessert:`) or as bullets under one heading. File order gives Course order. An optional time can go on a heading (`Dinner (19:30):`) in CookCLI/cooklang-find's convention.
  - Service date/time as custom front-matter keys (e.g. `date:`, `time:`). This is not recognised by CookCLI or cooklang-find for "today" or `--from/--to`.
- Guest count maps to front-matter `servings`. References written as `{N%servings}` scale to it. ([spec conventions, Scaling Referenced Recipes](https://github.com/cooklang/spec/blob/main/conventions.md#scaling-referenced-recipes))
- The format has no notion of a Course _type_ beyond heading text, and no per-Dish progress or schedule fields. Those would be MiseFlow-layer data.

---

## 3. Parser options for a web app

| Option                                                                                                                                                 | Status                                                                                                                                                | Version / activity                                                                                                                                                                                      | Coverage                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`@cooklang/cooklang`** (npm). WASM build of cooklang-rs, in [`cooklang-rs/typescript`](https://github.com/cooklang/cooklang-rs/tree/main/typescript) | Official. README: "Official Cooklang parser for JavaScript and TypeScript". Works in Node 16+, modern browsers and bundlers (Vite, Webpack, Rollup)   | npm `latest` 0.19.0 (2026-09-30). Version tracks the Rust crate. "We'll bump to 1.0 when the Rust core reaches 1.0." ([README](https://github.com/cooklang/cooklang-rs/blob/main/typescript/README.md)) | Same parser as CookCLI, the playground and the Cook mobile/desktop apps ([cooklang-rs README](https://github.com/cooklang/cooklang-rs/blob/main/README.md)). All extensions on by default (`Extensions::all()`), and they can be switched off via a bitmask. |
| `@cooklang/cooklang-ts` (pure TS)                                                                                                                      | **Deprecated** on npm ("Please use @cooklang/cooklang instead"). Repo [cooklang/cooklang-ts](https://github.com/cooklang/cooklang-ts) is **archived** | Last 1.2.8                                                                                                                                                                                              | Superseded. Migration guide: [MIGRATION.md](https://github.com/cooklang/cooklang-rs/blob/main/typescript/MIGRATION.md)                                                                                                                                       |
| cooklang-find                                                                                                                                          | Rust with Swift/Kotlin (UniFFI) bindings. No JS/WASM build in the repo ([tree](https://github.com/cooklang/cooklang-find))                            | v0.10.0 (2026-10-06)                                                                                                                                                                                    | The only structured `.menu` parser (sections, dates, meals, times). For web use it would need porting or a WASM build.                                                                                                                                       |
| tree-sitter-cooklang                                                                                                                                   | Grammar for editors ([repo](https://github.com/cooklang/tree-sitter-cooklang))                                                                        | updated 2026-06                                                                                                                                                                                         | Syntax highlighting/CST only, no semantic model.                                                                                                                                                                                                             |

**What the WASM API exposes** ([typescript/src/lib.rs](https://github.com/cooklang/cooklang-rs/blob/main/typescript/src/lib.rs)): `Parser.parse(input, scale?)`, which returns the recipe plus interpreted standard metadata (title, description, tags, author, source, course, time, servings, difficulty, cuisine, diet, images, locale) plus `custom` (all other front-matter keys) plus a rendered diagnostics report. Also `parse_ast`, `parse_events`, `parse_full`, `parse_render`, `std_metadata`, `group_ingredients`, `group_cookware`, the `load_units` toggle, the `extensions` bitmask, and display/should-be-listed/is-optional helpers.

**What it does not expose** (from the same file): unit-system conversion (`Recipe::convert`), `scale_to_servings` / `scale_to_yield` (only a numeric factor), aisle and pantry parsing, shopping-list building, and recipe-reference existence checks (`ParseOptions.recipe_ref_check` is not wired). Reaching those from a browser would mean extending the WASM bindings or reimplementing them.

**Maturity signals:** 0.x semver with frequent breaking changes in the changelog. Examples: 0.19.0 made `?` core syntax and added a `FrontMatter` AST variant. 0.16.6 removed generics from `Recipe` and made scaling infallible. 0.14 replaced `>>` metadata with YAML. ([CHANGELOG](https://github.com/cooklang/cooklang-rs/blob/main/CHANGELOG.md)) The spec README warns "not all latest language features supported in the apps yet". ([spec README](https://github.com/cooklang/spec/blob/main/README.md))

---

## 4. Units, conversion and scaling in cooklang-rs

- **Quantity syntax:** `@name{qty%unit}`. Fractions (`1/2`) are allowed. Ranges (`2-4`, `200-300%ml`) come from an extension. With the advanced-units extension, a space can replace `%` (`@water{1 L}`). ([spec README](https://github.com/cooklang/spec/blob/main/README.md#ingredients), [extensions.md](https://github.com/cooklang/cooklang-rs/blob/main/extensions.md))
- **Units config:** bundled [`units.toml`](https://github.com/cooklang/cooklang-rs/blob/main/units.toml) with `default_system = "metric"`, SI prefix expansion, per-system/quantity/unit fraction rules (e.g. tsp max denominator 8), and `best` units per system (volume: ml, l | cup, tsp, tbsp; mass: mg, g, kg | oz, lb; and so on). The [`UnitsFile`](https://github.com/cooklang/cooklang-rs/blob/main/src/convert/units_file.rs) schema allows layering extra files that extend or edit units (e.g. [units/spanish.toml](https://github.com/cooklang/cooklang-rs/blob/main/units/spanish.toml)).
- **Physical quantities known:** `Volume, Mass, Length, Temperature, Time` only. ([src/convert/mod.rs](https://github.com/cooklang/cooklang-rs/blob/main/src/convert/mod.rs)) There are no count/piece units, no packs, and no per-ingredient density, so cups of flour cannot convert to grams.
- **Conversion:** `Recipe::convert(to: System)` converts ingredients, timers and inline quantities to metric or imperial in place, and collects errors for missing, unknown or text units. Formula: `val * ratio + difference`. (same file)
- **Scaling:** `Recipe::scale(factor)` multiplies only quantities marked `scalable`, then calls `fit()` to re-express the value in a best unit of the same system. It also updates numeric `servings` metadata. `scale_to_servings`, `scale_to_yield` (needs matching `yield` units) and `scale_to_target` wrap it. ([src/scale.rs](https://github.com/cooklang/cooklang-rs/blob/main/src/scale.rs))
- **What is scalable:** only **ingredient** quantities that are numeric and have no scaling lock. Cookware and timer quantities are never scalable. A lock on a non-ingredient produces an "Unnecessary scaling lock" warning. ([src/analysis/event_consumer.rs](https://github.com/cooklang/cooklang-rs/blob/main/src/analysis/event_consumer.rs))
- **Fixed quantities:** `@salt{=1%tsp}` keeps 1 tsp at any scale. Timers don't scale and cookware doesn't adjust. ([spec conventions, Scaling and Servings](https://github.com/cooklang/spec/blob/main/conventions.md#scaling-and-servings))
- **Sub-recipe scaling:** `@./x{2}` gives a factor, `@./x{4%servings}` scales against the referenced recipe's `servings`, and `@./x{150%ml}` scales against its `yield` (experimental, matching units only). It is an error if `yield` is absent or no unit matches. ([conventions](https://github.com/cooklang/spec/blob/main/conventions.md#scaling-referenced-recipes))
- **Gap vs MiseFlow baseline:** "rounded up to units you can buy" has no counterpart. Neither the spec nor cooklang-rs knows about pack sizes or purchasable units.

---

## 5. `aisle.conf` and `pantry.conf`

### aisle.conf ([spec conventions, Ingredient grouping](https://github.com/cooklang/spec/blob/main/conventions.md#ingredient-grouping))

```
[produce]
potatoes

[canned goods]
tuna|chicken of the sea
```

- `[category]` headers with arbitrary names (aisles or stores), one ingredient per line, and `|` synonyms where the first name is the display name. "The order of sections and ingredients in the configuration file matters — apps display them exactly as written."
- Comments start with `//`. `cook doctor aisle` warns when a `#` or `--` line is read as an ingredient. ([cookcli docs/doctor.md](https://github.com/cooklang/cookcli/blob/main/docs/doctor.md))
- Parser: `cooklang::aisle::AisleConf`. Lookups are case-insensitive, and it provides `ingredient_sort_key` (category index, ingredient index) and `ingredients_info` (common name and category). It is serde-serialisable. ([src/aisle.rs](https://github.com/cooklang/cooklang-rs/blob/main/src/aisle.rs)) Ingredients not in any category appear under "other" in CookCLI. ([docs/shopping-list.md](https://github.com/cooklang/cookcli/blob/main/docs/shopping-list.md))
- One file maps one ingredient name to one category. It has no Station, allergen or dietary data.

### pantry.conf ([spec conventions, Pantry Configuration](https://github.com/cooklang/spec/blob/main/conventions.md#pantry-configuration))

```toml
[fridge]
milk = { expire = "10.05.2024", quantity = "1%L" }
[pantry]
rice = "5%kg"
pasta = { quantity = "1%kg", low = "200%g" }
```

- TOML. Sections are storage locations. An item is either a quantity string or a table with `bought`, `expire`, `quantity` and `low`.
- Parser: `cooklang::pantry::PantryConf` (order-preserving, lowercase index). Dates are plain strings and are not parsed. ([src/pantry.rs](https://github.com/cooklang/cooklang-rs/blob/main/src/pantry.rs))
- **Subtraction semantics** (`IngredientList::subtract_pantry`, [src/ingredient_list.rs](https://github.com/cooklang/cooklang-rs/blob/main/src/ingredient_list.rs)):
  - item in pantry with no quantity: removed from the list ("assume we have it")
  - `"unlim"` / `"unlimited"`: removed
  - quantity ≤ 0: kept in full
  - otherwise subtracted **only if the unit string matches exactly (lowercased)**. There is no unit conversion, so `1%kg` in the pantry does not offset `500%g` in the recipe. A mismatch keeps the full amount and logs a warning.
- CookCLI: `cook shopping-list` subtracts the pantry automatically and accepts `--pantry <path>` / `--ignore-pantry` ([design](https://github.com/cooklang/cookcli/blob/main/docs/superpowers/specs/2026-05-15-shopping-list-pantry-flags-design.md)). `cook pantry list|add|remove|update` provides CRUD ([docs/pantry.md](https://github.com/cooklang/cookcli/blob/main/docs/pantry.md)). Optional ingredients don't count as missing in pantry matching ([conventions](https://github.com/cooklang/spec/blob/main/conventions.md#pantry-configuration)).
- Related conventions: a `.shopping-list` file (recipe refs with multipliers, nesting, free-hand items, `? name{qty}` selection lines for accepted optional ingredients) and an append-only `.shopping-checked` log (`+ name` / `- name`, last wins, case-insensitive, global across recipes). ([conventions, Shopping list format](https://github.com/cooklang/spec/blob/main/conventions.md#shopping-list-format))
- Neither the aisle nor the pantry parser is exposed in the WASM package (§3).

---

## 6. Recipe references, rename and re-import

- **Syntax:** `@./sauces/Hollandaise{150%g}`. The path is "relative to the root of the recipes directory, without the `.cook` extension". ([spec README, Referencing other recipes](https://github.com/cooklang/spec/blob/main/README.md#referencing-other-recipes)) Optional references are written `@?./…{}`. In the model, a reference is `RecipeReference { name, components }`, which is only a path. ([src/model.rs](https://github.com/cooklang/cooklang-rs/blob/main/src/model.rs)) There is no ID, so **identity is the file path**.
- **Parser validation:** none by default. `ParseOptions.recipe_ref_check` is an optional host callback "Check recipe references for existence". ([src/analysis/mod.rs](https://github.com/cooklang/cooklang-rs/blob/main/src/analysis/mod.rs)) The WASM `Parser` doesn't wire it up.
- **`cook doctor validate`** checks syntax errors, warnings, "missing recipe references", and invalid units or quantities. `--strict` exits 1 for CI. ([docs/doctor.md](https://github.com/cooklang/cookcli/blob/main/docs/doctor.md)) The guide also says `cook recipe Plan.menu` shows unresolved references as warnings. ([meal-planning guide](https://cooklang.org/guides/meal-planning/))
- **Rename:** CookCLI's server has `POST /api/recipe_rename/{path}`. It renames a `.cook`/`.menu` file within its folder, moves its pictures, and rewrites references in other `.cook`/`.menu` files that name it exactly. References written with an escape, a comment or line break inside the name, or a different letter case are **left alone and reported**. A rewrite only happens in files unchanged since read, and existing destinations are never overwritten. The rename does not move files across folders. ([src/server/handlers/recipe_rename.rs](https://github.com/cooklang/cookcli/blob/main/src/server/handlers/recipe_rename.rs), [src/server/rename.rs](https://github.com/cooklang/cookcli/blob/main/src/server/rename.rs)) It also checks whether the saved `.shopping-list` still names the file. Renames done outside this endpoint (file manager, git, sync) rewrite nothing.
- **Re-import:** [cooklang-import](https://github.com/cooklang/cooklang-import) converts external recipes into new Cooklang text. Nothing in the spec or tools keeps identity across a re-import: a re-imported file is a new file, and step positions and text can change.
- **Cycles:** CookCLI's shopping list skips a reference that leads back to a recipe already being expanded, with a warning. ([docs/shopping-list.md](https://github.com/cooklang/cookcli/blob/main/docs/shopping-list.md))
- Note: CookCLI's rename code handles `@../Sauces/Tomato{}`-style references resolved from the writer's folder, which goes beyond the spec's root-relative wording. ([rename.rs](https://github.com/cooklang/cookcli/blob/main/src/server/rename.rs))

---

## 7. Recipe-level metadata relevant to MiseFlow

Canonical keys ([spec conventions, Canonical metadata](https://github.com/cooklang/spec/blob/main/conventions.md#canonical-metadata)):

| MiseFlow need                 | Cooklang support                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yield / servings              | `servings` / `serves` (the leading number is used for scaling, e.g. `6 portions`). `yield` in `number%unit`, single or list (`[500%ml, 350%g]`), used for unit-based reference scaling. They are independent. Default servings is 1.           |
| Durations                     | `time` / `duration` / `time required`, `prep time` / `time.prep`, `cook time` / `time.cook` (free-form, `1h30m` recommended). WASM returns the parsed `time`. Step durations exist only as inline timers `~{25%minutes}` / `~name{3%minutes}`. |
| Make-ahead window, shelf life | **No canonical key and no step-level field.** Custom front-matter keys are allowed and preserved (`custom` in WASM output), so a recipe-level key is possible. Other apps would ignore it.                                                     |
| Plating notes                 | No canonical key. Options in the format: `description` / `introduction` (recipe level), `> note` blocks (shown inline), a dedicated section (`== Plating ==`), or a custom key.                                                                |
| Course                        | `course` / `category`.                                                                                                                                                                                                                         |
| Diet / allergens              | `diet` (recipe level, string or array). The spec has no ingredient-level allergen tags.                                                                                                                                                        |
| Equipment                     | Cookware `#oven{}` inline per step, optionally `#?` optional, and can carry a quantity. There is no notion of units of equipment being schedulable.                                                                                            |
| Station                       | None.                                                                                                                                                                                                                                          |

---

## Implications for the "DB vs files canonical" decision (inputs, not a decision)

1. **Step identity cannot come from the file today.** If files are canonical, MiseFlow needs a step-matching strategy (positional, content hash or diff-based re-anchoring) or an in-file convention that the parser drops (comments) or that other apps display (notes). If the DB is canonical, Cooklang can still serve as import/export, but planning data won't round-trip through it.
2. **Round-tripping loses comments.** The parsed model drops comments, so parse→serialize (CookCLI is extracting a "back into Cooklang source" converter into `cooklang-format`, [design](https://github.com/cooklang/cookcli/blob/main/docs/superpowers/specs/2026-08-14-cooklang-format-crate-design.md)) cannot preserve them. _Inference:_ preserving the user's exact text needs edits applied to the source text through AST spans, which is how CookCLI's rename rewrites only the bytes of a reference.
3. **The `.menu` shape differs from MiseFlow's Menu.** The ecosystem's `.menu` is a multi-day plan, while MiseFlow's Menu is one Service with ordered Courses. Expressing a Service is possible with conventions (a dated section, meal headings as Courses), but Course semantics live only in heading text.
4. **Web parsing is covered, the rest is not.** The official WASM package parses and scales. Unit-system conversion, reference checking, aisle, pantry, shopping lists and `.menu` structure (cooklang-find) are Rust-only today.
5. **Reference integrity depends on paths.** Renames outside a reference-rewriting tool break links silently until `cook doctor validate` runs. A DB with IDs avoids this. Files as canonical would need MiseFlow to do the rewriting (as CookCLI's server does) or to validate on sync.
6. **Shopping gaps vs the baseline.** There are no purchasable-unit or pack-size concepts, no cross-unit pantry subtraction, no Station on ingredients, and no ingredient-level allergen tags. `aisle.conf` ordering and synonyms map well onto shopping categories.
7. **Churn risk.** Both the spec and the parser are actively changing (0.x, breaking changes in the last few releases). Any dependency, WASM package or file convention would need version pinning.
