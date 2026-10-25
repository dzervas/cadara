import { expect, test, type Page } from "@playwright/test";

import {
  countHeldDocumentWrites,
  holdDocumentWrites,
  installDocumentWriteHold,
  releaseDocumentWrites,
} from "./helpers/document-write-hold";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  createBaseExtrudeOperationHistory,
  FEATURE_FIXTURE,
} from "./helpers/modeling-fixtures";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

interface RingEnd {
  iterations: number;
  durationMs: number;
  outcome: "running" | "finished" | "cancelled";
  /** The rotation's time when it finished; null when cancelled. */
  finishedAtMs: number | null;
}

declare global {
  interface Window {
    __e2eRingPhases?: string[];
    __e2eRingEnd?: RingEnd;
  }
}

/**
 * Records the ring's phases, and how the latest rotation ended: whether its
 * `finished` promise resolved (it reached its capped end) or was rejected by
 * a cancel (stopped mid-loop), and its time at the end.
 */
async function recordRing(page: Page) {
  await page.evaluate(() => {
    const ring = document.querySelector<HTMLElement>(
      "[data-workbench-file-menu] [data-save-activity-ring]",
    )!;
    const rotor = ring.firstElementChild!;
    window.__e2eRingPhases = [];
    let rotation: Animation | null = null;
    new MutationObserver(() => {
      const phase = ring.dataset.saveActivityRing!;
      window.__e2eRingPhases!.push(phase);
      if (phase === "spinning") {
        const animation = rotor.getAnimations()[0]!;
        if (animation === rotation) return;
        rotation = animation;
        animation.finished.then(
          () => {
            window.__e2eRingEnd = {
              ...window.__e2eRingEnd!,
              outcome: "finished",
              finishedAtMs: Number(animation.currentTime),
            };
          },
          () => {
            window.__e2eRingEnd = {
              ...window.__e2eRingEnd!,
              outcome: "cancelled",
            };
          },
        );
      }
      if (phase === "finishing") {
        const timing = rotation!.effect!.getComputedTiming();
        window.__e2eRingEnd = {
          iterations: Number(timing.iterations),
          durationMs: Number(timing.duration),
          outcome: "running",
          finishedAtMs: null,
        };
      }
    }).observe(ring, {
      attributes: true,
      attributeFilter: ["data-save-activity-ring"],
    });
  });
}

// cadara-781c: while an edit is being saved, a ring turns around the spark
// logo; when the save ends, the ring finishes its current revolution and
// stops exactly on the loop boundary (never cut off mid-loop).
test("an edit turns the save ring around the logo until the save ends, then it stops on a loop boundary", async ({
  page,
}) => {
  await installDocumentWriteHold(page);
  await new FeatureWorkbenchHarness(page).openWithRepositoryAndOperationHistory(
    createBaseExtrudeOperationHistory(),
  );
  const logo = page.getByRole("button", { name: "File", exact: true });
  const ring = logo.locator("[data-save-activity-ring]");
  await expect(
    ring,
    "premise: no save is underway after loading",
  ).toHaveAttribute("data-save-activity-ring", "idle", { timeout: 15_000 });
  await expect(ring).toBeHidden();
  await recordRing(page);

  const row = page.locator(
    `[data-parts-tree-target="body:${FEATURE_FIXTURE.body}"]`,
  );
  const labelButton = row.locator("button").first();
  const original = await labelButton.innerText();
  await holdDocumentWrites(page);
  await labelButton.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = row.getByRole("textbox", { name: `Rename ${original}` });
  await expect(input).toBeFocused();
  await page.keyboard.type("Mount plate");
  await input.press("Enter");
  await expect
    .poll(() => countHeldDocumentWrites(page), {
      message: "premise: the rename's repository write is held",
    })
    .toBeGreaterThan(0);

  await expect(ring).toHaveAttribute("data-save-activity-ring", "spinning");
  await expect(ring).toBeVisible();
  await expect(ring).toHaveAttribute("aria-hidden", "true");
  // The 2 px ring sits 4 px clear of the 36 px logo and clear of the first
  // toolbar pill.
  const logoBox = (await logo.boundingBox())!;
  const ringBox = (await ring.boundingBox())!;
  expect(ringBox.x).toBeCloseTo(logoBox.x - 6, 0);
  expect(ringBox.y).toBeCloseTo(logoBox.y - 6, 0);
  expect(ringBox.width).toBeCloseTo(logoBox.width + 12, 0);
  const firstPillBox = (await page
    .locator("[data-toolbar-section]")
    .first()
    .boundingBox())!;
  expect(ringBox.x + ringBox.width).toBeLessThan(firstPillBox.x);

  // Held for longer than a revolution: the ring keeps turning.
  await page.waitForTimeout(1500);
  await expect(ring).toHaveAttribute("data-save-activity-ring", "spinning");

  await releaseDocumentWrites(page);
  await expect(ring).toHaveAttribute("data-save-activity-ring", "idle", {
    timeout: 15_000,
  });
  await expect(ring).toBeHidden();

  const phases = await page.evaluate(() => window.__e2eRingPhases!);
  expect(
    phases.slice(-2),
    "the ring finished its loop before it stopped",
  ).toEqual(["finishing", "idle"]);
  const end = await page.evaluate(() => window.__e2eRingEnd!);
  expect(end.outcome, "the rotation ran to its capped end").toBe("finished");
  expect(Number.isInteger(end.iterations)).toBe(true);
  expect(
    end.iterations,
    "a save held past a revolution ends after more than one loop",
  ).toBeGreaterThan(1);
  expect(end.finishedAtMs, "it stopped exactly on a loop boundary").toBe(
    end.iterations * end.durationMs,
  );
});
