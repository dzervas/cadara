import { expect, test, type Page } from "@playwright/test";

import {
  currentRevision,
  glideDoubleClick,
  openTwoSessions,
  readHistoryStrip,
  waitForCommittedAction,
  waitForRedoneAction,
  waitForUndoneAction,
} from "./helpers/acceptance";
import { saveDocumentCopy } from "./helpers/document-files";
import { glideClick, glidePress } from "./helpers/mirror-workbench";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 960 } });

/**
 * §6 E2E-6 (T17k2; plan E2E-6 with review R-4, amendments R-4/P-8, T17-20).
 * Two author sessions on one shared document through the production peer
 * refresh (`openTwoSessions`; the only `refreshDocument` is the initial
 * negative check, documented there). Gliding pointer and keyboard only.
 * "Byte-equal" is the saved document (File → Save As → Download a copy)
 * before and after a blocked action, on both pages.
 */
test("§6 E2E-6 two authors: private drafts, one Publish Sketch, document Undo/Redo keeps peer edits, conflicting compensation blocks atomically, retained history after peer edits, re-entry stays private, a peer-deleted sketch (notice, Finish refused, discard and leave; document Undo blocked)", async ({
  context,
}, testInfo) => {
  test.setTimeout(420_000);
  const channel = `cad-e2e-sketch-publication-${testInfo.workerIndex}-${Date.now()}`;
  const { first: a, second: b } = await openTwoSessions(context, channel);
  const pageA = a.page;
  const pageB = b.page;
  const expectNewRevisions = async (before: string[], when: string) => {
    for (const [index, page] of [pageA, pageB].entries())
      await expect
        .poll(() => currentRevision(page), {
          message: `${index ? "B" : "A"} has a new revision ${when}`,
          timeout: 10_000,
        })
        .not.toBe(before[index]);
  };

  // 1. A draws privately; B sees nothing.
  await glidePress(pageA, a.toolbarButton("Start a new sketch."));
  await glidePress(
    pageA,
    pageA.getByRole("button", { name: /Top Plane/ }).first(),
  );
  await a.expectSketchSessionActive();
  await drawLine(a, { x: 360, y: 260 }, { x: 440, y: 320 });
  const revisionB0 = await currentRevision(pageB);
  // The one forced refresh (documented negative check): even a refresh
  // shows B nothing of A's private draft, and A wrote nothing.
  await refreshDocument(pageB);
  await expect.poll(() => currentRevision(pageB)).toBe(revisionB0);
  await expect(sketchEntry(pageB)).toHaveCount(0);

  // 2. A Finishes: one "Publish Sketch" document action on A.
  const revisionA0 = await currentRevision(pageA);
  await glidePress(pageA, a.toolbarButton("Exit the active sketch."));
  await a.expectMachine("idle", 30_000);
  await expect
    .poll(
      () =>
        readHistoryStrip(pageA).then((strip) =>
          strip.undo.map((entry) => entry.label),
        ),
      {
        message: "one Publish Sketch on A",
        timeout: 15_000,
      },
    )
    .toEqual(["Publish Sketch"]);
  // B receives it through the production peer refresh.
  await expect(sketchEntry(pageB)).toBeVisible({ timeout: 30_000 });
  const sketchId = await sketchEntry(pageA).getAttribute(
    "data-history-sketch-id",
  );
  expect(await sketchEntry(pageB).getAttribute("data-history-sketch-id")).toBe(
    sketchId,
  );
  expect(await currentRevision(pageA), "premise: A published").not.toBe(
    revisionA0,
  );

  // 3. B adds a variable (unrelated); A's document-level Undo of Publish
  //    Sketch removes only A's sketch: B's variable survives on both pages.
  await addVariable(pageB);
  await expect(variableRow(pageB)).toBeVisible();
  await openVariables(pageA);
  await expect(variableRow(pageA)).toBeVisible({ timeout: 30_000 });
  // T17k3 (K3): an Undo or Redo is a new state on both pages, so both
  // revisions change (base: compensation kept the stored revision id).
  const beforeUndo = [
    await currentRevision(pageA),
    await currentRevision(pageB),
  ];
  await waitForUndoneAction(pageA, "Publish Sketch", () =>
    glidePress(pageA, undoButton(pageA)),
  );
  await expect(sketchEntry(pageA)).toHaveCount(0, { timeout: 30_000 });
  await expect(
    variableRow(pageA),
    "B's variable survives A's Undo on A",
  ).toBeVisible();
  await expect(sketchEntry(pageB)).toHaveCount(0, { timeout: 30_000 });
  await expect(variableRow(pageB), "and on B").toBeVisible();
  await expectNewRevisions(beforeUndo, "after A's Undo");
  const beforeRedo = [
    await currentRevision(pageA),
    await currentRevision(pageB),
  ];
  await waitForRedoneAction(pageA, "Publish Sketch", () =>
    glidePress(pageA, redoButton(pageA)),
  );
  await expect(sketchEntry(pageA)).toBeVisible({ timeout: 30_000 });
  expect(await sketchEntry(pageA).getAttribute("data-history-sketch-id")).toBe(
    sketchId,
  );
  await expect(sketchEntry(pageB)).toBeVisible({ timeout: 30_000 });
  await expect(variableRow(pageB)).toBeVisible();
  await expect(variableRow(pageA)).toBeVisible();
  await expectNewRevisions(beforeRedo, "after A's Redo");

  // 4. Conflicting compensation. A changes the variable; A's Undo succeeds;
  //    B changes the same field; A's Redo is blocked by label, nothing
  //    changes on either page and the entry is kept.
  await waitForCommittedAction(pageA, "Edit Variable", () =>
    setVariableValue(pageA, "5"),
  );
  await expect(variableExpression(pageB)).toHaveText("5", { timeout: 30_000 });
  await waitForUndoneAction(pageA, "Edit Variable", () =>
    glidePress(pageA, undoButton(pageA)),
  );
  await expect(variableExpression(pageA)).toHaveText("0", { timeout: 30_000 });
  await expect(variableExpression(pageB)).toHaveText("0", { timeout: 30_000 });
  await setVariableValue(pageB, "7");
  await expect(variableExpression(pageA)).toHaveText("7", { timeout: 30_000 });
  await expectBlocked(
    a,
    b,
    "redo",
    "Edit Variable",
    "Can't redo Edit Variable: ‘var1’ was changed by another session.",
  );
  // The Undo-blocked variant: A changes it again, B changes the same field,
  // A's Undo is blocked.
  await waitForCommittedAction(pageA, "Edit Variable", () =>
    setVariableValue(pageA, "9"),
  );
  await expect(variableExpression(pageB)).toHaveText("9", { timeout: 30_000 });
  await setVariableValue(pageB, "11");
  await expect(variableExpression(pageA)).toHaveText("11", { timeout: 30_000 });
  await expectBlocked(
    a,
    b,
    "undo",
    "Edit Variable",
    "Can't undo Edit Variable: ‘var1’ was changed by another session.",
  );

  // 5. Retained history after peer edits: B edits A's sketch (re-enter,
  //    delete Line 1, Finish); A re-enters: its retained private entry is
  //    blocked and kept. A's new edit stays private until A finishes.
  await glideDoubleClick(pageB, sketchEntry(pageB));
  await b.expectSketchSessionActive();
  await glidePress(
    pageB,
    pageB.getByRole("button", { name: "Select Line 1." }),
  );
  await waitForCommittedAction(pageB, "Delete Sketch Item", () =>
    pageB.keyboard.press("Delete"),
  );
  await glidePress(pageB, b.toolbarButton("Exit the active sketch."));
  await b.expectMachine("idle", 30_000);
  // A receives B's edit (debug read: the part-mode sketch targets).
  await expect
    .poll(() => sketchLines(pageA, sketchId!), { timeout: 30_000 })
    .toBe(0);
  await glideDoubleClick(pageA, sketchEntry(pageA));
  await a.expectSketchSessionActive();
  const retained = pageA
    .locator(
      '[data-history-action-direction="undo"][data-history-action-sequence]',
    )
    .first();
  await expect(retained).toHaveText("Create Sketch Geometry");
  const retainedSequence = await retained.getAttribute(
    "data-history-action-sequence",
  );
  await glidePress(pageA, retained);
  // T17k2 review (A-2): the reason by label, as the document strip says it.
  const retainedReason =
    "Can't undo Create Sketch Geometry: ‘Line 1 start’, ‘Line 1 end’ and ‘Line 1’ were deleted by another session.";
  await expect(
    pageA.getByRole("status").filter({ hasText: retainedReason }),
  ).toHaveText(retainedReason, { timeout: 10_000 });
  await expect(retained).toHaveAttribute(
    "aria-label",
    `Create Sketch Geometry — blocked: ${retainedReason}`,
  );
  await expect(retained, "the retained entry is kept").toHaveAttribute(
    "data-history-action-sequence",
    retainedSequence!,
  );
  // A's re-entry edit: committed privately on A, nothing written, so B
  // has nothing to receive; Finish publishes it to B.
  const revisionB = await currentRevision(pageB);
  const insideA = await currentRevision(pageA);
  await waitForCommittedAction(pageA, "Create Sketch Geometry", () =>
    drawLine(a, { x: 520, y: 300 }, { x: 600, y: 360 }),
  );
  expect(
    await currentRevision(pageA),
    "a private edit writes nothing to the document",
  ).toBe(insideA);
  expect(await currentRevision(pageB), "so B has nothing new").toBe(revisionB);
  // T17k2 review (A-1): revision ids can collide across writers, so B's
  // content is checked too: still no line in the shared sketch.
  expect(
    await sketchLines(pageB, sketchId!),
    "B still has no line in the sketch",
  ).toBe(0);
  await glidePress(pageA, a.toolbarButton("Exit the active sketch."));
  await a.expectMachine("idle", 30_000);
  await expect
    .poll(() => readHistoryStrip(pageA).then((strip) => strip.undo[0]?.label), {
      timeout: 15_000,
    })
    .toBe("Publish Sketch");
  await expect
    .poll(() => sketchLines(pageB, sketchId!), { timeout: 30_000 })
    .toBe(1);

  // 6. A is inside the shared sketch when B deletes it (T17-20): A is told
  //    by label, Finish is refused with that text, Discard and leave exits
  //    after a confirmation; then A's document Undo of its Publish Sketch is
  //    blocked ("… was deleted by another session") on both pages.
  await glideDoubleClick(pageA, sketchEntry(pageA));
  await a.expectSketchSessionActive();
  await waitForCommittedAction(pageA, "Create Sketch Geometry", () =>
    drawLine(a, { x: 520, y: 420 }, { x: 600, y: 480 }),
  );
  await waitForCommittedAction(pageB, "Delete Sketch", () =>
    deleteSketchFromTimeline(pageB),
  );
  await expect(sketchEntry(pageB)).toHaveCount(0, { timeout: 30_000 });
  const notice =
    "‘Sketch Draft’ was deleted by another session; your changes can't be published.";
  const noticePanel = pageA.getByTestId("sketch-deleted-notice");
  await expect(noticePanel.getByRole("alert")).toHaveText(notice, {
    timeout: 30_000,
  });
  await a.expectMachine("editingSketch");
  const strip = await readHistoryStrip(pageA);
  const traced = await traceSequence(pageA);
  await glidePress(pageA, a.toolbarButton("Exit the active sketch."));
  // Refused in the editor: the Finish publishes nothing (debug read: the
  // runtime trace of that press), A stays, the draft history is unchanged.
  await expect
    .poll(() => finishEffectsAfter(pageA, traced), { timeout: 15_000 })
    .toEqual([]);
  await expect(noticePanel.getByRole("alert")).toHaveText(notice);
  await a.expectMachine("editingSketch");
  expect(await readHistoryStrip(pageA)).toEqual(strip);
  await expectNoInternalIds(pageA);
  await glidePress(
    pageA,
    noticePanel.getByRole("button", { name: "Discard changes and leave…" }),
  );
  await a.expectMachine("editingSketch");
  await glidePress(
    pageA,
    noticePanel.getByRole("button", {
      name: "Discard changes and leave",
      exact: true,
    }),
  );
  await a.expectMachine("idle", 30_000);
  await expect(noticePanel).toHaveCount(0);
  await expect(sketchEntry(pageA)).toHaveCount(0);
  await expect
    .poll(() => readHistoryStrip(pageA).then((strip) => strip.undo[0]?.label), {
      timeout: 15_000,
    })
    .toBe("Publish Sketch");
  await expectBlocked(
    a,
    b,
    "undo",
    "Publish Sketch",
    "Can't undo Publish Sketch: ‘Sketch Draft’ was deleted by another session.",
  );
  await expect(sketchEntry(pageA)).toHaveCount(0);
  await expect(sketchEntry(pageB)).toHaveCount(0);
  await expectNoInternalIds(pageA);

  await pageB.close();
  await pageA.close();
});

