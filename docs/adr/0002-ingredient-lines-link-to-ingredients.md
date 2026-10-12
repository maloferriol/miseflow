# Ingredient lines link to an Ingredient; totals never match by text

Every Ingredient line points to one Ingredient in the kitchen's Ingredient catalog, and the Shopping list adds lines up by that link. It never groups lines by their wording. We chose this because allergen and dietary tags, the default Station, Conversions and Pack sizes all live on the Ingredient, so name matching would have to be redone, and could silently go wrong, every time a list is built. The cost is that every line must be linked: on entry and on import it's matched by exact name or alias. Otherwise the cook confirms an action chosen in advance: link to a near match, which teaches the kitchen a new alias, or create a new Ingredient ([#39](https://github.com/maloferriol/miseflow/issues/39)). Things bought as different products are separate Ingredients with no roll-up, while preparation and size stay on the line. Decided on [#27](https://github.com/maloferriol/miseflow/issues/27).

## Considered Options

- **Match by name when building the Shopping list.** Needs no linking step, but "AP flour" and "all-purpose flour" only add up if the normaliser happens to agree, and tags and Conversions would be looked up by name each time.
- **An Ingredient hierarchy with roll-ups** (sugar, then brown sugar). Rejected, because the Shopping list must keep apart what the cook buys separately. Substitutions are left to a later effort.
