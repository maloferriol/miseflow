import type { Locator, Page } from "@playwright/test";

// Gantt chart helpers shared by the specs that drag bars or compare the Plan's starts.

/**
 * Drags `bar` so it starts at `target` (a Minute): the date band holding `target` gives its x, and
 * the bar is grabbed 2 px in from its left edge, where its start is.
 */
export async function dragTo(page: Page, gantt: Locator, bar: Locator, target: number) {
  await bar.scrollIntoViewIfNeeded();
  const bands = await gantt.locator("[data-band]").evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return {
        from: Number(el.getAttribute("data-from")),
        to: Number(el.getAttribute("data-to")),
        x: box.x,
        width: box.width,
      };
    }),
  );
  const band = bands.find((b) => b.from <= target && target <= b.to);
  if (!band) throw new Error(`No date band holds ${target}`);
  const x = band.x + ((target - band.from) / (band.to - band.from)) * band.width;
  const box = (await bar.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y, { steps: 12 });
  await page.mouse.up();
}

/** Every bar's start by Task key (copies of one Task must agree). */
export async function starts(gantt: Locator) {
  const bars = await gantt
    .locator("[data-key]")
    .evaluateAll((els) =>
      els.map((el) => [el.getAttribute("data-key")!, el.getAttribute("data-start")!]),
    );
  const out: Record<string, string> = {};
  for (const [key, start] of bars) {
    if (key in out && out[key] !== start)
      throw new Error(`Copies of ${key} disagree: ${out[key]} and ${start}`);
    out[key] = start!;
  }
  return out;
}