const sketchEntry = (page: Page) =>
  page.getByRole("button", {
    name: "Select Sketch Draft. Double-click to reopen.",
  });
const cadToolbar = (page: Page) =>
  page.getByRole("toolbar", { name: "CAD tools" });
const undoButton = (page: Page) =>
  cadToolbar(page).getByRole("button", { name: "Undo", exact: true });
const redoButton = (page: Page) =>
  cadToolbar(page).getByRole("button", { name: "Redo", exact: true });
const variableRow = (page: Page) =>
  page.locator('[data-variable-row="variable_1"]');
const variableExpression = (page: Page) =>
  page.locator('[data-variable-expression="variable_1"]');

/** Debug read: the part-mode lines of `sketchId` (its selectable targets). */
const sketchLines = (page: Page, sketchId: string) =>
  page.evaluate(
    (id) =>
      (window.__cadaraDebug?.getState()?.selectableTargets ?? []).filter(
        (target) => target.startsWith(`${id}.sketch_entity_`),
      ).length,
    sketchId,
  );

/** Debug read: the newest runtime trace sequence. */
const traceSequence = (page: Page) =>
  page.evaluate(
    () => window.__cadaraDebug?.getTrace().entries.at(-1)?.sequence ?? 0,
  );

/**
 * Debug read: the effects of the first tool activation (the Finish press)
 * traced after `after`, or null before it is traced.
 */
