# The Ingredient seed is published under ODbL

The shared Ingredient seed (about 300 Ingredients keyed by USDA FDC id, with aliases) takes many of its aliases from the Open Food Facts ingredients taxonomy. That data is licensed under ODbL, so the seed file is published under ODbL and credits Open Food Facts. The licence covers only that data file, not MiseFlow's code. We accepted this because Open Food Facts is the best source of synonyms that already link to FDC ids (691 entries), and because an openly licensed seed fits the portability goal: a kitchen can take it away. Kitchen-added Ingredients and aliases are kept separate from the seed. Decided on [#27](https://github.com/maloferriol/miseflow/issues/27); research in [#35](https://github.com/maloferriol/miseflow/issues/35).

## Considered Options

- **Wikidata (CC0) and hand-written aliases only.** No licence obligations, but much thinner synonym coverage and more curation work.
- **Ask Open Food Facts for permission under other terms.** Possible later. Not needed while publishing the seed openly is acceptable.
- **Commercial APIs (Edamam, Spoonacular).** Their terms forbid storing their data or building a copy of it.
