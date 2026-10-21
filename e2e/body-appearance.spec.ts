import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { openDocumentCopy, saveDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

interface SavedDocument {
  bodyLabels: { bodyId: string; label: string }[];
  bodyAppearances?: { bodyId: string; appearance: unknown }[];
}

async function savedAppearanceOf(page: Page, label: string) {
  const saved = await saveDocumentCopy<SavedDocument>(page);
  const bodyId = saved.bodyLabels.find((entry) => entry.label === label)?.bodyId;
  return saved.bodyAppearances?.find((entry) => entry.bodyId === bodyId)
    ?.appearance;
}

// cadara-01k: the parts-tree body menu's swatches and custom colour picker
// drive the persisted body appearance; the picker previews live, Escape
// discards the preview and Undo restores the previous colour.
test("a body's colour is chosen from its parts-tree menu, persisted, cancellable and undoable", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  const document: unknown = JSON.parse(
    await readFile("landing/examples/wheel/model.cadara", "utf8"),
  );
  await openDocumentCopy(page, document, "wheel.cadara");
  await workbench.waitForRenderIdle(30_000);

  const row = page
    .getByRole("complementary", { name: "Parts and objects" })
    .getByRole("treeitem")
    .filter({ hasText: /^Hub$/ });
  const openMenu = async () => {
    await row.click({ button: "right" });
    await expect(page.getByRole("group", { name: "Body color" })).toBeVisible();
  };

  await openMenu();
  await page.getByRole("menuitemradio", { name: "Coral" }).click();
  await expect(page.getByRole("group", { name: "Body color" })).toBeHidden();
  await openMenu();
  // A colour change is one persisted action; on this 31-feature document the
  // repository write takes seconds, and a save does not wait for it.
  await expect(
    page.getByRole("menuitemradio", { name: "Coral" }),
  ).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect
    .poll(() => savedAppearanceOf(page, "Hub"), { timeout: 30_000 })
    .toEqual({ kind: "palette", slot: 4 });

  await openMenu();
  await page.getByRole("menuitem", { name: "Custom color…" }).click();
  const picker = page.getByTestId("body-color-picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("textbox", { name: "Hex color" }).fill("2F6F8F");
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();
  await expect
    .poll(() => savedAppearanceOf(page, "Hub"), { timeout: 30_000 })
    .toEqual({ kind: "custom", hex: "#2f6f8f" });

  await openMenu();
  await page.getByRole("menuitem", { name: "Custom color…" }).click();
  await picker.getByRole("textbox", { name: "Hex color" }).fill("FF0000");
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  expect(await savedAppearanceOf(page, "Hub")).toEqual({
    kind: "custom",
    hex: "#2f6f8f",
  });

  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect
    .poll(() => savedAppearanceOf(page, "Hub"), { timeout: 30_000 })
    .toEqual({ kind: "palette", slot: 4 });
});
