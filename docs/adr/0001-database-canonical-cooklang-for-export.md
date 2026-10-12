# The database is canonical for Recipes and Menus; Cooklang files are export/import only

MiseFlow stores every Recipe (including sub-recipes) and every Menu in its cloud-synced database, and that copy wins whenever two copies disagree. Cooklang `.cook` and `.menu` files are snapshots: MiseFlow exports them so a kitchen can leave with its recipes, and re-importing one updates the Recipe or Menu it came from (matched by id, not file path). We chose Cooklang for portability, which a dependable export already gives; recipes and menus change rarely, so keeping a folder of files continuously in step with the app isn't worth a desktop app, file watching and two-way conflict handling — and it would break the web/phone baseline.

## Considered Options

- **Files canonical, database as a rebuildable index.** Best for hand-editing, but needs a local desktop app with folder access; a web app can't reliably watch or write a folder, and Cooklang can't hold per-Step make-ahead windows, Step identity, or Ingredient tags and Stations.
- **Split** (files canonical for recipe text, database for planning data). Planning data hangs off Steps, which have no stable identity in Cooklang, so it would detach whenever a file is edited.
- **Desktop companion mirroring a folder.** Deferred to a later effort; nothing here prevents adding it as a mirror of the database.
