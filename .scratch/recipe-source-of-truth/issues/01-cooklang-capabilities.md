# What can a Cooklang file carry, and can it round-trip losslessly?

Type: research
Status: resolved
Blocked by: —
Assignee: —

## Question

Against the current Cooklang spec and its main parsers (cooklang-rs, cooklang-ts, CookCLI): what can a `.cook` file express beyond ingredients/cookware/timers/steps — YAML front matter / metadata, sections, notes, recipe references (`@./path{qty}`), custom annotations or extensions? Specifically, can it hold: a stable Recipe id; yield; make-ahead window + shelf life per Recipe and per Step; Ingredient allergen/dietary tags and default Station? Can a parse → model → serialize round-trip preserve a hand-written file (comments, ordering, formatting)? Is the spec versioned/stable enough to bet portability on?

Findings: `../research/cooklang-capabilities.md`

## Answer

Cooklang is a sound **portable format**, but it can't hold MiseFlow's full model as the only store.
- **Fits**: YAML front matter (any keys), sections, notes, comments, ingredient notes, optional/fixed quantities, recipe references `@./path{qty}`. Servings and yield are standard keys.
- **Custom front matter only** (other tools ignore it): a stable id, plus Recipe-level make-ahead window and shelf life. Cooklang identifies a recipe by its path, so references break when a file is renamed or moved.
- **No home**: anything attached to a single Step, so per-Step make-ahead windows can't go in the file. Ingredients have no attributes, so allergen/dietary tags and default Station can't either. The nearest precedent is a sidecar catalog like Cooklang's `aisle.conf`.
- **Round-trip is lossy**: the parser drops comments and layout. The only writer, CookCLI's `cooklang-format`, reformats and only promises the result means the same recipe. Keeping a hand-written file intact needs edits that patch the text in place using the parser's source spans.
- **Stability**: the spec has no version number. cooklang-ts is deprecated, leaving cooklang-rs (pre-1.0, often breaks its API, compiles to WASM) as the only parser. Use it with `Extensions::empty()` for portability. The core syntax has only grown since metadata moved to YAML front matter in late 2024.

Details and citations: `../research/cooklang-capabilities.md`
