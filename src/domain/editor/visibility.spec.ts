import { test, expect } from "vitest";

import {
  getAutoHiddenSketchTargetKeys,
  getSketchEditingOriginPlaneTargetKeys,
  getWorkbenchVisibilityState,
  reconcileVisibilityIntentKeys,
  toggleWorkbenchTargetVisibility,
} from "@/domain/editor/visibility";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { OCC_KERNEL_CONSTRUCTION_IDS } from "@/domain/modeling/opencascade-kernel-seed";

test("src/domain/editor/visibility.spec.ts", async () => {
  const adapter = new MockKernelAdapter();
  const response = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const snapshot = response.snapshot;
  const sketchTarget = snapshot.presentation.objects.find(
    (item) =>
      item.target.kind === "sketch" &&
      item.target.sketchId === "sketch_primary",
  )?.target;

  expect(
    sketchTarget?.kind,
    "Visibility fixture should expose the consumed primary sketch row.",
  ).toBe("sketch");

  const sketchKey = getPrimitiveRefKey(sketchTarget);
  const autoHiddenSketchTargetKeys = getAutoHiddenSketchTargetKeys(snapshot);

  expect(
    autoHiddenSketchTargetKeys[sketchKey],
    "Consumed sketch rows should derive auto-hidden state from snapshot consumption metadata.",
  ).toBeTruthy();

  const initialVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: {},
    explicitlyShownAutoHiddenTargetKeys: {},
  });

  expect(
    initialVisibility.effectiveHiddenTargetKeys[sketchKey],
    "Consumed sketch rows should start hidden when no explicit show override exists.",
  ).toBeTruthy();

  const originPlaneKeys = Object.values(OCC_KERNEL_CONSTRUCTION_IDS).map(
    (constructionId) =>
      getPrimitiveRefKey({ kind: "construction", constructionId }),
  );
  const originPlaneVisibility = getSketchEditingOriginPlaneTargetKeys(true);

  expect(
    originPlaneKeys.every((key) => originPlaneVisibility[key] === true),
    "Sketch editing should derive temporary hidden state for every origin plane.",
  ).toBeTruthy();

  const sketchEditingVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: {},
    explicitlyShownAutoHiddenTargetKeys: {},
    isSketchEditing: true,
  });

  expect(
    originPlaneKeys.every(
      (key) => sketchEditingVisibility.effectiveHiddenTargetKeys[key] === true,
    ),
    "Sketch editing should hide all origin planes without a user visibility toggle.",
  ).toBeTruthy();

  const exitedSketchVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: {},
    explicitlyShownAutoHiddenTargetKeys: {},
    isSketchEditing: false,
  });

  expect(
    originPlaneKeys.every(
      (key) => exitedSketchVisibility.effectiveHiddenTargetKeys[key] !== true,
    ),
    "Leaving sketch editing should restore origin-plane visibility when the user had not hidden them.",
  ).toBeTruthy();

  const explicitlyHiddenPlaneKey = originPlaneKeys[1];
  expect(
    explicitlyHiddenPlaneKey != null,
    "Origin-plane visibility fixture should include a YZ plane key.",
  ).toBeTruthy();

  const exitedWithPreviousPlaneHiddenVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: { [explicitlyHiddenPlaneKey]: true },
    explicitlyShownAutoHiddenTargetKeys: {},
    isSketchEditing: false,
  });

  expect(
    exitedWithPreviousPlaneHiddenVisibility.effectiveHiddenTargetKeys[
      explicitlyHiddenPlaneKey
    ],
    "Leaving sketch editing should preserve an origin plane that was already hidden.",
  ).toBeTruthy();

  const shownOverride = toggleWorkbenchTargetVisibility({
    target: sketchTarget,
    explicitHiddenTargetKeys: {},
    explicitlyShownAutoHiddenTargetKeys: {},
    effectiveHiddenTargetKeys: initialVisibility.effectiveHiddenTargetKeys,
    autoHiddenSketchTargetKeys: initialVisibility.autoHiddenSketchTargetKeys,
  });
  const shownVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: shownOverride.explicitHiddenTargetKeys,
    explicitlyShownAutoHiddenTargetKeys:
      shownOverride.explicitlyShownAutoHiddenTargetKeys,
  });

  expect(
    shownVisibility.effectiveHiddenTargetKeys[sketchKey],
    "Toggling an auto-hidden sketch should create a session-local show override.",
  ).not.toBeTruthy();

  const hiddenAgain = toggleWorkbenchTargetVisibility({
    target: sketchTarget,
    explicitHiddenTargetKeys: shownOverride.explicitHiddenTargetKeys,
    explicitlyShownAutoHiddenTargetKeys:
      shownOverride.explicitlyShownAutoHiddenTargetKeys,
    effectiveHiddenTargetKeys: shownVisibility.effectiveHiddenTargetKeys,
    autoHiddenSketchTargetKeys: shownVisibility.autoHiddenSketchTargetKeys,
  });
  const hiddenAgainVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: hiddenAgain.explicitHiddenTargetKeys,
    explicitlyShownAutoHiddenTargetKeys:
      hiddenAgain.explicitlyShownAutoHiddenTargetKeys,
  });

  expect(
    hiddenAgainVisibility.effectiveHiddenTargetKeys[sketchKey],
    "Toggling a shown consumed sketch again should fall back to the derived auto-hidden state.",
  ).toBeTruthy();

  const reconciled = reconcileVisibilityIntentKeys(
    {
      [sketchKey]: true,
      "sketch:stale": true,
    },
    new Set([sketchKey]),
  );

  expect(
    reconciled[sketchKey] === true && reconciled["sketch:stale"] !== true,
    "Visibility intent reconciliation should drop stale target keys after snapshot updates.",
  ).toBeTruthy();
});
