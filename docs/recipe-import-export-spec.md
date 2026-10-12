# Recipe import/export spec

How MiseFlow exports Recipes as Cooklang files and imports them back. Assembled from map [#14](https://github.com/maloferriol/miseflow/issues/14); each section links the ticket that decided it. Terms are defined in [CONTEXT.md](../CONTEXT.md).

## 1. Source of truth

- The **database is canonical** for Recipes (including sub-recipes) and Menus. MiseFlow is a web app, cloud-synced with an offline cache; there is no watched folder. ([#22](https://github.com/maloferriol/miseflow/issues/22), [#17](https://github.com/maloferriol/miseflow/issues/17), [ADR 0001](adr/0001-database-canonical-cooklang-for-export.md))
- A **Recipe file** is a snapshot. Exporting gives a kitchen its recipes to keep or edit elsewhere; re-importing a Recipe file updates the Recipe it came from.
- Recipes change rarely, so files are never kept continuously in step with the app.
- Menus follow the same rule. Whether to offer a `.menu` export is left to a later effort.

## 2. Identity

- Inside the app, Recipes and Steps have database ids. Renaming or editing never breaks a link. ([#18](https://github.com/maloferriol/miseflow/issues/18))
- Every edit creates a new **Revision**. Past Revisions are kept. ([#21](https://github.com/maloferriol/miseflow/issues/21))
- **Editing Steps in the app:** when a Step is split, the first part keeps its id and planning data, and the new part uses the Recipe's make-ahead window. When two Steps are merged, the first survives and the cook settles any conflicting windows.

## 3. Export

### Layout

- The cook exports any selection: one Recipe, several, or the whole collection. Sub-recipes are always included, all the way down, so every `refs` entry resolves inside the export. ([#37](https://github.com/maloferriol/miseflow/issues/37))
- One `.cook` file per Recipe. Each sub-recipe is its own file, referenced by relative path (`@./stocks/chicken-stock{1%l}`).
- One `ingredients.yaml` at the root of the export, covering what this export contains.

### Front matter

Everything MiseFlow needs sits under a single `miseflow:` key, which other Cooklang tools ignore. Servings and yield use Cooklang's standard keys. ([#18](https://github.com/maloferriol/miseflow/issues/18), [#21](https://github.com/maloferriol/miseflow/issues/21), [#23](https://github.com/maloferriol/miseflow/issues/23), [#34](https://github.com/maloferriol/miseflow/issues/34))

```yaml
---
servings: 4
miseflow:
  id: r_7f3a
  revision: 12
  make_ahead: { earliest: 2d, keeps: 3d }
  steps:
    - { id: s_01, hash: 9c1e, make_ahead: { earliest: 1d, keeps: 2d } }
    - { id: s_02, hash: 44ab, after: [s_01] }
  refs:
    "./stocks/chicken-stock": r_12ab
---
```

| Key          | Holds                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | The Recipe's id. A re-import finds its Recipe by this.                                                                                |
| `revision`   | The Revision that was exported. It's the starting point for comparing changes on re-import.                                           |
| `make_ahead` | The Recipe's make-ahead window and shelf life.                                                                                        |
| `steps`      | Every Step in order: its id, a hash of its text, its own make-ahead window and shelf life, and its manual dependency links (`after`). |
| `refs`       | The Recipe id for each sub-recipe path the file references.                                                                           |

### Recipe text

The front matter is regenerated on every export. The Recipe text is handled Step by Step. ([#24](https://github.com/maloferriol/miseflow/issues/24))

- **Unchanged Steps** (the hash matches the text stored at import) are written back exactly as they were imported, including comments directly above them.
- **Edited Steps**, and every Step of a Recipe created in the app, are regenerated:
  - in CookCLI `cooklang-format` style (one paragraph per Step, `= Section`, `>` notes)
  - with each Ingredient line's own wording and **Original unit** (`@flour{2%cups}`), never the Main unit
- Comments on a Step edited in the app are lost. This is accepted.
- Rejected: patching the text in place using the parser's source spans. It's fragile and depends on cooklang-rs internals, which are pre-1.0.

### `ingredients.yaml`

([#23](https://github.com/maloferriol/miseflow/issues/23))

- Covers every Ingredient the exported Recipes use.
- For each Ingredient: allergen and dietary tags, default Station, aliases, and Conversions (density, weight per piece, pack sizes).
- Values are the ones **in effect**, either the shared reference value or the kitchen's override. Each is marked with where it came from, so a kitchen that leaves keeps working Conversions.

### Not exported

Progress, Task grouping, schedules and assignees are not exported. They belong to a Dish in one Service, not to the Recipe. The export's documentation says so. ([#23](https://github.com/maloferriol/miseflow/issues/23))

## 4. Import

Every import is shown first as an **Import preview**. Nothing changes until the cook confirms it.

### Matching Recipes

([#18](https://github.com/maloferriol/miseflow/issues/18))

- A file with a known `miseflow.id` **updates** that Recipe.
- A file with no id, such as one from outside MiseFlow, **creates** a new Recipe.
- The file's name and folder don't matter.
- The preview lists each file as "updates X" or "creates new". Any update can be switched to "creates new". Two files in one import with the same id are flagged (a copied file).

### Ingredients

([#37](https://github.com/maloferriol/miseflow/issues/37))

- **Changed values in `ingredients.yaml`**, such as tags, Station, aliases or Conversions, are offered as **kitchen overrides** in the preview, and the cook accepts each one. The shared reference values never change. An override that equals the reference value is skipped.
- **An Ingredient line whose name matches no Ingredient or alias** (`@shiso{5}`) is listed as a new Ingredient. By default it's created as one of the kitchen's own Ingredients. The cook can instead match it to an existing Ingredient, and the name becomes an alias.

### Matching Steps

([#18](https://github.com/maloferriol/miseflow/issues/18))

1. Steps whose text hash matches the `steps` list match exactly.
2. Edited Steps are then matched by comparing their text, the way a diff does.
3. New Steps get new ids. Removed Steps lose their planning data, and the preview lists that loss.

### Comparing changes on both sides

([#21](https://github.com/maloferriol/miseflow/issues/21))

- The import compares three versions: the exported Revision (the base), the file now, and the app now.
- If the app's Revision still equals the file's `revision`, nothing changed in the app and the file applies as is.
- Otherwise each Step, and each Recipe-level field (title, yield, servings, make-ahead window), is compared against the base:
  - **changed on one side only:** applied automatically
  - **changed on both sides:** a conflict, and the cook picks the file's version or the app's in the preview
- Ingredient lines sit inside Step text, so comparing Steps covers them.

| Step…                                                       | Result                                   |
| ----------------------------------------------------------- | ---------------------------------------- |
| added in the file                                           | new Step, no planning data               |
| removed in the file, untouched in the app since the export  | removed, with a warning                  |
| removed in the file, edited in the app since the export     | conflict                                 |
| added in the app since the export, so missing from the file | kept, because it was never in the export |

### Sub-recipe references

([#34](https://github.com/maloferriol/miseflow/issues/34))

A reference is resolved by trying, in order:

1. A file in the same import at that path.
2. The id that `miseflow.refs` gives for that path.
3. A suggested match by title, file name or alias, which the cook confirms in the preview.

If 1 and 2 disagree, the path wins and the preview says so. A reference that still doesn't resolve doesn't block the import. It becomes a **Missing sub-recipe**: the Recipe shows a warning, and scaling and the Shopping list skip that line until the reference is fixed.

### Fixing missing sub-recipes

([#36](https://github.com/maloferriol/miseflow/issues/36), [prototype](https://github.com/maloferriol/miseflow/blob/prototype/missing-sub-recipes/prototypes/missing-sub-recipes/index.html))

- **Right after an import**, a guided **resolver** walks through each missing sub-recipe in turn. The cook can:
  - pick a suggested Recipe
  - pick another Recipe in MiseFlow
  - import the file
  - treat it as a plain Ingredient
  - remove the line
  - skip it
- One answer fixes every Recipe that uses that path.
- **Skipped** references go to the kitchen's **Needs fixing** inbox. It has a count in the menu bar and lists upcoming-Service items first. Opening a row opens the same resolver.
- A Recipe's warning banner also links into the resolver.

## 5. Out of scope

- Importing formats other than Cooklang (forms, pasted text, URLs, other apps' exports). See [#4](https://github.com/maloferriol/miseflow/issues/4).
- A JSON export of the whole account (Menus, Services, Plans).
- A desktop companion that mirrors a folder, or live file sync.
- How Dishes, Tasks and the Shopping list react to Recipe edits ([#20](https://github.com/maloferriol/miseflow/issues/20)).
- Implementation details: the hash normalisation, the duration format, the cooklang-rs configuration (use `Extensions::empty()` for portability).
