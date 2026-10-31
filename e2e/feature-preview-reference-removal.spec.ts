import { expect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

// Removing a selected reference from a part tool's reference list (the
// chip's Remove button) must update the preview the viewport draws: to the
// preview of the remaining references, and to no preview once none is left.
// A preview-only target is a face, edge or vertex of the previewed body that
// the document does not contain, so it is drawn only while that preview is.

test("removing fillet edges from the reference list updates the drawn preview, and clears it when none is left", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithBaseExtrudeFixture();
  await workbench.activateFeature("fillet");
  const [firstEdge, secondEdge] = await page.evaluate(
    () =>
      window.__cadaraDebug
        ?.getState()
        ?.selectableTargets.filter((target) =>
          /^body_feature_extrude-1\.edge_/.test(target),
        ) ?? [],
  );
  if (!firstEdge || !secondEdge) {
    throw new Error("The base extrude fixture should expose two body edges.");
  }

  await workbench.selectReference(firstEdge);
  await workbench.expectFeaturePreviewReady("fillet");
  const firstEdgePreview = await previewTargets(page);
  expect(firstEdgePreview.length, "one edge is previewed").toBeGreaterThan(0);

  await workbench.selectReference(secondEdge);
  await expect
    .poll(() => previewTargets(page), { timeout: 30_000 })
    .not.toEqual(firstEdgePreview);
  await workbench.expectFeaturePreviewReady("fillet");
  const bothEdgesPreview = await previewTargets(page);
  const secondEdgeOnly = await previewOnlyTargets(
    page,
    bothEdgesPreview.filter((target) => !firstEdgePreview.includes(target)),
  );
  expect(
    secondEdgeOnly.length,
    "the second edge's fillet adds preview-only targets",
  ).toBeGreaterThan(0);
  await expect.poll(() => drawnTargets(page, secondEdgeOnly)).toEqual(
    secondEdgeOnly,
  );

  await removeReferenceButton(page, secondEdge).click();
  await expect
    .poll(() => drawnTargets(page, secondEdgeOnly), {
      message: "the removed edge's fillet is no longer drawn",
      timeout: 30_000,
    })
    .toEqual([]);
  await workbench.expectFeaturePreviewReady("fillet");
  await expect
    .poll(() => selectionTargets(page), {
      message: "the removed edge is no longer highlighted as selected",
    })
    .not.toContain(secondEdge);

  const firstEdgeOnly = await previewOnlyTargets(
    page,
    await previewTargets(page),
  );
  expect(
    firstEdgeOnly.length,
    "the remaining edge's fillet has preview-only targets",
  ).toBeGreaterThan(0);
  await expect.poll(() => drawnTargets(page, firstEdgeOnly)).toEqual(
    firstEdgeOnly,
  );

  await removeReferenceButton(page, firstEdge).click();
  await expect
    .poll(() => previewTargets(page), {
      message: "no preview is left once no edge is",
    })
    .toEqual([]);
  await expect
    .poll(() => drawnTargets(page, firstEdgeOnly), {
      message: "the last removed edge's fillet is no longer drawn",
    })
    .toEqual([]);
});

function removeReferenceButton(page: Page, target: string) {
  const key = target.split(".").at(-1)!;
  return page
    .locator("aside")
    .getByRole("button", { name: new RegExp(`^Remove .*${key}$`) });
}

async function previewTargets(page: Page) {
  const targets = await page.evaluate(
    () => window.__cadaraDebug?.getState()?.previewTargets ?? [],
  );
  return [...targets].sort();
}

async function selectionTargets(page: Page) {
  const joined = await page.evaluate(
    () => window.__cadaraDebug?.getState()?.selectionTargets ?? "",
  );
  return joined.split(", ");
}

/** The given targets that the document itself does not contain. */
async function previewOnlyTargets(page: Page, targets: readonly string[]) {
  const documentTargets = await page.evaluate(
    () => window.__cadaraDebug?.getState()?.selectableTargets ?? [],
  );
  return targets.filter((target) => !documentTargets.includes(target));
}

/** The given targets the viewport scene currently draws. */
async function drawnTargets(page: Page, targets: readonly string[]) {
  return page.evaluate(
    (ids) => ids.filter((id) => (window.__cadProjectToScreen?.(id) ?? null) !== null),
    targets,
  );
}