const finishEffectsAfter = (page: Page, after: number) =>
  page.evaluate((since) => {
    const finish = (window.__cadaraDebug?.getTrace().entries ?? []).find(
      (entry) =>
        entry.sequence > since &&
        entry.kind === "event-dispatched" &&
        entry.event.type === "tool.activated",
    );
    return finish && finish.kind === "event-dispatched"
      ? finish.emittedEffects.map((effect) => effect.type)
      : null;
  }, after);

/** A Shift-placed line (no inferred constraint), then back to Select. */
async function drawLine(
  workbench: SketchWorkbenchHarness,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const page = workbench.page;
  await glidePress(page, workbench.toolbarButton("Create line geometry."));
  await page.keyboard.down("Shift");
  await glideClick(workbench, from);
  await glideClick(workbench, to);
  await page.keyboard.up("Shift");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

async function openVariables(page: Page) {
  const panel = page.locator("[data-workbench-variables-panel]");
  if (!(await panel.isVisible()))
    await glidePress(page, page.locator("[data-workbench-variables-fab]"));
  await expect(panel).toBeVisible();
  // The panel slides in: wait until its controls are stable before a press.
  await panel
    .getByRole("button", { name: "Add variable" })
    .click({ trial: true });
}

/** Variables → Add variable ("var1" = 0), one "Add Variable". */
async function addVariable(page: Page) {
  await openVariables(page);
  await waitForCommittedAction(page, "Add Variable", () =>
    glidePress(page, page.getByRole("button", { name: "Add variable" })),
  );
  await page.keyboard.press("Escape");
}

/** Edits var1's value through its row (double-click, type, Enter). */
async function setVariableValue(page: Page, value: string) {
  await openVariables(page);
  await glideDoubleClick(
    page,
    page.getByRole("button", { name: "Edit variable var1" }),
  );
  const input = page.getByLabel("Variable value variable_1");
  await glidePress(page, input);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  await expect(variableExpression(page)).toHaveText(value, { timeout: 15_000 });
}

async function deleteSketchFromTimeline(page: Page) {
  const entry = sketchEntry(page);
  await expect(entry).toBeVisible({ timeout: 30_000 });
  const box = (await entry.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 10,
  });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right",
  });
  await glidePress(
    page,
    page.getByRole("menu").getByRole("menuitem", { name: /^Delete/ }),
  );
}

