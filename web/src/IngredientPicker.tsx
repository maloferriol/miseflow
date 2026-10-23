import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { type CatalogIngredient, fetchIngredients } from "./api.ts";

// A one-line combobox over the Ingredient catalog, opened when the cook types "@" in a Step.
// WAI-ARIA APG combobox with a listbox popup: DOM focus stays on the input, the active option
// is named by aria-activedescendant; Down/Up move, Enter picks, Escape closes (keeping what was
// typed as Step text).
// Source: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
export function IngredientPicker({
  onPick,
  onClose,
}: {
  onPick: (ingredient: CatalogIngredient) => void;
  /** Closed without a pick: `typed` goes back into the Step text after the "@". */
  onClose: (typed: string) => void;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const results = useQuery({
    queryKey: ["ingredients", query],
    queryFn: () => fetchIngredients(query),
  });
  const options = results.data ?? [];
  const expanded = options.length > 0;

  useEffect(() => input.current?.focus(), []);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && expanded) {
      event.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (event.key === "ArrowUp" && expanded) {
      event.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = options[active] ?? options[0];
      if (picked) onPick(picked);
    } else if (event.key === "Escape" || event.key === "{") {
      // "{" means the cook is typing the shorthand by hand: hand it back to the textarea.
      event.preventDefault();
      onClose(event.key === "{" ? `${query}{` : query);
    }
  }

  return (
    <div>
      <label>
        Ingredient{" "}
        <input
          ref={input}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={
            active >= 0 && options[active] ? `${listId}-${active}` : undefined
          }
          maxLength={200}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {expanded && (
        <ul role="listbox" id={listId} aria-label="Ingredient matches">
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // Keep focus on the input while picking with the mouse.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(option)}
            >
              {option.name}
              {option.matchedBy === "alias" && " (alias)"}
            </li>
          ))}
        </ul>
      )}
      {results.isError && <p role="alert">{results.error.message}</p>}
    </div>
  );
}
