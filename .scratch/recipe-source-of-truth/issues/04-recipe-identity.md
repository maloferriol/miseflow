# How is a Recipe identified across renames and moves?

Type: grilling
Status: open
Blocked by: 01
Assignee: —

## Question

If `meringue.cook` is renamed or moved, Dishes must stay linked. Charting leaned to a stable id stored in the file's metadata rather than path-as-identity. Confirm that, and settle: who mints the id (app on first sight vs author), what happens to a file with no id, duplicated ids (file copied), and how sub-recipe references (by path) are re-resolved after a move.