/**
 * Presses `direction` on A's newest entry `label` and checks the block:
 * the entry is kept and reads "‹label› — blocked: ‹reason›", and neither
 * page changes (revision, and the saved document byte for byte).
 */
async function expectBlocked(
  a: SketchWorkbenchHarness,
  b: SketchWorkbenchHarness,
  direction: "undo" | "redo",
  label: string,
  reason: string,
) {
  const [pageA, pageB] = [a.page, b.page];
  const before = await readHistoryStrip(pageA);
  const entry = before[direction][0]!;
  expect(entry.label, `premise: the newest ${direction} entry`).toBe(label);
  const revisions = [
    await currentRevision(pageA),
    await currentRevision(pageB),
  ];
  const saved = [
    JSON.stringify(await saveDocumentCopy(pageA)),
    JSON.stringify(await saveDocumentCopy(pageB)),
  ];
  await glidePress(
    pageA,
    direction === "undo" ? undoButton(pageA) : redoButton(pageA),
  );
  const button = pageA.locator(
    `[data-history-action-direction="${direction}"][data-history-action-sequence="${entry.sequence}"]`,
  );
  await expect(button).toHaveAttribute(
    "aria-label",
    `${label} — blocked: ${reason}`,
    { timeout: 15_000 },
  );
  expect(await readHistoryStrip(pageA), "the entry is kept").toEqual(before);
  expect([await currentRevision(pageA), await currentRevision(pageB)]).toEqual(
    revisions,
  );
  expect(
    [
      JSON.stringify(await saveDocumentCopy(pageA)),
      JSON.stringify(await saveDocumentCopy(pageB)),
    ],
    "nothing changed, partially or at all",
  ).toEqual(saved);
}

