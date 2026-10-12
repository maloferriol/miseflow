# Does a Supabase backend change whether files can be canonical?

Type: research
Status: resolved
Blocked by: —
Assignee: —

## Question

MiseFlow is local-first with SQLite assumed, but Supabase is possible. For each (plain local SQLite; Supabase hosted; Supabase with a local-first sync layer such as PowerSync/ElectricSQL), what does it mean for a folder of `.cook` files on the user's disk: can changes be detected (file watching) and pushed into the store, can the store write files back, and where would conflicts surface? Identify which options make "files are canonical" impractical and which keep it open.

Findings: `../research/backend-vs-files.md`

## Answer

Only plain local SQLite keeps "files are canonical" open. Hosted Supabase and Supabase + a sync layer (PowerSync/ElectricSQL) make the server the authority by design, so the `.cook` folder could only be an export/mirror, with three-way (file / local DB / server) conflicts surfacing on reconnect. File watching and write-back depend on the app platform, not the backend: a desktop shell (Tauri/Electron/Node) can do it; a browser-only app can't reliably. Watch events are lossy (missing filenames, editors that delete-and-recreate on save), so detection should rescan and compare content hashes. Keep the SQLite file out of network/cloud-synced folders.

Details and citations: `../research/backend-vs-files.md`
