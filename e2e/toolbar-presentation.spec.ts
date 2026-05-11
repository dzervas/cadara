import { expect, test, type Page } from "@playwright/test";

test("toolbar uses local SVG icons and rich tooltips across buttons, dropdowns, and search rows", async ({
  page,
}) => {
  await page.goto("/");

  const extrudeButton = page.locator('button[data-tool-id="extrude"]').first();
  await expect(
    extrudeButton.locator('img[src="/icons/extrude.svg"]'),
  ).toBeVisible();

  await extrudeButton.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip.getByText("Extrude", { exact: true })).toBeVisible();
  await expect(
    tooltip.getByText("Create an extruded solid or surface."),
  ).toBeVisible();

  const patternButton = page.locator('button[data-tool-id="pattern"]');
  await expect(
    patternButton.locator('img[src="/icons/linear-pattern.svg"]'),
  ).toBeVisible();

  await patternButton.hover();
  await expect(tooltip.getByText("Pattern", { exact: true })).toBeVisible();
  await expect(tooltip.getByText("Choose a pattern tool.")).toBeVisible();

  await patternButton.click();
  const circularPatternItem = page
    .getByRole("menuitem")
    .filter({ hasText: "Circular Pattern" });
  await expect(
    circularPatternItem.locator('img[src="/icons/circular-pattern.svg"]'),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByPlaceholder("Search tools").fill("mirror");
  const mirrorSearchRow = page.locator(
    'button[data-tool-source="search"][data-tool-id="mirror"]',
  );
  await expect(
    mirrorSearchRow.locator('img[src="/icons/mirror.svg"]'),
  ).toBeVisible();
});

test("toolbar spills whole tool groups into a second row at narrow desktop widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/");

  const toolbar = page.getByRole("toolbar", { name: "CAD tools" });
  await expect(toolbar).toHaveAttribute("data-toolbar-responsive-rows", "2");
  await expectToolbarToUseAtMostTwoToolRows(page);
  await expectToolbarToolsToAvoidSearch(page);
  await expectToolbarPillShadowsToHaveBreathingRoom(page);

  await page.locator('button[data-tool-id="sketch"]').click();
  await page.getByText("Top Plane", { exact: true }).click();

  await expect(toolbar).toHaveAttribute("data-toolbar-responsive-rows", "2");
  await expectToolbarToUseAtMostTwoToolRows(page);
  await expectToolbarToolsToAvoidSearch(page);
  await expectToolbarPillShadowsToHaveBreathingRoom(page);
});

async function expectToolbarToUseAtMostTwoToolRows(page: Page) {
  const rowTops = await page.evaluate(() => {
    const toolbar = document.querySelector(
      '[role="toolbar"][aria-label="CAD tools"]',
    );
    if (!toolbar) {
      throw new Error("CAD tools toolbar was not found.");
    }

    const buttons = Array.from(
      toolbar.querySelectorAll<HTMLButtonElement>(
        'button[data-tool-source="toolbar"], button[data-tool-dropdown-trigger]',
      ),
    );
    return [
      ...new Set(
        buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
      ),
    ].sort((a, b) => a - b);
  });

  expect(rowTops.length).toBeGreaterThanOrEqual(2);
  expect(rowTops.length).toBeLessThanOrEqual(2);
}

async function expectToolbarToolsToAvoidSearch(page: Page) {
  const overlappingToolIds = await page.evaluate(() => {
    const toolbar = document.querySelector(
      '[role="toolbar"][aria-label="CAD tools"]',
    );
    if (!toolbar) {
      throw new Error("CAD tools toolbar was not found.");
    }

    const search = document.querySelector<HTMLInputElement>(
      '[placeholder="Search tools"]',
    );
    if (!search) {
      throw new Error("Toolbar search input was not found.");
    }

    const buttons = Array.from(
      toolbar.querySelectorAll<HTMLButtonElement>(
        'button[data-tool-source="toolbar"], button[data-tool-dropdown-trigger]',
      ),
    );
    const searchRect = search.getBoundingClientRect();
    return buttons
      .filter((button) => {
        const buttonRect = button.getBoundingClientRect();
        return (
          buttonRect.left < searchRect.right &&
          buttonRect.right > searchRect.left &&
          buttonRect.top < searchRect.bottom &&
          buttonRect.bottom > searchRect.top
        );
      })
      .map(
        (button) =>
          button.getAttribute("data-tool-id") ??
          button.getAttribute("data-tool-dropdown-trigger"),
      );
  });

  expect(overlappingToolIds).toEqual([]);
}

async function expectToolbarPillShadowsToHaveBreathingRoom(page: Page) {
  const shadowLayout = await page.evaluate(() => {
    const primaryRail = document.querySelector<HTMLElement>(
      "[data-toolbar-primary-rail]",
    );
    if (!primaryRail) {
      throw new Error("Toolbar primary rail was not found.");
    }

    const historySection = primaryRail.querySelector<HTMLElement>(
      '[data-toolbar-section="history"]',
    );
    if (!historySection) {
      throw new Error("Toolbar history section was not found.");
    }

    const search = document.querySelector<HTMLInputElement>(
      '[placeholder="Search tools"]',
    );
    if (!search) {
      throw new Error("Toolbar search input was not found.");
    }

    const primarySections = Array.from(
      primaryRail.querySelectorAll<HTMLElement>("[data-toolbar-section]"),
    );
    const primaryRailRect = primaryRail.getBoundingClientRect();
    const historyRect = historySection.getBoundingClientRect();
    const searchRect = search.getBoundingClientRect();
    const rightMostPrimarySection = Math.max(
      ...primarySections.map(
        (section) => section.getBoundingClientRect().right,
      ),
    );

    return {
      historyLeftShadowGutter: Math.round(
        historyRect.left - primaryRailRect.left,
      ),
      searchShadowGap: Math.round(searchRect.left - rightMostPrimarySection),
    };
  });

  expect(shadowLayout.historyLeftShadowGutter).toBeGreaterThanOrEqual(31);
  expect(shadowLayout.searchShadowGap).toBeGreaterThanOrEqual(56);
}