/** No internal id in the page's text or any accessible name. */
async function expectNoInternalIds(page: Page) {
  const texts = await page.evaluate(() => [
    document.body.innerText,
    ...Array.from(
      document.querySelectorAll("[aria-label]"),
      (element) => element.getAttribute("aria-label") ?? "",
    ),
  ]);
  for (const text of texts)
    expect(text, "no internal id").not.toMatch(
      /sketch_|derivation_|constraint_|dimension_|[0-9a-f]{8}-[0-9a-f]{4}-/,
    );
}

// T17k2 review (A-5; probe `probe-import.out.log`): Import Image inside a
// sketch used to commit the whole private draft (B received A's unfinished
// line). It is a private sketch action now: one "Import Image", nothing
// written, so B sees nothing until A finishes.
test("§6 Import Image inside a sketch is a private action: the draft and the image are published only by Finish", async ({
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  const channel = `cad-e2e-sketch-import-private-${testInfo.workerIndex}-${Date.now()}`;
  const { first: a, second: b } = await openTwoSessions(context, channel);
  const pageA = a.page;
  const pageB = b.page;
  // Headless Chromium: the file input path (as the import-noop row).
  await pageA.evaluate(() => {
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: undefined,
    });
  });
  await glidePress(pageA, a.toolbarButton("Start a new sketch."));
  await glidePress(
    pageA,
    pageA.getByRole("button", { name: /Top Plane/ }).first(),
  );
  await a.expectSketchSessionActive();
  await waitForCommittedAction(pageA, "Create Sketch Geometry", () =>
    drawLine(a, { x: 360, y: 260 }, { x: 440, y: 320 }),
  );
  const revisionA = await currentRevision(pageA);
  const chooser = pageA.waitForEvent("filechooser");
  await waitForCommittedAction(pageA, "Import Image", async () => {
    await glidePress(
      pageA,
      a.toolbarButton(
        "Import one or more reference images into the active sketch.",
      ),
    );
    await (
      await chooser
    ).setFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSuoAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });
  await a.expectMachine("editingSketch");
  expect(
    (await readHistoryStrip(pageA)).undo.map((entry) => entry.label),
    "the draft's history is kept: the line, then the import",
  ).toEqual(["Import Image", "Create Sketch Geometry"]);
  expect(
    await currentRevision(pageA),
    "the import writes nothing to the document",
  ).toBe(revisionA);
  expect(await sketchEntry(pageB).count(), "B has no sketch").toBe(0);

  await glidePress(pageA, a.toolbarButton("Exit the active sketch."));
  await a.expectMachine("idle", 30_000);
  await expect
    .poll(() => readHistoryStrip(pageA).then((strip) => strip.undo[0]?.label), {
      timeout: 15_000,
    })
    .toBe("Publish Sketch");
  await expect(sketchEntry(pageB)).toBeVisible({ timeout: 30_000 });
  const sketchId = await sketchEntry(pageB).getAttribute(
    "data-history-sketch-id",
  );
  await expect
    .poll(() => sketchLines(pageB, sketchId!), { timeout: 30_000 })
    .toBe(1);
  // Re-review A-2: B received the image too (B's saved document).
  const savedB = await saveDocumentCopy<{
    sketches: {
      sketchId: string;
      definition: { referenceImages?: { label: string }[] };
    }[];
  }>(pageB);
  expect(
    savedB.sketches
      .find((sketch) => sketch.sketchId === sketchId)
      ?.definition.referenceImages?.map((image) => image.label),
  ).toEqual(["reference.png"]);

  await pageB.close();
  await pageA.close();
});

