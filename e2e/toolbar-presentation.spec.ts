import { expect, test, type Page } from "@playwright/test";

test("toolbar uses local SVG icons and rich tooltips across buttons, dropdowns, and search rows", async ({
  page,
}) => {
  await page.goto("/app");

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

test("toolbar progressively collapses tool families, then islands, then merges islands as the window narrows", async ({
  page,
}) => {
  const toolbar = page.getByRole("toolbar", { name: "CAD tools" });
  await page.setViewportSize({ width: 2600, height: 900 });
  await page.goto("/app");

  await expect(toolbar).toHaveAttribute("data-toolbar-compaction", "expanded");
  await expect(
    page.locator(
      'button[data-tool-source="toolbar"][data-tool-id="circularPattern"]',
    ),
    "Wide toolbars show family variants inline instead of a dropdown.",
  ).toBeVisible();
  await expect(page.locator("[data-toolbar-collapsed]")).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(toolbar).toHaveAttribute("data-toolbar-compaction", "islands");
  await expect(
    page.locator('button[data-tool-dropdown-trigger="pattern"]'),
  ).toBeVisible();
  await expect(
    page.locator('button[data-tool-id="extrude"]'),
    "An island keeps its leading tools and tucks only the trailing ones.",
  ).toBeVisible();
  await expect(page.locator('button[data-tool-id="revolve"]')).toHaveCount(0);
  const build = page.locator(
    'button[data-toolbar-group-trigger="featuresBuild"]',
  );
  await expect(
    build.locator('img[src="/icons/revolve.svg"]'),
    "The tucked dropdown shows the first tool it hides.",
  ).toBeVisible();
  await build.click();
  await expect(page.getByRole("menuitem")).toHaveCount(3);
  await page.keyboard.press("Escape");
  // Hovered toolbar buttons lift by a pixel; measure rows without hover.
  await page.mouse.move(600, 600);
  await expect(
    page.locator('button[data-toolbar-group-trigger="inspect"]'),
    "The last island collapses first.",
  ).toBeVisible();
  await expectToolbarToUseOneToolRow(page);
  await expectToolbarToolsToAvoidSearch(page);
  await expectToolbarPillShadowsToHaveBreathingRoom(page);

  await page.setViewportSize({ width: 800, height: 900 });
  await expect(toolbar).toHaveAttribute("data-toolbar-compaction", "merged");
  await expect(
    page.locator('button[data-tool-id="undo"]'),
    "Pinned islands never collapse.",
  ).toBeVisible();
  await expectToolbarToUseOneToolRow(page);
  await expectToolbarToolsToAvoidSearch(page);

  await page.setViewportSize({ width: 1000, height: 900 });
  await page.locator('button[data-tool-id="sketch"]').click();
  await page.getByText("Top Plane", { exact: true }).click();
  await expect(
    page.locator('button[data-tool-id="finishSketch"]'),
  ).toBeVisible();
  await expectToolbarToUseOneToolRow(page);
  await expectToolbarToolsToAvoidSearch(page);
  await expectToolbarPillShadowsToHaveBreathingRoom(page);
});

test("a tool picked from a collapsed island becomes its face and stays first after a reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app");

  const transforms = page.locator(
    'button[data-toolbar-group-trigger="transforms"]',
  );
  await expect(
    transforms.locator('img[src="/icons/move-face.svg"]'),
  ).toBeVisible();
  await transforms.click();
  await page.locator('[role="menuitem"][data-tool-id="mirror"]').click();
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(transforms).toHaveAttribute("aria-pressed", "true");
  await expect(
    transforms.locator('img[src="/icons/mirror.svg"]'),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(transforms).toHaveAttribute("aria-pressed", "false");

  await page.reload();
  await expect(
    transforms.locator('img[src="/icons/mirror.svg"]'),
  ).toBeVisible();
  await transforms.click();
  await expect(
    page.getByRole("menuitem").first(),
    "The last used tool is listed first.",
  ).toHaveAttribute("data-tool-id", "mirror");
});

async function expectToolbarToUseOneToolRow(page: Page) {
  const rowTops = await page.evaluate(() => {
    const toolbar = document.querySelector(
      '[role="toolbar"][aria-label="CAD tools"]',
    );
    if (!toolbar) {
      throw new Error("CAD tools toolbar was not found.");
    }

    const buttons = Array.from(
      toolbar.querySelectorAll<HTMLButtonElement>(
        'button[data-tool-source="toolbar"], button[data-tool-dropdown-trigger], button[data-toolbar-group-trigger]',
      ),
    );
    return [
      ...new Set(
        buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
      ),
    ];
  });

  expect(rowTops).toHaveLength(1);
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
        'button[data-tool-source="toolbar"], button[data-tool-dropdown-trigger], button[data-toolbar-group-trigger]',
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
          button.getAttribute("data-tool-dropdown-trigger") ??
          button.getAttribute("data-toolbar-group-trigger"),
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
