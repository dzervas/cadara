import { expect, test } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test("selects the top plane with a real left click in the viewport", async ({ page }) => {
	const workbench = new SketchWorkbenchHarness(page);

	await workbench.open();
	await workbench.clickViewportTargetReal("construction_plane-xy");

	await expect.poll(() => workbench.currentEditorSelection()).toContain("construction_plane-xy");
	await expect.poll(() => workbench.currentMachineSelectionCount()).toBe(1);
});

test("starts a sketch from the viewport with a real left click", async ({ page }) => {
	const workbench = new SketchWorkbenchHarness(page);

	await workbench.open();
	await workbench.activateTool("Start a new sketch.");
	await workbench.clickViewportTargetReal("construction_plane-xy");

	await workbench.expectMachine("editingSketch");
	await workbench.expectSketchPlane("XY");
	await expect.poll(() => workbench.currentEditorSelection()).toContain("construction_plane-xy");
	await expect.poll(() => workbench.currentMachineSelectionCount()).toBe(1);
});