test("document Undo/Redo preserves the original identity and later sketch history stays independent", async ({
  page,
}, testInfo) => {
  const databaseName = `cad-e2e-sketch-identity-${testInfo.workerIndex}-${Date.now()}`;
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.openPreservingStorage(
    `/?${new URLSearchParams({ cadRepositoryDbName: databaseName, cadTestMode: "1" })}`,
  );

  const createPublishedLine = async (offset: number) => {
    await workbench.activateTool("Start a new sketch.");
    await page
      .getByRole("button", { name: /Top Plane/ })
      .first()
      .click();
    await workbench.activateTool("Create line geometry.");
    const canvas = page.locator("main canvas").first();
    await canvas.click({ position: { x: 360 + offset, y: 260 }, force: true });
    await canvas.click({ position: { x: 420 + offset, y: 320 }, force: true });
    await workbench.activateTool("Exit the active sketch.");
    await workbench.expectMachine("idle");
  };

  await createPublishedLine(0);
  const firstSketch = page.getByRole("button", {
    name: "Select Sketch Draft. Double-click to reopen.",
  });
  await expect(firstSketch).toBeVisible();
  const firstSketchId = await firstSketch.getAttribute(
    "data-history-sketch-id",
  );
  expect(firstSketchId).toMatch(/^sketch_[0-9a-f-]{36}$/);

  const cadToolbar = page.getByRole("toolbar", { name: "CAD tools" });
  await cadToolbar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(firstSketch).toHaveCount(0, { timeout: 30_000 });

  await cadToolbar.getByRole("button", { name: "Redo", exact: true }).click();
  const restoredFirst = page.getByRole("button", {
    name: "Select Sketch Draft. Double-click to reopen.",
  });
  await expect(restoredFirst).toBeVisible({ timeout: 30_000 });
  expect(await restoredFirst.getAttribute("data-history-sketch-id")).toBe(
    firstSketchId,
  );

  await cadToolbar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(restoredFirst).toHaveCount(0, { timeout: 30_000 });
  await createPublishedLine(80);
  const secondSketch = page.getByRole("button", {
    name: "Select Sketch Draft. Double-click to reopen.",
  });
  await expect(secondSketch).toBeVisible({ timeout: 30_000 });
  const secondSketchId = await secondSketch.getAttribute(
    "data-history-sketch-id",
  );
  expect(secondSketchId).toMatch(/^sketch_[0-9a-f-]{36}$/);
  expect(secondSketchId).not.toBe(firstSketchId);

  await secondSketch.dblclick({ force: true });
  await workbench.expectSketchSessionActive();
  const originalAction = page
    .locator('[data-history-action-direction="undo"]')
    .filter({ hasText: "Create Sketch Geometry" });
  await expect(originalAction).toBeVisible();
  await originalAction.click();
  const originalRedo = page
    .locator('[data-history-action-direction="redo"]')
    .filter({ hasText: "Create Sketch Geometry" });
  await expect(originalRedo).toBeVisible();
  await originalRedo.click();
  await expect(originalAction).toBeVisible();
});

async function refreshDocument(page: Page) {
  await page.evaluate(() => {
    window.__cadaraDebug?.refreshDocument();
  });
}
