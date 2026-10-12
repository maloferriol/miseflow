# Which is canonical for Recipes: the database or the Cooklang files?

Type: grilling
Status: open
Blocked by: 01, 02, 08, 09
Assignee: —

## Question

Pick the source of truth for Recipes (incl. sub-recipes): (a) files canonical, DB is an index/cache rebuilt from them; (b) DB canonical, files are an export/import surface; (c) split — files canonical for some fields, DB for the rest. Judge against portability first (see map Notes), given what Cooklang can carry (01), the backend constraints (02), and where the data Cooklang can't hold lives (09), which largely decides whether (c) is viable. Record as an ADR.
