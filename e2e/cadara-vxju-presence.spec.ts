import { expect, test, type Page } from "@playwright/test";
import { openWorkbench } from "./helpers/project-sync";

/** The shared top inset panels, the view cube and annotations sit below. */
function overlayTop(page: Page) {
  return page
    .locator("main")
    .evaluate((element) =>
      parseFloat(
        getComputedStyle(element).getPropertyValue(
          "--workbench-viewport-overlay-top",
        ),
      ),
    );
}

test("the presence rail shows one avatar per account, overlaps four, opens overflow and clears the view cube", async ({
  page,
}) => {
  await openWorkbench(page, "/app?cadTestMode=1");
  const baselineInset = await overlayTop(page);
  await page.evaluate(async () => {
    const path = "/e2e/fixtures/project-presence-row.tsx";
    (await import(path)).mountPresenceFixture("synced");
  });
  const people = page.getByRole("list", {
    name: "People in this project",
    exact: true,
  });
  await expect(people.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("status", { name: /Sync status:/ })).toHaveCount(
    0,
  );
  const first = people.getByRole("listitem").first();
  await first.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Person 0 · viewer");
  await expect(first).toHaveAttribute("data-project-presence-color", /.+/);
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toBeHidden();
  // Keyboard users reach the same tooltip by focusing the avatar.
  await people.getByRole("listitem").nth(1).focus();
  await expect(page.getByRole("tooltip")).toHaveText("Person 1 · editor");
  const more = page.getByRole("button", {
    name: "2 more people in this project",
  });
  await more.focus();
  await page.keyboard.press("Enter");
  const overflow = page.getByRole("list", {
    name: "More people in this project",
  });
  await expect(overflow).toContainText("Person 4 · editor");
  await expect(overflow).toContainText("Person 5 · editor");
  await expect(overflow.getByRole("listitem")).toHaveCount(2);
  // The focus trap moves focus into the dropdown on a timer; Escape closes
  // the popover only from there.
  await expect(
    page
      .getByRole("dialog")
      .filter({ has: overflow })
      .locator(":scope:focus-within"),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(overflow).toBeHidden();
  await expect(more).toBeFocused();
  const bounds = await page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      };
    };
    return {
      row: box("[data-project-presence-row]"),
      utilities: box('[data-toolbar-section="utilities"]'),
      cube: box('[data-testid="view-cube"]'),
      avatars: [
        ...document.querySelectorAll("[data-project-presence-name]"),
      ].map((avatar) => avatar.getBoundingClientRect().left),
    };
  });
  expect(bounds.row.top).toBeGreaterThan(bounds.utilities.bottom);
  expect(bounds.row.bottom).toBeLessThan(bounds.cube.top);
  expect(bounds.row.right).toBeLessThanOrEqual(bounds.utilities.right + 1);
  expect(bounds.avatars[1]! - bounds.avatars[0]!).toBeLessThan(28);
  // The shared panel/annotation reservation grows with the visible rail.
  await expect.poll(() => overlayTop(page)).toBeGreaterThan(baselineInset);
});

test("offline moves the sync warning into the rail without reserving space in Local", async ({
  page,
}) => {
  await openWorkbench(page, "/app?cadTestMode=1");
  // Local has no rail, so the inset is still the toolbar-only reservation.
  const baselineInset = await overlayTop(page);
  await page.evaluate(async () => {
    const path = "/e2e/fixtures/project-presence-row.tsx";
    (await import(path)).mountPresenceFixture("offline", 0);
  });
  await expect(
    page.getByRole("status", { name: "Sync status: Offline" }),
  ).toBeVisible();
  await expect(page.locator("[data-project-presence-row]")).toContainText(
    "Offline",
  );
  await expect.poll(() => overlayTop(page)).toBeGreaterThan(baselineInset);
});
